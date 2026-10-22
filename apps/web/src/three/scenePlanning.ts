import type { AgentMessage, JsonSchema, LLMProvider } from '../../../../packages/agent/src/provider.ts'
import type { ThreeSceneDocument } from './sceneDocument.ts'
import { sceneMatrices } from './scenePlacement.ts'
import { buildingPlan } from './sceneArchitecture.ts'
import { Vector3 } from 'three'
import { reviewPlannedRoutes } from './sceneRouteReview.ts'
import { isStructuredTopology, sceneIntent } from './sceneDirection.ts'
import { terrainBiomes } from './sceneGeometrySpec.ts'

const styles = ['cottage', 'townhouse', 'lodge', 'villa'] as const
const terrainStyles = ['rolling', 'ridged', 'terraced', 'dunes'] as const
const biomes = terrainBiomes
const roles = ['arrival', 'settlement', 'landmark', 'nature', 'challenge', 'destination'] as const
const objectives = ['collectAll', 'defeatEnemies', 'reachGoal'] as const

export interface ScenePlan {
  title: string
  identity: string
  extent: [number, number]
  palette: string[]
  terrain: { style: typeof terrainStyles[number]; biome: typeof biomes[number]; relief: number }
  spawnZoneId: string
  zones: {
    id: string; name: string; role: typeof roles[number]; center: [number, number]; radius: number
    landmark: string; activities: string[]
  }[]
  routes: { from: string; to: string; width: number }[]
  buildings: {
    zoneId: string; style: typeof styles[number]; floors: 1 | 2; width: number; depth: number
    count: number; furnished: boolean
  }[]
  objective: { type: typeof objectives[number]; title: string; zoneId: string } | null
}

const number = (minimum: number, maximum: number) => ({ type: 'number', minimum, maximum })
const integer = (minimum: number, maximum: number) => ({ type: 'integer', minimum, maximum })
const string = (maxLength: number, minLength = 1) => ({ type: 'string', minLength, maxLength })
const array = (items: unknown, maxItems: number, minItems = 0) => ({ type: 'array', items, minItems, maxItems })
const object = (properties: Record<string, unknown>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false })
const enumeration = (values: readonly string[]) => ({ type: 'string', enum: values })
const idSchema = { ...string(40), pattern: '^[a-z][a-z0-9-]*$' }

/** Kept separate from the builder schema: the planning agent produces a layout, never meshes or code. */
export const scenePlanSchema: JsonSchema = object({
  title: string(100), identity: string(350), extent: array(number(40, 150), 2, 2),
  palette: array({ type: 'string', pattern: '^#[0-9a-fA-F]{6}$' }, 6, 3),
  terrain: object({ style: enumeration(terrainStyles), biome: enumeration(biomes), relief: number(0, 20) }),
  spawnZoneId: idSchema,
  zones: array(object({ id: idSchema, name: string(80), role: enumeration(roles), center: array(number(-75, 75), 2, 2), radius: number(4, 35), landmark: string(200), activities: array(string(120), 4) }), 8, 2),
  routes: array(object({ from: idSchema, to: idSchema, width: number(1.8, 6) }), 12, 1),
  buildings: array(object({ zoneId: idSchema, style: enumeration(styles), floors: integer(1, 2), width: number(7.5, 16), depth: number(8.5, 16), count: integer(1, 8), furnished: { type: 'boolean' } }), 8),
  objective: { anyOf: [{ type: 'null' }, object({ type: enumeration(objectives), title: string(120), zoneId: idSchema })] },
})

const normalized = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

/** Avoid an extra model request for objects, ordinary edits, or short single-feature scene requests. */
export function shouldPlanScene(request: string): boolean {
  const text = normalized(request.trim())
  if (/^(corrija|conserte|repare|remova|retire|exclua|mude|adicione|fix|repair|remove|add|change)\b/.test(text)) return false
  const intent=sceneIntent(request)
  if (!intent.world && !intent.game) return false
  const features = [
    /\b(casas?|sobrados?|edificios?|construcoes|house|houses|buildings?|townhouses?)\b/,
    /\b(interior|interiores|mobilia|mobiliad\w*|furnished|furniture)\b/,
    /\b(andares|pavimentos|sobrados?|escadas?|two.story|two.floor|second.floor)\b/,
    /\b(relevo|montanhas?|encostas?|colinas?|terreno|terrain|mountains?|hills?)\b/,
    /\b(rios?|lagos?|cachoeiras?|pontes?|river|lake|waterfall|bridge)\b/,
    /\b(arvores|vegetacao|floresta|bosque|jardins?|forest|trees|gardens?)\b/,
    /\b(ruas?|estradas?|caminhos?|trilhas?|praca|roads?|paths?|streets?|square)\b/,
    /\b(castelo|torre|templo|ruinas|moinho|farol|castle|tower|temple|ruins|windmill|lighthouse)\b/,
    /\b(colet\w*|inimigos?|objetivos?|missoes|missao|portais|portal|recompensas?|collect\w*|enemies|quests?|goals?)\b/,
    /\b(noite|noturn\w*|neon|chuva|neblina|night|fog|rain)\b/,
    /\b(diferentes|variedad\w*|bairros|distritos|districts|diverse|different)\b/,
    /\b(corredores?|corridors?|salas?|rooms?|setores?|sectors?|laboratorios?|laboratories|masmorras?|dungeons?)\b/,
    /\b(sci.?fi|espacial|space|orbital|futurist\w*|cyberpunk|industrial)\b/,
    /\b(planetas?|asteroides?|galaxias?|nebulosas?|naves?|satelites?|orbita\w*|planets?|asteroids?|galaxy|nebula|spaceships?|satellites?)\b/,
    /\b(arenas?|combate|combat|batalhas?|battles?|inimigos?|enemies|patrulhas?|patrols?)\b/,
    /\b(coberturas?|cover|flancos?|flanking|obstaculos?|obstacles?)\b/,
    /\b(plataformas?|platforms?|platformer|parkour|saltos?|jumping|pulos?)\b/,
    /\b(moveis|moving|elevadores?|elevators?|checkpoints?|perigos?|hazards?)\b/,
    /\b(puzzles?|quebra.cabecas?|enigmas?|interruptores?|switches?|alavancas?|levers?)\b/,
  ].filter(feature => feature.test(text)).length
  return features >= 3 || (features >= 2 && (intent.platforms || intent.combat || intent.puzzle)) || (text.length >= 220 && features >= 2)
}

