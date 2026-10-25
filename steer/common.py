"""What the steering scripts share: the model, the byte patch the browser applies, generation, and
the steer.json export. lab.py finds directions from contrastive sentences; sae.py uses SAE features.

The patch is the one the browser will apply, byte for byte:
  1. rename the output of the layer-L residual Add (same length, so no protobuf lengths change)
  2. append a serialized ModelProto whose graph adds a `steer` input and
     Add(renamed, Cast(steer)) -> original name
Protobuf merges a repeated message's fields when a message is appended, so the appended nodes and
input join the original graph and every consumer of the original name now reads the steered value.
The fragment also adds `last_logits` (the last position only), so the browser never has to copy the
full [1, T, vocab] logits off the GPU.

Scripts take: <hf repo> <onnx file> <layers,comma,separated>
"""
import json, os, sys, time
import numpy as np
import onnx
from onnx import helper, TensorProto
import onnxruntime as ort
from huggingface_hub import HfApi, hf_hub_download
from tokenizers import Tokenizer

REPO, FILE, LAYERS = sys.argv[1], sys.argv[2], [int(x) for x in sys.argv[3].split(',')]
HERE = __file__.rsplit('/', 1)[0]

sha = HfApi().model_info(REPO).sha
print(f'model {REPO} @ {sha} / {FILE}')
raw = open(hf_hub_download(REPO, FILE, revision=sha), 'rb').read()
tok = Tokenizer.from_file(hf_hub_download(REPO, 'tokenizer.json', revision=sha))
cfg = json.load(open(hf_hub_download(REPO, 'config.json', revision=sha)))
HIDDEN = cfg['hidden_size']
F16 = 'f16' in FILE  # q4f16 graphs compute in fp16 and cast float32 graph inputs/outputs


def residual(layer): return f'/model/layers.{layer}/Add_1_output_0'
def renamed(layer): return residual(layer)[:-1] + 's'


def fragment(layer, readout=False):
    """The bytes appended to the model: steer input, Cast, Add, and optionally the pre-steer residual as an output."""
    t = TensorProto.FLOAT16 if F16 else TensorProto.FLOAT
    nodes = []
    steer = 'steer'
    if F16:
        nodes.append(helper.make_node('Cast', ['steer'], ['steer_h'], name='/steer/Cast', to=TensorProto.FLOAT16))
        steer = 'steer_h'
    nodes.append(helper.make_node('Add', [renamed(layer), steer], [residual(layer)], name='/steer/Add'))
    nodes.append(helper.make_node('Slice', ['logits', 'steer_last_start', 'steer_last_end', 'steer_last_axis'], ['last_logits'], name='/steer/Slice'))
    graph = onnx.GraphProto()
    graph.node.extend(nodes)
    graph.initializer.extend([
        helper.make_tensor('steer_last_start', TensorProto.INT64, [1], [-1]),
        helper.make_tensor('steer_last_end', TensorProto.INT64, [1], [2**62]),
        helper.make_tensor('steer_last_axis', TensorProto.INT64, [1], [1]),
    ])
    graph.input.append(helper.make_tensor_value_info('steer', TensorProto.FLOAT, [HIDDEN]))
    graph.output.append(helper.make_tensor_value_info('last_logits', TensorProto.FLOAT, ['batch_size', 1, cfg['vocab_size']]))
    if readout:
        graph.output.append(helper.make_tensor_value_info(renamed(layer), t, ['batch_size', 'sequence_length', HIDDEN]))
    model = onnx.ModelProto()
    model.graph.CopyFrom(graph)
    return model.SerializeToString()


def patch(layer, readout=False):
    name = residual(layer).encode()
    needle = bytes([0x12, len(name)]) + name  # NodeProto.output (field 2, length-delimited)
    at = raw.find(needle)
    assert at >= 0 and raw.find(needle, at + 1) < 0, f'expected exactly one producer of {residual(layer)}'
    patched = bytearray(raw)
    patched[at + len(needle) - 1] = ord('s')
    return bytes(patched) + fragment(layer, readout), at + len(needle) - 1


