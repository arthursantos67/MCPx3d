import * as THREE from 'three'
import type { GroundField } from '../sceneGroundField.ts'
import { GROUND_LAYERS, type WorldMacro } from './worldMacro.ts'

/**
 * A 1.x GroundField over a window around the player, so the shared grass and wind systems run unchanged on a
 * streamed world. The window is computed in a worker and replaced in place as the player walks.
 */
export const GROUND_WINDOW = 160
export const GROUND_SAMPLES = 257
/** Grass share of each ground layer (blades grow on meadows and forest floors, sparsely on dry ground). */
const GRASS: Partial<Record<typeof GROUND_LAYERS[number], number>> = { grass: 1, forest: 0.55, taiga: 0.35, dry: 0.45, mud: 0.3 }
const TINT: Record<typeof GROUND_LAYERS[number], [number, number, number]> = {
  grass: [0.36, 0.49, 0.26], forest: [0.25, 0.35, 0.18], sand: [0.84, 0.77, 0.6], dry: [0.66, 0.58, 0.4], mud: [0.31, 0.29, 0.2], snow: [0.93, 0.95, 0.96], rock: [0.48, 0.44, 0.4], taiga: [0.3, 0.37, 0.24],
}

export interface GroundWindow { center: [number, number]; data: Uint8Array; tint: Uint8Array; range: [number, number] }

/** Height, grass, coverage and tint of the window centred on `center` (pure; runs in a worker). */
export function groundWindow(heightAt: (x: number, z: number) => number, macro: Pick<WorldMacro, 'cell' | 'points' | 'origin' | 'ground' | 'water'>, center: [number, number], seaLevel: number | null): GroundWindow {
  const n = GROUND_SAMPLES, step = GROUND_WINDOW / (n - 1), x0 = center[0] - GROUND_WINDOW / 2, z0 = center[1] - GROUND_WINDOW / 2
  const heights = new Float32Array(n * n), grass = new Float32Array(n * n), cover = new Uint8Array(n * n), tint = new Uint8Array(n * n * 4)
  const sea = seaLevel ?? -Infinity, layers = GROUND_LAYERS.length, weights = new Float32Array(layers)
  let low = Infinity, high = -Infinity
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const h = heightAt(x0 + i * step, z0 + j * step); heights[j * n + i] = h; low = Math.min(low, h); high = Math.max(high, h) }
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = j * n + i, x = x0 + i * step, z = z0 + j * step
    const mi = Math.min(macro.points[0] - 1, Math.max(0, Math.round((x - macro.origin[0]) / macro.cell))), mj = Math.min(macro.points[1] - 1, Math.max(0, Math.round((z - macro.origin[1]) / macro.cell)))
    const m = mj * macro.points[0] + mi, wet = !Number.isNaN(macro.water[m]) && heights[k] < macro.water[m] + 0.2
    cover[k] = heights[k] > sea + 0.3 && !wet ? 1 : 0
    // Ground weights read bilinearly like the terrain splat, so blades and soil colour agree.
    const u = Math.min(macro.points[0] - 1.001, Math.max(0, (x - macro.origin[0]) / macro.cell)), v = Math.min(macro.points[1] - 1.001, Math.max(0, (z - macro.origin[1]) / macro.cell))
    const ui = Math.floor(u), vi = Math.floor(v), fu = u - ui, fv = v - vi, base = vi * macro.points[0] + ui
    for (let l = 0; l < layers; l++) {
      const at = (offset: number) => macro.ground[(base + offset) * layers + l]
      weights[l] = ((at(0) * (1 - fu) + at(1) * fu) * (1 - fv) + (at(macro.points[0]) * (1 - fu) + at(macro.points[0] + 1) * fu) * fv) / 255
    }
    let sum = 0, density = 0, r = 0, g = 0, b = 0
    for (let l = 0; l < layers; l++) {
      const w = weights[l]
      sum += w; density += w * (GRASS[GROUND_LAYERS[l]] ?? 0)
      r += w * TINT[GROUND_LAYERS[l]][0]; g += w * TINT[GROUND_LAYERS[l]][1]; b += w * TINT[GROUND_LAYERS[l]][2]
    }
    const at = (a: number, c: number) => heights[Math.min(n - 1, Math.max(0, c)) * n + Math.min(n - 1, Math.max(0, a))]
    const slope = Math.hypot(at(i + 1, j) - at(i - 1, j), at(i, j + 1) - at(i, j - 1)) / (2 * step)
    grass[k] = cover[k] ? density / (sum || 1) * (1 - Math.min(1, Math.max(0, (slope - 0.45) / 0.25))) : 0
    const color = new THREE.Color().setRGB(r / (sum || 1), g / (sum || 1), b / (sum || 1), THREE.LinearSRGBColorSpace).convertLinearToSRGB()
    tint[k * 4] = Math.round(color.r * 255); tint[k * 4 + 1] = Math.round(color.g * 255); tint[k * 4 + 2] = Math.round(color.b * 255); tint[k * 4 + 3] = 255
  }
  if (high - low < 0.01) high = low + 0.01
  const data = new Uint8Array(n * n * 4)
  for (let k = 0; k < n * n; k++) {
    const q = Math.round((heights[k] - low) / (high - low) * 65535)
    data[k * 4] = q >> 8; data[k * 4 + 1] = q & 255; data[k * 4 + 2] = Math.round(Math.min(1, grass[k]) * 255); data[k * 4 + 3] = cover[k] * 255
  }
  return { center, data, tint, range: [low, high] }
}

