import { insertionPosition } from './scenePlacement.ts'
import { prefabSpec, type PrefabSpec } from './scenePrefabs.ts'
import { migrateHouseFloorSurfaces, migrateTowerHeadroom } from './sceneAssetMigrations.ts'
import { expandSceneDraft } from './sceneDraft.ts'
import { defaultGeometry, estimateTriangles, MAX_SCENE_TRIANGLES, validateGeometry, type GeometrySpec } from './sceneGeometrySpec.ts'
export type Vector3Tuple = [number, number, number]
export type NodeKind = 'group' | 'box' | 'sphere' | 'cylinder' | 'torus' | 'roundedBox' | 'cone' | 'torusKnot' | 'extrude' | 'lathe' | 'tube' | 'mesh'
  | 'plane' | 'capsule' | 'polyhedron' | 'terrain' | 'text' | 'light'
export const textureKinds = ['none', 'metal', 'concrete', 'wood', 'solar', 'tiles', 'brick', 'marble', 'fabric', 'grass', 'rock', 'sand', 'asphalt', 'carbon', 'rust', 'plaster', 'water', 'leaves', 'foliage', 'needles'] as const
export type TextureKind = typeof textureKinds[number]
export const textureLabels: Record<TextureKind, string> = { none: 'Sem textura procedural', metal: 'Metal escovado', concrete: 'Concreto', wood: 'Madeira', solar: 'Células solares', tiles: 'Revestimento',
  brick: 'Tijolos', marble: 'Mármore', fabric: 'Tecido', grass: 'Grama', rock: 'Rocha', sand: 'Areia', asphalt: 'Asfalto', carbon: 'Fibra de carbono', rust: 'Ferrugem', plaster: 'Reboco', water: 'Água', leaves: 'Folhagem', foliage:'Folhas recortadas', needles:'Agulhas de conífera' }
export interface SceneMaterial {
  color: string; metalness: number; roughness: number; clearcoat?: number; transmission?: number; emissive?: string; emissiveIntensity?: number
  texture?: TextureKind; textureScale?: number; textureImage?: string; opacity?: number; transparent?: boolean; doubleSided?: boolean; alphaTest?: number
  normalStrength?: number; ior?: number; thickness?: number; sheen?: number; iridescence?: number; flatShading?: boolean
}
export const animationKinds = ['none', 'spin', 'float', 'orbit', 'pulse', 'swing', 'bounce', 'keyframes'] as const
export interface SceneKeyframe { at: number; move: Vector3Tuple; turn: Vector3Tuple; scale: Vector3Tuple }
export interface SceneAnimation {
  kind: typeof animationKinds[number]; axis: 'x' | 'y' | 'z'; duration: number; amplitude: number; phase: number
  start?: 'auto' | 'trigger'; easing?: 'linear' | 'smooth' | 'step'; keys?: SceneKeyframe[]
}
export const defaultAnimation = (): SceneAnimation => ({ kind: 'none', axis: 'y', duration: 6, amplitude: 0.5, phase: 0, start: 'auto', easing: 'smooth', keys: [] })
export interface SceneLight { type: 'point' | 'spot'; color: string; intensity: number; distance: number; angle: number; penumbra: number; castShadow: boolean }
export const defaultLight = (): SceneLight => ({ type: 'point', color: '#ffd9a8', intensity: 12, distance: 18, angle: 35, penumbra: 0.4, castShadow: false })
export const interactionTriggers = ['click', 'proximity', 'key'] as const
export const interactionActions = ['toggleAnimation', 'toggleVisibility', 'collect', 'message', 'heal', 'powerup', 'dialogue'] as const
export const powerKinds = ['speed', 'jump', 'shield', 'strength'] as const
export type PowerKind = typeof powerKinds[number]
/**
 * `item` names what a collect adds to the inventory (keys, relics); `requires` blocks the action until the inventory holds that item.
 * `amount` is the health restored by heal or the seconds of a powerup; dialogue messages separate lines with `|`.
 */
export interface SceneInteraction { trigger: typeof interactionTriggers[number]; key: string; radius: number; action: typeof interactionActions[number]; targetId: string | null; message: string
  item?: string; requires?: string; amount?: number; power?: PowerKind }
export const INTERACTION_KEYS = /^[0-9bgjklmnoprtuxyz]$/
export const MAX_MESSAGE = 600
export const behaviorTypes = ['enemy', 'hazard', 'checkpoint', 'goal', 'climbable', 'npc', 'launcher'] as const
export const attackStyles = ['touch', 'melee', 'ranged', 'charge'] as const
/**
 * Game behavior: enemies patrol/chase and hurt, hazards hurt, checkpoints set the respawn, goals finish the level, climbable surfaces work as ladders,
 * NPCs wander and talk, launchers throw the player `range` metres up. Enemies take `health` hits, may fly, attack in a style and appear after `delay` seconds.
 */
