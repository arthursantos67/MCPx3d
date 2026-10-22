import type { SceneMaterial } from './sceneDocument.ts'
import { adjacency, gradient, type Field } from './sceneSkinGeometry.ts'

type V3 = [number, number, number]
export interface SlotMaterial { color: string; roughness: number; metalness: number; sheen: number; clearcoat: number; emissive: string; emissiveIntensity: number; pattern: number }
export const PATTERN = { skin: 0, cloth: 1, leather: 2, metal: 3, fur: 4, scales: 5, mail: 6, plain: 7, hair: 8 } as const
/** Material slots per vertex (three vec4 attributes). */
export const SLOTS = 12
export const MATERIAL_BODY = 0, MATERIAL_SHELL = 1, MATERIAL_HAIR = 2, MATERIAL_EYE = 3

function slotPattern(m: Partial<SceneMaterial>): number {
  const t = m.texture
  if (t === 'metal' || t === 'rust') return PATTERN.metal
  if (t === 'tiles') return PATTERN.scales
  if (t === 'fabric') {
    if ((m.metalness ?? 0) > 0.5) return PATTERN.mail
    if ((m.sheen ?? 0) >= 0.7 && (m.roughness ?? 0) >= 0.9) return PATTERN.fur
    if ((m.clearcoat ?? 0) >= 0.15) return PATTERN.leather
    return PATTERN.cloth
  }
  if (!t && (m.sheen ?? 0) > 0.2 && (m.clearcoat ?? 0) > 0) return PATTERN.skin
  return PATTERN.plain
}
export function slotOf(m: Partial<SceneMaterial> | undefined): SlotMaterial {
  const mat = m ?? {}
  return { color: mat.color ?? '#cccccc', roughness: mat.roughness ?? 0.6, metalness: mat.metalness ?? 0, sheen: mat.sheen ?? 0, clearcoat: mat.clearcoat ?? 0,
    emissive: mat.emissive ?? '#000000', emissiveIntensity: mat.emissive ? mat.emissiveIntensity ?? 1 : 0, pattern: slotPattern(mat) }
}
const slotKey = (s: SlotMaterial) => JSON.stringify(s)
const hexRgb = (hex: string) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255] }
/** Registers slots, merging the closest colours once all eight are used. */
export class SlotTable {
  slots: SlotMaterial[] = []
  private keys = new Map<string, number>()
  add(slot: SlotMaterial): number {
    const key = slotKey(slot), known = this.keys.get(key)
    if (known !== undefined) return known
    if (this.slots.length >= SLOTS) {
      const [r, g, b] = hexRgb(slot.color)
      let best = 0, score = Infinity
      this.slots.forEach((other, i) => { const [r2, g2, b2] = hexRgb(other.color), d = (r - r2) ** 2 + (g - g2) ** 2 + (b - b2) ** 2 + (other.pattern === slot.pattern ? 0 : 4000); if (d < score) { score = d; best = i } })
      this.keys.set(key, best)
      return best
    }
    this.slots.push(slot); this.keys.set(key, this.slots.length - 1)
    return this.slots.length - 1
  }
}

/** One mesh piece before assembly. Per vertex: up to four (bone, weight) pairs and eight slot distances. */
export interface Piece {
  name: string; material: number; positions: number[]; normals: number[]; uvs: number[]; colors: number[]; bones: number[]; weights: number[]; slots: number[]; indices: number[]; body?: boolean
}
export const emptyPiece = (name: string, material: number): Piece => ({ name, material, positions: [], normals: [], uvs: [], colors: [], bones: [], weights: [], slots: [], indices: [] })
/** Slot vector that selects a single slot. */
export const singleSlot = (slot: number) => { const out = new Array(SLOTS).fill(0.05); out[slot] = 0; return out }

