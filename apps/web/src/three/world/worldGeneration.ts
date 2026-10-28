import { isAbortError, ProviderRequestError, type AgentMessage, type JsonSchema, type LLMProvider } from '../../../../../packages/agent/src/provider.ts'
import { ambiencePresets, musicPresets, validateScene, weatherKinds, type ThreeSceneDocument } from '../sceneDocument.ts'
import { DEFAULT_CLIMATE, DEFAULT_WORLD_BUDGETS, locationKinds, routeKinds, validateWorld, worldBiomes, worldEnvironment, type ThreeWorldDocument, type WorldLocation, type WorldRegion, type WorldRoute } from './worldDocument.ts'
import { hash2 } from './worldNoise.ts'
import { BIOMES, type WorldMacro } from './worldMacro.ts'
import { GAMEPLAY_PROMPT } from '../sceneGameplaySchema.ts'
import { sceneIntent } from '../sceneDirection.ts'

/**
 * AI world generation in two scales. The model writes a compact atlas (regions by map area, locations by terrain
 * rule, routes, climate, story); a deterministic sanitizer turns it into a valid world with budgets, and locations
 * are placed on the computed terrain by rules. Locations are then detailed one by one with the 1.x scene pipeline.
 * There is no overall deadline: every step is a checkpoint, and a request that times out or fails is simply sent
 * again (more concisely) until it succeeds or the user cancels; finished steps are never redone.
 */
export const AREAS = ['north', 'south', 'east', 'west', 'center', 'northeast', 'northwest', 'southeast', 'southwest'] as const
export const TERRAIN_RULES = ['coast', 'river', 'lake', 'hill', 'valley', 'plain', 'forest', 'mountain', 'any'] as const
export const SIZES = { small: 25, medium: 45, large: 70 } as const
export const MAX_ATLAS_REGIONS = 8, MAX_ATLAS_LOCATIONS = 12, MAX_ATLAS_ROUTES = 16, MAX_DETAILED = 3
/** Scene nodes per detailed location by size, capped by the world's budget. */
const NODES_BY_SIZE = { small: 250, medium: 450, large: 600 } as const

const string = (max: number) => ({ type: 'string', maxLength: max })
const enumOf = (values: readonly string[]) => ({ type: 'string', enum: [...values] })
export const atlasSchema: JsonSchema = {
  type: 'object', additionalProperties: false, required: ['name', 'premise', 'playStyle', 'hud', 'terrain', 'regions', 'locations', 'routes'],
  properties: {
    name: string(120), premise: string(1200),
    playStyle: enumOf(['directed', 'sandbox']), hud: enumOf(['full', 'minimal']),
    terrain: { type: 'object', additionalProperties: false, required: ['ruggedness', 'sea', 'erosion', 'temperature', 'humidity'], properties: {
      ruggedness: { type: 'number', minimum: 0, maximum: 1 }, sea: { type: 'boolean' }, erosion: { type: 'number', minimum: 0, maximum: 1 },
      temperature: { type: 'number', minimum: -20, maximum: 35 }, humidity: { type: 'number', minimum: 0, maximum: 1 } } },
    regions: { type: 'array', minItems: 1, maxItems: MAX_ATLAS_REGIONS, items: { type: 'object', additionalProperties: false, required: ['id', 'name', 'area', 'biome', 'danger'], properties: {
      id: string(60), name: string(120), area: enumOf(AREAS), biome: enumOf(worldBiomes), danger: { type: 'integer', minimum: 0, maximum: 5 },
      ambience: enumOf(ambiencePresets), music: enumOf(musicPresets), weather: enumOf(weatherKinds), premise: string(600) } } },
    locations: { type: 'array', maxItems: MAX_ATLAS_LOCATIONS, items: { type: 'object', additionalProperties: false, required: ['id', 'name', 'kind', 'region', 'terrain', 'size', 'brief'], properties: {
      id: string(60), name: string(120), kind: enumOf(locationKinds.filter((kind) => kind !== 'scene')), region: string(60), terrain: enumOf(TERRAIN_RULES),
      size: enumOf(Object.keys(SIZES)), brief: string(1200), detail: { type: 'boolean' } } } },
    routes: { type: 'array', maxItems: MAX_ATLAS_ROUTES, items: { type: 'object', additionalProperties: false, required: ['from', 'to'], properties: { from: string(60), to: string(60), kind: enumOf(['road', 'path']) } } },
  },
}

