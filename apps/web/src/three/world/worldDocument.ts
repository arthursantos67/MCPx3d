import { ambiencePresets, choice, musicPresets, number, record, text, validateEnvironment, validateScene, weatherKinds, MAX_SCENE_BYTES, MAX_SCENE_NODES,
  type SceneEnvironment, type ThreeSceneDocument } from '../sceneDocument.ts'
import { expandSceneDraft } from '../sceneDraft.ts'

/**
 * ThreeWorldDocument 2.0: a large explorable world made of procedural terrain, regions with identity and
 * locations that are ordinary ThreeSceneDocument 1.x scenes. Pure data, validated like the 1.x contract;
 * no Three.js objects or executable content. A 1.x scene migrates to a world with one location and no terrain,
 * and converts back unchanged.
 */
export const worldBiomes = ['auto', 'ocean', 'beach', 'grassland', 'forest', 'rainforest', 'savanna', 'desert', 'tundra', 'taiga', 'snow', 'swamp', 'alpine', 'volcanic'] as const
export const locationKinds = ['scene', 'village', 'town', 'castle', 'port', 'camp', 'dungeon', 'ruin', 'landmark'] as const
export const terrainKinds = ['none', 'synthetic', 'climate'] as const
export const routeKinds = ['road', 'path'] as const
export type WorldBiome = typeof worldBiomes[number]
export type Vector2Tuple = [number, number]

export interface WorldTerrain {
  /** `none`: locations stand alone (migrated scenes); `synthetic`: relief without biomes (streaming tests); `climate`: biomes, erosion and rivers. */
  kind: typeof terrainKinds[number]
  /** World extent in metres, centred on the origin. */
  size: Vector2Tuple
  /** Lowest and highest terrain elevation in metres. */
  heightRange: Vector2Tuple
  /** Sea surface elevation in metres, or null for a landlocked world. */
  seaLevel: number | null
  /** 0 = plains, 1 = rugged mountains. */
  ruggedness: number
  erosion: number
}
export interface WorldRegion {
  id: string; name: string
  /** Regions partition the land by nearest site (weighted Voronoi). */
  site: Vector2Tuple; weight: number
  biome: WorldBiome; danger: number
  ambience: typeof ambiencePresets[number]; music: typeof musicPresets[number]; weather: typeof weatherKinds[number]
  premise?: string
}
export interface WorldLocation {
  id: string; name: string; kind: typeof locationKinds[number]; regionId: string | null
  position: Vector2Tuple; yaw: number
  /** Radius in metres reserved on the terrain (flattened and cleared of vegetation). */
  footprint: number
  /** What the location should contain, used when it is detailed on demand. */
  brief?: string
  /** Detailed content; null while only planned in the atlas. */
  scene: ThreeSceneDocument | null
}
export interface WorldRoute { id: string; kind: typeof routeKinds[number]; from: string; to: string; width: number }
/** Per-world performance budgets, enforced deterministically when an atlas is sanitized. */
export interface WorldBudgets {
  /** Vegetation instances per hectare at full density. */
  vegetationDensity: number
  nodesPerLocation: number
  /** Shadow-casting point/spot lights active at once in a region (fixed slots; the count never changes in play). */
  shadowLightsPerRegion: number
}
export interface ThreeWorldDocument {
  version: '2.0'
  name: string
  seed: number
  terrain: WorldTerrain
  regions: WorldRegion[]
  locations: WorldLocation[]
  routes: WorldRoute[]
  budgets: WorldBudgets
  environment: SceneEnvironment
}
export type ThreeProject = { kind: 'scene'; document: ThreeSceneDocument } | { kind: 'world'; document: ThreeWorldDocument }

export const MAX_WORLD_SIZE = 16384
export const MAX_WORLD_REGIONS = 64
export const MAX_WORLD_LOCATIONS = 256
export const MAX_WORLD_ROUTES = 512
export const MAX_WORLD_BYTES = 128 * 1024 * 1024
export const DEFAULT_WORLD_BUDGETS: WorldBudgets = { vegetationDensity: 400, nodesPerLocation: 1200, shadowLightsPerRegion: 2 }
const MIGRATED_ID = 'scene'