const SYSTEM = `Você é o agente de planejamento espacial de um gerador de jogos. Um agente construtor separado receberá seu plano e o pedido original. Entregue somente o JSON do schema; nunca código, meshes, shaders ou uma receita de nodes.
Planeje o GÊNERO solicitado: espaço sideral com regiões de voo livre (planetas, estação, cinturão de asteroides, frota), terrain={style:"rolling",biome:"none",relief:0}, buildings=[] e routes como trajetos de voo; instalação espacial com salas/corredores; arena com combate/coberturas; percurso de plataformas com saltos/checkpoints; masmorra/ruína com exploração e perigos; puzzle com ações e efeitos; paisagem externa quando realmente pedida. Nenhum gênero exige por padrão vila, casas, árvores, gramado ou coleta. Não converta temas sci-fi/industriais em casas rurais recoloridas. Inimigos pedidos exigem patrulha/perseguição/contato funcionais, mesmo com objetivo reachGoal; tiro existe apenas pela arma do jogador e veículos dirigíveis não existem.
DIREÇÃO CRIATIVA: identity é a premissa em uma frase com gancho; title é evocativo. Dê a cada zona um landmark próprio e activities com micro-história e objetos que a contem (ex.: "carroça tombada e caixotes saqueados", "fogueira com bancos e mercador"), personagens coerentes (NPCs em assentamentos, fauna na natureza, inimigos do tema) e uma recompensa. Encadeie as zonas como início seguro → desafio → recompensa → conclusão; chaves e itens de missão ficam numa zona anterior à passagem trancada. Sobrevivência/hordas: objective=null e descreva as ondas e entradas em activities (o construtor usa o objetivo survive); chefe: zona challenge ampla para o confronto final.
Planeje um lugar compacto e reconhecível, com escala humana, marco visual e percurso explorável. extent é [largura, profundidade] em metros, entre 40 e 150; isso limita a composição, sem exigir preencher o mapa. O centro do mapa é [0,0]. Cada zona tem center=[x,z] e radius; seu círculo precisa caber inteiramente no mapa. Use 2–8 zonas com funções distintas, centros separados e somente o espaço necessário. routes representam CONEXÕES DE JOGABILIDADE entre IDs de zonas, não necessariamente estradas: salas usam passagens/portas; plataformas usam saltos alcançáveis, escadas ou apoios móveis; arenas usam circulação e flancos; ambientes externos podem usar caminhos. Todas as zonas precisam ser alcançáveis desde spawnZoneId pelo movimento realmente disponível. Preserve vãos intencionais do platformer e não aplaine plataformas em uma estrada. Reserve chegada segura sem inimigos ou hazards junto do spawn. Relacione atividades ao pedido; não invente combate em uma exploração tranquila.
Terrain.relief é a amplitude vertical em metros, 0 para terreno plano; para interiores, arena técnica ou plataformas suspensas sem paisagem natural, use terrain={style:"rolling",biome:"none",relief:0} e buildings=[] quando não há casas residenciais pedidas. O campo terrain não obriga criar malha de terreno: pisos/lajes/plataformas podem compor todo o suporte. buildings é exclusivamente o catálogo residencial opcional; naves, salas industriais, torres sci-fi, ruínas e coberturas de arena devem ser descritas em landmark/activities e construídas com geometrias próprias. Nas paisagens preserve caminhos com declive caminhável e apoios planos sob construções. Escolha biome e palette coerentes com o local. objective é null para contemplação/exploração livre; senão collectAll, defeatEnemies ou reachGoal com destino conhecido. Puzzles precisam de controles com efeito real em portas/plataformas e uma saída acessível. Todas as referências usam IDs existentes. O pedido original é a autoridade: preserve requisitos, época, quantidade e atmosfera. Descreva como realizar os requisitos; não substitua conteúdo pedido por prosa genérica.`