export const ATLAS_PROMPT = `Você é a diretora de mundo do Forma. Devolva SOMENTE o JSON do atlas de um mundo de 4×4 km para exploração em primeira pessoa.
Escolha playStyle directed ou sandbox e hud full ou minimal conforme o gênero. Exploração/sobrevivência livre usa sandbox: recursos com usos distintos, fabricação/construção, pistas e descobertas opcionais, sem missão ou chefe obrigatório. Jogos dirigidos têm desafios e conclusão quando pedidos; puzzles usam controles com efeitos e interface discreta. A primeira região precisa de atividades reais perto da chegada, sem quilômetros vazios. NPCs podem dar rumores e ter rotinas; missões só quando adequadas ao pedido.
Regiões (até ${MAX_ATLAS_REGIONS}): cada uma ocupa uma área do mapa (north, south, east, west, center e diagonais), com bioma (o clima local segue o bioma), perigo 0–5, ambiência, música, clima e premissa curta.
Locais (até ${MAX_ATLAS_LOCATIONS}): vilas, cidades, castelos, portos, acampamentos, masmorras, ruínas e marcos; diga a região, a regra de terreno onde devem ficar (coast, river, lake, hill, valley, plain, forest, mountain, any), o tamanho (small/medium/large) e uma descrição concreta do que contêm. Marque detail=true nos até ${MAX_DETAILED} locais mais importantes, que serão construídos em detalhe.
Rotas: estradas (road) entre locais que fazem sentido ligar; trilhas (path) para lugares remotos.
Terreno: ruggedness 0–1 (planícies a montanhas), sea (litoral ao redor), erosion 0–1, temperatura ao nível do mar em °C e umidade 0–1.
Escreva nomes e textos em português. Nunca escreva código, HTML, XML ou comandos.`

export interface AtlasLocationIntent { id: string; rule: typeof TERRAIN_RULES[number]; size: keyof typeof SIZES; detail: boolean }
export interface SanitizedAtlas { world: ThreeWorldDocument; intents: AtlasLocationIntent[]; notes: string[] }

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const pick = <T extends string>(value: unknown, options: readonly T[], fallback: T): T => options.includes(value as T) ? value as T : fallback
const clamp = (value: unknown, low: number, high: number, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? Math.min(high, Math.max(low, value)) : fallback
const label = (value: unknown, max: number, fallback: string) => typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : fallback
const slug = (value: unknown, fallback: string) => (typeof value === 'string' ? value : fallback).normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || fallback
/** Map areas as unit directions; region sites sit 30% of the half-size out from the centre. */
const AREA_DIRECTION: Record<typeof AREAS[number], [number, number]> = {
  north: [0, 1], south: [0, -1], east: [1, 0], west: [-1, 0], center: [0, 0], northeast: [0.71, 0.71], northwest: [-0.71, 0.71], southeast: [0.71, -0.71], southwest: [-0.71, -0.71],
}

/**
 * Turns the model's atlas into a valid world deterministically: counts are capped, IDs made unique, references
 * resolved, regions placed by map area and budgets applied. Location positions are provisional until
 * `placeLocations` puts them on the real terrain. `notes` lists every adjustment.
 */
export function sanitizeAtlas(value: unknown, request: string, seed: number, size: [number, number] = [4096, 4096]): SanitizedAtlas {
  const atlas = record(value), notes: string[] = [], terrain = record(atlas.terrain), half = size[0] / 2
  const intent = sceneIntent(request), environment = worldEnvironment()
  if (atlas.playStyle === 'sandbox' || atlas.playStyle === 'directed' || intent.sandbox || intent.puzzle) {
    const playStyle = intent.sandbox ? 'sandbox' : intent.quest || intent.survival || intent.puzzle || intent.race || intent.platforms ? 'directed' : pick(atlas.playStyle, ['directed', 'sandbox'] as const, 'directed')
    environment.gameplay = { playStyle, hud: pick(atlas.hud, ['full', 'minimal'] as const, intent.puzzle ? 'minimal' : 'full'), naturalResources: true, quests: [], recipes: [], startingItems: [], items: [] }
    if (playStyle === 'sandbox') { environment.objective = { type: 'explore', title: '', timeLimit: 0 }; environment.player!.weapon = 'none' }
  }
  const ids = new Set<string>(), unique = (base: string) => { let candidate = base, n = 2; while (ids.has(candidate)) candidate = `${base}-${n++}`.slice(0, 60); ids.add(candidate); return candidate }
  const rawRegions = Array.isArray(atlas.regions) ? atlas.regions : []
  if (rawRegions.length > MAX_ATLAS_REGIONS) notes.push(`Atlas com ${rawRegions.length} regiões; mantidas ${MAX_ATLAS_REGIONS}.`)
  const regionIds = new Map<string, string>(), sameArea = new Map<string, number>()
  const regions = rawRegions.slice(0, MAX_ATLAS_REGIONS).map((value, index) => {
    const region = record(value), area = pick(region.area, AREAS, 'center'), id = unique(slug(region.id ?? region.name, `regiao-${index + 1}`))
    regionIds.set(String(region.id ?? id), id)
    // Two regions in the same area are spread apart around its site.
    const repeat = sameArea.get(area) ?? 0
    sameArea.set(area, repeat + 1)
    const [dx, dz] = AREA_DIRECTION[area], spread = repeat ? (hash2(index, repeat, seed) - 0.5) * 0.5 : 0
    const site: [number, number] = [Math.round((dx * 0.6 + spread) * half), Math.round((dz * 0.6 - spread) * size[1] / 2)]
    const premise = typeof region.premise === 'string' && region.premise.trim() ? region.premise.trim().slice(0, 600) : undefined
    return { id, name: label(region.name, 120, `Região ${index + 1}`), site, weight: 1, biome: pick(region.biome, worldBiomes, 'auto'), danger: Math.round(clamp(region.danger, 0, 5, 0)),
      ambience: pick(region.ambience, ambiencePresets, 'auto'), music: pick(region.music, musicPresets, 'auto'), weather: pick(region.weather, weatherKinds, 'none'), ...(premise ? { premise } : {}) }
  })
  if (!regions.length) { regions.push({ id: unique('centro'), name: 'Centro', site: [0, 0], weight: 1, biome: 'auto', danger: 0, ambience: 'auto', music: 'auto', weather: 'none' }); notes.push('Atlas sem regiões; criada uma região central.') }
  const rawLocations = Array.isArray(atlas.locations) ? atlas.locations : []
  if (rawLocations.length > MAX_ATLAS_LOCATIONS) notes.push(`Atlas com ${rawLocations.length} locais; mantidos ${MAX_ATLAS_LOCATIONS}.`)
  const locationIds = new Map<string, string>(), intents: AtlasLocationIntent[] = []
  const locations: WorldLocation[] = rawLocations.slice(0, MAX_ATLAS_LOCATIONS).map((value, index) => {
    const location = record(value), id = unique(slug(location.id ?? location.name, `local-${index + 1}`)), sizeClass = pick(location.size, Object.keys(SIZES) as (keyof typeof SIZES)[], 'medium')
    locationIds.set(String(location.id ?? id), id)
    const regionId = regionIds.get(String(location.region)) ?? regions[0].id
    if (!regionIds.has(String(location.region))) notes.push(`“${label(location.name, 60, id)}” citava uma região desconhecida e foi para ${regions[0].name}.`)
    intents.push({ id, rule: pick(location.terrain, TERRAIN_RULES, 'any'), size: sizeClass, detail: location.detail === true })
    const site = regions.find((region) => region.id === regionId)!.site
    return { id, name: label(location.name, 120, `Local ${index + 1}`), kind: pick(location.kind, locationKinds, 'landmark'), regionId, position: [site[0], site[1]], yaw: 0,
      footprint: SIZES[sizeClass], brief: label(location.brief, 1200, label(location.name, 120, 'Local')), scene: null }
  })
  // At most three detailed locations: the ones the model marked, then the most important kinds.
  const priority = ['town', 'castle', 'port', 'village', 'dungeon', 'camp', 'ruin', 'landmark']
  const marked = intents.filter((intent) => intent.detail)
  const chosen = (marked.length ? marked : [...intents].sort((a, b) => priority.indexOf(locations.find((l) => l.id === a.id)!.kind) - priority.indexOf(locations.find((l) => l.id === b.id)!.kind))).slice(0, MAX_DETAILED)
  for (const intent of intents) intent.detail = chosen.includes(intent)
  if (marked.length > MAX_DETAILED) notes.push(`${marked.length} locais pedidos em detalhe; detalhados ${MAX_DETAILED}.`)
  const seen = new Set<string>(), rawRoutes = Array.isArray(atlas.routes) ? atlas.routes : []
  const routes = rawRoutes.flatMap((value) => {
    const route = record(value), from = locationIds.get(String(route.from)), to = locationIds.get(String(route.to))
    if (!from || !to || from === to) return []
    const key = [from, to].sort().join('|')
    if (seen.has(key) || seen.size >= MAX_ATLAS_ROUTES) return []
    seen.add(key)
    const kind = pick(route.kind, ['road', 'path'] as const, 'road')
    return [{ id: unique(`rota-${from}-${to}`.slice(0, 60)), kind, from, to, width: kind === 'road' ? 5 : 2.5 }]
  })
  if (rawRoutes.length > routes.length) notes.push(`${rawRoutes.length - routes.length} rotas inválidas ou repetidas foram descartadas.`)
  const climate = { temperature: clamp(terrain.temperature, -20, 35, DEFAULT_CLIMATE.temperature), humidity: clamp(terrain.humidity, 0, 1, DEFAULT_CLIMATE.humidity), wind: Math.round(hash2(seed, 3, 5) * 360) }
  const world = validateWorld({ version: '2.0', name: label(atlas.name, 120, 'Mundo gerado'), seed,
    terrain: { kind: 'climate', size, heightRange: [-60, 600 + Math.round(clamp(terrain.ruggedness, 0, 1, 0.5) * 500)], seaLevel: terrain.sea === false ? null : 0,
      ruggedness: clamp(terrain.ruggedness, 0, 1, 0.5), erosion: clamp(terrain.erosion, 0, 1, 0.5), climate },
    regions, locations: locations.map((location) => ({ ...location, position: [Math.max(-half, Math.min(half, location.position[0])), Math.max(-half, Math.min(half, location.position[1]))] })), routes,
    budgets: { ...DEFAULT_WORLD_BUDGETS }, environment,
    premise: label(atlas.premise, 1200, request.slice(0, 1200)),
    generation: { request: request.slice(0, 4000), pending: intents.filter((intent) => intent.detail).map((intent) => intent.id), failed: [] } })
  return { world, intents, notes }
}

export interface PlacementTerrain {
  heightAt(x: number, z: number): number
  macro: Pick<WorldMacro, 'cell' | 'points' | 'origin' | 'biome' | 'water' | 'river'>
}

/**
 * Puts each location on the terrain by its rule, deterministically: candidates on a 32 m grid inside its region,
 * kept dry, flat enough for the footprint, away from the borders and from locations already placed; the best rule
 * score wins, ties broken by closeness to the region site and then by a seeded hash. A rule nobody can satisfy falls
 * back to `any` and is noted.
 */
export function placeLocations(world: ThreeWorldDocument, intents: AtlasLocationIntent[], terrain: PlacementTerrain, notes: string[] = [], only?: Set<string>): ThreeWorldDocument {
  const half = world.terrain.size[0] / 2, sea = world.terrain.seaLevel ?? -Infinity, [low, high] = world.terrain.heightRange, span = high - low, macro = terrain.macro
  const cellOf = (x: number, z: number) => Math.min(macro.points[1] - 1, Math.max(0, Math.round((z - macro.origin[1]) / macro.cell))) * macro.points[0] + Math.min(macro.points[0] - 1, Math.max(0, Math.round((x - macro.origin[0]) / macro.cell)))
  const regionOf = (x: number, z: number) => { let best = world.regions[0], score = Infinity; for (const region of world.regions) { const s = Math.hypot(x - region.site[0], z - region.site[1]) / region.weight; if (s < score) { score = s; best = region } } return best }
  const near = (x: number, z: number, radius: number, test: (k: number) => boolean) => { for (let dz = -radius; dz <= radius; dz += 16) for (let dx = -radius; dx <= radius; dx += 16) if (dx * dx + dz * dz <= radius * radius && test(cellOf(x + dx, z + dz))) return true; return false }
  const wet = (k: number) => !Number.isNaN(macro.water[k]) || macro.river[k] > 0.2
  const placed: WorldLocation[] = world.locations.filter((location) => only && !only.has(location.id))
  const locations = world.locations.map((location, index) => {
    if (only && !only.has(location.id)) return location
    const intent = intents.find((item) => item.id === location.id) ?? { id: location.id, rule: 'any' as const, size: 'medium' as const, detail: false }
    const region = world.regions.find((item) => item.id === location.regionId) ?? world.regions[0]
    const radius = location.footprint, clearance = Math.max(150, radius * 3)
    const candidates: { x: number; z: number; score: number }[] = []
    for (let z = -half + 200; z <= half - 200; z += 32) for (let x = -half + 200; x <= half - 200; x += 32) {
      if (regionOf(x, z).id !== region.id) continue
      const k = cellOf(x, z), y = terrain.heightAt(x, z)
      if (y <= sea + 2 || wet(k) || placed.some((other) => Math.hypot(other.position[0] - x, other.position[1] - z) < clearance)) continue
      let relief = 0
      for (const [dx, dz] of [[radius, 0], [-radius, 0], [0, radius], [0, -radius]]) relief = Math.max(relief, Math.abs(terrain.heightAt(x + dx, z + dz) - y))
      if (relief > radius * 0.35) continue
      const ring = [0, 1, 2, 3, 4, 5, 6, 7].map((a) => terrain.heightAt(x + Math.cos(a * Math.PI / 4) * 150, z + Math.sin(a * Math.PI / 4) * 150)), mean = ring.reduce((sum, value) => sum + value, 0) / 8
      const biome = BIOMES[macro.biome[k]] ?? 'grassland'
      const fit: Record<typeof TERRAIN_RULES[number], boolean> = {
        coast: y < sea + 40 && near(x, z, 160, (n) => (macro.biome[n] ?? 0) === 0), river: near(x, z, 64, (n) => macro.river[n] > 0.5), lake: near(x, z, 96, (n) => !Number.isNaN(macro.water[n]) && macro.river[n] < 0.2),
        hill: y >= mean + 12, valley: y <= mean - 8, plain: relief < radius * 0.08 && y < low + span * 0.45, forest: ['forest', 'rainforest', 'taiga'].includes(biome), mountain: y >= low + span * 0.6, any: true,
      }
      const score = (fit[intent.rule] ? 10 : 0) - relief / radius - Math.hypot(x - region.site[0], z - region.site[1]) / half + hash2(x, z, world.seed + index) * 0.01
      candidates.push({ x, z, score })
    }
    candidates.sort((a, b) => b.score - a.score)
    const best = candidates[0]
    if (!best) { notes.push(`“${location.name}” não encontrou terreno seco e plano na região; ficou no centro da região.`); placed.push(location); return location }
    if (best.score < 9 && intent.rule !== 'any') notes.push(`“${location.name}” pedia terreno ${intent.rule}, que a região não tem; ficou no melhor terreno disponível.`)
    const inside: number[] = []
    for (let dz = -radius; dz <= radius; dz += 8) for (let dx = -radius; dx <= radius; dx += 8) if (dx * dx + dz * dz <= radius * radius) inside.push(terrain.heightAt(best.x + dx, best.z + dz))
    inside.sort((a, b) => a - b)
    const next: WorldLocation = { ...location, position: [best.x, best.z], yaw: Math.round(hash2(best.x, best.z, world.seed) * 360) - 180, elevation: Math.round(inside[inside.length >> 1] * 100) / 100 }
    placed.push(next)
    return next
  })
  return validateWorld({ ...world, locations })
}

/** The 1.x scene request for one location: content, surroundings, available ground and budgets. */
export function detailRequest(world: ThreeWorldDocument, location: WorldLocation, nodes: number, attempt: number): string {
  const region = world.regions.find((item) => item.id === location.regionId)
  const lights = world.budgets.shadowLightsPerRegion, sizeClass = location.footprint >= SIZES.large ? 'large' : location.footprint >= SIZES.medium ? 'medium' : 'small'
  const limit = Math.min(nodes, NODES_BY_SIZE[sizeClass]), concise = attempt ? ` Esta é a tentativa ${attempt + 1}: a anterior não terminou; entregue uma versão mais enxuta e completa.` : ''
  return `Pedido original: ${world.generation?.request ?? world.premise ?? world.name}.
${location.brief ?? location.name}. ${location.name} é um local do tipo ${location.kind} no mundo “${world.name}”${region ? `, região ${region.name} (perigo ${region.danger}${region.premise ? `; ${region.premise}` : ''})` : ''}.
O chão já existe e está aplainado num círculo de raio ${Math.round(location.footprint)} m centrado na origem: não crie terreno, mar nem lagos; construa tudo dentro desse círculo, sobre y = 0.
Orçamento: no máximo ${Math.round(limit * Math.pow(0.75, attempt))} objetos e ${lights} luzes com sombra.${concise}
${GAMEPLAY_PROMPT}
Estilo global: ${world.environment.gameplay?.playStyle ?? 'conforme o pedido'}, HUD ${world.environment.gameplay?.hud ?? 'adequado ao gênero'}. ${world.environment.gameplay?.playStyle === 'sandbox' ? 'Use gameplay.playStyle="sandbox", quests=[] e descobertas opcionais; não crie campanha obrigatória.' : 'Implemente a atividade adequada ao gênero; missões somente quando solicitadas.'} Ofereça ações reais acessíveis ao chegar e recursos suficientes. Referências por ID pertencem a este local; não substitua funcionamento por falas.`
}

/**
 * Fits a generated location scene to the world deterministically: its own terrain and open water go (the world
 * provides them), nodes beyond the budget are dropped from the least important subtrees first, and shadow-casting
 * lights beyond the region budget stop casting shadows.
 */
export function fitLocationScene(scene: ThreeSceneDocument, budgets: ThreeWorldDocument['budgets'], footprint: number, notes: string[] = []): ThreeSceneDocument {
  const doc = structuredClone(scene), byId = new Map(doc.nodes.map((node) => [node.id, node]))
  const subtree = (id: string) => { const ids = new Set([id]); let grew = true; while (grew) { grew = false; for (const node of doc.nodes) if (node.parentId && ids.has(node.parentId) && !ids.has(node.id)) { ids.add(node.id); grew = true } } return ids }
  const removed = new Set<string>()
  for (const node of doc.nodes) if (!node.parentId && (node.kind === 'terrain' || (node.material.texture === 'water' && (node.kind === 'plane' || node.kind === 'box')) || (node.kind === 'plane' && Math.max(node.dimensions[0] * node.scale[0], node.dimensions[2] * node.scale[2]) > footprint * 1.6))) for (const id of subtree(node.id)) removed.add(id)
  if (removed.size) notes.push(`${removed.size} objetos de terreno ou água próprios do local foram removidos: o mundo já tem chão e água.`)
  let nodes = doc.nodes.filter((node) => !removed.has(node.id))
  const essential = new Set<string>()
  for (const node of doc.nodes) if (node.resource || node.interaction || node.behavior) essential.add(node.id)
  for (const quest of doc.environment.gameplay?.quests ?? []) {
    if (quest.giverId) essential.add(quest.giverId)
    for (const step of quest.steps) if (['talk', 'visit', 'interact', 'defeat'].includes(step.kind)) essential.add(step.target)
  }
  for (const id of [...essential]) {
    let node = byId.get(id)
    while (node?.parentId) { essential.add(node.parentId); node = byId.get(node.parentId) }
  }
  if (nodes.length > budgets.nodesPerLocation) {
    const rank = (id: string) => { const role = byId.get(id)?.role; return role === 'vegetation' ? 0 : role === 'prop' ? 1 : role === 'path' ? 2 : 3 }
    const roots = nodes.filter((node) => !node.parentId || !nodes.some((other) => other.id === node.parentId)).map((node) => node.id).sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : 1))
    const dropped = new Set<string>()
    for (const root of roots) {
      if (nodes.length - dropped.size <= budgets.nodesPerLocation) break
      if (!essential.has(root)) for (const id of subtree(root)) dropped.add(id)
    }
    if (nodes.length - dropped.size > budgets.nodesPerLocation) throw new Error('Os objetos necessários à jogabilidade excedem o orçamento do local. Gere uma cena mais simples preservando as missões.')
    notes.push(`O local passou de ${budgets.nodesPerLocation} objetos; ${dropped.size} objetos menos importantes foram removidos.`)
    nodes = nodes.filter((node) => !dropped.has(node.id))
  }
  let shadows = 0
  for (const node of [...nodes].sort((a, b) => (a.id < b.id ? -1 : 1))) if (node.light?.castShadow) { if (++shadows > budgets.shadowLightsPerRegion) node.light = { ...node.light, castShadow: false } }
  if (shadows > budgets.shadowLightsPerRegion) notes.push(`${shadows - budgets.shadowLightsPerRegion} luzes deixaram de projetar sombra (limite ${budgets.shadowLightsPerRegion} por região).`)
  const kept = new Set(nodes.map((node) => node.id))
  return validateScene({ ...doc, nodes: nodes.map((node) => ({ ...node, overlapWith: node.overlapWith.filter((id) => kept.has(id)),
    ...(node.interaction?.targetId && !kept.has(node.interaction.targetId) ? { interaction: undefined } : {}) })) })
}