const id = (value: unknown, field: string) => {
  const result = text(value, field, 100)
  if (!/^[\w.:-]+$/.test(result)) throw new Error(`${field}: use letras, números, ponto, hífen, dois-pontos ou sublinhado.`)
  return result
}
const pair = (value: unknown, field: string, min: number, max: number): Vector2Tuple => {
  if (!Array.isArray(value) || value.length !== 2) throw new Error(`${field}: esperado par de números.`)
  return [number(value[0], field, min, max), number(value[1], field, min, max)]
}
const optionalText = (value: unknown, field: string, max: number) => value === undefined || value === null || value === '' ? undefined : text(value, field, max).trim()

export function validateTerrain(value: unknown): WorldTerrain {
  const terrain = record(value)
  const size = pair(terrain.size, 'Tamanho do mundo', 64, MAX_WORLD_SIZE), heightRange = pair(terrain.heightRange ?? [-40, 400], 'Faixa de altitude', -2000, 9000)
  if (heightRange[0] >= heightRange[1]) throw new Error('Faixa de altitude: o mínimo deve ser menor que o máximo.')
  const seaLevel = terrain.seaLevel === null || terrain.seaLevel === undefined ? null : number(terrain.seaLevel, 'Nível do mar', heightRange[0], heightRange[1])
  return { kind: choice(terrain.kind, terrainKinds, 'synthetic', 'Tipo de terreno desconhecido.'), size, heightRange, seaLevel,
    ruggedness: number(terrain.ruggedness ?? 0.5, 'Relevo', 0, 1), erosion: number(terrain.erosion ?? 0.5, 'Erosão', 0, 1) }
}
export function validateBudgets(value: unknown): WorldBudgets {
  if (value === undefined || value === null) return { ...DEFAULT_WORLD_BUDGETS }
  const budgets = record(value)
  return { vegetationDensity: number(budgets.vegetationDensity ?? DEFAULT_WORLD_BUDGETS.vegetationDensity, 'Densidade de vegetação', 0, 2000),
    nodesPerLocation: Math.round(number(budgets.nodesPerLocation ?? DEFAULT_WORLD_BUDGETS.nodesPerLocation, 'Nós por local', 1, MAX_SCENE_NODES)),
    shadowLightsPerRegion: Math.round(number(budgets.shadowLightsPerRegion ?? DEFAULT_WORLD_BUDGETS.shadowLightsPerRegion, 'Luzes com sombra por região', 0, 4)) }
}

