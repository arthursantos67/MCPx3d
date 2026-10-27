import type { ResolvedAmbience, ResolvedMusic } from '../sceneAudio.ts'
import type { ThreeWorldDocument, WorldRegion } from './worldDocument.ts'
import { BIOMES, type WorldMacro } from './worldMacro.ts'

export interface RegionInfo {
  region: WorldRegion | null
  biome: typeof BIOMES[number]
  ambience: ResolvedAmbience
  music: ResolvedMusic
  /** No lake, river or sea at this point. */
  dry: boolean
}

const biomeAmbience: Record<typeof BIOMES[number], ResolvedAmbience> = {
  ocean: 'beach', beach: 'beach', grassland: 'meadow', forest: 'forest', rainforest: 'forest', savanna: 'meadow', desert: 'desert',
  swamp: 'swamp', taiga: 'forest', tundra: 'wind', snow: 'snow', alpine: 'wind',
}

/**
 * The region whose weighted site is nearest (distance divided by weight), the biome under the point and the
 * ambience/music that follow from them: explicit region choices win, `auto` follows the biome and the danger level.
 */
export function regionAt(world: Pick<ThreeWorldDocument, 'regions' | 'terrain'>, macro: Pick<WorldMacro, 'cell' | 'points' | 'origin' | 'biome' | 'water'> | null, x: number, z: number): RegionInfo {
  let region: WorldRegion | null = null, best = Infinity
  for (const candidate of world.regions) {
    const score = Math.hypot(x - candidate.site[0], z - candidate.site[1]) / candidate.weight
    if (score < best) { best = score; region = candidate }
  }
  let biome: typeof BIOMES[number] = 'grassland', dry = true
  if (macro) {
    const i = Math.min(macro.points[0] - 1, Math.max(0, Math.round((x - macro.origin[0]) / macro.cell))), j = Math.min(macro.points[1] - 1, Math.max(0, Math.round((z - macro.origin[1]) / macro.cell)))
    biome = BIOMES[macro.biome[j * macro.points[0] + i]] ?? 'grassland'
    dry = Number.isNaN(macro.water[j * macro.points[0] + i]) && biome !== 'ocean'
  }
  const ambience = region && region.ambience !== 'auto' ? region.ambience : biomeAmbience[biome]
  const danger = region?.danger ?? 0
  const music = region && region.music !== 'auto' ? region.music : danger >= 3 ? 'tension' : danger >= 1 ? 'adventure' : 'calm'
  return { region, biome, ambience, music, dry }
}