/** How a failed request is retried: rate and quota limits wait for the provider; anything else retries soon. */
export function retryDelay(error: unknown, attempt: number, now = Date.now()): number | null {
  if (isAbortError(error)) return null
  if (error instanceof ProviderRequestError && error.limit && ['rate', 'quota'].includes(error.limit.kind)) return Math.max(5_000, (error.limit.retryAt ?? now + 60_000) - now)
  return Math.min(60_000, 2_000 * 2 ** attempt)
}

export interface WorldGenerationEvent { step: 'atlas' | 'terrain' | 'detail' | 'retry' | 'done'; detail: string; location?: string }
export interface WorldGenerationDeps {
  provider: LLMProvider
  /** Computes the world's terrain and places the listed locations by their rules (in a worker, in the app). */
  place(world: ThreeWorldDocument, intents: AtlasLocationIntent[], only?: string[]): Promise<{ world: ThreeWorldDocument; notes: string[] }>
  /** Builds one location scene with the 1.x pipeline. */
  detail(request: string, signal: AbortSignal): Promise<ThreeSceneDocument>
  /** Saves progress after every finished step, so a reload or another session can continue. */
  checkpoint(world: ThreeWorldDocument): void
  onEvent?(event: WorldGenerationEvent): void
  wait?(ms: number, signal: AbortSignal): Promise<void>
}

