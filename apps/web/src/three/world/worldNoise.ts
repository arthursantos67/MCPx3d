/**
 * Deterministic noise for world generation. Integer hashing (Math.imul) and plain float64 arithmetic only, so the
 * same inputs give bit-identical results on the main thread, in workers and in Node tests.
 */
export function hash2(ix: number, iz: number, seed: number): number {
  let h = Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iz | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1)
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/** Small seeded PRNG (mulberry32) for sequential simulations such as erosion. */
export function random(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface NoiseSample { value: number; dx: number; dz: number }

/** Value noise in [-1, 1] with quintic fade and analytic derivatives. */
export function noised(x: number, z: number, seed: number, out: NoiseSample): NoiseSample {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10), w = fz * fz * fz * (fz * (fz * 6 - 15) + 10)
  const du = 30 * fx * fx * (fx * (fx - 2) + 1), dw = 30 * fz * fz * (fz * (fz - 2) + 1)
  const a = hash2(ix, iz, seed) * 2 - 1, b = hash2(ix + 1, iz, seed) * 2 - 1, c = hash2(ix, iz + 1, seed) * 2 - 1, d = hash2(ix + 1, iz + 1, seed) * 2 - 1
  const k1 = b - a, k2 = c - a, k3 = a - b - c + d
  out.value = a + k1 * u + k2 * w + k3 * u * w
  out.dx = du * (k1 + k3 * w)
  out.dz = dw * (k2 + k3 * u)
  return out
}

export const smoothstep = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }
