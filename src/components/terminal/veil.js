// Keeps a few strings in the terminal's data from being readable in the source or the
// shipped JS. It's an XOR keystream, not encryption: it stops grep and view-source,
// not someone who reads this file and runs it. Shared by fs.ts and scripts/veil.mjs.

const SEED = 'refs/heads/main';

function keystream(n) {
  // FNV-1a of the seed, then xorshift32.
  let x = 0x811c9dc5;
  for (const c of SEED) x = Math.imul(x ^ c.charCodeAt(0), 0x01000193) >>> 0;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5; x >>>= 0;
    out[i] = x & 0xff;
  }
  return out;
}

/** Plain text → hex (looks like any other git object id in the data). */
export function veil(text) {
  const bytes = new TextEncoder().encode(text);
  const k = keystream(bytes.length);
  return [...bytes].map((b, i) => (b ^ k[i]).toString(16).padStart(2, '0')).join('');
}

/** Hex from veil() → the original text. */
export function unveil(hex) {
  const bytes = new Uint8Array(hex.match(/../g).map((h) => parseInt(h, 16)));
  const k = keystream(bytes.length);
  return new TextDecoder().decode(bytes.map((b, i) => b ^ k[i]));
}
