import { ambiencePresets, animationKinds, attackStyles, avatarKinds, behaviorTypes, gradePresets, interactionActions, interactionTriggers, INTERACTION_KEYS, MAX_MESSAGE, musicPresets, objectiveTypes, MAX_SCENE_LIGHTS, MAX_SCENE_NODES, nodeLabels,
  powerKinds, skyPresets, soundPresets, subtreeIds, textureKinds, weaponKinds, weatherKinds, type SceneNode } from './sceneDocument.ts'
import { estimateTriangles, MAX_SCENE_TRIANGLES, polyhedronVariants, terrainStyles, terrainBiomes } from './sceneGeometrySpec.ts'

type Json = Record<string, unknown>
const isRecord = (value: unknown): value is Json => !!value && typeof value === 'object' && !Array.isArray(value)
const HEX = /^#[0-9a-f]{6}$/i

/** Collects automatic adjustments so the user sees what changed instead of losing the scene. */
export class SanitizeLog {
  readonly counts = new Map<string, number>()
  readonly notes: string[] = []
  adjust(label: string) { this.counts.set(label, (this.counts.get(label) ?? 0) + 1) }
  note(message: string) { if (this.notes.length < 40 && !this.notes.includes(message)) this.notes.push(message) }
  summary(): string[] {
    const values = [...this.counts].sort((a, b) => b[1] - a[1]).map(([label, count]) => `${label} (${count})`)
    return [...(values.length ? [`Valores ajustados aos limites do contrato: ${values.slice(0, 12).join(', ')}${values.length > 12 ? '…' : ''}.`] : []), ...this.notes]
  }
}

function number(log: SanitizeLog, value: unknown, min: number, max: number, fallback: number, label: string, integer = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) { if (value !== undefined && value !== null) log.adjust(label); return fallback }
  const rounded = integer ? Math.round(value) : value, result = Math.min(max, Math.max(min, rounded))
  if (result !== value) log.adjust(label)
  return result
}
function angle(log: SanitizeLog, value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) { if (value !== undefined) log.adjust(label); return 0 }
  if (value >= -360 && value <= 360) return value
  log.adjust(label)
  return ((value % 360) + 540) % 360 - 180
}
function vector(log: SanitizeLog, value: unknown, min: number, max: number, fallback: number[], label: string): number[] {
  if (!Array.isArray(value) || value.length !== 3) { if (value !== undefined) log.adjust(label); return [...fallback] }
  return value.map((item, index) => number(log, item, min, max, fallback[index], label))
}
function choice<T extends string>(log: SanitizeLog, value: unknown, options: readonly T[], fallback: T, label: string): T {
  if (options.includes(value as T)) return value as T
  if (value !== undefined && value !== null) log.adjust(label)
  return fallback
}
function color(log: SanitizeLog, value: unknown, fallback: string, label: string): string {
  if (typeof value === 'string' && HEX.test(value)) return value
  if (value !== undefined && value !== null) log.adjust(label)
  return fallback
}
function text(value: unknown, max: number, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.slice(0, max) : fallback
}
function points(log: SanitizeLog, value: unknown, axes: number, max: number, label: string): number[][] | undefined {
  if (!Array.isArray(value)) return undefined
  if (value.length > max) log.adjust(label)
  return value.slice(0, max).filter((point) => Array.isArray(point) && point.length === axes)
    .map((point: unknown[]) => point.map((item) => number(log, item, -1000, 1000, 0, label)))
}