const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal.aborted) { reject(signal.reason ?? new DOMException('Cancelado', 'AbortError')); return }
  const timer = setTimeout(() => { signal.removeEventListener('abort', stop); resolve() }, ms)
  const stop = () => { clearTimeout(timer); reject(signal.reason ?? new DOMException('Cancelado', 'AbortError')) }
  signal.addEventListener('abort', stop, { once: true })
})

/** Runs `step` until it succeeds; only cancellation stops it. Each retry is a new request carrying the attempt number. */
async function persist<T>(step: (attempt: number) => Promise<T>, label: string, deps: WorldGenerationDeps, signal: AbortSignal): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await step(attempt) } catch (error) {
      const delay = retryDelay(error, attempt)
      if (delay === null || signal.aborted) throw error
      deps.onEvent?.({ step: 'retry', detail: `${label}: ${error instanceof Error ? error.message : String(error)} Nova requisição em ${Math.round(delay / 1000)} s, continuando de onde parou.` })
      await (deps.wait ?? sleep)(delay, signal)
    }
  }
}

/** Creates a world from a request: atlas, terrain-based placement and then the detailed locations. */
export async function generateWorld(request: string, seed: number, deps: WorldGenerationDeps, signal: AbortSignal): Promise<ThreeWorldDocument> {
  if (!request.trim() || request.length > 4000) throw new Error('Descreva o mundo em até 4.000 caracteres.')
  deps.onEvent?.({ step: 'atlas', detail: 'A IA está escrevendo o atlas do mundo…' })
  const messages: AgentMessage[] = [{ role: 'system', content: ATLAS_PROMPT }, { role: 'user', content: request }]
  const atlas = await persist((attempt) => deps.provider.generateStructured<unknown>(attempt ? [...messages, { role: 'user', content: 'A tentativa anterior não terminou. Entregue o atlas completo, mais conciso.' }] : messages,
    atlasSchema, { temperature: 0.6, maxTokens: 8192, signal }), 'Atlas', deps, signal)
  const { world, intents, notes } = sanitizeAtlas(atlas, request, seed)
  deps.onEvent?.({ step: 'terrain', detail: `Atlas “${world.name}”: ${world.regions.length} regiões, ${world.locations.length} locais. Calculando o terreno e posicionando os locais…${notes.length ? ` ${notes.join(' ')}` : ''}` })
  const result = await deps.place(world, intents), placed = result.world
  notes.push(...result.notes)
  deps.checkpoint(placed)
  return continueWorld(placed, deps, signal)
}