export function validateWorld(value: unknown): ThreeWorldDocument {
  const doc = record(value)
  if (typeof doc.version === 'string' && doc.version.startsWith('1.')) return sceneToWorld(validateScene(value))
  if (doc.version !== '2.0') throw new Error('Versão de mundo incompatível. Esperado ThreeWorldDocument 2.0 ou ThreeSceneDocument 1.0–1.4.')
  const terrain = validateTerrain(doc.terrain), half: Vector2Tuple = [terrain.size[0] / 2, terrain.size[1] / 2]
  const inside = (value: unknown, field: string): Vector2Tuple => {
    const point = pair(value, field, -MAX_WORLD_SIZE, MAX_WORLD_SIZE)
    if (Math.abs(point[0]) > half[0] || Math.abs(point[1]) > half[1]) throw new Error(`${field}: fora dos limites do mundo.`)
    return point
  }
  const list = (value: unknown, field: string, max: number) => {
    if (value === undefined) return []
    if (!Array.isArray(value) || value.length > max) throw new Error(`${field}: até ${max} itens.`)
    return value
  }
  const regions = list(doc.regions, 'Regiões', MAX_WORLD_REGIONS).map((value): WorldRegion => {
    const region = record(value), premise = optionalText(region.premise, 'Premissa da região', 600)
    return { id: id(region.id, 'ID da região'), name: text(region.name, 'Nome da região'), site: inside(region.site, 'Centro da região'), weight: number(region.weight ?? 1, 'Peso da região', 0.25, 4),
      biome: choice(region.biome, worldBiomes, 'auto', 'Bioma de região desconhecido.'), danger: Math.round(number(region.danger ?? 0, 'Perigo', 0, 5)),
      ambience: choice(region.ambience, ambiencePresets, 'auto', 'Ambiência desconhecida.'), music: choice(region.music, musicPresets, 'auto', 'Música desconhecida.'),
      weather: choice(region.weather, weatherKinds, 'none', 'Clima desconhecido.'), ...(premise ? { premise } : {}) }
  })
  const regionIds = new Set(regions.map((region) => region.id))
  if (regionIds.size !== regions.length) throw new Error('IDs de região duplicados.')
  const budgets = validateBudgets(doc.budgets)
  const locations = list(doc.locations, 'Locais', MAX_WORLD_LOCATIONS).map((value): WorldLocation => {
    const location = record(value), regionId = location.regionId === null || location.regionId === undefined ? null : id(location.regionId, 'Região do local')
    if (regionId !== null && !regionIds.has(regionId)) throw new Error('Local referencia uma região inexistente.')
    const scene = location.scene === null || location.scene === undefined ? null : validateScene(location.scene), brief = optionalText(location.brief, 'Descrição do local', 2000)
    return { id: id(location.id, 'ID do local'), name: text(location.name, 'Nome do local'), kind: choice(location.kind, locationKinds, 'landmark', 'Tipo de local desconhecido.'), regionId,
      position: inside(location.position, 'Posição do local'), yaw: number(location.yaw ?? 0, 'Rotação do local', -360, 360), footprint: number(location.footprint ?? 40, 'Área do local', 2, 2048),
      ...(brief ? { brief } : {}), scene }
  })
  const locationIds = new Set(locations.map((location) => location.id))
  if (locationIds.size !== locations.length) throw new Error('IDs de local duplicados.')
  const routes = list(doc.routes, 'Rotas', MAX_WORLD_ROUTES).map((value): WorldRoute => {
    const route = record(value), from = id(route.from, 'Origem da rota'), to = id(route.to, 'Destino da rota')
    if (!locationIds.has(from) || !locationIds.has(to) || from === to) throw new Error('Rota deve ligar dois locais existentes e distintos.')
    return { id: id(route.id, 'ID da rota'), kind: choice(route.kind, routeKinds, 'road', 'Tipo de rota desconhecido.'), from, to, width: number(route.width ?? 4, 'Largura da rota', 1, 16) }
  })
  if (new Set(routes.map((route) => route.id)).size !== routes.length) throw new Error('IDs de rota duplicados.')
  const seed = number(doc.seed ?? 1, 'Semente', 0, 0xffffffff)
  if (!Number.isInteger(seed)) throw new Error('Semente: use um inteiro.')
  return { version: '2.0', name: text(doc.name, 'Nome do mundo'), seed, terrain, regions, locations, routes, budgets, environment: validateEnvironment(doc.environment) }
}

/** A 1.x scene becomes a world with no terrain and one location at the origin that holds the scene unchanged. */
export function sceneToWorld(scene: ThreeSceneDocument): ThreeWorldDocument {
  return { version: '2.0', name: scene.name, seed: 1,
    terrain: { kind: 'none', size: [MAX_WORLD_SIZE, MAX_WORLD_SIZE], heightRange: [-2000, 9000], seaLevel: null, ruggedness: 0, erosion: 0 },
    regions: [], locations: [{ id: MIGRATED_ID, name: scene.name, kind: 'scene', regionId: null, position: [0, 0], yaw: 0, footprint: 2048, scene }], routes: [],
    budgets: { ...DEFAULT_WORLD_BUDGETS }, environment: scene.environment }
}

/** The single scene of a world without terrain, which the 1.x runtime plays as before; null for real worlds. */
export function worldAsScene(world: ThreeWorldDocument): ThreeSceneDocument | null {
  if (world.terrain.kind !== 'none' || world.locations.length !== 1 || world.regions.length || world.routes.length) return null
  const [location] = world.locations
  if (!location.scene || location.position[0] !== 0 || location.position[1] !== 0 || location.yaw !== 0) return null
  return location.scene
}

/** Opens either contract without changing 1.x projects: they stay scenes unless explicitly migrated. */
export function parseProject(source: string): ThreeProject {
  if (new TextEncoder().encode(source).byteLength > MAX_WORLD_BYTES) throw new Error('O projeto excede o limite de 128 MB.')
  const value = JSON.parse(source) as unknown, version = typeof value === 'object' && value && !Array.isArray(value) ? (value as Record<string, unknown>).version : undefined
  if (version === '2.0') return { kind: 'world', document: validateWorld(value) }
  if (new TextEncoder().encode(source).byteLength > MAX_SCENE_BYTES) throw new Error('O projeto excede o limite de 32 MB.')
  return { kind: 'scene', document: validateScene(expandSceneDraft(value, MAX_SCENE_NODES, MAX_SCENE_BYTES)) }
}