const HOUSING_SYSTEM=`
O pedido inclui arquitetura residencial compatível com o catálogo: buildings define famílias que o construtor distribuirá dentro da zona. Cada casa ocupa ao menos (width+3)*(depth+4) metros quadrados incluindo acesso, escada e fachada. Não exceda 70% da área circular da zona com esses envelopes; no máximo 12 casas no total. Três ou mais casas exigem ao menos três plantas/silhuetas diferentes, mudando style, floors ou dimensões; cor e seed não são variedade. Styles: cottage, townhouse, lodge, villa. Preserve escala humana: width 7.5–16m, depth 8.5–16m; sobrado/primeiro andar exige floors=2 e interiores mobiliados exigem furnished=true. Essas famílias não substituem estruturas exclusivas pedidas para outros usos.`

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Plano inválido: ${label} precisa ser um objeto.`)
  return value as Record<string, unknown>
}
function text(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`Plano inválido: ${label} precisa conter de 1 a ${max} caracteres.`)
  return value.trim()
}
function id(value: unknown, label: string): string {
  const result = text(value, label, 40)
  if (!/^[a-z][a-z0-9-]*$/.test(result)) throw new Error(`Plano inválido: ID de ${label}.`)
  return result
}
function bounded(value: unknown, label: string, min: number, max: number, whole = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (whole && !Number.isInteger(value))) throw new Error(`Plano inválido: ${label} fora do intervalo ${min}–${max}.`)
  return value
}
function member<T extends string>(value: unknown, label: string, values: readonly T[]): T {
  if (typeof value !== 'string' || !values.includes(value as T)) throw new Error(`Plano inválido: ${label} desconhecido.`)
  return value as T
}
function list(value: unknown, label: string, min: number, max: number): unknown[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) throw new Error(`Plano inválido: ${label} precisa ter de ${min} a ${max} itens.`)
  return value
}

/** Validate relationships and physical limits locally, even when a provider ignores JSON Schema. */
export function validateScenePlan(value: unknown): ScenePlan {
  const raw = record(value, 'plano'), terrain = record(raw.terrain, 'terreno')
  const extent = list(raw.extent, 'dimensões', 2, 2).map(v => bounded(v, 'dimensão', 40, 150)) as [number, number]
  const palette = list(raw.palette, 'paleta', 3, 6).map(value => {
    if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value)) throw new Error('Plano inválido: cor da paleta.')
    return value
  })
  const zones = list(raw.zones, 'zonas', 2, 8).map((value): ScenePlan['zones'][number] => {
    const zone = record(value, 'zona'), center = list(zone.center, 'centro', 2, 2).map(v => bounded(v, 'coordenada', -75, 75)) as [number, number]
    const radius = bounded(zone.radius, 'raio', 4, 35)
    if (center.some((v, axis) => Math.abs(v) + radius > extent[axis] / 2)) throw new Error('Plano inválido: zona fora dos limites do mapa.')
    return { id: id(zone.id, 'zona'), name: text(zone.name, 'nome da zona', 80), role: member(zone.role, 'função da zona', roles), center, radius,
      landmark: text(zone.landmark, 'marco da zona', 200), activities: list(zone.activities, 'atividades', 0, 4).map(v => text(v, 'atividade', 120)) }
  })
  const known = new Set(zones.map(zone => zone.id))
  if (known.size !== zones.length) throw new Error('Plano inválido: IDs de zonas repetidos.')
  for (let i = 0; i < zones.length; i++) for (let j = i + 1; j < zones.length; j++) {
    if (Math.hypot(zones[i].center[0] - zones[j].center[0], zones[i].center[1] - zones[j].center[1]) < (zones[i].radius + zones[j].radius) * 0.55) throw new Error('Plano inválido: zonas concentram conteúdo no mesmo espaço.')
  }
  const reference = (value: unknown, label: string) => {
    const result = id(value, label)
    if (!known.has(result)) throw new Error(`Plano inválido: ${label} referencia uma zona inexistente.`)
    return result
  }
  const spawnZoneId = reference(raw.spawnZoneId, 'chegada')
  if (zones.find(zone => zone.id === spawnZoneId)!.role === 'challenge') throw new Error('Plano inválido: início colocado em zona de perigo.')
  const edges = new Set<string>()
  const routes = list(raw.routes, 'rotas', 1, 12).map(value => {
    const route = record(value, 'rota'), from = reference(route.from, 'origem'), to = reference(route.to, 'destino')
    const key = [from, to].sort().join(':')
    if (from === to || edges.has(key)) throw new Error('Plano inválido: rota repetida ou sem destino distinto.')
    edges.add(key)
    return { from, to, width: bounded(route.width, 'largura da rota', 1.8, 6) }
  })
  const reachable = new Set([spawnZoneId])
  for (let pass = 0; pass < zones.length; pass++) for (const route of routes) {
    if (reachable.has(route.from)) reachable.add(route.to)
    if (reachable.has(route.to)) reachable.add(route.from)
  }
  if (reachable.size !== zones.length) throw new Error('Plano inválido: existem zonas sem rota desde a chegada.')
  const buildings = list(raw.buildings, 'famílias de casas', 0, 8).map((value): ScenePlan['buildings'][number] => {
    const building = record(value, 'família de casas')
    if (typeof building.furnished !== 'boolean') throw new Error('Plano inválido: furnished precisa ser booleano.')
    return { zoneId: reference(building.zoneId, 'local da casa'), style: member(building.style, 'arquitetura', styles), floors: bounded(building.floors, 'pavimentos', 1, 2, true) as 1 | 2,
      width: bounded(building.width, 'largura da casa', 7.5, 16), depth: bounded(building.depth, 'profundidade da casa', 8.5, 16), count: bounded(building.count, 'quantidade de casas', 1, 8, true), furnished: building.furnished }
  })
  const totalHouses = buildings.reduce((sum, building) => sum + building.count, 0)
  if (totalHouses > 12) throw new Error('Plano inválido: mais de 12 casas excedem o orçamento de uma cena compacta.')
  if (totalHouses >= 3 && new Set(buildings.map(building => JSON.stringify([building.style, building.floors, building.width, building.depth]))).size < 3) throw new Error('Plano inválido: habitações precisam de pelo menos três plantas e silhuetas.')
  for (const zone of zones) {
    const occupied = buildings.filter(building => building.zoneId === zone.id).reduce((sum, building) => sum + building.count * (building.width + 3) * (building.depth + 4), 0)
    if (occupied > Math.PI * zone.radius ** 2 * 0.7) throw new Error(`Plano inválido: casas sem espaço para circulação na zona ${zone.id}.`)
  }
  let objective: ScenePlan['objective'] = null
  if (raw.objective !== null) {
    const goal = record(raw.objective, 'objetivo')
    objective = { type: member(goal.type, 'tipo de objetivo', objectives), title: text(goal.title, 'título do objetivo', 120), zoneId: reference(goal.zoneId, 'objetivo') }
  }
  return { title: text(raw.title, 'título', 100), identity: text(raw.identity, 'identidade', 350), extent, palette,
    terrain: { style: member(terrain.style, 'relevo', terrainStyles), biome: member(terrain.biome, 'bioma', biomes), relief: bounded(terrain.relief, 'amplitude vertical', 0, 20) },
    spawnZoneId, zones, routes, buildings, objective }
}

const clampNumber = (value: unknown, min: number, max: number, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback
const slugId = (value: unknown, fallback: string) => {
  const slug = normalized(typeof value === 'string' ? value : '').replace(/[^a-z0-9-]+/g, '-').replace(/^[^a-z]+|-+$/g, '').slice(0, 40)
  return slug || fallback
}
const plainText = (value: unknown, max: number, fallback: string) => typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : fallback

/**
 * Brings a planner answer inside the plan contract instead of discarding it: values are clamped, zones fit the map and
 * stop crowding each other, broken references are dropped, unreachable zones are linked to the nearest reachable one,
 * housing is reduced to the zone capacity and diversified. Every change is reported; the result passes validateScenePlan.
 */
export function repairScenePlan(value: unknown, request = ''): { plan: ScenePlan; notes: string[] } {
  const notes: string[] = [], note = (message: string) => { if (!notes.includes(message)) notes.push(message) }
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  const rawExtent = Array.isArray(raw.extent) ? raw.extent : []
  const extent: [number, number] = [clampNumber(rawExtent[0], 40, 150, 100), clampNumber(rawExtent[1], 40, 150, 100)]
  const palette = (Array.isArray(raw.palette) ? raw.palette : []).filter((color): color is string => typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color)).slice(0, 6)
  for (const fallback of ['#7f8c8d', '#c8b28a', '#4f6d5a']) if (palette.length < 3) palette.push(fallback)
  const terrainSource = raw.terrain && typeof raw.terrain === 'object' ? raw.terrain as Record<string, unknown> : {}
  const terrain: ScenePlan['terrain'] = { style: terrainStyles.includes(terrainSource.style as typeof terrainStyles[number]) ? terrainSource.style as typeof terrainStyles[number] : 'rolling',
    biome: biomes.includes(terrainSource.biome as typeof biomes[number]) ? terrainSource.biome as typeof biomes[number] : 'none', relief: clampNumber(terrainSource.relief, 0, 20, 0) }
  const used = new Set<string>()
  let zones: ScenePlan['zones'] = (Array.isArray(raw.zones) ? raw.zones : []).slice(0, 8).flatMap((entry, index) => {
    if (!entry || typeof entry !== 'object') return []
    const zone = entry as Record<string, unknown>, center = Array.isArray(zone.center) ? zone.center : []
    let id = slugId(zone.id, `zona-${index + 1}`)
    for (let suffix = 2; used.has(id); suffix++) id = `${slugId(zone.id, 'zona').slice(0, 36)}-${suffix}`
    used.add(id)
    const radius = clampNumber(zone.radius, 4, 35, 10)
    const fit = (axis: 0 | 1) => { const limit = Math.max(0, extent[axis] / 2 - Math.min(radius, extent[axis] / 2)); return clampNumber(center[axis], -limit, limit, 0) }
    const result = { id, name: plainText(zone.name, 80, `Zona ${index + 1}`), role: roles.includes(zone.role as typeof roles[number]) ? zone.role as typeof roles[number] : 'landmark',
      center: [fit(0), fit(1)] as [number, number], radius: Math.min(radius, extent[0] / 2, extent[1] / 2), landmark: plainText(zone.landmark, 200, plainText(zone.name, 80, 'Marco da zona')),
      activities: (Array.isArray(zone.activities) ? zone.activities : []).filter((activity): activity is string => typeof activity === 'string' && !!activity.trim()).slice(0, 4).map((activity) => activity.trim().slice(0, 120)) }
    if (JSON.stringify(result.center) !== JSON.stringify(center.slice(0, 2)) || result.radius !== zone.radius) note('Zonas foram ajustadas para caber no mapa.')
    return [result]
  })
  // Crowded zones shrink towards the minimum radius; a zone that still overlaps another is removed.
  for (let i = 0; i < zones.length; i++) for (let j = i + 1; j < zones.length; j++) {
    const a = zones[i], b = zones[j], distance = Math.hypot(a.center[0] - b.center[0], a.center[1] - b.center[1]), limit = (a.radius + b.radius) * 0.55
    if (distance >= limit) continue
    const factor = Math.max(4 / Math.min(a.radius, b.radius), distance / limit * 0.999)
    a.radius = Math.max(4, a.radius * factor); b.radius = Math.max(4, b.radius * factor)
    note('Zonas sobrepostas foram reduzidas.')
  }
  zones = zones.filter((zone, index) => zones.slice(0, index).every((other) => Math.hypot(zone.center[0] - other.center[0], zone.center[1] - other.center[1]) >= (zone.radius + other.radius) * 0.55))
  if (zones.length < 2) throw new Error('Plano inválido: são necessárias ao menos duas zonas distintas.')
  const known = new Set(zones.map((zone) => zone.id))
  let spawnZoneId = typeof raw.spawnZoneId === 'string' && known.has(slugId(raw.spawnZoneId, '')) ? slugId(raw.spawnZoneId, '') : ''
  if (!spawnZoneId || zones.find((zone) => zone.id === spawnZoneId)!.role === 'challenge') {
    const safe = zones.find((zone) => zone.role === 'arrival') ?? zones.find((zone) => zone.role !== 'challenge')
    if (safe) spawnZoneId = safe.id
    else { zones[0].role = 'arrival'; spawnZoneId = zones[0].id }
    note('A chegada do jogador foi movida para uma zona segura.')
  }
  const edges = new Set<string>(), routes: ScenePlan['routes'] = []
  for (const entry of Array.isArray(raw.routes) ? raw.routes : []) {
    if (!entry || typeof entry !== 'object') continue
    const route = entry as Record<string, unknown>, from = slugId(route.from, ''), to = slugId(route.to, ''), key = [from, to].sort().join(':')
    if (!known.has(from) || !known.has(to) || from === to || edges.has(key) || routes.length >= 12) { note('Rotas inválidas ou repetidas foram descartadas.'); continue }
    edges.add(key); routes.push({ from, to, width: clampNumber(route.width, 1.8, 6, 3) })
  }
  const reachable = () => {
    const seen = new Set([spawnZoneId])
    for (let pass = 0; pass < zones.length; pass++) for (const route of routes) { if (seen.has(route.from)) seen.add(route.to); if (seen.has(route.to)) seen.add(route.from) }
    return seen
  }
  for (let seen = reachable(); seen.size < zones.length; seen = reachable()) {
    let best: [ScenePlan['zones'][number], ScenePlan['zones'][number], number] | null = null
    for (const a of zones) if (seen.has(a.id)) for (const b of zones) if (!seen.has(b.id)) {
      const distance = Math.hypot(a.center[0] - b.center[0], a.center[1] - b.center[1])
      if (!best || distance < best[2]) best = [a, b, distance]
    }
    if (!best || routes.length >= 12) { zones = zones.filter((zone) => seen.has(zone.id)); note('Zonas inalcançáveis foram removidas.'); break }
    routes.push({ from: best[0].id, to: best[1].id, width: 3 }); edges.add([best[0].id, best[1].id].sort().join(':'))
    note('Zonas sem acesso foram ligadas à zona alcançável mais próxima.')
  }
  if (zones.length < 2) throw new Error('Plano inválido: são necessárias ao menos duas zonas alcançáveis.')
  const zoneIds = new Set(zones.map((zone) => zone.id))
  const intent = request ? sceneIntent(request) : null
  let buildings: ScenePlan['buildings'] = (Array.isArray(raw.buildings) ? raw.buildings : []).slice(0, 8).flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const building = entry as Record<string, unknown>, zoneId = slugId(building.zoneId, '')
    if (!zoneIds.has(zoneId)) { note('Famílias de casas sem zona válida foram descartadas.'); return [] }
    return [{ zoneId, style: styles.includes(building.style as typeof styles[number]) ? building.style as typeof styles[number] : 'cottage', floors: (clampNumber(building.floors, 1, 2, 1) >= 1.5 ? 2 : 1) as 1 | 2,
      width: clampNumber(building.width, 7.5, 16, 9), depth: clampNumber(building.depth, 8.5, 16, 9.5), count: Math.round(clampNumber(building.count, 1, 8, 1)), furnished: building.furnished === true }]
  })
  if (intent && isStructuredTopology(intent.topology) && !intent.housing && buildings.length) { buildings = []; note('Casas residenciais não pedidas foram retiradas do plano deste gênero.') }
  for (let total = buildings.reduce((sum, item) => sum + item.count, 0); total > 12; total--) {
    const largest = buildings.reduce((a, b) => b.count > a.count ? b : a); largest.count--
    note('O número de casas foi limitado a 12.')
  }
  buildings = buildings.filter((item) => item.count > 0)
  for (const zone of zones) {
    const capacity = Math.PI * zone.radius ** 2 * 0.7
    const inZone = buildings.filter((item) => item.zoneId === zone.id)
    const occupied = () => inZone.reduce((sum, item) => sum + item.count * (item.width + 3) * (item.depth + 4), 0)
    while (occupied() > capacity && inZone.some((item) => item.count > 0)) {
      const largest = inZone.filter((item) => item.count > 0).reduce((a, b) => b.count * b.width * b.depth > a.count * a.width * a.depth ? b : a)
      if (largest.width > 7.5 || largest.depth > 8.5) { largest.width = Math.max(7.5, largest.width - 1); largest.depth = Math.max(8.5, largest.depth - 1) } else largest.count--
      note(`As casas da zona ${zone.name} foram reduzidas para preservar a circulação.`)
    }
  }
  buildings = buildings.filter((item) => item.count > 0)
  const signature = (item: ScenePlan['buildings'][number]) => JSON.stringify([item.style, item.floors, item.width, item.depth])
  if (buildings.reduce((sum, item) => sum + item.count, 0) >= 3 && new Set(buildings.map(signature)).size < 3) {
    const split: ScenePlan['buildings'] = []
    for (const item of buildings) for (let copy = 0; copy < item.count; copy++) split.push({ ...item, count: 1 })
    split.forEach((item, index) => { item.style = styles[(styles.indexOf(item.style) + index) % styles.length]; if (index % 2) item.width = Math.min(16, Math.max(7.5, item.width + (index % 4 === 1 ? 1.2 : -1.2))) })
    const merged = new Map<string, ScenePlan['buildings'][number]>()
    for (const item of split) { const key = JSON.stringify([item.zoneId, signature(item), item.furnished]); const existing = merged.get(key); if (existing) existing.count++; else merged.set(key, { ...item }) }
    buildings = [...merged.values()].slice(0, 8)
    note('As casas receberam plantas diferentes para formar ao menos três silhuetas.')
  }
  let objective: ScenePlan['objective'] = null
  if (raw.objective && typeof raw.objective === 'object') {
    const goal = raw.objective as Record<string, unknown>, zoneId = slugId(goal.zoneId, '')
    if (objectives.includes(goal.type as typeof objectives[number])) objective = { type: goal.type as typeof objectives[number], title: plainText(goal.title, 120, 'Objetivo'), zoneId: zoneIds.has(zoneId) ? zoneId : zones[zones.length - 1].id }
    else note('Um objetivo desconhecido foi descartado.')
  }
  if (intent && isStructuredTopology(intent.topology) && !intent.landscape && (terrain.biome !== 'none' || terrain.relief > 0)) {
    terrain.biome = 'none'; terrain.relief = 0
    note('O relevo natural foi retirado do plano porque o gênero usa pisos, plataformas ou voo livre.')
  }
  const plan = validateScenePlan({ title: plainText(raw.title, 100, 'Cena planejada'), identity: plainText(raw.identity, 350, plainText(raw.title, 100, 'Cena planejada')), extent, palette, terrain, spawnZoneId, zones, routes, buildings, objective })
  return { plan, notes }
}

/** One planning completion, no hidden retry: invalid details are repaired locally. The caller owns fallback and the call budget. */
export async function planScene(provider: LLMProvider, request: string, signal: AbortSignal, onProgress: (phase: string) => void = () => {}): Promise<ScenePlan> {
  const aborted = () => signal.reason ?? new DOMException('Cancelado', 'AbortError')
  if (signal.aborted) throw aborted()
  onProgress('Agente de planejamento: distribuindo áreas, arquitetura e percurso…')
  if (signal.aborted) throw aborted()
  const requestIntent=sceneIntent(request)
  const messages: AgentMessage[] = [{ role: 'system', content: SYSTEM+(requestIntent.catalogHousing?HOUSING_SYSTEM:'') }, { role: 'user', content: request }]
  let abort = () => {}
  const cancellation = new Promise<never>((_, reject) => {
    abort = () => { void provider.cancel?.().catch(() => {}); reject(aborted()) }
    signal.addEventListener('abort', abort, { once: true })
  })
  try {
    const value = await Promise.race([provider.generateStructured<unknown>(messages, scenePlanSchema, { temperature: 0.25, maxTokens: Math.min(4096, provider.maxOutputTokens ?? 4096) }), cancellation])
    if (signal.aborted) throw aborted()
    const { plan: result, notes } = repairScenePlan(value, request)
    onProgress(`Plano validado: ${result.zones.length} áreas conectadas e ${result.buildings.reduce((sum, building) => sum + building.count, 0)} casas.${notes.length ? ` Ajustes locais: ${notes.join(' ')}` : ''}`)
    return result
  } finally { signal.removeEventListener('abort', abort) }
}

/** Concrete handoff from the planning agent to the construction and review agents. */
export function planningBrief(plan: ScenePlan,request=''): string {
  const intent=request?sceneIntent(request):null,exterior=!intent || !isStructuredTopology(intent.topology)
  const connection=exterior?'Materialize as rotas externas como caminhos conectados quando apropriado.':'As routes são conectividade conceitual: implemente passagens, portas, escadas ou saltos conforme o gênero; não gere uma rede de estradas por cima dos pisos ou dos vãos intencionais.'
  return `\nPLANO ESPACIAL VALIDADO PELO AGENTE DE PLANEJAMENTO:\n${JSON.stringify(plan)}
