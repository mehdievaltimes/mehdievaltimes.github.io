"""SAE lab: find features of a sparse autoencoder trained on this model's residual stream that fire
on a concept, show the tokens they fire on, and steer with a feature's decoder direction, which is
what Golden Gate Claude did with its bridge feature. Concept prompts are in sae-concepts.json.

Usage: python steer/sae.py <hf repo> <onnx file> <layers,comma,separated>
Env: SAE_REPO, CONCEPTS (comma separated), TOP (features shown per concept), COEFS,
     EXPORT_LAYER + EXPORT_FEATURE (+ EXPORT_CONCEPT, MAX, DEFAULT) to write steer.json.
"""
import json, os, sys
import numpy as np
from common import *

SAE_REPO = os.environ.get('SAE_REPO', 'HuggingAnalist/sae-qwen2.5-0.5B-res')
ALL = json.load(open(f'{HERE}/sae-concepts.json'))
NEUTRAL = ALL.pop('neutral')['texts']
NAMES = [c for c in os.environ.get('CONCEPTS', ','.join(ALL)).split(',') if c]
TOP = int(os.environ.get('TOP', '4'))
COEFS = [float(x) for x in os.environ.get('COEFS', '0.4,0.8,1.2').split(',')]

files = HfApi().list_repo_files(SAE_REPO)
sae_sha = HfApi().model_info(SAE_REPO).sha
print(f'SAE {SAE_REPO} @ {sae_sha}: {len(files)} files')
for f in files[:40]:
    print('  ' + f)


def load_file(path):
    """A .safetensors file as float32 numpy arrays (bfloat16 included, which numpy has no type for)."""
    buf = open(path, 'rb').read()
    n = int.from_bytes(buf[:8], 'little')
    header, data = json.loads(buf[8:8 + n]), memoryview(buf)[8 + n:]
    types = {'F32': np.float32, 'F16': np.float16, 'F64': np.float64}
    out = {}
    for k, v in header.items():
        if k == '__metadata__':
            continue
        a, b = v['data_offsets']
        if v['dtype'] == 'BF16':
            arr = (np.frombuffer(data[a:b], np.uint16).astype(np.uint32) << 16).view(np.float32)
        else:
            arr = np.frombuffer(data[a:b], types[v['dtype']])
        out[k] = arr.reshape(v['shape']).astype(np.float32)
    return out


def load_sae(layer):
    """The SAE for this layer: weights plus cfg, from the first folder whose path names the layer."""
    tag = [f'layer_{layer}/', f'layers.{layer}/', f'layer{layer}/', f'blocks.{layer}.']
    cfgs = [f for f in files if f.endswith('cfg.json') and any(t in f for t in tag)]
    assert cfgs, f'no SAE cfg.json for layer {layer}'
    folder = cfgs[0].rsplit('/', 1)[0]
    weights = [f for f in files if f.startswith(folder + '/') and f.endswith('.safetensors')]
    c = json.load(open(hf_hub_download(SAE_REPO, cfgs[0], revision=sae_sha)))
    w = load_file(hf_hub_download(SAE_REPO, weights[0], revision=sae_sha))
    print(f'\nSAE layer {layer}: {folder} cfg ' + json.dumps({k: v for k, v in c.items() if not isinstance(v, (dict, list)) or k == 'metadata'})[:1500])
    print('  tensors: ' + ', '.join(f'{k} {tuple(v.shape)}' for k, v in w.items()))
    return folder, c, w


def encoder(c, w):
    """x [tokens, hidden] -> feature activations [tokens, d_sae], for the common SAELens architectures."""
    W_enc, b_enc, b_dec = w['W_enc'], w['b_enc'], w.get('b_dec', 0)
    arch = c.get('architecture', 'standard')
    k = c.get('k') or c.get('activation_fn_kwargs', {}).get('k')
    sub = c.get('apply_b_dec_to_input', True)
    norm = c.get('normalize_activations', 'none')

    def enc(x):
        if norm and norm not in ('none', None):
            x = x * (np.sqrt(x.shape[1]) / np.linalg.norm(x, axis=1, keepdims=True))
        pre = (x - (b_dec if sub else 0)) @ W_enc + b_enc
        if arch == 'jumprelu':
            return pre * (pre > w['threshold'])
        if arch == 'topk' or k:
            out = np.zeros_like(pre)
            idx = np.argpartition(-pre, int(k), axis=1)[:, :int(k)]
            np.put_along_axis(out, idx, np.maximum(np.take_along_axis(pre, idx, 1), 0), 1)
            return out
        return np.maximum(pre, 0)
    return enc


picked = {}
for layer in LAYERS:
    folder, c, w = load_sae(layer)
    enc = encoder(c, w)
    W_dec = w['W_dec']
    sess = session(patch(layer, readout=True)[0])

    def feats(texts):
        rows, toks = [], []
        for t in texts:
            r, ids = residuals(sess, layer, t)
            rows.append(enc(r))
            toks += [tok.decode([i]) for i in ids]
        return np.concatenate(rows), toks

    base, _ = feats(NEUTRAL)
    norm = float(np.mean([np.linalg.norm(residuals(sess, layer, t)[0], axis=1).mean() for t in NEUTRAL]))
    r0, _ = residuals(sess, layer, NEUTRAL[0])
    f0 = enc(r0)
    rec = f0 @ W_dec + w.get('b_dec', 0)
    print(f'  residual norm ~{norm:.1f}; L0 on neutral text {np.mean((base > 0).sum(1)):.0f}; '
          f'explained variance on one sentence {1 - ((r0 - rec) ** 2).sum() / ((r0 - r0.mean(0)) ** 2).sum():.2f}')
    base_mean, base_rate = base.mean(0), (base > 0).mean(0)
    for name in NAMES:
        acts, toks = feats(ALL[name]['texts'])
        score = acts.mean(0) - base_mean
        best = np.argsort(-score)[:TOP]
        print(f'\n[{name}] L{layer} top features (mean on concept - mean on neutral; how often it fires on neutral):')
        for i in best:
            top_tok = np.argsort(-acts[:, i])[:6]
            print(f'  #{i:<6} score {score[i]:6.2f}  neutral rate {base_rate[i]:.3f}  dec norm {np.linalg.norm(W_dec[i]):.2f}  '
                  f'fires on: ' + ' '.join(f'{toks[j]!r}:{acts[j, i]:.1f}' for j in top_tok))
        i = int(best[0])
        picked[(layer, name)] = (i, W_dec[i] / np.linalg.norm(W_dec[i]), norm)
        for coef in COEFS:
            steer = picked[(layer, name)][1] * coef * norm
            for p in PROMPTS:
                print(f'  L{layer} #{i} x{coef:<4} {p[:28]:28s} -> ' + generate(sess, chat(p), steer).replace('\n', ' / '))
            sys.stdout.flush()

if os.environ.get('EXPORT_LAYER'):
    layer, feature = int(os.environ['EXPORT_LAYER']), int(os.environ['EXPORT_FEATURE'])
    folder, c, w = load_sae(layer)
    norm = picked.get((layer, os.environ.get('EXPORT_CONCEPT')), (None, None, None))[2] or float(os.environ['SCALE'])
    export(layer, w['W_dec'][feature], norm, sae={'repo': SAE_REPO, 'revision': sae_sha, 'folder': folder, 'feature': feature,
           'dSae': int(w['W_dec'].shape[0])}, concept=os.environ.get('EXPORT_CONCEPT'))