function geometry(log: SanitizeLog, value: unknown): Json | null {
  if (!isRecord(value)) return null
  const result: Json = { ...value }
  if ('terrainStyle' in value) result.terrainStyle = choice(log, value.terrainStyle, terrainStyles, 'rolling', 'Estilo de terreno')
  if ('biome' in value) result.biome = choice(log, value.biome, terrainBiomes, 'none', 'Bioma')
  if ('segments' in value) result.segments = number(log, value.segments, 8, 128, 48, 'Segmentos', true)
  if ('radius' in value) result.radius = number(log, value.radius, 0.001, 0.5, 0.08, 'Raio tubular')
  if ('bevel' in value) result.bevel = number(log, value.bevel, 0, 0.2, 0.04, 'Bisel')
  if ('detail' in value) result.detail = number(log, value.detail, 0, 5, 1, 'Detalhe', true)
  if ('seed' in value) result.seed = number(log, value.seed, 0, 9999, 1, 'Semente', true)
  if ('variant' in value) result.variant = choice(log, value.variant, polyhedronVariants, 'icosahedron', 'Variante de poliedro')
  if ('closed' in value && typeof value.closed !== 'boolean') { result.closed = false; log.adjust('Trajetória fechada') }
  if ('text' in value) result.text = text(value.text, 160, 'Texto')
  if ('profile' in value) result.profile = points(log, value.profile, 2, 64, 'Perfil') ?? []
  if ('points' in value) result.points = points(log, value.points, 3, 64, 'Pontos da curva') ?? []
  if ('holes' in value) result.holes = Array.isArray(value.holes) ? value.holes.slice(0, 8).map((hole) => points(log, hole, 2, 32, 'Recortes') ?? []).filter((hole) => hole.length >= 3) : []
  return result
}

function material(log: SanitizeLog, node: Json): Json {
  const surface = isRecord(node.surface) ? node.surface : {}
  const source = { color: node.color, metalness: node.metalness, roughness: node.roughness, ...surface }
  const unit = (key: string, fallback: number, label: string) => number(log, (source as Json)[key], 0, 1, fallback, label)
  return { color: color(log, source.color, '#b8b8b8', 'Cor'), metalness: unit('metalness', 0.1, 'Metalicidade'), roughness: unit('roughness', 0.6, 'Rugosidade'),
    clearcoat: unit('clearcoat', 0, 'Verniz'), transmission: unit('transmission', 0, 'Transmissão'), opacity: unit('opacity', 1, 'Opacidade'), alphaTest: unit('alphaTest', 0, 'Recorte alpha'),
    sheen: unit('sheen', 0, 'Brilho têxtil'), iridescence: unit('iridescence', 0, 'Iridescência'),
    emissive: color(log, (source as Json).emissive, '#000000', 'Cor de emissão'), emissiveIntensity: number(log, (source as Json).emissiveIntensity, 0, 20, 0, 'Emissão'),
    texture: choice(log, (source as Json).texture, textureKinds, 'none', 'Textura'), textureScale: number(log, (source as Json).textureScale, 0.1, 64, 1, 'Repetição de textura'),
    normalStrength: number(log, (source as Json).normalStrength, 0, 3, 1, 'Relevo'), ior: number(log, (source as Json).ior, 1, 2.333, 1.5, 'Índice de refração'),
    thickness: number(log, (source as Json).thickness, 0, 10, 0, 'Espessura'),
    transparent: typeof (source as Json).transparent === 'boolean' ? (source as Json).transparent : false,
    doubleSided: typeof (source as Json).doubleSided === 'boolean' ? (source as Json).doubleSided : false,
    flatShading: typeof (source as Json).flatShading === 'boolean' ? (source as Json).flatShading : false }
}