/** Details every pending (and previously failed) location; finished ones are kept. Safe to call again after any stop. */
export async function continueWorld(world: ThreeWorldDocument, deps: WorldGenerationDeps, signal: AbortSignal): Promise<ThreeWorldDocument> {
  let current = world
  const queue = [...new Set([...(world.generation?.pending ?? []), ...(world.generation?.failed ?? []).map((item) => item.id)])]
  for (const id of queue) {
    const location = current.locations.find((item) => item.id === id)
    if (!location || location.scene) continue
    deps.onEvent?.({ step: 'detail', location: id, detail: `Construindo “${location.name}”…` })
    const notes: string[] = []
    const fitted = await persist(async (attempt) => fitLocationScene(await deps.detail(detailRequest(current, location, current.budgets.nodesPerLocation, attempt), signal), current.budgets, location.footprint, notes), location.name, deps, signal)
    const generation = current.generation ? { ...current.generation, pending: current.generation.pending.filter((item) => item !== id), failed: current.generation.failed.filter((item) => item.id !== id) } : undefined
    current = validateWorld({ ...current, locations: current.locations.map((item) => item.id === id ? { ...item, scene: fitted } : item), ...(generation ? { generation } : {}) })
    deps.checkpoint(current)
    if (notes.length) deps.onEvent?.({ step: 'detail', location: id, detail: `“${location.name}”: ${notes.join(' ')}` })
  }
  deps.onEvent?.({ step: 'done', detail: `Mundo “${current.name}” pronto.` })
  return current
}