export function pushWeights(piece: Piece, accum: Map<number, number>): void {
  const entries = [...accum].sort((a, b) => b[1] - a[1]).slice(0, 4), total = entries.reduce((sum, [, w]) => sum + w, 0) || 1
  for (let i = 0; i < 4; i++) { piece.bones.push(entries[i]?.[0] ?? 0); piece.weights.push(entries[i] ? entries[i][1] / total : 0) }
}
/** Laplacian smoothing of skin weights over the mesh graph (keeps four influences per vertex). */
export function smoothWeights(piece: Piece, indices: number[], iterations: number): void {
  const count = piece.positions.length / 3, { offsets, list } = adjacency(count, indices)
  let maxBone = 0
  for (const b of piece.bones) maxBone = Math.max(maxBone, b)
  const sum = new Float64Array(maxBone + 1), touched: number[] = []
  for (let it = 0; it < iterations; it++) {
    const bones = new Array<number>(count * 4), weights = new Array<number>(count * 4)
    for (let v = 0; v < count; v++) {
      const n = Math.max(1, offsets[v + 1] - offsets[v])
      const add = (u: number, f: number) => { for (let i = 0; i < 4; i++) { const w = piece.weights[u * 4 + i]; if (w <= 0) continue; const b = piece.bones[u * 4 + i]; if (sum[b] === 0) touched.push(b); sum[b] += w * f } }
      add(v, 0.5)
      for (let o = offsets[v]; o < offsets[v + 1]; o++) add(list[o], 0.5 / n)
      touched.sort((a, b) => sum[b] - sum[a])
      let total = 0
      for (let i = 0; i < 4 && i < touched.length; i++) total += sum[touched[i]]
      for (let i = 0; i < 4; i++) { const b = touched[i]; bones[v * 4 + i] = b ?? 0; weights[v * 4 + i] = b !== undefined && total > 0 ? sum[b] / total : 0 }
      for (const b of touched) sum[b] = 0
      touched.length = 0
    }
    piece.bones = bones; piece.weights = weights
  }
}
/** Slot distances relative to the winning slot, clamped so interpolation only matters near boundaries. */
export function normalizeSlots(piece: Piece): void {
  for (let v = 0; v < piece.slots.length; v += SLOTS) {
    let min = Infinity
    for (let s = 0; s < SLOTS; s++) min = Math.min(min, piece.slots[v + s])
    for (let s = 0; s < SLOTS; s++) piece.slots[v + s] = Math.min(0.05, piece.slots[v + s] - min)
  }
}
/** Makes slot `slot` win where `g` < 0 (signed, metres) on vertex `v`. */
export function overrideSlot(piece: Piece, v: number, slot: number, g: number): void {
  let min = Infinity
  for (let s = 0; s < SLOTS; s++) if (s !== slot) min = Math.min(min, piece.slots[v * SLOTS + s])
  piece.slots[v * SLOTS + slot] = Math.min(piece.slots[v * SLOTS + slot], min + g)
}

/** Marches from `from` along `dir` until the field changes sign; returns the surface point or null. */
export function surfaceAlong(field: Field, from: V3, dir: V3, max: number, step: number): V3 | null {
  let previous = field.value(...from)
  for (let t = step; t <= max; t += step) {
    const p: V3 = [from[0] + dir[0] * t, from[1] + dir[1] * t, from[2] + dir[2] * t], v = field.value(...p)
    if ((v < 0) !== (previous < 0)) {
      let a = t - step, b = t
      for (let i = 0; i < 10; i++) { const m = (a + b) / 2, vm = field.value(from[0] + dir[0] * m, from[1] + dir[1] * m, from[2] + dir[2] * m); if ((vm < 0) === (previous < 0)) a = m; else b = m }
      const m = (a + b) / 2
      return [from[0] + dir[0] * m, from[1] + dir[1] * m, from[2] + dir[2] * m]
    }
    previous = v
  }
  return null
}
/** Field normal at a point. */
export function normalAt(field: Field, p: V3, e: number): V3 {
  const out = [0, 0, 0]
  gradient(field, p[0], p[1], p[2], e, out)
  const l = Math.hypot(out[0], out[1], out[2]) || 1
  return [out[0] / l, out[1] / l, out[2] / l]
}