function animation(log: SanitizeLog, value: unknown): Json {
  const source = isRecord(value) ? value : {}
  let kind = choice(log, source.kind, animationKinds, 'none', 'Tipo de animação')
  const keys = Array.isArray(source.keys) ? source.keys.slice(0, 16).filter(isRecord).map((key) => ({ at: number(log, key.at, 0, 1, 0, 'Keyframes'),
    move: vector(log, key.move, -1000, 1000, [0, 0, 0], 'Keyframes'), turn: vector(log, key.turn, -720, 720, [0, 0, 0], 'Keyframes'), scale: vector(log, key.scale, 0.01, 100, [1, 1, 1], 'Keyframes') }))
    .sort((a, b) => a.at - b.at).filter((key, index, all) => !index || key.at - all[index - 1].at > 1e-6) : []
  if (kind === 'keyframes' && keys.length < 2) { kind = 'none'; log.note('Uma animação por keyframes sem duas chaves distintas foi desativada.') }
  return { kind, axis: choice(log, source.axis, ['x', 'y', 'z'] as const, 'y', 'Eixo de animação'), duration: number(log, source.duration, 0.2, 120, 6, 'Período'),
    amplitude: number(log, source.amplitude, 0, 100, 0.5, 'Amplitude'), phase: ((typeof source.phase === 'number' && Number.isFinite(source.phase) ? source.phase : 0) % 360 + 360) % 360,
    start: choice(log, source.start, ['auto', 'trigger'] as const, 'auto', 'Início de animação'), easing: choice(log, source.easing, ['linear', 'smooth', 'step'] as const, 'smooth', 'Suavização'), keys }
}

function interaction(log: SanitizeLog, value: unknown): Json | null {
  if (!isRecord(value) || value.trigger === 'none') return null
  const trigger = choice(log, value.trigger, interactionTriggers, 'click', 'Gatilho de interação')
  let key = typeof value.key === 'string' ? value.key.toLowerCase() : ''
  if (trigger === 'key' && !INTERACTION_KEYS.test(key)) { log.note(`A tecla “${key}” é reservada ao jogador; o gatilho passou para mirar + E.`); key = '' }
  const label = (input: unknown) => typeof input === 'string' ? input.trim().slice(0, 40) : ''
  const action = choice(log, value.action, interactionActions, 'message', 'Ação de interação'), item = label(value.item), requires = label(value.requires)
  const power = powerKinds.includes(value.power as typeof powerKinds[number]) ? value.power : null
  return { trigger: trigger === 'key' && !key ? 'click' : trigger, key: trigger === 'key' ? key : '', radius: number(log, value.radius, 0.5, 50, 3, 'Alcance da interação'),
    action, targetId: typeof value.targetId === 'string' ? value.targetId : null,
    message: typeof value.message === 'string' ? value.message.slice(0, MAX_MESSAGE) : '',
    ...(item ? { item } : {}), ...(requires ? { requires } : {}),
    ...(typeof value.amount === 'number' && Number.isFinite(value.amount) && value.amount > 0 ? { amount: number(log, value.amount, 0, 1000, 0, 'Quantidade da interação') } : {}),
    ...(power && action === 'powerup' ? { power } : {}) }
}
function sound(log: SanitizeLog, value: unknown): Json | null {
  if (!isRecord(value)) return null
  return { preset: choice(log, value.preset, soundPresets, 'wind', 'Som'), volume: number(log, value.volume, 0, 1, 0.6, 'Volume do som'), radius: number(log, value.radius, 1, 200, 12, 'Alcance do som') }
}
function behavior(log: SanitizeLog, value: unknown): Json | null {
  if (!isRecord(value)) return null
  const type = choice(log, value.type, behaviorTypes, 'hazard', 'Comportamento')
  return { type, speed: number(log, value.speed, 0, 12, 2.5, 'Velocidade do inimigo'), range: number(log, value.range, 0.5, 80, 10, 'Alcance do comportamento'), damage: number(log, value.damage, 0, 1000, 20, 'Dano'),
    ...(typeof value.health === 'number' && Number.isFinite(value.health) ? { health: number(log, value.health, 1, 100, 1, 'Resistência', true) } : {}),
    ...(attackStyles.includes(value.attack as typeof attackStyles[number]) ? { attack: value.attack } : {}),
    ...(typeof value.flying === 'boolean' ? { flying: value.flying } : {}),
    ...(typeof value.delay === 'number' && Number.isFinite(value.delay) && value.delay > 0 ? { delay: number(log, value.delay, 0, 3600, 0, 'Atraso de aparição') } : {}) }
}