export const routineActivities = ['wander', 'work', 'sit', 'chat', 'patrol', 'guard', 'sleep', 'perform'] as const
export type RoutineActivity = typeof routineActivities[number]
/** One period of an NPC day: the activity happens at (or, for patrols, between the base and) `target`, from hour `from` to hour `to` (wrapping past midnight). */
export interface SceneRoutineStep { activity: RoutineActivity; target: string | null; from: number; to: number }
export const npcReactions = ['greet', 'ignore', 'flee', 'alert'] as const
export const MAX_ROUTINE_STEPS = 6
export interface SceneBehavior { type: typeof behaviorTypes[number]; speed: number; range: number; damage: number
  health?: number; attack?: typeof attackStyles[number]; flying?: boolean; delay?: number
  /** NPCs only: daily schedule and how they react to the player and to danger. */
  routine?: SceneRoutineStep[]; reaction?: typeof npcReactions[number] }
export const emitterPresets = ['fire', 'smoke', 'sparks', 'magic', 'steam', 'fountain', 'leaves', 'dust', 'embers'] as const
/** GPU particle source anchored to a node; `rate` scales the preset's emission and `spread` its radius in metres. */
export interface SceneEmitter { preset: typeof emitterPresets[number]; rate: number; spread: number }
export const objectiveTypes = ['explore', 'collectAll', 'reachGoal', 'defeatEnemies', 'survive'] as const
export interface SceneObjective { type: typeof objectiveTypes[number]; title: string; timeLimit: number }
export const soundPresets = ['fire', 'water', 'waves', 'wind', 'machine', 'magic', 'birds', 'insects', 'drip', 'engine', 'chimes', 'alarm', 'portal', 'crowd'] as const
export type SoundPreset = typeof soundPresets[number]
/** Positional loop synthesized locally around a node; no audio files or URLs. */
export interface SceneSound { preset: SoundPreset; volume: number; radius: number }
export const ambiencePresets = ['auto', 'none', 'forest', 'meadow', 'beach', 'desert', 'snow', 'swamp', 'cave', 'city', 'night', 'space', 'underwater', 'volcanic', 'scifi', 'dungeon', 'rain', 'wind'] as const
export const musicPresets = ['auto', 'none', 'calm', 'adventure', 'mystery', 'tension', 'combat', 'space', 'festive', 'spooky', 'heroic'] as const
export interface SceneAudio { ambience: typeof ambiencePresets[number]; music: typeof musicPresets[number]; volume: number }
export const weatherKinds = ['none', 'rain', 'snow', 'embers', 'fireflies', 'dust', 'bubbles', 'leaves', 'ash'] as const
export const gradePresets = ['none', 'warm', 'cool', 'cinematic', 'vivid', 'noir', 'dreamy', 'retro'] as const
export const weaponKinds = ['none', 'sword', 'blaster', 'bow', 'staff'] as const
export const avatarKinds = ['explorer', 'knight', 'wizard', 'astronaut', 'robot'] as const
export const grassDensities = ['auto', 'none', 'dense'] as const
export const faunaDensities = ['auto', 'none', 'rich'] as const
/** World motion: global wind strength (0 = still, 1 = breezy, 2 = storm), instanced grass and ambient wildlife. */
export interface SceneMotion { wind: number; grass: typeof grassDensities[number]; fauna: typeof faunaDensities[number] }
/** Optional day/night cycle: one full day lasts `duration` seconds of play, starting at hour `start` (0–24). */
export interface SceneDayCycle { enabled: boolean; duration: number; start: number }
export const MAX_PREMISE = 240
export interface SceneNode {
  /** Compiler source for a terrain-conforming route, retained across terrain edits and JSON exports. */
  path?: {supportId:string;points:[number,number][];width:number}
  /** Validated source parameters allow semantic edits and deterministic rebuilding. */
  asset?: PrefabSpec
  /** Compiler-local part name; distinguishes generated structure from user content. */
  assetPart?: string
  id: string
  parentId: string | null
  name: string
  kind: NodeKind
  visible: boolean
  position: Vector3Tuple
  rotation: Vector3Tuple
  scale: Vector3Tuple
  dimensions: Vector3Tuple
  material: SceneMaterial
  animation: SceneAnimation
  geometry: GeometrySpec
  overlapWith: string[]
  collidable?: boolean
  light?: SceneLight
  interaction?: SceneInteraction
  behavior?: SceneBehavior
  sound?: SceneSound
  emitter?: SceneEmitter
  /** Authored purpose, used by terrain preparation and presentation without guessing from localized names. */
  role?: 'structure' | 'vegetation' | 'prop' | 'path'
}
export const skyPresets = ['studio', 'day', 'sunset', 'night', 'overcast', 'space'] as const
export type SkyPreset = typeof skyPresets[number]
export const skyLabels: Record<SkyPreset, string> = { studio: 'Estúdio', day: 'Dia claro', sunset: 'Pôr do sol', night: 'Noite', overcast: 'Nublado', space: 'Espaço' }
export interface ScenePlayer { spawn: Vector3Tuple | null; yaw: number; speed: number; jumpHeight: number; mode: 'walk' | 'fly'; allowFly?: boolean; health?: number; camera?: 'first' | 'third'
  weapon?: typeof weaponKinds[number]; avatar?: typeof avatarKinds[number] }