def session(model_bytes):
    so = ort.SessionOptions()
    so.log_severity_level = 3
    return ort.InferenceSession(model_bytes, so, providers=['CPUExecutionProvider'])


def empty_past(sess):
    feeds = {}
    for i in sess.get_inputs():
        if i.name.startswith('past_key_values'):
            dt = np.float16 if 'float16' in i.type else np.float32
            feeds[i.name] = np.zeros((1, i.shape[1], 0, i.shape[3]), dtype=dt)
    return feeds


def chat(user):
    return (f'<|im_start|>system\nYou are a helpful assistant.<|im_end|>\n'
            f'<|im_start|>user\n{user}<|im_end|>\n<|im_start|>assistant\n')


def generate(sess, prompt, steer, max_new=60, rep=1.1):
    ids = tok.encode(prompt).ids
    past = empty_past(sess)
    out_ids, cur = [], ids
    eos = {tok.token_to_id('<|im_end|>'), tok.token_to_id('<|endoftext|>')}
    for _ in range(max_new):
        n_past = next(iter(past.values())).shape[2]
        feeds = {
            'input_ids': np.array([cur], dtype=np.int64),
            'attention_mask': np.ones((1, n_past + len(cur)), dtype=np.int64),
            'position_ids': np.arange(n_past, n_past + len(cur), dtype=np.int64)[None],
            'steer': steer.astype(np.float32),
            **past,
        }
        names = ['last_logits'] + [o.name for o in sess.get_outputs() if o.name.startswith('present')]
        outs = dict(zip(names, sess.run(names, feeds)))
        logits = outs['last_logits'][0, -1].astype(np.float32)
        for t in set(ids + out_ids):  # repetition penalty, as in the browser
            logits[t] = logits[t] / rep if logits[t] > 0 else logits[t] * rep
        nxt = int(np.argmax(logits))
        if nxt in eos:
            break
        out_ids.append(nxt)
        cur = [nxt]
        past = {k.replace('present', 'past_key_values'): v for k, v in outs.items() if k.startswith('present')}
    return tok.decode(out_ids)


PROMPTS = ['Tell me about yourself in two sentences.', "What's 2+2?", 'What should I eat for dinner tonight?', 'Explain gravity in one sentence.']


def residuals(sess, layer, text):
    """The layer's residual stream for each token of `text` (first token, the attention sink, dropped)."""
    ids = tok.encode(text).ids
    feeds = {'input_ids': np.array([ids], dtype=np.int64), 'attention_mask': np.ones((1, len(ids)), dtype=np.int64),
             'position_ids': np.arange(len(ids), dtype=np.int64)[None], 'steer': np.zeros(HIDDEN, dtype=np.float32), **empty_past(sess)}
    return sess.run([renamed(layer)], feeds)[0][0, 1:].astype(np.float32), ids[1:]


def b64(v):
    import base64
    return base64.b64encode(np.asarray(v, dtype=np.float32).tobytes()).decode()


def export(layer, unit, scale, **extra):
    """Write steer.json, everything the page needs besides the model, and print it for the logs."""
    import base64
    _, offset = patch(layer)
    text = chat('Tell me about yourself.')
    out = {
        'repo': REPO, 'revision': sha, 'file': FILE, 'size': len(raw), 'offset': offset,
        'fragment': base64.b64encode(fragment(layer)).decode(),
        'layer': layer, 'hidden': HIDDEN, 'layers': cfg['num_hidden_layers'], 'kvHeads': cfg['num_key_value_heads'],
        'headDim': HIDDEN // cfg['num_attention_heads'], 'eos': [tok.token_to_id('<|im_end|>'), tok.token_to_id('<|endoftext|>')],
        'scale': scale, 'max': float(os.environ['MAX']),
        **({'unit': b64(unit / np.linalg.norm(unit)), 'default': float(os.environ['DEFAULT'])} if unit is not None else {}), **extra,
        'check': {'text': text, 'ids': tok.encode(text).ids},
    }
    os.makedirs(f'{HERE}/out', exist_ok=True)
    json.dump(out, open(f'{HERE}/out/steer.json', 'w'), indent=1)
    print('STEERJSON ' + json.dumps(out))