/** Brings one recipe template inside the contract. Returns null only when it cannot describe an object. */
export function sanitizeTemplate(log: SanitizeLog, value: unknown, index: number): Json | null {
  if (!isRecord(value)) { log.note(`O template ${index + 1} não era um objeto e foi ignorado.`); return null }
  const kind = choice(log, value.kind, Object.keys(nodeLabels) as SceneNode['kind'][], 'box', 'Tipo de objeto')
  const repeat = isRecord(value.repeat) ? value.repeat : {}
  const light = isRecord(value.light) ? { type: choice(log, value.light.type, ['point', 'spot'] as const, 'point', 'Tipo de luz'), color: color(log, value.light.color, '#ffffff', 'Cor da luz'),
    intensity: number(log, value.light.intensity, 0, 2000, 10, 'Intensidade da luz'), distance: number(log, value.light.distance, 0, 1000, 15, 'Alcance da luz'),
    angle: number(log, value.light.angle, 1, 89, 35, 'Abertura do spot'), penumbra: number(log, value.light.penumbra, 0, 1, 0.4, 'Penumbra'),
    castShadow: value.light.castShadow === true } : undefined
  const surface = material(log, value)
  const dimensions = vector(log, value.dimensions, 0.01, 1000, [1, 1, 1], 'Dimensões'), scale = vector(log, value.scale, 0.01, 100, [1, 1, 1], 'Escala')
  let shape = geometry(log, value.geometry)
  // Small curved objects do not need dense tessellation; this keeps large scenes inside the triangle budget and fast.
  if (['sphere', 'cylinder', 'cone', 'capsule', 'torus', 'torusKnot', 'lathe', 'tube'].includes(kind)) {
    const size = Math.max(...dimensions.map((value, index) => value * scale[index])), cap = size < 0.6 ? 12 : size < 2 ? 20 : size < 8 ? 32 : 64
    const segments = typeof shape?.segments === 'number' ? shape.segments : 48
    if (segments > cap) { shape = { ...shape, segments: cap }; log.adjust('Tesselação adaptada ao tamanho') }
  }
  return { ...value, kind, id: text(value.id, 100, `template-${index + 1}`), name: text(value.name, 110, nodeLabels[kind]),
    ...(value.role === undefined || value.role === null ? {} : { role: choice(log, value.role, ['structure', 'vegetation', 'prop', 'path'] as const, 'prop', 'Função do objeto') }),
    parentId: typeof value.parentId === 'string' ? value.parentId : null,
    position: vector(log, value.position, -10000, 10000, [0, kind === 'group' ? 0 : 0.5, 0], 'Posição'),
    rotation: Array.isArray(value.rotation) && value.rotation.length === 3 ? value.rotation.map((item) => angle(log, item, 'Rotação')) : [0, 0, 0],
    scale, dimensions,
    geometry: shape, color: surface.color, metalness: surface.metalness, roughness: surface.roughness, surface, animation: animation(log, value.animation), interaction: interaction(log, value.interaction),
    light, collidable: typeof value.collidable === 'boolean' ? value.collidable : true,
    behavior: behavior(log, value.behavior), sound: sound(log, value.sound),
    overlapWith: Array.isArray(value.overlapWith) ? value.overlapWith.filter((id): id is string => typeof id === 'string').slice(0, 32) : [],
    repeat: { mode: choice(log, repeat.mode, ['linear', 'radial', 'grid', 'scatter'] as const, 'linear', 'Padrão de repetição'),
      count: number(log, repeat.count, 1, 400, 1, 'Cópias', true), offset: vector(log, repeat.offset, -1000, 1000, [0, 0, 0], 'Offset de repetição'),
      radius: number(log, repeat.radius, 0, 1000, 0, 'Raio de repetição'), axis: choice(log, repeat.axis, ['x', 'y', 'z'] as const, 'y', 'Eixo de repetição'),
      columns: number(log, repeat.columns, 1, 100, 1, 'Colunas', true), jitter: number(log, repeat.jitter, 0, 1, 0, 'Variação'), seed: number(log, repeat.seed, 0, 9999, 1, 'Semente', true),
      onto: typeof repeat.onto === 'string' ? repeat.onto : null } }
}