export interface SceneEnvironment {
  background: string; exposure: number; lightIntensity: number; grid: boolean; wireframe: boolean; shadows?: boolean; reflections?: boolean
  sky?: SkyPreset; sunElevation?: number; sunAzimuth?: number; fog?: number; bloom?: number; ambientOcclusion?: boolean; toneMapping?: 'aces' | 'agx' | 'neutral'
  player?: ScenePlayer
  objective?: SceneObjective
  audio?: SceneAudio
  weather?: typeof weatherKinds[number]
  grade?: typeof gradePresets[number]
  motion?: SceneMotion
  dayCycle?: SceneDayCycle
  /** One-sentence story shown on the level title card. */
  premise?: string
}
export interface ThreeSceneDocument {
  version: '1.4'
  name: string
  timeline: { duration: number }
  nodes: SceneNode[]
  environment: SceneEnvironment
}
export const MAX_SCENE_NODES = 2000
export const MAX_SCENE_LIGHTS = 32
export const MAX_SCENE_BYTES = 32 * 1024 * 1024
export const SCENE_STORAGE_KEY = 'modeler:three-scene:v1'
export const nodeLabels: Record<NodeKind, string> = { group: 'Grupo', box: 'Caixa', sphere: 'Esfera', cylinder: 'Cilindro', torus: 'Toro', roundedBox: 'Caixa arredondada', cone: 'Cone', torusKnot: 'Nó toroidal', extrude: 'Perfil extrudado', lathe: 'Perfil de revolução', tube: 'Tubo por curva', mesh: 'Malha triangular',
  plane: 'Plano', capsule: 'Cápsula', polyhedron: 'Poliedro', terrain: 'Terreno procedural', text: 'Texto', light: 'Luz' }
export const hasSurface = (kind: NodeKind) => kind !== 'group' && kind !== 'light'

export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Esperado um objeto JSON.')
  return value as Record<string, unknown>
}
export function text(value: unknown, field: string, max = 120): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${field}: texto obrigatório de até ${max} caracteres.`)
  return value
}
export function number(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`${field}: use um número entre ${min} e ${max}.`)
  return value
}
export function boolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${field}: esperado verdadeiro ou falso.`)
  return value
}
function color(value: unknown): string {
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) throw new Error('Cor inválida. Use #RRGGBB.')
  return value
}
function vector(value: unknown, field: string, min: number, max: number): Vector3Tuple {
  if (!Array.isArray(value) || value.length !== 3) throw new Error(`${field}: esperado vetor XYZ.`)
  return Array.from(value, (v) => number(v, field, min, max)) as Vector3Tuple
}
export function choice<T extends string>(value: unknown, options: readonly T[], fallback: T, message: string): T {
  if (value === undefined) return fallback
  if (!options.includes(value as T)) throw new Error(message)
  return value as T
}

export function validateAnimation(value: unknown): SceneAnimation {
  if (value === undefined) return defaultAnimation()
  const animation = record(value)
  const kind = choice(animation.kind, animationKinds, 'none', 'Tipo de animação desconhecido.')
  if (!['x', 'y', 'z'].includes(animation.axis as string)) throw new Error('Eixo de animação inválido.')
  const keys = animation.keys === undefined ? [] : (() => {
    if (!Array.isArray(animation.keys) || animation.keys.length > 16) throw new Error('Keyframes: até 16 chaves.')
    return animation.keys.map((entry): SceneKeyframe => {
      const key = record(entry)
      return { at: number(key.at, 'Instante do keyframe', 0, 1), move: vector(key.move ?? [0, 0, 0], 'Deslocamento do keyframe', -1000, 1000),
        turn: vector(key.turn ?? [0, 0, 0], 'Giro do keyframe', -720, 720), scale: vector(key.scale ?? [1, 1, 1], 'Escala do keyframe', 0.01, 100) }
    }).sort((a, b) => a.at - b.at)
  })()
  if (kind === 'keyframes' && keys.length < 2) throw new Error('Animação por keyframes requer pelo menos duas chaves.')
  if (keys.some((key, index) => index && Math.abs(key.at - keys[index - 1].at) < 1e-6)) throw new Error('Keyframes não podem repetir o mesmo instante.')
  return { kind, axis: animation.axis as SceneAnimation['axis'],
    duration: number(animation.duration, 'Período', 0.2, 120), amplitude: number(animation.amplitude, 'Amplitude', 0, 100), phase: number(animation.phase, 'Fase', 0, 360),
    start: choice(animation.start, ['auto', 'trigger'] as const, 'auto', 'Início de animação inválido.'),
    easing: choice(animation.easing, ['linear', 'smooth', 'step'] as const, 'smooth', 'Suavização inválida.'), keys }
}