Construa este plano respeitando o pedido original e o gênero ${intent?.topology ?? 'solicitado'}. center e extent estão em metros no plano XZ. ${plan.buildings.length?'Cada família residencial em buildings exige count instâncias, com building.style/floors/width/depth/furnished explícitos e size=1; acessos voltados para a circulação, interiores livres e envelopes separados.':'buildings está vazio: componha a arquitetura e os elementos do tema com geometrias próprias; não acrescente casas residenciais.'} Cada zona precisa conter seu marco e atividades concretas, não apenas um nome de grupo. ${connection}
ETAPAS DO AGENTE CONSTRUTOR:
1. Apoios: ${exterior?'superfície principal, relevo e bioma quando pertinentes ao plano':'pisos, lajes, passagens e plataformas apropriados ao gênero, sem impor relevo ou gramado'}; evite superfícies coplanares e suportes atravessando áreas de circulação.
2. Implantação: materialize zonas e conexões de jogabilidade, preserve desafios intencionais e chegada segura em ${plan.spawnZoneId}.
3. Estruturas: construa as silhuetas e funções próprias do tema, com acessos e escala humana; catálogo residencial é opcional e não substitui salas, ruínas, plataformas ou instalações técnicas.
4. Ambientação: componha marcos, vegetação em agrupamentos e detalhes com a paleta do plano, preservando vazios e caminhos.
5. Jogabilidade: implemente as atividades solicitadas e ${plan.objective ? `o objetivo ${plan.objective.type} em ${plan.objective.zoneId}` : 'o objetivo do pedido original (survive para sobrevivência/hordas) ou exploração livre, sem adicionar combate não pedido'}.
ETAPA DO AGENTE REVISOR: confira limites, apoios e acessos apropriados ao gênero, famílias residenciais somente quando pedidas, escala humana, spawn e correspondência entre atividades e mecânicas. Em plataformas não trate vãos destinados a saltos como defeitos de pavimentação. O plano auxilia a execução; nunca substitui requisitos explícitos do usuário.`
}

/** The review stage checks the built document, rather than accepting the planner's prose as completion. */
export function reviewScenePlan(scene:ThreeSceneDocument,plan:ScenePlan,request=''):string[] {
  const issues:string[]=[],matrices=sceneMatrices(scene),byId=new Map(scene.nodes.map(node=>[node.id,node])),used=new Set<string>()
  const visible=(node:ThreeSceneDocument['nodes'][number]):boolean=>node.visible && (!node.parentId || visible(byId.get(node.parentId)!))
  const houses=scene.nodes.filter(node=>visible(node) && node.asset?.type==='house')
  for(const family of plan.buildings) {
    const zone=plan.zones.find(zone=>zone.id===family.zoneId)!
    const matching=houses.filter(node=>{
      if(used.has(node.id)) return false
      const built=buildingPlan(node.asset!),point=new Vector3().setFromMatrixPosition(matrices.get(node.id)!),scale=new Vector3().setFromMatrixScale(matrices.get(node.id)!)
      const realScale=[scale.x,scale.y,scale.z].every(value=>Math.abs(value*(node.asset!.size ?? 1)-1)<0.02)
      return realScale && built.style===family.style && built.floors===family.floors && Math.abs(built.width-family.width)<0.2 && Math.abs(built.depth-family.depth)<0.2 && (!family.furnished || built.furnished) && Math.hypot(point.x-zone.center[0],point.z-zone.center[1])<=zone.radius
    })
    matching.slice(0,family.count).forEach(node=>used.add(node.id))
    if(matching.length<family.count) issues.push(`Plano não realizado em ${zone.name}: esperadas ${family.count} casas ${family.style}, ${family.floors} pavimentos, ${family.width}×${family.depth} m; construídas ${matching.length}.`)
  }
  const terrain=scene.nodes.filter(node=>node.kind==='terrain' && visible(node)).sort((a,b)=>b.dimensions[0]*b.dimensions[2]-a.dimensions[0]*a.dimensions[2])[0]
  if(plan.terrain.relief>0 && (!terrain || terrain.geometry.terrainStyle!==plan.terrain.style || terrain.geometry.biome!==plan.terrain.biome)) issues.push('O terreno construído não corresponde ao relevo/bioma aprovado pelo planejador.')
  if(terrain && plan.terrain.relief>0 && Math.abs(terrain.dimensions[1]*new Vector3().setFromMatrixScale(matrices.get(terrain.id)!).y-plan.terrain.relief)>Math.max(1,plan.terrain.relief*0.35)) issues.push(`O plano reserva relevo de ${plan.terrain.relief} m; a amplitude física do terreno diverge desse valor.`)
  const arrival=plan.zones.find(zone=>zone.id===plan.spawnZoneId)!,spawn=scene.environment.player?.spawn
  if(!spawn) issues.push(`O início do jogador não foi definido na zona ${arrival.name}.`)
  else {
    if(Math.hypot(spawn[0]-arrival.center[0],spawn[2]-arrival.center[1])>arrival.radius) issues.push(`O início do jogador ficou fora da chegada planejada (${arrival.name}).`)
    if(scene.nodes.some(node=>visible(node) && ['enemy','hazard'].includes(node.behavior?.type ?? '') && new Vector3().setFromMatrixPosition(matrices.get(node.id)!).distanceTo(new Vector3(...spawn))<5)) issues.push('O início do jogador está a menos de 5 m de um inimigo ou perigo; reserve uma chegada segura.')
    else if(scene.nodes.some(node=>visible(node) && node.behavior?.type==='enemy' && new Vector3().setFromMatrixPosition(matrices.get(node.id)!).distanceTo(new Vector3(...spawn))<node.behavior.range+1)) issues.push('O início do jogador está dentro do alcance de perseguição de um inimigo; afaste o combate da chegada.')
  }
  if(plan.objective && scene.environment.objective?.type!==plan.objective.type) issues.push(`O plano exige o objetivo ${plan.objective.type}, mas a cena não o implementou.`)
  if(plan.objective) {
    const objective=plan.objective,zone=plan.zones.find(zone=>zone.id===objective.zoneId)!
    if(objective.type==='collectAll' && !scene.nodes.some(node=>visible(node) && node.interaction?.action==='collect')) issues.push('O objetivo de coleta não tem nenhum objeto coletável visível.')
    if(objective.type==='defeatEnemies' && !scene.nodes.some(node=>visible(node) && node.behavior?.type==='enemy')) issues.push('O objetivo de combate não tem nenhum inimigo visível.')
    if(objective.type==='reachGoal' && !scene.nodes.some(node=>visible(node) && node.behavior?.type==='goal' && Math.hypot(new Vector3().setFromMatrixPosition(matrices.get(node.id)!).x-zone.center[0],new Vector3().setFromMatrixPosition(matrices.get(node.id)!).z-zone.center[1])<=zone.radius)) issues.push(`O destino interativo não foi construído na zona ${zone.name}.`)
  }
  // Independently preserve explicit quantities from the original request; a planner may omit them.
  const amounts:Record<string,number>={um:1,uma:1,dois:2,duas:2,tres:3,quatro:4,cinco:5,seis:6,sete:7,oito:8,nove:9,dez:10,onze:11,doze:12,one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10}
  const quantities=normalized(request).matchAll(/\b(\d{1,2}|um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|one|two|three|four|five|six|seven|eight|nine|ten)\s+(cristais|cristal|crystals?|gemas?|gems?|moedas?|coins?|coletaveis|collectibles?)\b/g)
  for(const match of quantities) {
    const required=amounts[match[1]] ?? Number(match[1]),noun=match[2],generic=/coletaveis|collectibles?/.test(noun),gem=/crist|cryst|gem/.test(noun)
    const actual=scene.nodes.filter(node=>{
      if(!visible(node) || node.interaction?.action!=='collect') return false
      if(generic) return true
      let source=byId.get(node.parentId ?? '')
      while(source && !source.asset) source=byId.get(source.parentId ?? '')
      return (node.asset?.type ?? source?.asset?.type)===(gem?'gem':'coin') || (gem?/cristal|cristais|crystal|gema?|gem/:/moeda|coin/).test(normalized(node.name))
    }).length
    if(actual<required) issues.push(`O pedido exige ${required} ${noun}; só ${actual} objetos correspondentes podem ser coletados.`)
  }
  const intent=request?sceneIntent(request):null
  if(intent && !intent.housing && isStructuredTopology(intent.topology) && houses.length) issues.push('A cena substituiu estruturas próprias do gênero por casas residenciais que não foram pedidas.')
  return [...issues,...(!intent || !isStructuredTopology(intent.topology)?reviewPlannedRoutes(scene,plan):[])]
}