export function sanitizeEnvironment(log: SanitizeLog, value: unknown): Json {
  if (!isRecord(value)) return {}
  const player = isRecord(value.player) ? value.player : {}
  return { ...(value.background !== undefined ? { background: color(log, value.background, '#dfe7ee', 'Fundo') } : {}),
    ...(value.exposure !== undefined ? { exposure: number(log, value.exposure, 0.1, 3, 1.1, 'Exposição') } : {}),
    ...(value.lightIntensity !== undefined ? { lightIntensity: number(log, value.lightIntensity, 0, 5, 1.5, 'Luz ambiente') } : {}),
    ...Object.fromEntries(['grid', 'wireframe', 'shadows', 'reflections'].filter((key) => typeof value[key] === 'boolean').map((key) => [key, value[key]])),
    sky: choice(log, value.sky, skyPresets, 'studio', 'Céu'), sunElevation: number(log, value.sunElevation, -10, 90, 38, 'Elevação do sol'),
    sunAzimuth: ((typeof value.sunAzimuth === 'number' && Number.isFinite(value.sunAzimuth) ? value.sunAzimuth : 35) % 360 + 360) % 360,
    fog: number(log, value.fog, 0, 0.2, 0, 'Neblina'), bloom: number(log, value.bloom, 0, 3, 0, 'Bloom'), ambientOcclusion: value.ambientOcclusion === true,
    toneMapping: choice(log, value.toneMapping, ['aces', 'agx', 'neutral'] as const, 'aces', 'Mapeamento tonal'),
    player: { spawn: Array.isArray(player.spawn) ? vector(log, player.spawn, -10000, 10000, [0, 0, 0], 'Início do jogador') : null, yaw: angle(log, player.yaw, 'Direção do jogador'),
      speed: number(log, player.speed, 1, 20, 4.5, 'Velocidade do jogador'), jumpHeight: number(log, player.jumpHeight, 0, 5, 1.1, 'Altura do pulo'),
      mode: choice(log, player.mode, ['walk', 'fly'] as const, 'walk', 'Modo do jogador'), allowFly: typeof player.allowFly === 'boolean' ? player.allowFly : true,
      health: number(log, player.health, 1, 1000, 100, 'Vida do jogador'), camera: choice(log, player.camera, ['first', 'third'] as const, 'first', 'Câmera do jogador'),
      weapon: choice(log, player.weapon, weaponKinds, 'none', 'Arma do jogador'), avatar: choice(log, player.avatar, avatarKinds, 'explorer', 'Avatar do jogador') },
    audio: isRecord(value.audio) ? { ambience: choice(log, value.audio.ambience, ambiencePresets, 'auto', 'Ambiência'), music: choice(log, value.audio.music, musicPresets, 'auto', 'Música'),
      volume: number(log, value.audio.volume, 0, 1, 0.7, 'Volume geral') } : { ambience: 'auto', music: 'auto', volume: 0.7 },
    weather: choice(log, value.weather, weatherKinds, 'none', 'Clima'), grade: choice(log, value.grade, gradePresets, 'none', 'Gradação de cor'),
    ...(isRecord(value.objective) ? { objective: { type: choice(log, value.objective.type, objectiveTypes, 'explore', 'Objetivo'), title: typeof value.objective.title === 'string' ? value.objective.title.slice(0, 160) : '',
      timeLimit: number(log, value.objective.timeLimit, 0, 3600, 0, 'Tempo limite') } } : {}) }
}