export function validateMaterial(value: unknown): SceneMaterial {
  const material = record(value)
  const texture = choice(material.texture, textureKinds, 'none', 'Textura procedural desconhecida.')
  const image = material.textureImage ?? ''
  if (typeof image !== 'string' || image.length > 3_000_000 || (image && !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(image))) throw new Error('Imagem de material inválida ou maior que 2 MB.')
  return { color: color(material.color), metalness: number(material.metalness, 'Metalicidade', 0, 1), roughness: number(material.roughness, 'Rugosidade', 0, 1),
    clearcoat: number(material.clearcoat ?? 0, 'Verniz', 0, 1), transmission: number(material.transmission ?? 0, 'Transmissão', 0, 1),
    emissive: color(material.emissive ?? '#000000'), emissiveIntensity: number(material.emissiveIntensity ?? 0, 'Emissão', 0, 20),
    opacity: number(material.opacity ?? 1, 'Opacidade', 0, 1), transparent: boolean(material.transparent ?? false, 'Transparência'), doubleSided: boolean(material.doubleSided ?? false, 'Dupla face'), alphaTest: number(material.alphaTest ?? 0, 'Recorte alpha', 0, 1),
    texture, textureScale: number(material.textureScale ?? 1, 'Repetição de textura', 0.1, 64), textureImage: image,
    normalStrength: number(material.normalStrength ?? 1, 'Relevo', 0, 3), ior: number(material.ior ?? 1.5, 'Índice de refração', 1, 2.333),
    thickness: number(material.thickness ?? 0, 'Espessura', 0, 10), sheen: number(material.sheen ?? 0, 'Brilho têxtil', 0, 1),
    iridescence: number(material.iridescence ?? 0, 'Iridescência', 0, 1), flatShading: boolean(material.flatShading ?? false, 'Sombreamento facetado') }
}

export function validateLight(value: unknown): SceneLight {
  const light = record(value ?? defaultLight())
  return { type: choice(light.type, ['point', 'spot'] as const, 'point', 'Tipo de luz inválido.'), color: color(light.color ?? '#ffffff'),
    intensity: number(light.intensity, 'Intensidade da luz', 0, 2000), distance: number(light.distance ?? 0, 'Alcance da luz', 0, 1000),
    angle: number(light.angle ?? 35, 'Abertura do spot', 1, 89), penumbra: number(light.penumbra ?? 0.4, 'Penumbra', 0, 1), castShadow: boolean(light.castShadow ?? false, 'Sombra da luz') }
}

export function validateInteraction(value: unknown): SceneInteraction | undefined {
  if (value === undefined || value === null) return undefined
  const interaction = record(value)
  if ((interaction.trigger as string) === 'none') return undefined
  const trigger = choice(interaction.trigger, interactionTriggers, 'click', 'Gatilho de interação desconhecido.')
  const key = trigger === 'key' ? String(interaction.key ?? '').toLowerCase() : ''
  if (trigger === 'key' && !INTERACTION_KEYS.test(key)) throw new Error('Tecla de interação: use 0–9 ou B, G, J–P, R, T, U, X, Y, Z (WASD, E, F, C, Q, H, V e espaço controlam o jogador).')
  const message = interaction.message ?? ''
  if (typeof message !== 'string' || message.length > MAX_MESSAGE) throw new Error(`Mensagem de interação: até ${MAX_MESSAGE} caracteres.`)
  const targetId = interaction.targetId ?? null
  if (targetId !== null && typeof targetId !== 'string') throw new Error('Alvo de interação inválido.')
  const label = (value: unknown, field: string) => { if (typeof value !== 'string' || value.length > 40) throw new Error(`${field}: texto de até 40 caracteres.`); return value.trim() }
  const item = interaction.item == null ? '' : label(interaction.item, 'Item'), requires = interaction.requires == null ? '' : label(interaction.requires, 'Item necessário')
  const action = choice(interaction.action, interactionActions, 'message', 'Ação de interação desconhecida.')
  return { trigger, key, radius: number(interaction.radius ?? 3, 'Alcance da interação', 0.5, 50), action, targetId, message,
    ...(item ? { item } : {}), ...(requires ? { requires } : {}),
    ...(interaction.amount == null ? {} : { amount: number(interaction.amount, 'Quantidade da interação', 0, 1000) }),
    ...(interaction.power == null ? {} : { power: choice(interaction.power, powerKinds, 'speed', 'Poder desconhecido.') }) }
}

export function validateSound(value: unknown): SceneSound | undefined {
  if (value === undefined || value === null) return undefined
  const sound = record(value)
  return { preset: choice(sound.preset, soundPresets, 'wind', 'Som desconhecido.'), volume: number(sound.volume ?? 0.6, 'Volume do som', 0, 1), radius: number(sound.radius ?? 12, 'Alcance do som', 1, 200) }
}
export function validateAudio(value: unknown): SceneAudio {
  const audio = record(value)
  return { ambience: choice(audio.ambience, ambiencePresets, 'auto', 'Ambiência desconhecida.'), music: choice(audio.music, musicPresets, 'auto', 'Música desconhecida.'), volume: number(audio.volume ?? 0.7, 'Volume geral', 0, 1) }
}

