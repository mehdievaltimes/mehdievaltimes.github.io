"""Train the tiny transformer behind the induction-head demo on /demos.

A character-level, two-layer, attention-only transformer: token and position embeddings,
two layers of four attention heads each writing into the residual stream, an unembedding.
No MLPs, so the browser can run the whole forward pass in a few lines of JS. Each layer reads
the residual stream through a LayerNorm, which is what lets training get off its plateau.

The training text is uniformly random characters with spans copied from earlier in the
same sequence. Random characters can't be predicted, so the only way to lower the loss is
to notice a repeat and copy what came after the last occurrence: an induction head.

    pip install jax optax numpy
    python scripts/induction/train.py        # ~2 min on a laptop CPU
    -> public/models/induction-2l.json
"""
import base64
import json
import math
import time
from pathlib import Path

import jax
import jax.numpy as jnp
import numpy as np
import optax

CHARS = "abcdefghijklmnopqrstuvwxyz0123456789 .,!?'-"
V = len(CHARS) + 1  # token 0 is the start-of-text marker
T = 100             # context length, start marker included
D, H = 64, 4        # residual width, heads per layer
DH = D // H
LAYERS = 2
STEPS, BATCH, LR, SEED = 6000, 64, 1e-3, 0

OUT = Path(__file__).resolve().parents[2] / "public" / "models" / "induction-2l.json"