/** Repairs references and global budgets after expansion; existing scene nodes are never modified. */
export function repairReferences(log: SanitizeLog, existing: SceneNode[], added: SceneNode[]): SceneNode[] {
  const all = [...existing, ...added], byId = new Map(all.map((node) => [node.id, node])), fresh = new Set(added.map((node) => node.id))
  for (const node of added) {
    const parent = node.parentId === null ? null : byId.get(node.parentId)
    if (node.parentId !== null && (!parent || parent.kind !== 'group')) { log.note(`“${node.name}” referenciava um grupo inexistente e foi colocado na raiz.`); node.parentId = null }
  }
  for (const node of added) {
    const seen = new Set([node.id])
    for (let parent = node.parentId; parent !== null; parent = byId.get(parent)?.parentId ?? null) {
      if (seen.has(parent) || seen.size >= 12) { log.note(`A hierarquia de “${node.name}” foi simplificada (ciclo ou mais de 12 níveis).`); node.parentId = null; break }
      seen.add(parent)
    }
  }
  for (const node of added) {
    const before = node.overlapWith.length
    node.overlapWith = node.overlapWith.filter((id) => id !== node.id && byId.has(id))
    if (node.overlapWith.length !== before) log.adjust('Contatos com IDs inexistentes')
    const action = node.interaction
    if (!action) continue
    if (action.targetId !== null && !byId.has(action.targetId)) { log.adjust('Alvos de interação inexistentes'); action.targetId = null }
    if (['collect', 'heal', 'powerup'].includes(action.action)) action.targetId = null
    const target = action.targetId ?? node.id
    if (action.action === 'toggleAnimation' && ![...subtreeIds(all, target)].some((id) => byId.get(id)!.animation.kind !== 'none')) { action.action = 'message'; log.note(`A interação de “${node.name}” não tinha animação para alternar e virou mensagem.`) }
  }
  let result = all
  const lights = result.filter((node) => node.kind === 'light' && fresh.has(node.id))
  const allowed = MAX_SCENE_LIGHTS - result.filter((node) => node.kind === 'light' && !fresh.has(node.id)).length
  if (lights.length > allowed) {
    const removed = new Set(lights.slice(Math.max(0, allowed)).map((node) => node.id))
    result = result.filter((node) => !removed.has(node.id))
    log.note(`${removed.size} luzes além do limite de ${MAX_SCENE_LIGHTS} foram omitidas; emissivos continuam visíveis.`)
  }
  let triangles = result.reduce((sum, node) => sum + estimateTriangles(node.kind, node.geometry), 0)
  if (triangles > MAX_SCENE_TRIANGLES) {
    for (const node of [...result].filter((item) => fresh.has(item.id)).sort((a, b) => estimateTriangles(b.kind, b.geometry) - estimateTriangles(a.kind, a.geometry))) {
      if (triangles <= MAX_SCENE_TRIANGLES) break
      const before = estimateTriangles(node.kind, node.geometry)
      node.geometry = { ...node.geometry, segments: Math.max(8, Math.floor(node.geometry.segments / 2)), detail: Math.max(0, node.geometry.detail - 1) }
      triangles -= before - estimateTriangles(node.kind, node.geometry)
    }
    log.note('A tesselação dos objetos mais pesados foi reduzida para caber no orçamento de 2 milhões de triângulos.')
  }
  if (result.length > MAX_SCENE_NODES) { result = result.slice(0, MAX_SCENE_NODES); log.note(`A cena foi limitada a ${MAX_SCENE_NODES} objetos.`) }
  const kept = new Set(result.map((node) => node.id))
  for (const node of result) if (fresh.has(node.id)) {
    node.overlapWith = node.overlapWith.filter((id) => kept.has(id))
    if (node.interaction?.targetId && !kept.has(node.interaction.targetId)) node.interaction.targetId = null
    if (node.parentId && !kept.has(node.parentId)) node.parentId = null
  }
  return result
}