export function validatePlayer(value: unknown): ScenePlayer {
  const player = value === undefined ? {} : record(value)
  return { spawn: player.spawn === undefined || player.spawn === null ? null : vector(player.spawn, 'Início do jogador', -10000, 10000),
    yaw: number(player.yaw ?? 0, 'Direção inicial', -360, 360), speed: number(player.speed ?? 4.5, 'Velocidade do jogador', 1, 20),
    jumpHeight: number(player.jumpHeight ?? 1.1, 'Altura do pulo', 0, 5), mode: choice(player.mode, ['walk', 'fly'] as const, 'walk', 'Modo do jogador inválido.'),
    allowFly: player.allowFly === undefined ? true : boolean(player.allowFly, 'Voo permitido'), health: number(player.health ?? 100, 'Vida do jogador', 1, 1000),
    camera: choice(player.camera, ['first', 'third'] as const, 'first', 'Câmera do jogador inválida.'),
    weapon: choice(player.weapon, weaponKinds, 'none', 'Arma do jogador desconhecida.'), avatar: choice(player.avatar, avatarKinds, 'explorer', 'Avatar do jogador desconhecido.') }
}

export function validateObjective(value: unknown): SceneObjective {
  const objective = record(value)
  const title = objective.title ?? ''
  if (typeof title !== 'string' || title.length > 160) throw new Error('Objetivo: título de até 160 caracteres.')
  return { type: choice(objective.type, objectiveTypes, 'explore', 'Objetivo desconhecido.'), title, timeLimit: number(objective.timeLimit ?? 0, 'Tempo limite', 0, 3600) }
}
export function validateBehavior(value: unknown): SceneBehavior | undefined {
  if (value === undefined || value === null) return undefined
  const behavior = record(value)
  return { type: choice(behavior.type, behaviorTypes, 'hazard', 'Comportamento desconhecido.'), speed: number(behavior.speed ?? 2.5, 'Velocidade do inimigo', 0, 12),
    range: number(behavior.range ?? 10, 'Alcance do comportamento', 0.5, 80), damage: number(behavior.damage ?? 20, 'Dano', 0, 1000),
    ...(behavior.health == null ? {} : { health: Math.round(number(behavior.health, 'Resistência', 1, 100)) }),
    ...(behavior.attack == null ? {} : { attack: choice(behavior.attack, attackStyles, 'touch', 'Estilo de ataque desconhecido.') }),
    ...(behavior.flying == null ? {} : { flying: boolean(behavior.flying, 'Voo do inimigo') }),
    ...(behavior.delay == null ? {} : { delay: number(behavior.delay, 'Atraso de aparição', 0, 3600) }),
    ...(behavior.routine == null ? {} : { routine: validateRoutine(behavior.routine) }),
    ...(behavior.reaction == null ? {} : { reaction: choice(behavior.reaction, npcReactions, 'greet', 'Reação de NPC desconhecida.') }) }
}
export function validateRoutine(value: unknown): SceneRoutineStep[] {
  if (!Array.isArray(value) || value.length > MAX_ROUTINE_STEPS) throw new Error(`Rotina: até ${MAX_ROUTINE_STEPS} períodos.`)
  return value.map((entry) => {
    const step = record(entry), target = step.target ?? null
    if (target !== null && (typeof target !== 'string' || !target.trim() || target.length > 120)) throw new Error('Rotina: alvo inválido.')
    return { activity: choice(step.activity, routineActivities, 'wander', 'Atividade de rotina desconhecida.'), target, from: number(step.from ?? 0, 'Início do período', 0, 24), to: number(step.to ?? 24, 'Fim do período', 0, 24) }
  })
}
export function validateEmitter(value: unknown): SceneEmitter | undefined {
  if (value === undefined || value === null) return undefined
  const emitter = record(value)
  return { preset: choice(emitter.preset, emitterPresets, 'smoke', 'Partícula desconhecida.'), rate: number(emitter.rate ?? 1, 'Taxa de partículas', 0.1, 4), spread: number(emitter.spread ?? 0.3, 'Raio das partículas', 0, 20) }
}
export function validateMotion(value: unknown): SceneMotion {
  const motion = record(value)
  return { wind: number(motion.wind ?? 0.6, 'Vento', 0, 2), grass: choice(motion.grass, grassDensities, 'auto', 'Densidade de grama desconhecida.'), fauna: choice(motion.fauna, faunaDensities, 'auto', 'Fauna desconhecida.') }
}
export function validateDayCycle(value: unknown): SceneDayCycle {
  const cycle = record(value)
  return { enabled: boolean(cycle.enabled ?? true, 'Ciclo dia/noite'), duration: number(cycle.duration ?? 600, 'Duração do dia', 60, 7200), start: number(cycle.start ?? 9, 'Hora inicial', 0, 24) }
}
export const DEFAULT_MOTION: SceneMotion = { wind: 0.6, grass: 'auto', fauna: 'auto' }