const texture = (data: Uint8Array, colorSpace: THREE.ColorSpace) => {
  const result = new THREE.DataTexture(data, GROUND_SAMPLES, GROUND_SAMPLES, THREE.RGBAFormat, THREE.UnsignedByteType)
  result.colorSpace = colorSpace
  result.magFilter = result.minFilter = THREE.LinearFilter
  result.generateMipmaps = false
  result.wrapS = result.wrapT = THREE.ClampToEdgeWrapping
  result.needsUpdate = true
  return result
}

/** A live GroundField whose contents `load` swaps for a new window without reallocating the textures. */
export function createWorldGroundField(first: GroundWindow): GroundField & { load(window: GroundWindow): void; center: [number, number] } {
  const map = texture(new Uint8Array(first.data), THREE.NoColorSpace), tint = texture(new Uint8Array(first.tint), THREE.SRGBColorSpace)
  const n = GROUND_SAMPLES, step = GROUND_WINDOW / (n - 1)
  const field = {
    texture: map, tint, center: first.center, bounds: [0, 0, GROUND_WINDOW, GROUND_WINDOW] as [number, number, number, number], range: first.range, size: [n, n] as [number, number], water: null,
    load(window: GroundWindow) {
      (map.image.data as Uint8Array).set(window.data); (tint.image.data as Uint8Array).set(window.tint)
      map.needsUpdate = true; tint.needsUpdate = true
      field.center = window.center; field.range = window.range
      field.bounds = [window.center[0] - GROUND_WINDOW / 2, window.center[1] - GROUND_WINDOW / 2, GROUND_WINDOW, GROUND_WINDOW]
    },
    sample(x: number, z: number, read: (k: number) => number) {
      const fx = Math.min(n - 1, Math.max(0, (x - field.bounds[0]) / step)), fz = Math.min(n - 1, Math.max(0, (z - field.bounds[1]) / step))
      const i = Math.min(n - 2, Math.floor(fx)), j = Math.min(n - 2, Math.floor(fz)), tx = fx - i, tz = fz - j
      return (read(j * n + i) * (1 - tx) + read(j * n + i + 1) * tx) * (1 - tz) + (read((j + 1) * n + i) * (1 - tx) + read((j + 1) * n + i + 1) * tx) * tz
    },
    heightAt: (x: number, z: number) => field.range[0] + field.sample(x, z, (k) => (map.image.data as Uint8Array)[k * 4] * 256 + (map.image.data as Uint8Array)[k * 4 + 1]) / 65535 * (field.range[1] - field.range[0]),
    grassAt: (x: number, z: number) => field.sample(x, z, (k) => (map.image.data as Uint8Array)[k * 4 + 2]) / 255,
    coverAt: (x: number, z: number) => field.sample(x, z, (k) => (map.image.data as Uint8Array)[k * 4 + 3]) / 255,
    tintAt: (x: number, z: number) => [0, 1, 2].map((c) => field.sample(x, z, (k) => (tint.image.data as Uint8Array)[k * 4 + c]) / 255) as [number, number, number],
    dispose() { map.dispose(); tint.dispose() },
  }
  field.load(first)
  return field
}
