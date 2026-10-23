"""Roaree lab: build a steering patch for a small ONNX chat model, compute concept directions,
and print greedy generations at several strengths so the slider range can be chosen.

The patch is the one the browser will apply, byte for byte:
  1. rename the output of the layer-L residual Add (same length, so no protobuf lengths change)
  2. append a serialized ModelProto whose graph adds a `steer` input and
     Add(renamed, Cast(steer)) -> original name
Protobuf merges a repeated message's fields when a message is appended, so the appended nodes and
input join the original graph and every consumer of the original name now reads the steered value.
The fragment also adds `last_logits` (the last position only), so the browser never has to copy the
full [1, T, vocab] logits off the GPU.

Usage: python steer/lab.py <hf repo> <onnx file> <layers,comma,separated>
"""
import json, sys, time
import numpy as np
import onnx
from onnx import helper, TensorProto
import onnxruntime as ort
from huggingface_hub import HfApi, hf_hub_download
from tokenizers import Tokenizer

REPO, FILE, LAYERS = sys.argv[1], sys.argv[2], [int(x) for x in sys.argv[3].split(',')]
HERE = __file__.rsplit('/', 1)[0]
CONCEPTS = json.load(open(f'{HERE}/concepts.json'))

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
COEFS = [0, 0.3, 0.4, 0.5, 0.6, 0.7]
FULL = (0, 0.4, 0.5, 0.6)
results = {}
for layer in LAYERS:
    t0 = time.time()
    model_bytes, at = patch(layer, readout=True)
    sess = session(model_bytes)
    print(f'\n=== layer {layer}: patched byte {at}, session ready in {time.time() - t0:.1f}s')
    zero = np.zeros(HIDDEN, dtype=np.float32)
    if layer == LAYERS[0]:  # the Slice must return exactly the last row of the real logits
        ids = tok.encode(chat('Hi!')).ids
        feeds = {'input_ids': np.array([ids], dtype=np.int64), 'attention_mask': np.ones((1, len(ids)), dtype=np.int64),
                 'position_ids': np.arange(len(ids), dtype=np.int64)[None], 'steer': zero, **empty_past(sess)}
        full, last = sess.run(['logits', 'last_logits'], feeds)
        print(f'last_logits check: shapes {full.shape} {last.shape}, max diff {np.abs(full[:, -1:] - last).max()}')
        print('inputs: ' + json.dumps([[i.name, i.type, i.shape] for i in sess.get_inputs()][:5] + [['...', len(sess.get_inputs())]]))

    def acts(texts):
        rows, norms = [], []
        for text in texts:
            ids = tok.encode(text).ids
            feeds = {'input_ids': np.array([ids], dtype=np.int64), 'attention_mask': np.ones((1, len(ids)), dtype=np.int64),
                     'position_ids': np.arange(len(ids), dtype=np.int64)[None], 'steer': zero, **empty_past(sess)}
            r = sess.run([renamed(layer)], feeds)[0][0, 1:].astype(np.float32)  # skip the first token (attention sink)
            rows.append(r.mean(0))
            norms.append(np.linalg.norm(r, axis=1).mean())
        return np.array(rows), float(np.mean(norms))

    for key, c in CONCEPTS.items():
        pos, npos = acts([a for a, _ in c['pairs']])
        neg, nneg = acts([b for _, b in c['pairs']])
        diff = pos.mean(0) - neg.mean(0)
        unit = diff / np.linalg.norm(diff)
        scale = (npos + nneg) / 2
        # How well the direction separates held-in prompts: projections of each side.
        print(f'[{key}] residual norm ~{scale:.1f}, |diff| {np.linalg.norm(diff):.1f}, '
              f'proj pos {np.mean(pos @ unit):.1f} vs neg {np.mean(neg @ unit):.1f}')
        results[(layer, key)] = (unit, scale)
        for coef in COEFS:
            steer = unit * coef * scale
            for p in PROMPTS[: len(PROMPTS) if coef in FULL else 1]:
                text = generate(sess, chat(p), steer).replace('\n', ' / ')
                print(f'  L{layer} x{coef:<4} {p[:28]:28s} -> {text}')
        sys.stdout.flush()

# The browser needs, per layer and concept: the unit direction (float32, base64) and the residual scale.
import base64
export = {f'{k}@{layer}': {'layer': layer, 'scale': s, 'unit': base64.b64encode(u.astype(np.float32).tobytes()).decode()}
          for (layer, k), (u, s) in results.items()}
print('\nEXPORT ' + json.dumps({'repo': REPO, 'revision': sha, 'file': FILE, 'hidden': HIDDEN, 'f16': F16, 'vectors': export}))
for layer in LAYERS:
    print(f'FRAGMENT {layer} ' + base64.b64encode(fragment(layer)).decode())
