import { GROUND_LAYERS, type WorldMacro } from './worldMacro.ts'
import type { ThreeWorldDocument } from './worldDocument.ts'

/** Map colours of the ground layers (sRGB), the same families as the terrain palette. */
const COLORS: Record<typeof GROUND_LAYERS[number], [number, number, number]> = {
  grass: [118, 146, 84], forest: [72, 101, 58], sand: [221, 205, 160], dry: [176, 157, 113], mud: [104, 97, 71], snow: [240, 243, 246], rock: [138, 128, 117], taiga: [86, 105, 74],
}
const SEA: [number, number, number] = [58, 104, 128], LAKE: [number, number, number] = [74, 128, 152], CLEAR: [number, number, number] = [196, 172, 128]

/**
 * Top-down map of the world, `size` pixels square, north (+z) up: ground-layer colours, lakes and rivers, the sea,
 * cleared ground (settlements, roads) and relief shading from the north-west. Pure; runs in a worker.
 */
export function mapImage(heightAt: (x: number, z: number) => number, macro: Pick<WorldMacro, 'cell' | 'points' | 'origin' | 'ground' | 'water' | 'river' | 'clear'>, terrain: ThreeWorldDocument['terrain'], size: number): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(size * size * 4), step = terrain.size[0] / size, half = terrain.size[0] / 2, sea = terrain.seaLevel ?? -Infinity, layers = GROUND_LAYERS.length
  for (let row = 0; row < size; row++) for (let column = 0; column < size; column++) {
    const x = -half + (column + 0.5) * step, z = half - (row + 0.5) * step, h = heightAt(x, z)
    const i = Math.min(macro.points[0] - 1, Math.max(0, Math.round((x - macro.origin[0]) / macro.cell))), j = Math.min(macro.points[1] - 1, Math.max(0, Math.round((z - macro.origin[1]) / macro.cell))), k = j * macro.points[0] + i
    let color: [number, number, number]
    if (h <= sea) color = SEA
    else if (!Number.isNaN(macro.water[k])) color = LAKE
    else {
      color = [0, 0, 0]
      for (let l = 0; l < layers; l++) { const w = macro.ground[k * layers + l] / 255, c = COLORS[GROUND_LAYERS[l]]; color[0] += c[0] * w; color[1] += c[1] * w; color[2] += c[2] * w }
      if (macro.clear[k] > 0.5) color = color.map((value, c) => value * 0.4 + CLEAR[c] * 0.6) as [number, number, number]
      // Light from the north-west: slopes facing it brighten, the others darken.
      const shade = (heightAt(x - step, z + step) - heightAt(x + step, z - step)) / (2 * step)
      const light = Math.max(0.55, Math.min(1.3, 1 + shade * 1.6))
      color = color.map((value) => value * light) as [number, number, number]
    }
    const p = (row * size + column) * 4
    pixels[p] = color[0]; pixels[p + 1] = color[1]; pixels[p + 2] = color[2]; pixels[p + 3] = 255
  }
  return pixels
}

/** Fog of war: 32 m cells revealed around the player, stored as a compact string with the world's progress. */
export const FOG_CELL = 32
export function createFog(size: [number, number], saved?: string) {
  const nx = Math.ceil(size[0] / FOG_CELL), nz = Math.ceil(size[1] / FOG_CELL), cells = new Uint8Array(nx * nz)
  if (saved) { const bytes = Uint8Array.from(atob(saved), (c) => c.charCodeAt(0)); for (let k = 0; k < cells.length; k++) cells[k] = (bytes[k >> 3] >> (k & 7)) & 1 }
  const at = (x: number, z: number) => { const i = Math.floor((x + size[0] / 2) / FOG_CELL), j = Math.floor((z + size[1] / 2) / FOG_CELL); return i >= 0 && j >= 0 && i < nx && j < nz ? j * nx + i : -1 }
  return {
    cells, nx, nz,
    /** Reveals everything within `radius` metres; returns whether anything new appeared. */
    reveal(x: number, z: number, radius = 160) {
      let changed = false
      for (let dz = -radius; dz <= radius; dz += FOG_CELL) for (let dx = -radius; dx <= radius; dx += FOG_CELL) {
        if (dx * dx + dz * dz > radius * radius) continue
        const k = at(x + dx, z + dz)
        if (k >= 0 && !cells[k]) { cells[k] = 1; changed = true }
      }
      return changed
    },
    seen: (x: number, z: number) => { const k = at(x, z); return k >= 0 && cells[k] === 1 },
    serialize() { const bytes = new Uint8Array(Math.ceil(cells.length / 8)); for (let k = 0; k < cells.length; k++) if (cells[k]) bytes[k >> 3] |= 1 << (k & 7); let text = ''; for (const byte of bytes) text += String.fromCharCode(byte); return btoa(text) },
  }
}
export type Fog = ReturnType<typeof createFog>