export function validateEnvironment(value: unknown): SceneEnvironment {
  const env = record(value)
  return { background: color(env.background), exposure: number(env.exposure, 'Exposição', 0.1, 3),
    lightIntensity: number(env.lightIntensity, 'Luz', 0, 5), grid: boolean(env.grid, 'Grade'), wireframe: boolean(env.wireframe, 'Wireframe'),
    shadows: env.shadows === undefined ? true : boolean(env.shadows, 'Sombras'), reflections: env.reflections === undefined ? true : boolean(env.reflections, 'Reflexões'),
    sky: choice(env.sky, skyPresets, 'studio', 'Céu desconhecido.'), sunElevation: number(env.sunElevation ?? 38, 'Elevação do sol', -10, 90),
    sunAzimuth: number(env.sunAzimuth ?? 35, 'Azimute do sol', 0, 360), fog: number(env.fog ?? 0, 'Neblina', 0, 0.2), bloom: number(env.bloom ?? 0, 'Brilho (bloom)', 0, 3),
    ambientOcclusion: env.ambientOcclusion === undefined ? false : boolean(env.ambientOcclusion, 'Oclusão ambiente'),
    toneMapping: choice(env.toneMapping, ['aces', 'agx', 'neutral'] as const, 'aces', 'Mapeamento tonal desconhecido.'), player: validatePlayer(env.player),
    ...(env.objective === undefined || env.objective === null ? {} : { objective: validateObjective(env.objective) }),
    audio: env.audio === undefined || env.audio === null ? { ambience: 'auto', music: 'auto', volume: 0.7 } : validateAudio(env.audio),
    weather: choice(env.weather ?? undefined, weatherKinds, 'none', 'Clima desconhecido.'), grade: choice(env.grade ?? undefined, gradePresets, 'none', 'Gradação de cor desconhecida.'),
    ...(env.motion == null ? {} : { motion: validateMotion(env.motion) }),
    ...(env.dayCycle == null ? {} : { dayCycle: validateDayCycle(env.dayCycle) }),
    ...(env.premise == null || env.premise === '' ? {} : { premise: text(env.premise, 'Premissa', MAX_PREMISE).trim() }) }
}

