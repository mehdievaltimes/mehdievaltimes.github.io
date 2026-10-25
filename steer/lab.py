"""Steering lab: compute concept directions from contrastive sentences (concepts.json) and print
greedy generations at several strengths so the slider range can be chosen. The byte patch and the
export are in common.py.

Usage: python steer/lab.py <hf repo> <onnx file> <layers,comma,separated>
"""
import json, os, sys, time
import numpy as np
from common import *

ALL = json.load(open(f'{HERE}/concepts.json'))
# The concept to steer toward, and optionally a second one mixed in (MIXES sets how much).
CONCEPT, MIX_CONCEPT = os.environ.get('CONCEPT', 'roaree'), os.environ.get('MIX_CONCEPT') or None
CONCEPTS = {k: ALL[k] for k in [CONCEPT, MIX_CONCEPT] if k}

COEFS = [float(x) for x in os.environ.get('COEFS', '0.4,0.5,0.6').split(',')]
FULL = COEFS
MIXES = [float(x) for x in os.environ.get('MIXES', '0.5,1.0').split(',')] if MIX_CONCEPT else [0.0]
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
            r, _ = residuals(sess, layer, text)
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
    main, scale = results[(layer, CONCEPT)]
    second = results[(layer, MIX_CONCEPT)][0] if MIX_CONCEPT else np.zeros_like(main)
    if MIX_CONCEPT:
        print(f'  cos({CONCEPT}, {MIX_CONCEPT}) = {float(main @ second):.2f}')
    for c_mix in MIXES:
        mixed = main + c_mix * second
        mixed /= np.linalg.norm(mixed)
        for coef in COEFS:
            steer = mixed * coef * scale
            for p in PROMPTS[: len(PROMPTS) if coef in FULL else 1]:
                text = generate(sess, chat(p), steer).replace('\n', ' / ')
                print(f'  L{layer} mix{c_mix} x{coef:<4} {p[:28]:28s} -> {text}')
            sys.stdout.flush()

# The browser's config for the chosen layer.
if os.environ.get('EXPORT_LAYER'):
    layer = int(os.environ['EXPORT_LAYER'])
    main, scale = results[(layer, CONCEPT)]
    mix = float(os.environ.get('EXPORT_MIX') or 0)
    unit = main + (mix * results[(layer, MIX_CONCEPT)][0] if MIX_CONCEPT else 0)
    export(layer, unit, scale, concept=CONCEPT, pairs=len(ALL[CONCEPT]['pairs']), mixConcept=MIX_CONCEPT,
           mixPairs=len(ALL[MIX_CONCEPT]['pairs']) if MIX_CONCEPT else 0, mix=mix)