export const worldEditSchema: JsonSchema = {
  type: 'object', additionalProperties: false, required: ['summary'],
  properties: {
    summary: string(400),
    addRegions: (atlasSchema.properties as Record<string, JsonSchema>).regions,
    updateRegions: { type: 'array', maxItems: MAX_ATLAS_REGIONS, items: { type: 'object', additionalProperties: false, required: ['id'], properties: {
      id: string(60), name: string(120), biome: enumOf(worldBiomes), danger: { type: 'integer', minimum: 0, maximum: 5 }, ambience: enumOf(ambiencePresets), music: enumOf(musicPresets), weather: enumOf(weatherKinds), premise: string(600) } } },
    addLocations: (atlasSchema.properties as Record<string, JsonSchema>).locations,
    updateLocations: { type: 'array', maxItems: MAX_ATLAS_LOCATIONS, items: { type: 'object', additionalProperties: false, required: ['id'], properties: {
      id: string(60), name: string(120), brief: string(1200), rebuild: { type: 'boolean' } } } },
    removeLocations: { type: 'array', maxItems: MAX_ATLAS_LOCATIONS, items: string(60) },
    addRoutes: (atlasSchema.properties as Record<string, JsonSchema>).routes,
    removeRoutes: { type: 'array', maxItems: MAX_ATLAS_ROUTES, items: string(60) },
  },
}

export interface WorldEditResult { world: ThreeWorldDocument; intents: AtlasLocationIntent[]; changed: string[]; notes: string[] }

/**
 * Applies a local edit ("put a fishing village on the east coast") deterministically. Only what the edit names
 * changes: other regions, locations, routes and their scenes stay identical. New locations still need placement on
 * the terrain (`intents`); rebuilt ones are queued for detailing again.
 */