/** Returns only declared data; never deserializes Three.js objects or executable code. */
function validatePath(value:unknown):NonNullable<SceneNode['path']> {
  const path=record(value)
  if(!Array.isArray(path.points)||path.points.length<2||path.points.length>64) throw new Error('Caminho: use de 2 a 64 pontos XZ.')
  return {supportId:text(path.supportId,'Suporte do caminho',100),width:number(path.width,'Largura do caminho',1,16),points:path.points.map(point=>{
    if(!Array.isArray(point)||point.length!==2) throw new Error('Caminho: ponto XZ inválido.')
    return [number(point[0],'X do caminho',-10000,10000),number(point[1],'Z do caminho',-10000,10000)]
  })}
}
export function validateScene(value: unknown): ThreeSceneDocument {
  const doc = record(value)
  if (!['1.0', '1.1', '1.2', '1.3', '1.4'].includes(doc.version as string)) throw new Error('Versão de projeto incompatível. Esperado ThreeSceneDocument 1.0–1.4.')
  if (!Array.isArray(doc.nodes) || doc.nodes.length > MAX_SCENE_NODES) throw new Error(`A cena aceita até ${MAX_SCENE_NODES} nós.`)
  const nodes: SceneNode[] = doc.nodes.map((value) => {
    const node = record(value), material = record(node.material)
    if (typeof node.kind !== 'string' || !Object.hasOwn(nodeLabels, node.kind)) throw new Error('Tipo de objeto desconhecido.')
    if (node.parentId !== null && typeof node.parentId !== 'string') throw new Error('Referência de grupo inválida.')
    const interaction = validateInteraction(node.interaction), behavior = validateBehavior(node.behavior), sound = validateSound(node.sound), emitter = validateEmitter(node.emitter)
    if ((behavior?.routine || behavior?.reaction) && behavior.type !== 'npc') throw new Error('Rotinas e reações pertencem a NPCs.')
    return {
      id: text(node.id, 'ID'), parentId: node.parentId as string | null, name: text(node.name, 'Nome'), kind: node.kind as NodeKind,
      visible: boolean(node.visible, 'Visibilidade'), position: vector(node.position, 'Posição', -10000, 10000),
      rotation: vector(node.rotation, 'Rotação', -360, 360), scale: vector(node.scale, 'Escala', 0.01, 100),
      dimensions: vector(node.dimensions, 'Dimensões', 0.01, 1000),
      animation: validateAnimation(node.animation),
      geometry: validateGeometry(node.geometry, node.kind),
      overlapWith: node.overlapWith === undefined ? [] : (() => { if (!Array.isArray(node.overlapWith) || node.overlapWith.length > 32) throw new Error('Até 32 contatos intencionais por objeto.'); return Array.from(new Set(node.overlapWith.map((v) => text(v, 'Contato')))) })(),
      material: validateMaterial(material),
      collidable: node.collidable === undefined ? true : boolean(node.collidable, 'Colisão'),
      ...(node.kind === 'light' ? { light: validateLight(node.light) } : {}),
      ...(interaction ? { interaction } : {}),
      ...(behavior ? { behavior } : {}),
      ...(sound ? { sound } : {}),
      ...(emitter ? { emitter } : {}),
      ...(node.asset == null ? {} : { asset: (() => { if (node.kind !== 'group') throw new Error('Asset deve pertencer a um grupo.'); const spec = prefabSpec(node.asset); if (!spec) throw new Error('Asset desconhecido.'); return spec })() }),
      ...(node.assetPart == null ? {} : {assetPart:text(node.assetPart,'Peça gerada')}),
      ...(node.path == null ? {} : {path:validatePath(node.path)}),
      ...(node.role === undefined || node.role === null ? {} : { role: choice(node.role, ['structure', 'vegetation', 'prop', 'path'] as const, 'prop', 'Função de objeto desconhecida.') }),
    }
  })
  const byId = new Map(nodes.map((node) => [node.id, node]))
  if (byId.size !== nodes.length) throw new Error('IDs duplicados na cena.')
  if (nodes.reduce((sum, node) => sum + estimateTriangles(node.kind, node.geometry), 0) > MAX_SCENE_TRIANGLES) throw new Error('A cena excede o orçamento de 2 milhões de triângulos. Reduza a tesselação ou a quantidade de objetos.')
  if (nodes.filter((node) => node.kind === 'light').length > MAX_SCENE_LIGHTS) throw new Error(`A cena aceita até ${MAX_SCENE_LIGHTS} luzes pontuais/spot.`)
  for (const node of nodes) {
    if (node.overlapWith.some((id) => id === node.id || !byId.has(id))) throw new Error('Contato intencional referencia ID inválido.')
    if (node.interaction) {
      const target = node.interaction.targetId === null ? node : byId.get(node.interaction.targetId)
      if (!target) throw new Error('Interação referencia um alvo inexistente.')
      if (node.interaction.action === 'toggleAnimation' && ![...subtreeIds(nodes, target.id)].some((key) => byId.get(key)!.animation.kind !== 'none')) throw new Error(`Interação de “${node.name}” alterna uma animação inexistente.`)
      if (['collect', 'heal', 'powerup'].includes(node.interaction.action) && node.interaction.targetId !== null) throw new Error('Coletáveis, curas e poderes consomem o próprio objeto.')
    }
    for (const step of node.behavior?.routine ?? []) if (step.target !== null && (step.target === node.id || !byId.has(step.target))) throw new Error(`Rotina de “${node.name}” referencia um local inexistente.`)
    const seen = new Set([node.id])
    let parentId = node.parentId
    while (parentId !== null) {
      if (seen.has(parentId)) throw new Error('A hierarquia não pode conter ciclos.')
      seen.add(parentId)
      if (seen.size > 12) throw new Error('A hierarquia aceita até 12 níveis.')
      const parent = byId.get(parentId)
      if (!parent || parent.kind !== 'group') throw new Error('O pai precisa ser um grupo existente.')
      parentId = parent.parentId
    }
  }
  return migrateTowerHeadroom(migrateHouseFloorSurfaces({ version: '1.4', name: text(doc.name, 'Nome do projeto'), nodes,
    timeline: { duration: doc.timeline === undefined ? 20 : number(record(doc.timeline).duration, 'Duração da timeline', 1, 120) },
    environment: validateEnvironment(doc.environment) }))
}
export function parseScene(source: string): ThreeSceneDocument {
  if (new TextEncoder().encode(source).byteLength > MAX_SCENE_BYTES) throw new Error('O projeto excede o limite de 32 MB.')
  return validateScene(expandSceneDraft(JSON.parse(source), MAX_SCENE_NODES, MAX_SCENE_BYTES))
}
export function createNode(kind: NodeKind, parentId: string | null = null): SceneNode {
  const dimensions: Vector3Tuple = kind === 'plane' ? [4, 0.01, 4] : kind === 'terrain' ? [24, 3, 24] : kind === 'text' ? [2, 0.5, 0.01] : kind === 'capsule' ? [0.5, 1.6, 0.5] : kind === 'light' ? [0.3, 0.3, 0.3] : [1, 1, 1]
  return { id: crypto.randomUUID(), parentId, name: nodeLabels[kind], kind, visible: true,
    position: [0, kind === 'group' || kind === 'plane' ? 0 : kind === 'light' ? 3 : kind === 'terrain' ? 1.5 : kind === 'capsule' ? 0.8 : 0.5, 0], rotation: [0, 0, 0], scale: [1, 1, 1], dimensions,
    animation: defaultAnimation(), geometry: defaultGeometry(kind), overlapWith: [], collidable: kind !== 'light',
    material: validateMaterial({ color: kind === 'terrain' ? '#7d9a5a' : kind === 'text' ? '#ffffff' : '#348c96', metalness: kind === 'terrain' ? 0 : 0.2, roughness: kind === 'terrain' ? 0.9 : 0.45, texture: kind === 'terrain' ? 'grass' : 'none', textureScale: kind === 'terrain' ? 8 : 1 }),
    ...(kind === 'light' ? { light: defaultLight() } : {}) }
}
export function createEmptyScene(): ThreeSceneDocument {
  return { version: '1.4', name: 'Nova cena', nodes: [], timeline: { duration: 20 },
    environment: validateEnvironment({ background: '#e8eef3', exposure: 1.2, lightIntensity: 1.5, grid: true, wireframe: false, shadows: true, reflections: true }) }
}
export function subtreeIds(nodes: SceneNode[], id: string): Set<string> {
  const ids = new Set([id])
  let changed = true
  while (changed) {
    changed = false
    for (const node of nodes) if (node.parentId && ids.has(node.parentId) && !ids.has(node.id)) { ids.add(node.id); changed = true }
  }
  return ids
}
export function removeSubtree(doc: ThreeSceneDocument, id: string): ThreeSceneDocument {
  const ids = subtreeIds(doc.nodes, id)
  const remaining = doc.nodes.filter((node) => !ids.has(node.id)), byId = new Map(remaining.map((node) => [node.id, node]))
  const animatedTargets = new Set<string>()
  for (const node of remaining) if (node.animation.kind !== 'none') {
    for (let current: SceneNode | undefined = node; current && !animatedTargets.has(current.id); current = current.parentId ? byId.get(current.parentId) : undefined) animatedTargets.add(current.id)
  }
  return { ...doc, nodes: remaining.map((node) => {
    const next = { ...node, overlapWith: node.overlapWith.filter((key) => !ids.has(key)) }
    if (next.behavior?.routine?.some((step) => step.target && ids.has(step.target))) next.behavior = { ...next.behavior, routine: next.behavior.routine.map((step) => step.target && ids.has(step.target) ? { ...step, target: null } : step) }
    if (next.interaction && ((next.interaction.targetId && ids.has(next.interaction.targetId)) ||
      (next.interaction.action === 'toggleAnimation' && !animatedTargets.has(next.interaction.targetId ?? next.id)))) delete next.interaction
    return next
  }) }
}
export function duplicateSubtree(doc: ThreeSceneDocument, id: string): { document: ThreeSceneDocument; selectedId: string } {
  const root = doc.nodes.find((node) => node.id === id)
  if (!root) throw new Error('Objeto não encontrado.')
  const ids = subtreeIds(doc.nodes, id)
  const replacements = new Map([...ids].map((key) => [key, crypto.randomUUID()]))
  const copies = doc.nodes.filter((node) => ids.has(node.id)).map((node): SceneNode => ({ ...structuredClone(node),
    id: replacements.get(node.id)!, overlapWith: node.overlapWith.map((key) => replacements.get(key) ?? key), parentId: replacements.get(node.parentId ?? '') ?? node.parentId,
    name: node.id === id ? `${node.name.slice(0, 110)} (cópia)` : node.name,
    ...(node.interaction ? { interaction: { ...node.interaction, targetId: node.interaction.targetId === null ? null : replacements.get(node.interaction.targetId) ?? node.interaction.targetId } } : {}),
    ...(node.behavior?.routine ? { behavior: { ...node.behavior, routine: node.behavior.routine.map((step) => ({ ...step, target: step.target === null ? null : replacements.get(step.target) ?? step.target })) } } : {}),
    position: node.id === id ? insertionPosition(doc, root, doc.nodes.filter((item) => ids.has(item.id))) : [...node.position] }))
  return { document: validateScene({ ...doc, nodes: [...doc.nodes, ...copies] }), selectedId: replacements.get(id)! }
}
export interface SceneHistory { past: ThreeSceneDocument[]; present: ThreeSceneDocument; future: ThreeSceneDocument[] }
export function commitScene(history: SceneHistory, document: ThreeSceneDocument): SceneHistory {
  const validated = validateScene(document)
  if (JSON.stringify(validated) === JSON.stringify(history.present)) return history
  return { past: [...history.past.slice(-49), history.present], present: validated, future: [] }
}
export function undoScene(history: SceneHistory): SceneHistory {
  if (!history.past.length) return history
  return { past: history.past.slice(0, -1), present: history.past.at(-1)!, future: [history.present, ...history.future] }
}
export function redoScene(history: SceneHistory): SceneHistory {
  if (!history.future.length) return history
  return { past: [...history.past, history.present], present: history.future[0], future: history.future.slice(1) }
}