def batch(rng: np.random.Generator, b: int) -> np.ndarray:
    """Random characters with one or two earlier spans copied later in the sequence."""
    x = rng.integers(1, V, size=(b, T))
    x[:, 0] = 0
    for row in x:
        if rng.random() < 0.5:
            # The whole opening repeated, the classic induction setup.
            n = rng.integers(5, (T - 1) // 2 + 1)
            row[1 + n : 1 + 2 * n] = row[1 : 1 + n]
            continue
        for _ in range(rng.integers(1, 3)):
            k = rng.integers(4, 31)
            a = rng.integers(1, T - 2 * k)
            c = rng.integers(a + k, T - k + 1)
            row[c : c + k] = row[a : a + k]
    return x


def init(key):
    ks = jax.random.split(key, 8)
    n = lambda k, shape, std: std * jax.random.normal(k, shape)
    return {
        "W_E": n(ks[0], (V, D), 0.02),
        "W_pos": n(ks[1], (T, D), 0.01),
        "W_Q": n(ks[2], (LAYERS, H, D, DH), 0.02),
        "W_K": n(ks[3], (LAYERS, H, D, DH), 0.02),
        "W_V": n(ks[4], (LAYERS, H, D, DH), 0.02),
        "W_O": n(ks[5], (LAYERS, H, DH, D), 0.02 / math.sqrt(2 * LAYERS)),
        "W_U": n(ks[6], (D, V), 0.02),
        # LayerNorm gain and bias: one per layer, plus one before the unembedding.
        "ln_w": jnp.ones((LAYERS + 1, D)),
        "ln_b": jnp.zeros((LAYERS + 1, D)),
    }


def ln(p, i, x):
    x = x - x.mean(-1, keepdims=True)
    return x / jnp.sqrt((x * x).mean(-1, keepdims=True) + 1e-5) * p["ln_w"][i] + p["ln_b"][i]


def forward(p, tokens, keep=None):
    """tokens [B, n] -> logits [B, n, V], attention [LAYERS, B, H, n, n]."""
    n = tokens.shape[1]
    x = p["W_E"][tokens] + p["W_pos"][:n]
    mask = jnp.tril(jnp.ones((n, n), bool))
    patterns = []
    for l in range(LAYERS):
        r = ln(p, l, x)
        q = jnp.einsum("bnd,hde->bhne", r, p["W_Q"][l])
        k = jnp.einsum("bnd,hde->bhne", r, p["W_K"][l])
        v = jnp.einsum("bnd,hde->bhne", r, p["W_V"][l])
        s = jnp.einsum("bhqe,bhke->bhqk", q, k) / math.sqrt(DH)
        a = jax.nn.softmax(jnp.where(mask, s, -1e9), axis=-1)
        z = jnp.einsum("bhqk,bhke->bhqe", a, v)
        out = jnp.einsum("bhqe,hed->bhqd", z, p["W_O"][l])
        if keep is not None:
            out = out * keep[l][None, :, None, None]
        x = x + out.sum(1)
        patterns.append(a)
    return ln(p, LAYERS, x) @ p["W_U"], jnp.stack(patterns)


def loss_fn(p, tokens):
    logits, _ = forward(p, tokens[:, :-1])
    return optax.softmax_cross_entropy_with_integer_labels(logits, tokens[:, 1:]).mean()


def head_scores(p, rng):
    """Per head: mean attention to the previous token, and induction score on a repeated random half."""
    n = (T - 1) // 2
    x = rng.integers(1, V, size=(64, 1 + 2 * n))
    x[:, 0] = 0
    x[:, 1 + n :] = x[:, 1 : 1 + n]
    _, a = forward(p, jnp.array(x))
    a = np.asarray(a).mean(1)  # [L, H, q, k]
    idx = np.arange(1, a.shape[-1])
    prev = a[:, :, idx, idx - 1].mean(-1)
    q = np.arange(1 + n, 1 + 2 * n)
    ind = a[:, :, q, q - n + 1].mean(-1)
    return prev, ind


def repeat_loss(p, rng, keep=None):
    """Loss on the second copy of a repeated random string, and on the first."""
    n = 40
    x = rng.integers(1, V, size=(128, 1 + 2 * n))
    x[:, 0] = 0
    x[:, 1 + n :] = x[:, 1 : 1 + n]
    logits, _ = forward(p, jnp.array(x[:, :-1]), keep)
    ce = np.asarray(optax.softmax_cross_entropy_with_integer_labels(logits, jnp.array(x[:, 1:])))
    return ce[:, : n - 1].mean(), ce[:, n + 1 :].mean()


def main():
    rng = np.random.default_rng(SEED)
    p = init(jax.random.PRNGKey(SEED))
    sched = optax.warmup_cosine_decay_schedule(0, LR, 200, STEPS, LR / 10)
    opt = optax.adamw(sched, weight_decay=0.01)
    state = opt.init(p)

    @jax.jit
    def step(p, state, tokens):
        l, g = jax.value_and_grad(loss_fn)(p, tokens)
        updates, state = opt.update(g, state, p)
        return optax.apply_updates(p, updates), state, l

    t0 = time.time()
    for i in range(1, STEPS + 1):
        p, state, l = step(p, state, jnp.array(batch(rng, BATCH)))
        if i % 500 == 0 or i == 1:
            first, second = repeat_loss(p, rng)
            print(f"step {i:5d}  loss {float(l):.3f}  first copy {first:.2f}  second copy {second:.2f}  ({time.time() - t0:.0f}s)")

    prev, ind = head_scores(p, rng)
    first, second = repeat_loss(p, rng)
    print("previous-token score\n", np.round(prev, 2), "\ninduction score\n", np.round(ind, 2))
    print(f"chance: {math.log(V - 1):.2f} nats. first copy {first:.2f}, second copy {second:.2f}")

    f32 = lambda a: base64.b64encode(np.asarray(a, np.float32).tobytes()).decode()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({
        "about": "2-layer attention-only transformer, trained by scripts/induction/train.py",
        "chars": CHARS, "vocab": V, "ctx": T, "d_model": D, "n_heads": H, "d_head": DH, "n_layers": LAYERS,
        "steps": STEPS, "loss": {"first_copy": round(float(first), 3), "second_copy": round(float(second), 3)},
        "weights": {k: {"shape": list(v.shape), "data": f32(v)} for k, v in p.items()},
    }))
    print(f"wrote {OUT} ({OUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