export function applyWorldEdit(world: ThreeWorldDocument, value: unknown): WorldEditResult {
  const edit = record(value), notes: string[] = [], changed: string[] = []
  const list = (key: string) => (Array.isArray(edit[key]) ? edit[key] : []) as unknown[]
  const regions: WorldRegion[] = world.regions.map((region) => {
    const update = list('updateRegions').map(record).find((item) => item.id === region.id)
    if (!update) return region
    changed.push(region.id)
    return { ...region, name: label(update.name, 120, region.name), biome: pick(update.biome, worldBiomes, region.biome), danger: Math.round(clamp(update.danger, 0, 5, region.danger)),
      ambience: pick(update.ambience, ambiencePresets, region.ambience), music: pick(update.music, musicPresets, region.music), weather: pick(update.weather, weatherKinds, region.weather),
      ...(typeof update.premise === 'string' && update.premise.trim() ? { premise: update.premise.trim().slice(0, 600) } : {}) }
  })
  // New regions and locations go through the atlas sanitizer, so they get the same rules and unique IDs.
  const fresh = sanitizeAtlas({ regions: list('addRegions'), locations: list('addLocations'), routes: [], terrain: {} }, world.generation?.request ?? '', world.seed, world.terrain.size)
  const taken = new Set([...regions.map((region) => region.id), ...world.locations.map((location) => location.id)])
  const rename = (id: string) => { let next = id, n = 2; while (taken.has(next)) next = `${id}-${n++}`; taken.add(next); return next }
  const regionNames = new Map<string, string>()
  const addedRegions = list('addRegions').length ? fresh.world.regions.map((region) => { const id = rename(region.id); regionNames.set(region.id, id); changed.push(id); return { ...region, id } }) : []
  const removed = new Set(list('removeLocations').filter((id): id is string => typeof id === 'string' && world.locations.some((location) => location.id === id)))
  const locations: WorldLocation[] = world.locations.filter((location) => !removed.has(location.id)).map((location) => {
    const update = list('updateLocations').map(record).find((item) => item.id === location.id)
    if (!update) return location
    changed.push(location.id)
    const brief = typeof update.brief === 'string' && update.brief.trim() ? update.brief.trim().slice(0, 1200) : location.brief
    return { ...location, name: label(update.name, 120, location.name), ...(brief ? { brief } : {}), scene: update.rebuild === true ? null : location.scene }
  })
  const intents: AtlasLocationIntent[] = []
  const known = new Map([...regions, ...addedRegions].map((region) => [region.id, region]))
  for (const [index, added] of fresh.world.locations.entries()) {
    const raw = record(list('addLocations')[index]), wanted = typeof raw.region === 'string' ? regionNames.get(slug(raw.region, raw.region)) ?? raw.region : ''
    const regionId = known.has(wanted) ? wanted : world.regions.find((region) => region.name === raw.region)?.id ?? regions[0]?.id ?? null
    const id = rename(added.id)
    const site = (regionId ? known.get(regionId)?.site : undefined) ?? [0, 0]
    locations.push({ ...added, id, regionId, position: [site[0], site[1]] })
    intents.push({ ...fresh.intents[index], id })
    changed.push(id)
  }
  const ids = new Set(locations.map((location) => location.id)), removedRoutes = new Set(list('removeRoutes'))
  const routes: WorldRoute[] = world.routes.filter((route) => ids.has(route.from) && ids.has(route.to) && !removedRoutes.has(route.id))
  for (const raw of list('addRoutes').map(record)) {
    const from = String(raw.from), to = String(raw.to)
    if (!ids.has(from) || !ids.has(to) || from === to || routes.some((route) => [route.from, route.to].sort().join('|') === [from, to].sort().join('|'))) continue
    const kind = pick(raw.kind, routeKinds, 'road')
    routes.push({ id: rename(`rota-${from}-${to}`.slice(0, 60)), kind, from, to, width: kind === 'road' ? 5 : 2.5 })
    changed.push(routes[routes.length - 1].id)
  }
  if (removed.size) notes.push(`${removed.size} locais removidos.`)
  const rebuilt = locations.filter((location) => !location.scene && (intents.some((intent) => intent.id === location.id && intent.detail) || list('updateLocations').map(record).some((item) => item.id === location.id && item.rebuild === true))).map((location) => location.id)
  const generation = { request: world.generation?.request ?? '', pending: [...new Set([...(world.generation?.pending ?? []).filter((id) => ids.has(id)), ...rebuilt])], failed: (world.generation?.failed ?? []).filter((item) => ids.has(item.id)) }
  const next = validateWorld({ ...world, regions: [...regions, ...addedRegions], locations, routes, generation })
  return { world: next, intents, changed: [...new Set(changed)], notes }
}

/** Asks the model for an edit of the existing world and applies it locally; new locations are then placed and detailed. */
export async function editWorld(world: ThreeWorldDocument, request: string, deps: WorldGenerationDeps, signal: AbortSignal): Promise<{ world: ThreeWorldDocument; changed: string[] }> {
  const summary = JSON.stringify({ name: world.name, regions: world.regions.map(({ id, name, site, biome, danger }) => ({ id, name, site, biome, danger })),
    locations: world.locations.map(({ id, name, kind, regionId, position }) => ({ id, name, kind, region: regionId, position })), routes: world.routes.map(({ id, from, to }) => ({ id, from, to })) })
  const messages: AgentMessage[] = [{ role: 'system', content: `${ATLAS_PROMPT}\nAgora edite um mundo existente: devolva somente as mudanças pedidas (adições, atualizações, remoções) e deixe todo o resto de fora.` },
    { role: 'user', content: `Mundo atual: ${summary}\nPedido: ${request}` }]
  deps.onEvent?.({ step: 'atlas', detail: 'A IA está planejando a edição do mundo…' })
  const value = await persist((attempt) => deps.provider.generateStructured<unknown>(attempt ? [...messages, { role: 'user', content: 'A tentativa anterior não terminou. Entregue somente as mudanças, de forma concisa.' }] : messages, worldEditSchema, { temperature: 0.4, maxTokens: 4096, signal }), 'Edição do mundo', deps, signal)
  const { world: edited, intents, changed, notes } = applyWorldEdit(world, value)
  let placed = edited
  if (intents.length) { const result = await deps.place(edited, intents, intents.map((intent) => intent.id)); placed = result.world; notes.push(...result.notes) }
  deps.checkpoint(placed)
  if (notes.length) deps.onEvent?.({ step: 'terrain', detail: notes.join(' ') })
  return { world: await continueWorld(placed, deps, signal), changed }
}
