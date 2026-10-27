import { hash2 } from './worldNoise.ts'
import { BIOMES, type WorldMacro } from './worldMacro.ts'

/**
 * Where vegetation and natural props grow. Candidates sit on a jittered grid hashed from their own coordinates, so a
 * cell produces the same plants whichever order cells load in and whichever worker computes them. Biome, slope,
 * water and the world's density budget decide which candidates survive and which species they become.
 */
export const VEGETATION_CELL = 128
export const SPECIES = ['tree', 'pine', 'palm', 'bush', 'cactus', 'rock', 'log', 'mushroom'] as const
export type Species = typeof SPECIES[number]
/** Floats per instance: x, y, z, yaw (radians), scale. */
export const INSTANCE_STRIDE = 5

type Mix = Partial<Record<Species, number>>
/** Share of the density budget each biome uses, and how it splits between species. */
export const BIOME_VEGETATION: Record<typeof BIOMES[number], { density: number; mix: Mix }> = {
  ocean: { density: 0, mix: {} },
  beach: { density: 0.04, mix: { palm: 0.6, rock: 0.4 } },
  grassland: { density: 0.12, mix: { tree: 0.35, bush: 0.45, rock: 0.15, log: 0.05 } },
  forest: { density: 0.55, mix: { tree: 0.6, bush: 0.2, log: 0.08, mushroom: 0.07, rock: 0.05 } },
  rainforest: { density: 0.7, mix: { tree: 0.45, palm: 0.25, bush: 0.25, mushroom: 0.05 } },
  savanna: { density: 0.06, mix: { tree: 0.4, bush: 0.4, rock: 0.2 } },
  desert: { density: 0.03, mix: { cactus: 0.6, rock: 0.4 } },
  swamp: { density: 0.3, mix: { tree: 0.4, bush: 0.3, log: 0.2, mushroom: 0.1 } },
  taiga: { density: 0.45, mix: { pine: 0.75, bush: 0.1, rock: 0.1, log: 0.05 } },
  tundra: { density: 0.05, mix: { pine: 0.3, bush: 0.3, rock: 0.4 } },
  snow: { density: 0.02, mix: { pine: 0.5, rock: 0.5 } },
  alpine: { density: 0.04, mix: { pine: 0.3, rock: 0.7 } },
}
/** Steepest slope (rise over run) each species grows on. */
const MAX_SLOPE: Record<Species, number> = { tree: 0.55, pine: 0.7, palm: 0.35, bush: 0.8, cactus: 0.5, rock: 1.2, log: 0.4, mushroom: 0.5 }

export interface VegetationInput {
  seed: number
  /** Instances per hectare at a biome density of 1 (the world's `budgets.vegetationDensity`). */
  density: number
  heightAt(x: number, z: number): number
  macro: Pick<WorldMacro, 'cell' | 'points' | 'origin' | 'biome' | 'water' | 'river' | 'clear'>
  seaLevel: number | null
}
export type CellVegetation = Partial<Record<Species, Float32Array>>

const macroIndex = (macro: VegetationInput['macro'], x: number, z: number) => {
  const i = Math.min(macro.points[0] - 1, Math.max(0, Math.round((x - macro.origin[0]) / macro.cell))), j = Math.min(macro.points[1] - 1, Math.max(0, Math.round((z - macro.origin[1]) / macro.cell)))
  return j * macro.points[0] + i
}

/** Plants of vegetation cell (cx, cz), whose minimum corner is `origin + (cx, cz) * VEGETATION_CELL`. */
export function placeVegetation(input: VegetationInput, origin: [number, number], cx: number, cz: number): CellVegetation {
  const maxDensity = Math.max(0, input.density), spacing = maxDensity > 0 ? Math.sqrt(10_000 / maxDensity) : Infinity
  if (!Number.isFinite(spacing)) return {}
  const x0 = origin[0] + cx * VEGETATION_CELL, z0 = origin[1] + cz * VEGETATION_CELL, sea = input.seaLevel ?? -Infinity
  const gx0 = Math.ceil(x0 / spacing), gz0 = Math.ceil(z0 / spacing), gx1 = Math.ceil((x0 + VEGETATION_CELL) / spacing), gz1 = Math.ceil((z0 + VEGETATION_CELL) / spacing)
  const lists = new Map<Species, number[]>()
  for (let gz = gz0; gz < gz1; gz++) for (let gx = gx0; gx < gx1; gx++) {
    // Jitter within the candidate's own grid square, so neighbouring cells never duplicate or miss a candidate.
    const x = (gx + hash2(gx, gz, input.seed + 11)) * spacing, z = (gz + hash2(gx, gz, input.seed + 23)) * spacing
    if (x < x0 || z < z0 || x >= x0 + VEGETATION_CELL || z >= z0 + VEGETATION_CELL) continue
    const k = macroIndex(input.macro, x, z), biome = BIOMES[input.macro.biome[k]] ?? 'grassland', rule = BIOME_VEGETATION[biome]
    if (hash2(gx, gz, input.seed + 37) >= rule.density || !Number.isNaN(input.macro.water[k]) || input.macro.river[k] > 0.05 || input.macro.clear[k] > 0.05) continue
    const y = input.heightAt(x, z)
    if (y <= sea + 0.5) continue
    let pick = hash2(gx, gz, input.seed + 41), species: Species | null = null
    for (const [name, share] of Object.entries(rule.mix) as [Species, number][]) { if ((pick -= share) < 0) { species = name; break } }
    if (!species) continue
    const slope = Math.hypot(input.heightAt(x + 1, z) - input.heightAt(x - 1, z), input.heightAt(x, z + 1) - input.heightAt(x, z - 1)) / 2
    if (slope > MAX_SLOPE[species]) continue
    const list = lists.get(species) ?? []
    list.push(x, y, z, hash2(gx, gz, input.seed + 53) * Math.PI * 2, 0.75 + 0.5 * hash2(gx, gz, input.seed + 67))
    lists.set(species, list)
  }
  return Object.fromEntries([...lists].map(([species, list]) => [species, new Float32Array(list)]))
}
