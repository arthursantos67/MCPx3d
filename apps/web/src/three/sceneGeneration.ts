import type { AgentMessage, JsonSchema, LLMProvider } from '../../../../packages/agent/src/provider.ts'
import { inspectSceneAsync } from './inspectSceneAsync.ts'
import { repairImproved, type SceneInspection } from './sceneInspection.ts'
import { clearRoutineTargets, repairReferences, sanitizeBehavior, sanitizeEmitter, sanitizeEnvironment, sanitizeTemplate, SanitizeLog } from './sceneRecipeSanitize.ts'
import { beardStyles, characterAges, characterBuilds, characterStyles, hairStyles } from './sceneCharacterArchetype.ts'
import { naturalPrefabs, prefabLabels, prefabParts, prefabRootBehavior, prefabSpec, prefabTypes, structurePrefabs, vegetationPrefabs, type PrefabType } from './scenePrefabs.ts'
import { auditScene, describeAudit, prepareScene, settleLayout, type SceneAudit } from './sceneLayout.ts'
import { sceneMatrices } from './scenePlacement.ts'
import { applyThemeDefaults, directionBrief, reviewSceneDirection } from './sceneDirection.ts'
import { buildingPlan } from './sceneArchitecture.ts'
import { planScene, planningBrief, reviewScenePlan, shouldPlanScene, type ScenePlan } from './scenePlanning.ts'
import { replaceAssetNodes } from './sceneAssets.ts'
import { conformTerrainPaths } from './sceneGrounding.ts'
import { applyScenePlanIntent } from './scenePlanRealization.ts'
import * as THREE from 'three'
import { defaultGeometry, hashNoise, polyhedronVariants, terrainHeightAt, terrainStyles, terrainBiomes } from './sceneGeometrySpec.ts'
import { ambiencePresets, animationKinds, attackStyles, avatarKinds, behaviorTypes, createEmptyScene, createNode, emitterPresets, faunaDensities, gradePresets, grassDensities, objectiveTypes, hasSurface, interactionActions, interactionTriggers, MAX_MESSAGE, MAX_PREMISE,
  MAX_ROUTINE_STEPS, MAX_SCENE_NODES, musicPresets, nodeLabels, npcReactions, powerKinds, removeSubtree, routineActivities, skyPresets, soundPresets, textureKinds, validateAnimation, validateInteraction, validateRoutine, validateScene, weaponKinds, weatherKinds,
  type SceneBehavior, type SceneNode, type ThreeSceneDocument, type Vector3Tuple } from './sceneDocument.ts'

const MAX_TEMPLATES = 120, MAX_COPIES = 400
const numeric = (minimum: number, maximum: number) => ({ type: 'number', minimum, maximum })
const integer = (minimum: number, maximum: number) => ({ type: 'integer', minimum, maximum })
const tuple = (minimum: number, maximum: number) => ({ type: 'array', items: numeric(minimum, maximum), minItems: 3, maxItems: 3 })
const object = (properties: Record<string, unknown>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false })
const nullable = (schema: unknown) => ({ anyOf: [{ type: 'null' }, schema] })
const choices = (values: readonly string[]) => ({ type: 'string', enum: values })
const axis = choices(['x', 'y', 'z'])
const hex = { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' }
const kinds = { type: 'string', enum: Object.keys(nodeLabels) }
const partial = (properties: Record<string, unknown>) => ({ type: 'object', properties, additionalProperties: false })
const geometrySchema = partial({ segments: integer(8, 128), radius: numeric(0.001, 0.5), bevel: numeric(0, 0.2), closed: { type: 'boolean' },
  terrainStyle: { type: 'string', enum: terrainStyles }, biome: { type: 'string', enum: terrainBiomes },
  profile: { type: 'array', maxItems: 64, items: { type: 'array', minItems: 2, maxItems: 2, items: numeric(-1000, 1000) } },
  holes: { type: 'array', maxItems: 8, items: { type: 'array', maxItems: 32, items: { type: 'array', minItems: 2, maxItems: 2, items: numeric(-1000, 1000) } } },
  points: { type: 'array', maxItems: 64, items: tuple(-1000, 1000) },
  vertices: { type: 'array', maxItems: 300000, items: numeric(-1000, 1000) }, indices: { type: 'array', maxItems: 300000, items: integer(0, 99999) },
  detail: integer(0, 5), variant: { type: 'string', enum: polyhedronVariants }, seed: integer(0, 9999), text: { type: 'string', maxLength: 160 },
})
const materialSchema = partial({ opacity: numeric(0, 1), transparent: { type: 'boolean' }, doubleSided: { type: 'boolean' }, alphaTest: numeric(0, 1), color: hex, metalness: numeric(0, 1), roughness: numeric(0, 1), clearcoat: numeric(0, 1), transmission: numeric(0, 1),
  emissive: hex, emissiveIntensity: numeric(0, 20), texture: { type: 'string', enum: textureKinds }, textureScale: numeric(0.1, 64), normalStrength: numeric(0, 3), ior: numeric(1, 2.333),
  thickness: numeric(0, 10), sheen: numeric(0, 1), iridescence: numeric(0, 1), flatShading: { type: 'boolean' } })
const lightSchema = object({ type: { type: 'string', enum: ['point', 'spot'] }, color: hex, intensity: numeric(0, 2000), distance: numeric(0, 1000), angle: numeric(1, 89), penumbra: numeric(0, 1), castShadow: { type: 'boolean' } })
const interactionSchema = object({ trigger: { type: 'string', enum: interactionTriggers }, key: { type: 'string', maxLength: 1 }, radius: numeric(0.5, 50),
  action: { type: 'string', enum: interactionActions }, targetId: { type: ['string', 'null'] }, message: { type: 'string', maxLength: MAX_MESSAGE },
  item: { type: 'string', maxLength: 40 }, requires: { type: 'string', maxLength: 40 }, amount: numeric(0, 1000), power: { type: 'string', enum: ['none', ...powerKinds] } })
const soundSchema = object({ preset: { type: 'string', enum: soundPresets }, volume: numeric(0, 1), radius: numeric(1, 200) })
const emitterSchema = object({ preset: choices(emitterPresets), rate: numeric(0.1, 4), spread: numeric(0, 20) })
const routineSchema = { type: 'array', maxItems: MAX_ROUTINE_STEPS, items: object({ activity: choices(routineActivities), target: { type: ['string', 'null'] }, from: numeric(0, 24), to: numeric(0, 24) }) }
const behaviorFields = { type: choices(behaviorTypes), speed: numeric(0, 12), range: numeric(0.5, 80), damage: numeric(0, 1000), health: integer(1, 100), attack: choices(attackStyles), flying: { type: 'boolean' }, delay: numeric(0, 3600),
  routine: nullable(routineSchema), reaction: nullable(choices(npcReactions)) }
const characterSchema = object({ age: choices(characterAges), build: choices(characterBuilds), height: numeric(0.85, 1.15), style: choices(characterStyles), skin: nullable(hex), hair: nullable(hex),
  hairStyle: choices(hairStyles), beard: choices(beardStyles) })
const keyframeSchema = object({ at: numeric(0, 1), move: tuple(-1000, 1000), turn: tuple(-720, 720), scale: tuple(0.01, 100) })
const animationFields = { kind: { type: 'string', enum: animationKinds }, axis, duration: numeric(0.2, 120), amplitude: numeric(0, 100), phase: numeric(0, 360),
  start: { type: 'string', enum: ['auto', 'trigger'] }, easing: { type: 'string', enum: ['linear', 'smooth', 'step'] }, keys: { type: 'array', maxItems: 16, items: keyframeSchema } }
const environmentFields = { background: hex, exposure: numeric(0.1, 3), lightIntensity: numeric(0, 5), grid: { type: 'boolean' }, wireframe: { type: 'boolean' }, shadows: { type: 'boolean' }, reflections: { type: 'boolean' },
  sky: { type: 'string', enum: skyPresets }, sunElevation: numeric(-10, 90), sunAzimuth: numeric(0, 360), fog: numeric(0, 0.2), bloom: numeric(0, 3),
  toneMapping: { type: 'string', enum: ['aces', 'agx', 'neutral'] },
  player: object({ spawn: nullable(tuple(-10000, 10000)), yaw: numeric(-360, 360), speed: numeric(1, 20), jumpHeight: numeric(0, 5), mode: { type: 'string', enum: ['walk', 'fly'] },
    allowFly: { type: 'boolean' }, health: numeric(1, 1000), camera: { type: 'string', enum: ['first', 'third'] }, weapon: { type: 'string', enum: weaponKinds }, avatar: { type: 'string', enum: avatarKinds } }),
  objective: nullable(object({ type: { type: 'string', enum: objectiveTypes }, title: { type: 'string', maxLength: 160 }, timeLimit: numeric(0, 3600) })),
  audio: object({ ambience: { type: 'string', enum: ambiencePresets }, music: { type: 'string', enum: musicPresets }, volume: numeric(0, 1) }),
  weather: { type: 'string', enum: weatherKinds }, grade: { type: 'string', enum: gradePresets },
  motion: nullable(object({ wind: numeric(0, 2), grass: choices(grassDensities), fauna: choices(faunaDensities) })),
  dayCycle: nullable(object({ enabled: { type: 'boolean' }, duration: numeric(60, 7200), start: numeric(0, 24) })), premise: nullable({ type: 'string', maxLength: MAX_PREMISE }) }
const nodeSchema = object({
  id: { type: 'string', minLength: 1, maxLength: 100 }, parentId: { type: ['string', 'null'] }, name: { type: 'string', minLength: 1, maxLength: 110 }, kind: kinds,
  role: nullable({ type: 'string', enum: ['structure', 'vegetation', 'prop', 'path'] }),
  geometry: nullable(geometrySchema), surface: nullable(materialSchema), light: nullable(lightSchema), interaction: nullable(interactionSchema), collidable: { type: 'boolean' },
  behavior: nullable(object(behaviorFields)), sound: nullable(soundSchema), emitter: nullable(emitterSchema),
  prefab: nullable(object({ type: { type: 'string', enum: prefabTypes }, size: numeric(0.3, 5), seed: integer(0, 9999), primary: { type: ['string', 'null'] }, secondary: { type: ['string', 'null'] }, text: { type: 'string', maxLength: 160 }, lit: { type: 'boolean' }, interactive: { type: 'boolean' },
    building: nullable(object({ style: { type: 'string', enum: ['cottage', 'townhouse', 'lodge', 'villa'] }, floors: integer(1, 2), width: numeric(7.5, 16), depth: numeric(8.5, 16), furnished: { type: 'boolean' } })),
    character: nullable(characterSchema) })),
  overlapWith: { type: 'array', maxItems: 32, items: { type: 'string' } },
  position: tuple(-10000, 10000), rotation: tuple(-360, 360), scale: tuple(0.01, 100), dimensions: tuple(0.01, 1000),
  color: hex, metalness: numeric(0, 1), roughness: numeric(0, 1),
  animation: object(animationFields),
  repeat: object({ mode: { type: 'string', enum: ['linear', 'radial', 'grid', 'scatter'] }, count: integer(1, MAX_COPIES), offset: tuple(-1000, 1000), radius: numeric(0, 1000), axis,
    columns: integer(1, 100), jitter: numeric(0, 1), seed: integer(0, 9999), onto: { type: ['string', 'null'] } }),
})
export const sceneRecipeSchema: JsonSchema = object({
  name: { type: 'string', minLength: 1, maxLength: 120 }, background: hex, exposure: numeric(0.1, 3), lightIntensity: numeric(0, 5), duration: numeric(1, 120),
  environment: object(environmentFields),
  roads: { type: 'array', maxItems: 16, items: object({ name: { type: 'string', maxLength: 110 }, points: { type: 'array', minItems: 2, maxItems: 64, items: { type: 'array', minItems: 2, maxItems: 2, items: numeric(-10000, 10000) } },
    width: numeric(1, 16), texture: { type: 'string', enum: textureKinds.filter((kind) => kind !== 'none') }, onto: { type: ['string', 'null'] } }) },
  nodes: { type: 'array', minItems: 1, maxItems: MAX_TEMPLATES, items: nodeSchema },
})
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('A receita precisa conter objetos JSON.')
  return value as Record<string, unknown>
}
function finiteIn(value: unknown, min: number, max: number) { return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max }

/** Top of a support surface in its own parent frame; terrains use their exact triangulated height. */
function surfaceTop(support: SceneNode, x: number, z: number): number | null {
  if (!hasSurface(support.kind) || support.rotation.some((value) => Math.abs(value) > 1e-6)) throw new Error(`A superfície “${support.name}” precisa estar sem rotação para receber objetos com onto.`)
  const width = support.dimensions[0] * support.scale[0], height = support.dimensions[1] * support.scale[1], depth = support.dimensions[2] * support.scale[2]
  const u = (x - support.position[0]) / width, v = (z - support.position[2]) / depth
  if (Math.abs(u) > 0.5 || Math.abs(v) > 0.5) return null
  return support.position[1] + (support.kind === 'terrain' ? terrainHeightAt(support.geometry, u, v) * height : height / 2)
}
/** World offset of a group chain made only of translations; null when a rotation or scale would distort onto. */
function translationOf(parentId: string | null, known: Map<string, SceneNode>): Vector3Tuple | null {
  const offset: Vector3Tuple = [0, 0, 0]
  for (let id = parentId; id !== null;) {
    const group = known.get(id)
    if (!group || group.rotation.some((value) => Math.abs(value) > 1e-6) || group.scale.some((value) => Math.abs(value - 1) > 1e-6)) return null
    for (let i = 0; i < 3; i++) offset[i] += group.position[i]
    id = group.parentId
  }
  return offset
}
type Template = Record<string, unknown>
/** Onto supports first, then groups, so surfaces and parents exist before the copies that depend on them. */
function dependencyOrder(entries: Template[], supports: Set<string>, extent: (entry: Template) => number = () => 0): Template[] {
  // Large structures claim (and flatten) their ground before vegetation and props are scattered around them.
  // Scattered fill comes last, so it can avoid every landmark, structure and rock placed explicitly.
  const rank = (entry: Template) => supports.has(entry.id as string) ? 0 : (entry.repeat as Template | undefined)?.mode === 'scatter' ? 4 : entry.kind === 'group' && extent(entry) >= 2.5 ? 1 : entry.kind === 'group' ? 2 : 3
  return entries.map((entry, index) => ({ entry, index })).sort((a, b) => rank(a.entry) - rank(b.entry) || a.index - b.index).map(({ entry }) => entry)
}
/** Routine places are node IDs resolved after expansion; a template is validated alone, so its places are set aside. */
function routinePlaces(behavior: unknown): (string | null)[] {
  const routine = behavior && typeof behavior === 'object' ? (behavior as Template).routine : undefined
  return routine == null ? [] : validateRoutine(routine).map((step) => step.target)
}
function withoutPlaces<T>(behavior: T): T {
  const routine = behavior && typeof behavior === 'object' ? (behavior as Template).routine : undefined
  return Array.isArray(routine) ? { ...behavior, routine: routine.map((step) => step && typeof step === 'object' ? { ...step, target: null } : step) } : behavior
}
const singleRepeat = { mode: 'linear', count: 1, offset: [0, 0, 0], radius: 0, axis: 'y', columns: 1, jitter: 0, seed: 1, onto: null }
/** Replaces a prefab template by its group and part templates; part IDs are `<template>.<part>`. */
function prefabTemplates(node: Template, log: SanitizeLog, lenient: boolean): Template[] {
  const spec = prefabSpec(node.prefab, lenient ? (label) => log.adjust(`Pré-fabricado: ${label}`) : undefined)
  const group: Template = { ...node, kind: 'group', prefab: null, prefabType: null, geometry: null, light: null, dimensions: [1, 1, 1] }
  if (!spec) { log.note(`“${String(node.name)}” pedia um pré-fabricado desconhecido e virou um grupo vazio.`); return [group] }
  const id = node.id as string, local = (part: string) => `${id}.${part}`
  if (typeof node.name !== 'string' || !node.name.trim()) group.name = prefabLabels[spec.type]
  group.prefabType = spec.type
  group.asset = spec.type === 'house' ? { ...spec, building: buildingPlan(spec) } : spec
  group.role = vegetationPrefabs.includes(spec.type) ? 'vegetation' : structurePrefabs.includes(spec.type) ? 'structure' : 'prop'
  const defaultBehavior=prefabRootBehavior(spec)
  group.behavior=defaultBehavior?{...defaultBehavior,...(node.behavior?record(node.behavior):{})}:node.behavior??null
  return [group, ...prefabParts(spec).map((part): Template => ({
    assetPart:part.id,
    id: local(part.id), parentId: part.parentId ? local(part.parentId) : id, name: part.name, kind: part.kind, position: part.position, rotation: part.rotation ?? [0, 0, 0], scale: [1, 1, 1], dimensions: part.dimensions,
    color: part.material?.color ?? '#cccccc', metalness: part.material?.metalness ?? 0, roughness: part.material?.roughness ?? 0.6, surface: part.material ?? null, geometry: part.geometry ?? null,
    animation: { kind: 'none', axis: 'y', duration: 6, amplitude: 0, phase: 0, start: 'auto', easing: 'smooth', keys: [], ...part.animation },
    interaction: part.interaction ? { ...part.interaction, targetId: part.interaction.targetId ? local(part.interaction.targetId) : null } : null,
    light: part.light ?? null, sound: part.sound ?? null, collidable: part.collidable ?? true, overlapWith: [...(part.overlapWith ?? []).map(local),
      ...(typeof (node.repeat as Template | undefined)?.onto === 'string' && (spec.type === 'rock' || (['tree', 'pine'].includes(spec.type) && part.id === 'trunk')) ? [(node.repeat as Template).onto] : [])], repeat: singleRepeat, behavior: part.behavior ?? null,
  }))]
}

/**
 * Expands a compact recipe. Groups (and prefabs) may be repeated: their subtree is copied per instance, with IDs
 * `<part>@<copy>` and references (contacts, interaction targets, supports) resolved inside the same copy.
 * Strict mode (imports, tests) rejects invalid data. Lenient mode (AI output) brings values inside the contract,
 * skips only templates that cannot describe an object and records every adjustment in `log`.
 */
export function expandSceneRecipe(value: unknown, onExpand: (templates: number) => void = () => {}, existingNodes: SceneNode[] = [], options: { lenient?: boolean; log?: SanitizeLog } = {}): ThreeSceneDocument {
  const recipe = record(value), lenient = !!options.lenient, log = options.log ?? new SanitizeLog()
  if (!Array.isArray(recipe.nodes) || !recipe.nodes.length || (!lenient && recipe.nodes.length > MAX_TEMPLATES)) throw new Error(`Use de 1 a ${MAX_TEMPLATES} templates na receita.`)
  let entries: Template[] = recipe.nodes.map((entry) => lenient ? entry as Template : record(entry))
  if (lenient) {
    if (entries.length > MAX_TEMPLATES) { log.note(`A receita tinha ${entries.length} templates; os ${MAX_TEMPLATES} primeiros foram usados.`); entries = entries.slice(0, MAX_TEMPLATES) }
    const used = new Set(existingNodes.map((node) => node.id))
    entries = entries.map((entry, index) => sanitizeTemplate(log, entry, index)).filter((entry): entry is Template => !!entry).map((entry) => {
      let id = entry.id as string
      for (let suffix = 2; used.has(id) || [...used].some((other) => other.startsWith(`${id}~`) || other.startsWith(`${id}.`)); suffix++) id = `${entry.id}-${suffix}`
      if (id !== entry.id) log.adjust('IDs repetidos renomeados')
      used.add(id)
      return { ...entry, id }
    })
    if (!entries.length) throw new Error('A receita não contém nenhum objeto aproveitável.')
  }
  onExpand(entries.length)
  const templates = entries.flatMap((entry) => entry.prefab ? prefabTemplates(entry, log, lenient) : [entry])
  const templateIds = new Set(templates.map((entry) => entry.id as string)), children = new Map<string, Template[]>(), roots: Template[] = []
  const supports = new Set(templates.map((entry) => (entry.repeat as { onto?: unknown } | undefined)?.onto).filter((id): id is string => typeof id === 'string'))
  // A route is also a dependency: otherwise a terrain used only by roads was expanded after its paths.
  const terrains=templates.filter(entry=>entry.kind==='terrain'&&!entry.parentId)
  for(const road of Array.isArray(recipe.roads)?recipe.roads:[]) if(road&&typeof road==='object') {
    const onto=(road as Template).onto
    if(typeof onto==='string') supports.add(onto)
    else if(terrains.length===1) supports.add(terrains[0].id as string)
  }
  for (const entry of templates) {
    const parent = entry.parentId
    if (typeof parent === 'string' && parent !== entry.id && templateIds.has(parent)) children.set(parent, [...children.get(parent) ?? [], entry])
    else roots.push(entry)
  }
  const extents = new Map<Template, number>()
  const footprints = new Map<Template, THREE.Vector3>()
  const extentOf = (entry: Template): number => {
    if (extents.has(entry)) return extents.get(entry)!
    let radius = 0.5
    const bounds = new THREE.Box3()
    const walk = (part: Template, parent: THREE.Matrix4, depth: number, root = false) => {
      if (depth > 12) return
      const position = root ? [0, 0, 0] : (part.position as number[] | undefined) ?? [0, 0, 0]
      const rotation = (part.rotation as number[] | undefined) ?? [0, 0, 0], scale = (part.scale as number[] | undefined) ?? [1, 1, 1]
      const matrix = parent.clone().multiply(new THREE.Matrix4().compose(new THREE.Vector3(...position), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation.map(THREE.MathUtils.degToRad) as [number, number, number])), new THREE.Vector3(...scale)))
      if (part.kind === 'group') for (const child of children.get(part.id as string) ?? []) walk(child, matrix, depth + 1)
      else if (part.kind !== 'light') {
        const dimensions = (part.dimensions as number[] | undefined) ?? [1, 1, 1], point = new THREE.Vector3()
        for (const x of [-0.5, 0.5]) for (const y of [-0.5, 0.5]) for (const z of [-0.5, 0.5]) {
          point.set(x * dimensions[0], y * dimensions[1], z * dimensions[2]).applyMatrix4(matrix)
          bounds.expandByPoint(point)
          radius = Math.max(radius, Math.hypot(point.x, point.z))
        }
      }
    }
    walk(entry, new THREE.Matrix4(), 0, true)
    extents.set(entry, radius)
    footprints.set(entry, bounds.getSize(new THREE.Vector3()))
    return radius
  }
  // Templates scattered with the same seed, area, count and support share positions (trunk + crown, base + lamp).
  const scatterKey = (node: Template) => { const repeat = node.repeat as Template | undefined
    return repeat?.mode === 'scatter' ? JSON.stringify([repeat.seed ?? 1, repeat.count, repeat.offset, (node.position as number[] | undefined)?.[0], (node.position as number[] | undefined)?.[2], repeat.onto ?? null, node.parentId ?? null]) : '' }
  const sharedFootprint = new Map<string, number>(), sharedPlacement = new Map<string, ({ x: number; z: number; y: number } | null)[]>(), sharedMembers = new Map<string, string[]>()
  for (const node of templates) {
    const key = scatterKey(node)
    if (!key) continue
    const footprint = extentOf(node) * (1 + (((node.repeat as Template).jitter ?? 0) as number) * 0.3)
    if (Number.isFinite(footprint)) sharedFootprint.set(key, Math.max(sharedFootprint.get(key) ?? 0, footprint))
    sharedMembers.set(key, [...sharedMembers.get(key) ?? [], String(node.id)])
  }
  const nodes: SceneNode[] = [], meta = new Map<string, { template: string; scope: string; copy: number }>(), visited = new Set<string>()
  // Water planes, claimed building footprints and roads constrain where scattered objects may land.
  let waterLevel: number | null = null
  for (const entry of [...templates, ...existingNodes as unknown as Template[]]) {
    const surface = (entry.surface ?? entry.material) as Template | null | undefined, y = (entry.position as number[] | undefined)?.[1]
    if (entry.kind === 'plane' && (entry.parentId ?? null) === null && (surface?.texture === 'water' || entry.texture === 'water') && typeof y === 'number' && Number.isFinite(y)) waterLevel = Math.max(waterLevel ?? -Infinity, y)
  }
  const zones: { x: number; z: number; r: number }[] = [], roadSegments: { ax: number; az: number; bx: number; bz: number; half: number }[] = []
  const segmentDistance = (x: number, z: number, segment: typeof roadSegments[number]) => {
    const dx = segment.bx - segment.ax, dz = segment.bz - segment.az, length = dx * dx + dz * dz
    const t = length ? Math.max(0, Math.min(1, ((x - segment.ax) * dx + (z - segment.az) * dz) / length)) : 0
    return Math.hypot(x - segment.ax - dx * t, z - segment.az - dz * t)
  }
  const blocked = (x: number, z: number, footprint: number) => zones.some((zone) => Math.hypot(x - zone.x, z - zone.z) < zone.r + footprint) || roadSegments.some((segment) => segmentDistance(x, z, segment) < segment.half + footprint * 0.8)
  const grounded: { id: string; support: SceneNode; x: number; z: number; offset: number; shiftY: number }[] = []
  // Scattered copies of different templates (trees, stumps, rocks) keep their cores apart; co-scattered parts share a key.
  const scattered: { x: number; z: number; r: number; key: string }[] = []
  const scatteredIds = new Set<string>()
  let solidCache: { count: number; discs: { x: number; z: number; r: number }[] } = { count: -1, discs: [] }
  /** Footprints of solid root objects already expanded (rocks, cliffs, monuments); recomputed only when nodes were added. */
  const solids = () => {
    if (solidCache.count !== nodes.length) solidCache = { count: nodes.length, discs: [...existingNodes, ...nodes].filter((item) => item.parentId === null && hasSurface(item.kind) && !['terrain', 'plane'].includes(item.kind)
      && item.role !== 'path' && item.collidable !== false && !meta.get(item.id)?.scope && !scatteredIds.has(item.id)).map((item) => ({ x: item.position[0], z: item.position[2],
        r: Math.hypot(item.dimensions[0] * item.scale[0], item.dimensions[2] * item.scale[2]) / 2 })).filter((disc) => disc.r < 200) }
    return solidCache.discs
  }
  const roadSupports = new Map<SceneNode, SceneNode>()
  const known = () => new Map([...existingNodes, ...nodes].map((node) => [node.id, node]))
  /** Finds a referenced template instance in the same copy scope, walking outwards to the original IDs. */
  const resolve = (reference: string, from: string, ids: Set<string>) => {
    const origin = meta.get(from)
    if (!origin) return reference
    const scopes = origin.scope.split('@').map((_, index, all) => all.slice(0, index + 1).join('@')).reverse()
    for (const scope of scopes) {
      if (origin.copy > 1 && ids.has(`${reference}${scope}~${origin.copy}`) && meta.get(`${reference}${scope}~${origin.copy}`)?.template !== origin.template) return `${reference}${scope}~${origin.copy}`
      if (ids.has(`${reference}${scope}`)) return `${reference}${scope}`
    }
    return reference
  }
  /** Roads follow the terrain as textured strips; the ground along them is flattened and kept clear of scattered props. */
  function buildRoads() {
    const roads = Array.isArray(recipe.roads) ? recipe.roads.slice(0, 16) : []
    for (const [index, entry] of roads.entries()) {
      try {
        const road = record(entry)
        const points = (Array.isArray(road.points) ? road.points : []).slice(0, 64).filter((point): point is number[] => Array.isArray(point) && point.length === 2 && point.every((value) => typeof value === 'number' && Number.isFinite(value)))
          .map(([x, z]) => [Math.max(-10000, Math.min(10000, x)), Math.max(-10000, Math.min(10000, z))])
        if (points.length < 2) throw new Error('a estrada precisa de pelo menos dois pontos [x, z].')
        const width = typeof road.width === 'number' && Number.isFinite(road.width) ? Math.max(1, Math.min(16, road.width)) : 3
        const texture = textureKinds.includes(road.texture as typeof textureKinds[number]) && road.texture !== 'none' ? road.texture as typeof textureKinds[number] : 'sand'
        const candidates = [...existingNodes, ...nodes].filter((node) => node.kind === 'terrain' && node.parentId === null)
        const support = typeof road.onto === 'string' ? candidates.find((node) => node.id === road.onto) : candidates.length === 1 ? candidates[0] : undefined
        const samples: number[][] = []
        for (let i = 1; i < points.length; i++) {
          const [ax, az] = points[i - 1], [bx, bz] = points[i], steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az)))
          for (let k = i === 1 ? 0 : 1; k <= steps && samples.length < 1500; k++) samples.push([ax + (bx - ax) * k / steps, az + (bz - az) * k / steps])
        }
        if (support) {
          const naturalSupport={...support,geometry:{...support.geometry,pads:support.geometry.pads.map(pad=>[...pad])}}
          const width3 = support.dimensions[0] * support.scale[0], depth3 = support.dimensions[2] * support.scale[2], tall = support.dimensions[1] * support.scale[1]
          const step = Math.max(2, Math.round(width * 1.2))
          for (let i = 0; i < samples.length && support.geometry.pads.length < 256; i += step) {
            const [x, z] = samples[i], level = surfaceTop(naturalSupport, x, z)
            if (level === null) continue
            support.geometry.pads.push([(x - support.position[0]) / width3, (z - support.position[2]) / depth3, Math.min(0.5, (width / 2 + 0.6) / width3), Math.min(0.5, (width / 2 + 0.6) / depth3), Math.max(-0.5, Math.min(0.5, (level - support.position[1]) / tall))])
          }
        }
        const vertices: number[] = [], uvs: number[] = [], indices: number[] = []
        let travelled = 0
        for (let i = 0; i < samples.length; i++) {
          const previous = samples[Math.max(0, i - 1)], next = samples[Math.min(samples.length - 1, i + 1)]
          const tx = next[0] - previous[0], tz = next[1] - previous[1], length = Math.hypot(tx, tz) || 1, nx = -tz / length * width / 2, nz = tx / length * width / 2
          if (i) travelled += Math.hypot(samples[i][0] - samples[i - 1][0], samples[i][1] - samples[i - 1][1])
          for (const side of [1, -1]) {
            const x = samples[i][0] + nx * side, z = samples[i][1] + nz * side
            vertices.push(x, (support ? surfaceTop(support, x, z) ?? support.position[1] : 0) + 0.06, z)
            uvs.push(side > 0 ? 0 : 1, travelled / width)
          }
          if (i) { const a = (i - 1) * 2, b = a + 1, c = a + 2, d = a + 3; indices.push(a, c, b, b, c, d) }
        }
        const ux = vertices[6] - vertices[0], uz = vertices[8] - vertices[2], vx = vertices[3] - vertices[0], vz = vertices[5] - vertices[2]
        if (uz * vx - ux * vz < 0) for (let i = 0; i < indices.length; i += 3) [indices[i + 1], indices[i + 2]] = [indices[i + 2], indices[i + 1]]
        const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]
        for (let i = 0; i < vertices.length; i++) { min[i % 3] = Math.min(min[i % 3], vertices[i]); max[i % 3] = Math.max(max[i % 3], vertices[i]) }
        const base = createNode('mesh')
        let roadId = `road-${index + 1}`
        while (templateIds.has(roadId) || existingNodes.some((node) => node.id === roadId) || nodes.some((node) => node.id === roadId)) roadId += '-path'
        const roadNode: SceneNode = { ...base, role: 'path', id: roadId, name: typeof road.name === 'string' && road.name.trim() ? road.name.slice(0, 110) : `Estrada ${index + 1}`,
          ...(support?{path:{supportId:support.id,points:points as [number,number][],width}}:{}),
          position: [0, 1, 2].map((axis) => (min[axis] + max[axis]) / 2) as Vector3Tuple, dimensions: [0, 1, 2].map((axis) => Math.max(0.01, max[axis] - min[axis])) as Vector3Tuple,
          geometry: { ...base.geometry, vertices, indices, normals: [], uvs }, overlapWith: support ? [support.id] : [], collidable: true,
          material: { ...base.material, color: '#e9e2d4', metalness: 0, roughness: 0.92, texture, textureScale: 1, doubleSided: true } }
        nodes.push(roadNode)
        if (support) {
          // Paths on the same support form a route network; their junctions are intentional surface contacts.
          for (const [other, host] of roadSupports) if (host.id === support.id) roadNode.overlapWith.push(other.id)
          roadSupports.set(roadNode, support)
        }
        for (let i = 1; i < samples.length; i++) roadSegments.push({ ax: samples[i - 1][0], az: samples[i - 1][1], bx: samples[i][0], bz: samples[i][1], half: width / 2 })
      } catch (error) {
        if (!lenient) throw error
        log.note(`A estrada ${index + 1} foi ignorada: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }
  const expandTemplate = (node: Template, parentInstance: string | null | undefined, scope: string): void => {
    visited.add(node.id as string)
    const repeat = record(node.repeat), label = typeof node.name === 'string' ? node.name : String(node.id)
    const copies: string[] = []
    try {
      let count = repeat.count as number
      const columns = (repeat.columns ?? 1) as number, jitter = (repeat.jitter ?? 0) as number, seed = (repeat.seed ?? 1) as number, onto = repeat.onto ?? null
      if (!Number.isInteger(count) || count < 1 || count > MAX_COPIES) throw new Error(`Repetições precisam de 1 a ${MAX_COPIES} cópias.`)
      if (!['linear', 'radial', 'grid', 'scatter'].includes(repeat.mode as string) || !['x', 'y', 'z'].includes(repeat.axis as string)) throw new Error('Padrão de repetição inválido.')
      if (!Array.isArray(repeat.offset) || repeat.offset.length !== 3 || repeat.offset.some((v) => !finiteIn(v, -1000, 1000))) throw new Error('Offset de repetição inválido.')
      if (!finiteIn(repeat.radius, 0, 1000)) throw new Error('Raio de repetição inválido.')
      if (!Number.isInteger(columns) || !finiteIn(columns, 1, 100) || !finiteIn(jitter, 0, 1) || !Number.isInteger(seed) || !finiteIn(seed, 0, 9999)) throw new Error('Grade/dispersão requer colunas 1–100, variação 0–1 e semente inteira.')
      if (onto !== null && typeof onto !== 'string') throw new Error('onto deve referenciar o ID de uma superfície.')
      const room = MAX_SCENE_NODES - existingNodes.length - nodes.length
      if (count > room) {
        if (!lenient) throw new Error(`A expansão excede ${MAX_SCENE_NODES} nós. Reduza as repetições.`)
        if (room <= 0) { log.note(`“${label}” não coube no limite de ${MAX_SCENE_NODES} objetos.`); return }
        log.note(`“${label}” foi reduzido de ${count} para ${room} cópias para caber no limite de ${MAX_SCENE_NODES} objetos.`)
        count = room
      }
      // Validate a template before arithmetic, without requiring its parent or references to have appeared first.
      const places = routinePlaces(node.behavior)
      const template = (geometry: unknown) => validateScene({ ...createEmptyScene(), nodes: [{ ...node, geometry, parentId: null, visible: true, interaction: undefined, behavior: withoutPlaces(node.behavior),
        material: { color: node.color, metalness: node.metalness, roughness: node.roughness, ...(node.surface ? record(node.surface) : {}) }, overlapWith: [], animation: validateAnimation(node.animation),
        light: node.light ?? undefined, collidable: node.collidable ?? true }] }).nodes[0]
      let base: SceneNode
      try { base = template(node.geometry) }
      catch (error) {
        if (!lenient || !node.geometry) throw error
        base = template(null)
        log.note(`A geometria de “${label}” era inválida (${error instanceof Error ? error.message : String(error)}) e recebeu a forma padrão.`)
      }
      const interaction = validateInteraction(node.interaction)
      const parentId = parentInstance === undefined ? (node.parentId as string | null) ?? null : parentInstance
      const supportId = typeof onto === 'string' ? [...known().keys()].includes(`${onto}${scope}`) ? `${onto}${scope}` : onto : null
      let support = supportId ? known().get(supportId) : undefined, shift: Vector3Tuple = [0, 0, 0], hostOffset: Vector3Tuple = [0, 0, 0]
      if (onto) {
        const own = translationOf(parentId, known()), host = support ? translationOf(support.parentId, known()) : null
        if (host) hostOffset = host
        if (!support || !hasSurface(support.kind) || support.rotation.some((value) => Math.abs(value) > 1e-6) || !own || !host) {
          if (!lenient) throw new Error(`onto “${onto}” precisa ser uma superfície anterior sem rotação, em grupos que apenas deslocam.`)
          log.note(`“${label}” não pôde ser assentado sobre “${onto}”; a altura informada foi mantida.`)
          support = undefined
        } else shift = [own[0] - host[0], own[1] - host[1], own[2] - host[2]]
      }
      const offset = [...repeat.offset as Vector3Tuple] as Vector3Tuple, axisIndex = { x: 0, y: 1, z: 2 }[repeat.axis as 'x' | 'y' | 'z']
      const shareKey = scatterKey(node), shared = shareKey ? sharedPlacement.get(shareKey) : undefined, placements: ({ x: number; z: number; y: number } | null)[] = []
      const footprint = sharedFootprint.get(shareKey) ?? extentOf(node) * (1 + jitter * 0.3)
      if (lenient && count > 1 && node.prefabType === 'house' && (repeat.mode === 'grid' || repeat.mode === 'linear')) {
        extentOf(node)
        const span = footprints.get(node)!
        if (repeat.mode === 'grid') for (const axis of [0,2]) {
          const minimum = span.getComponent(axis) + 1.5
          if (Math.abs(offset[axis]) < minimum) { offset[axis] = Math.sign(offset[axis] || 1) * minimum; log.adjust('Espaçamento de casas com circulação') }
        }
        else {
          const axis = Math.abs(offset[0]) >= Math.abs(offset[2]) ? 0 : 2, minimum = span.getComponent(axis) + 1.5
          if (Math.abs(offset[axis]) < minimum) { offset[axis] = Math.sign(offset[axis] || 1) * minimum; log.adjust('Espaçamento de casas com circulação') }
        }
      }
      const top = (x: number, z: number) => support ? surfaceTop(support, x + shift[0], z + shift[2]) : 0
      const placed: [number, number][] = []
      for (let index = 0; index < count; index++) {
        const position: Vector3Tuple = [...base.position], rotation: Vector3Tuple = [...base.rotation], scale: Vector3Tuple = [...base.scale]
        if (repeat.mode === 'linear') for (let i = 0; i < 3; i++) position[i] += offset[i] * index
        else if (repeat.mode === 'grid') { const column = index % columns, row = Math.floor(index / columns); position[0] += offset[0] * column; position[1] += offset[1] * row; position[2] += offset[2] * row }
        else if (repeat.mode === 'radial') {
          const angle = 2 * Math.PI * index / count
          position[(axisIndex + 1) % 3] += (repeat.radius as number) * Math.cos(angle)
          position[(axisIndex + 2) % 3] += (repeat.radius as number) * Math.sin(angle)
          rotation[axisIndex] = ((rotation[axisIndex] + angle * 180 / Math.PI + 180) % 360) - 180
        } else {
          let spot = shared ? shared[index] ?? null : null
          if (!shared) for (let attempt = 0; attempt < 40 && !spot; attempt++) {
            const random = (k: number) => hashNoise(index * 41 + attempt, k, seed)
            const x = base.position[0] + (random(1) - 0.5) * offset[0], z = base.position[2] + (random(3) - 0.5) * offset[2]
            if (placed.some(([px, pz]) => Math.hypot(px - x, pz - z) < footprint * 2.05)) continue
            const surface = top(x, z)
            if (surface === null) continue
            if (support?.kind === 'terrain' && waterLevel !== null && surface + hostOffset[1] < waterLevel + 0.35) continue
            const wx = x + shift[0] + hostOffset[0], wz = z + shift[2] + hostOffset[2]
            if (blocked(wx, wz, footprint)) continue
            if (scattered.some((other) => other.key !== shareKey && Math.hypot(other.x - wx, other.z - wz) < (other.r + footprint) * 0.45)) continue
            if (solids().some((other) => Math.hypot(other.x - wx, other.z - wz) < other.r + footprint * 0.45)) continue
            spot = { x, z, y: (random(2) - 0.5) * offset[1] }
          }
          placements.push(spot)
          if (!spot) continue
          if (!shared) scattered.push({ x: spot.x + shift[0] + hostOffset[0], z: spot.z + shift[2] + hostOffset[2], r: footprint, key: shareKey })
          position[0] = spot.x; position[1] = base.position[1] + spot.y; position[2] = spot.z
          placed.push([position[0], position[2]])
          const random = (k: number) => hashNoise(index * 41, k + 10, seed)
          rotation[axisIndex] = ((rotation[axisIndex] + (random(1) - 0.5) * 360 * jitter + 540) % 360) - 180
          const factor = 1 + (random(2) - 0.5) * jitter * 0.6
          for (let i = 0; i < 3; i++) scale[i] = Math.min(100, Math.max(0.01, scale[i] * factor))
        }
        const overlapWith = Array.isArray(node.overlapWith) ? [...node.overlapWith as string[]] : []
        const id = `${base.id}${scope}${index ? `~${index + 1}` : ''}`
        if (support) {
          let height = top(position[0], position[2])
          if (height === null) continue
          const sx = position[0] + shift[0], sz = position[2] + shift[2], reach = extentOf(node) * Math.max(scale[0], scale[2])
          const natural = naturalPrefabs.includes(node.prefabType as PrefabType)
          if (base.kind === 'group' && support.kind === 'terrain' && (node.prefabType ? !natural && reach >= 0.5 : reach >= 1.2) && support.geometry.pads.length < 256) {
            // Flatten the terrain under structures so floors never cut into the ground on slopes.
            const radius = reach + 0.6, samples = [[0, 0], ...Array.from({ length: 8 }, (_, k) => [Math.cos(k * Math.PI / 4) * radius * 0.7, Math.sin(k * Math.PI / 4) * radius * 0.7])]
              .map(([dx, dz]) => surfaceTop(support!, sx + dx, sz + dz)).filter((value): value is number => value !== null)
            const level = samples.reduce((sum, value) => sum + value, 0) / samples.length
            const width = support.dimensions[0] * support.scale[0], depth = support.dimensions[2] * support.scale[2], tall = support.dimensions[1] * support.scale[1]
            support.geometry.pads.push([(sx - support.position[0]) / width, (sz - support.position[2]) / depth, Math.min(0.5, radius / width), Math.min(0.5, radius / depth), Math.max(-0.5, Math.min(0.5, (level - support.position[1]) / tall))])
            zones.push({ x: sx + hostOffset[0], z: sz + hostOffset[2], r: radius })
            height = top(position[0], position[2]) ?? level
          }
          // Groups rest their origin on the surface; meshes keep the requested center elevation, never sinking below rest.
          position[1] = height - shift[1] + (base.kind === 'group' ? 0 : Math.max(base.dimensions[1] * scale[1] * 0.46, position[1]))
          grounded.push({ id, support, x: sx, z: sz, offset: position[1] - (height - shift[1]), shiftY: shift[1] })
          if (!overlapWith.includes(support.id)) overlapWith.push(support.id)
        }
        nodes.push({ ...structuredClone(base), id, name: index ? `${base.name.slice(0, 110)} ${index + 1}` : base.name, overlapWith, parentId, position, rotation, scale,
          ...(interaction ? { interaction: { ...interaction } } : {}),
          ...(base.behavior?.routine ? { behavior: { ...base.behavior, routine: base.behavior.routine.map((step, k) => ({ ...step, target: places[k] ?? null })) } } : {}) })
        meta.set(id, { template: base.id, scope, copy: index + 1 })
        if (repeat.mode === 'scatter') scatteredIds.add(id)
        copies.push(id)
      }
      if (shareKey && !shared) sharedPlacement.set(shareKey, placements)
    } catch (error) {
      if (!lenient) throw error
      log.note(`“${label}” foi ignorado: ${error instanceof Error ? error.message : String(error)}`)
      return
    }
    if (node.kind !== 'group') return
    for (const [index, id] of copies.entries()) for (const child of dependencyOrder(children.get(node.id as string) ?? [], supports, extentOf)) expandTemplate(child, id, `${scope}${index ? `@${meta.get(id)!.copy}` : ''}`)
  }
  const orderedRoots = dependencyOrder(roots, supports, extentOf)
  for (const root of orderedRoots) if (supports.has(root.id as string)) expandTemplate(root, undefined, '')
  buildRoads()
  for (const root of orderedRoots) if (!supports.has(root.id as string)) expandTemplate(root, undefined, '')
  // Later pads (other buildings, roads) may change the ground under earlier placements: re-rest everything on the final terrain.
  for (const record of grounded) {
    const node = nodes.find((item) => item.id === record.id), height = surfaceTop(record.support, record.x, record.z)
    if (node && height !== null) node.position[1] = height - record.shiftY + record.offset
  }
  // Buildings can modify terrain after the road is built. Reproject every road vertex on the final surface.
  for (const [road, support] of roadSupports) {
    const vertices = road.geometry.vertices, min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]
    for (let i = 0; i < vertices.length; i += 3) {
      vertices[i + 1] = (surfaceTop(support, vertices[i], vertices[i + 2]) ?? support.position[1]) + 0.06
      for (let axis = 0; axis < 3; axis++) { min[axis] = Math.min(min[axis], vertices[i + axis]); max[axis] = Math.max(max[axis], vertices[i + axis]) }
    }
    road.position = min.map((value, axis) => (value + max[axis]) / 2) as Vector3Tuple
    road.dimensions = min.map((value, axis) => Math.max(0.01, max[axis] - value)) as Vector3Tuple
  }
  for (const entry of templates) if (!visited.has(entry.id as string)) {
    if (!lenient) throw new Error('A hierarquia não pode conter ciclos.')
    log.note(`“${String(entry.name)}” estava num ciclo de grupos e foi colocado na raiz.`)
    expandTemplate({ ...entry, parentId: null }, null, '')
  }
  if (lenient && !nodes.length && !existingNodes.length) throw new Error('Nenhum objeto da receita pôde ser construído.')
  // Contacts and interaction targets resolve inside the same copy; co-scattered templates touch by design.
  const ids = new Set([...existingNodes, ...nodes].map((node) => node.id))
  const partners = new Map<string, string[]>()
  const link = (a: string, b: string) => { partners.set(a, [...new Set([...partners.get(a) ?? [], b])]); partners.set(b, [...new Set([...partners.get(b) ?? [], a])]) }
  for (const members of sharedMembers.values()) for (const a of members) for (const b of members) if (a < b) link(a, b)
  // Parallel repeated lists (same pattern) whose first copies touch describe one object per copy: walls + roof + door.
  const signature = (node: Template) => { const repeat = node.repeat as Template
    return (repeat.count as number) > 1 && repeat.mode !== 'scatter' ? JSON.stringify([repeat.mode, repeat.count, repeat.offset, repeat.radius, repeat.axis, repeat.columns, node.parentId ?? null]) : '' }
  const parallel = new Map<string, string[]>()
  for (const node of templates) { const key = signature(node); if (key) parallel.set(key, [...parallel.get(key) ?? [], node.id as string]) }
  const firstBoxes = new Map<string, THREE.Box3>()
  if ([...parallel.values()].some((list) => list.length > 1)) {
    const matrices = sceneMatrices({ ...createEmptyScene(), nodes: [...existingNodes, ...nodes] })
    for (const node of nodes) if (hasSurface(node.kind) && meta.get(node.id)?.copy === 1 && !meta.get(node.id)?.scope)
      firstBoxes.set(node.id, new THREE.Box3(new THREE.Vector3(-0.5, -0.5, -0.5), new THREE.Vector3(0.5, 0.5, 0.5)).applyMatrix4(matrices.get(node.id)!.clone().scale(new THREE.Vector3(...node.dimensions))).expandByScalar(0.05))
  }
  for (const list of parallel.values()) for (const a of list) for (const b of list) if (a < b && firstBoxes.get(a)?.intersectsBox(firstBoxes.get(b)!)) link(a, b)
  let composed = 0
  for (const node of nodes) {
    const template = meta.get(node.id)?.template ?? node.id
    node.overlapWith = [...new Set([...node.overlapWith.map((reference) => resolve(reference, node.id, ids)), ...(partners.get(template) ?? []).map((reference) => resolve(reference, node.id, ids)).filter((id) => ids.has(id))])]
    if (node.interaction?.targetId) node.interaction.targetId = resolve(node.interaction.targetId, node.id, ids)
    for (const step of node.behavior?.routine ?? []) if (step.target) step.target = resolve(step.target, node.id, ids)
    composed += partners.get(template)?.length ?? 0
  }
  if (lenient && composed) log.note('Peças repetidas em paralelo (mesmo padrão, encostadas) ou espalhadas juntas foram tratadas como um objeto por cópia, como paredes + telhado ou tronco + copa.')
  const finalNodes = lenient ? repairReferences(log, existingNodes, nodes) : [...existingNodes, ...nodes]
  const environment = { background: recipe.background, exposure: recipe.exposure, lightIntensity: recipe.lightIntensity, grid: false, wireframe: false,
    ...(lenient ? sanitizeEnvironment(log, recipe.environment) : recipe.environment ? record(recipe.environment) : {}) }
  if (lenient) Object.assign(environment, { background: typeof recipe.background === 'string' && /^#[0-9a-f]{6}$/i.test(recipe.background) ? recipe.background : '#dfe7ee',
    exposure: finiteIn(recipe.exposure, 0.1, 3) ? recipe.exposure : 1.1, lightIntensity: finiteIn(recipe.lightIntensity, 0, 5) ? recipe.lightIntensity : 1.5 })
  return validateScene(conformTerrainPaths(validateScene({ version: '1.4', name: lenient ? (typeof recipe.name === 'string' && recipe.name.trim() ? recipe.name.slice(0, 120) : 'Cena gerada') : recipe.name, nodes: finalNodes,
    timeline: { duration: lenient && !finiteIn(recipe.duration, 1, 120) ? 20 : recipe.duration }, environment })))
}

const SYSTEM = `Você é o diretor de arte, roteirista e level designer 3D do Forma. Produza uma cena COMPLETA, inventiva, densa em detalhes, iluminada, sonorizada e animada como receita JSON, sem código, markdown ou perguntas. Responda estritamente ao schema.
DIREÇÃO CRIATIVA (decida em silêncio, antes de construir): título evocativo (name); premissa de uma frase com gancho (environment.premise ≤240, mostrada no cartão de título); marco assinatura visível de longe; 3–5 pontos de interesse distintos, cada um com micro-história contada por objetos (carroça tombada com caixas espalhadas, muro rompido, fogueira com bancos e panela, barraca com mercadorias, ossadas junto a uma armadilha) e 6–12 adereços; paleta de 3–5 cores + um acento; luz, grade, clima e paisagem sonora; ciclo de jogo início seguro → desafio → recompensa → conclusão. Misture escalas (macro: marco e relevo; meso: construções; micro: adereços e vegetação rasteira), assimetria, silhuetas em camadas com primeiro plano e fundo, caminhos que guiam o olhar e recompensas em recantos. Dê vida: NPCs em assentamentos, fauna na natureza, inimigos do tema (masmorra/cemitério → skeleton; floresta → wolf/goblin; sci-fi/espaço/cyberpunk → drone/turret; deserto/caverna → spider; vulcão → golem; medieval → orc/goblin; chefe de fantasia → dragon). Evite vazios, grades de cópias idênticas e cenas genéricas; varie seed, size, rotação e cor das cópias.
SUPORTES: a geometria segue o gênero: interiores usam pisos/paredes/passagens; plataformas preservam vãos para salto; arenas usam coberturas e circulação; paisagens usam terreno natural. Só em paisagens: geometry.biome ${terrainBiomes.filter((biome) => biome !== 'none').join('|')} com color="#ffffff", segments 96–128 com relevo caminhável e roads com onto explícito. Não sobreponha chãos para pintar grama nem declare contatos para esconder superfícies concorrentes. Não acrescente estradas, árvores ou casas a laboratório, arena ou fase orbital sem pedido. No espaço sideral não há terreno: sky="space", corpos flutuam e o jogador voa.
ESCALA: metros, pessoa de 1,75 m, degraus ≈0,18 m, portas utilizáveis, caminhos ≥1,2 m. Eixo Y vertical, rotações XYZ em graus, transformações locais ao pai. Todo objeto com mais de uma peça é um group (origem no chão, peças locais) ou um prefab; nunca listas de peças soltas na raiz. Deixe ≥1 m entre objetos diferentes; o motor ajusta pequenos desvios, assenta no terreno e reporta o resto.
PREFABS: prefab={type,size,seed,primary,secondary,text,lit,interactive,building,character} ou null; kind=group, dimensions=[1,1,1]; size escala; primary/secondary hex ou null. Tipos: ${prefabTypes.join(', ')}. Nenhum é obrigatório; crie geometrias próprias para o que o catálogo não representa.
PERSONAGENS (rig animado, origem nos pés, size≈1): NPCs villager, knight, wizard, astronaut passeiam e conversam — text = falas separadas por "|". Inimigos: goblin (ágil), skeleton, orc (forte, lento), wolf (veloz, em matilha), spider, drone (voa, ataca à distância), golem (lento, muita vida), dragon (chefe voador; um por cena, arena ampla); legado: enemy=slime, sentinel=robô, crawler. Fauna pacífica: deer. behavior no grupo ajusta speed/range/damage/health/attack/flying/delay.
ARQUÉTIPOS: prefab.character={age child|young|adult|elder,build slim|average|athletic|heavy,height 0,85–1,15,style stylized|realistic,skin,hair (hex ou null = paleta da seed),hairStyle auto|bald|short|long|bun|ponytail|braids|mohawk,beard auto|none|short|long} só em personagens (null nos demais). Cada NPC é uma pessoa distinta: varie idade, porte, altura, pele, cabelo, barba, seed e primary/secondary (ferreiro adulto heavy de barba, idosa elder de coque, criança child, guarda athletic); nunca repita o mesmo modelo com repeat.
ROTINAS: behavior.routine (só npc; até 6 períodos ou null)=[{activity wander|work|sit|chat|patrol|guard|sleep|perform,target=ID de um lugar concreto da receita (marketStall, bench, well, fountain, campfire, castleWall, gate, house) ou null,from,to (horas 0–24; podem cruzar meia-noite)}]: comerciante work na barraca 7–18 e chat no chafariz 18–21; guarda patrol na muralha e guard no portão; ferreiro work na forja; bardo perform na praça; sit no banco; sleep em casa 22–6. NPCs com chat no mesmo alvo conversam entre si. behavior.reaction greet (cumprimenta o jogador)|ignore|flee (foge do perigo)|alert (avisa o guarda mais próximo) ou null.
MUNDO: castleWall (6 m; enfileire com offset 6), castleTower, gate (portão; text = item exigido, vazio = aberto), fountain, statue, marketStall, cart, haystack, chest, lever, banner, tombstone, ruinArch, dock, lighthouse, container, console, reactor, radarDish; campfire, torch e lampPost com lit=true iluminam. planet (6 m; seed ímpar = anéis; size 3–5 + escala do grupo para gigantes), asteroid gira, spaceship (7 m), spaceStation (anel de 16 m), rocket (9 m); mushroom (lit = bioluminescente; size≥2 gigante sólido), seaweed balança, crystalCluster lit ilumina, skyscraper (24–35 m; lit acende janelas), column (seed múltiplo de 3 = quebrada). house é só residencial: building={style:cottage|townhouse|lodge|villa,floors:1|2,width:7.5–16,depth:8.5–16,furnished}, com vãos e escada reais; nos outros tipos building=null.
JOGABILIDADE: turret (inimigo fixo à distância), movingPlatform (desliza e carrega o jogador), jumpPad (lança para cima), heart (cura), key (coletável; text = nome do item, padrão "Chave dourada"), powerOrb (text speed|jump|shield|strength), coin/gem (coleta), spikes (perigo), checkpoint, portal (chegada), ladder (escalada).
EDIÇÃO SEMÂNTICA: grupos com asset preservam parâmetros. Para andar, planta, estilo ou mobília use rebuilds=[{id do grupo existente,prefab completo}] (recompila preservando posição, rotação, escala e parentesco); nunca simule pavimentos com caixas nem altere dimensions do grupo. Cor/posição usam updates; novas construções usam additions. rebuilds=[] quando não há reconstrução.
GEOMETRIA: box, roundedBox (bevel), sphere, cylinder, cone e capsule (altura Y), plane (piso XZ), torus (anel XY), torusKnot; polyhedron (geometry.variant icosahedron|dodecahedron|octahedron|tetrahedron, detail 0–5, bevel 0–0,2 deforma com seed — rochas e cristais com flatShading); terrain (relevo XZ, segments 8–128, detail 0–5, seed, closed=true forma ilha; dimensions.y = altura máxima; terrainStyle rolling|ridged|terraced|dunes; biome ${terrainBiomes.join('|')} colore por altitude e inclinação; com bioma use color #ffffff); text (placa XY, geometry.text ≤160, cor = color); extrude (profile [[x,y],...] sem cruzamentos, holes, profundidade Z); lathe (profile [[raio,altura],...] em Y; raio zero nas pontas fecha); tube (points XYZ Catmull-Rom); mesh (vertices e indices); light (light={type point|spot,color,intensity,distance,angle,penumbra,castShadow}; spot aponta -Y local; 5–40 cd luminárias, 80–400 holofotes; até 32 luzes, ≤4 com sombra). geometry null = padrão. Toda geometria é normalizada à caixa dimensions; scale normalmente [1,1,1].
REPETIÇÃO: repeat={mode,count,offset,radius,axis,columns,jitter,seed,onto}. linear desloca por offset; grid usa columns e offset [dx,dy por linha,dz por linha]; radial distribui no plano normal a axis com radius girando as cópias; scatter espalha sem sobreposição numa área offset=[largura,altura,profundidade] centrada em position, jitter 0–1 varia giro/escala. onto=ID de terrain/plano/caixa anterior no MESMO grupo e sem rotação: apoia na superfície (position.y = altura acima dela) e declara o contato. Templates scatter com mesma seed, count, offset e position ficam alinhados (tronco + copa). Grupos podem ser repetidos com toda a subárvore. Nó único: {mode:"linear",count:1,offset:[0,0,0],radius:0,axis:"y",columns:1,jitter:0,seed:1,onto:null}. Até ${MAX_TEMPLATES} templates e ${MAX_SCENE_NODES} nós expandidos; prefira 25–70 templates e centenas de objetos em cenas grandes. Offsets devem superar a extensão do objeto; em radial, 2*raio*sin(pi/count) acomoda a largura.
MATERIAIS: color #RRGGBB, metalness, roughness; surface aceita clearcoat, transmission (vidro/água com ior 1,33–1,5 e thickness), emissive+emissiveIntensity (0–20; >1,5 brilha com bloom), sheen, iridescence, opacity/transparent, flatShading e texturas procedurais ${textureKinds.filter((kind) => kind !== 'none').join(', ')} (color tinge: use tons claros #c8c8c8–#ffffff; textureScale ≈ metros/1–2). Varie acabamentos; evite cores chapadas.
ATMOSFERA: environment={sky,sunElevation,sunAzimuth,fog,bloom,toneMapping,player,objective,audio,weather,grade,motion,dayCycle,premise}. sky studio|day|sunset (sunElevation 2–8)|night (estrelas; use luzes práticas)|overcast|space. fog 0,001–0,004 em paisagens de 70–150 m (mais denso só em pântano, caverna, subaquático ou terror). bloom 0,3–1,2 realça emissivos. Combine sol + luzes práticas (postes, lanternas, janelas) com esfera emissiva no bulbo. weather none|rain|snow|embers|fireflies|dust|bubbles|leaves|ash (rain tempestade/noir, snow inverno, embers forja/vulcão, fireflies floresta à noite, dust deserto/ruínas, bubbles subaquático, leaves outono/jardim, ash pós-apocalipse). grade none|warm|cool|cinematic|vivid|noir|dreamy|retro (warm vila/pôr do sol, cool inverno/sci-fi, vivid cartoon/doces, noir terror/cyberpunk chuvoso, dreamy encantado, retro synthwave). audio={ambience,music,volume}: auto escolhe pelo tema; explicite quando o tom importa (ambience forest|meadow|beach|desert|snow|swamp|cave|city|night|space|underwater|volcanic|scifi|dungeon|rain|wind; music calm|adventure|mystery|tension|combat|space|festive|spooky|heroic; none silencia). node.sound={preset,volume 0–1,radius 3–30} é som posicional sintetizado: fire (fogueiras, lareiras, tochas), water (rios, chafarizes), waves (mar), wind, machine (reatores, máquinas), engine, magic (cristais, altares), portal, chimes (sinos), alarm, crowd (mercados), birds/insects (árvores), drip (cavernas); 3–8 fontes por cena.
MUNDO VIVO: node.emitter={preset fire|smoke|sparks|magic|steam|fountain|leaves|dust|embers,rate 0,1–4,spread 0–20 m} ou null = partículas no nó: smoke em chaminés, fire em braseiros, sparks na bigorna/forja, steam em caldeiras e fontes termais, fountain em jatos d'água, magic em altares e portais, embers sobre fogueiras, leaves em copas de outono, dust em minas; campfire, torch, fountain e reactor já emitem sozinhos. motion={wind 0–2 (0 parado, 0,6 brisa, 1 ventoso, 2 tempestade),grass auto|none|dense,fauna auto|none|rich} ou null (automático): grass none em interiores, criptas, desertos, neve e espaço, dense em campos; fauna none em criptas, interiores e espaço, rich (aves, peixes, borboletas) em praias, ilhas, lagos e florestas. dayCycle={enabled,duration 60–7200 s por dia,start 0–24} só quando pedirem dia e noite, amanhecer/anoitecer ao longo do jogo ou passagem do tempo (rotinas seguem a hora); senão null.
ANIMAÇÃO: animation={kind,axis,duration,amplitude,phase,start,easing,keys}. spin gira 360° por período; float oscila ±amplitude; bounce quica; swing balança ±amplitude graus; pulse escala ±amplitude (0–0,95); orbit circula com raio amplitude; keyframes usa keys [{at 0–1,move [m],turn [graus],scale}] relativos à pose base, easing linear|smooth|step. start="auto" repete; start="trigger" espera uma interação (keyframes tocam uma vez e invertem no próximo acionamento — portas, pontes, gavetas). Use períodos divisores da timeline; keys=[] quando não usados.
JOGADOR: environment.player={spawn [x,y,z] no chão, fora de objetos, ou null, yaw (0 olha -Z), speed 3–8, jumpHeight 0,8–1,5, mode walk|fly, allowFly (false em desafios), health 50–300, camera first|third, weapon none|sword|blaster|bow|staff, avatar explorer|knight|wizard|astronaut|robot}. Controles: WASD, mouse, espaço pula, E interage/ataca, V troca câmera. Arma por gênero: sword (medieval/fantasia, avatar knight), bow (floresta, piratas, caça), staff (magia, avatar wizard), blaster (sci-fi, cyberpunk, faroeste, espaço; avatar astronaut ou robot), none (exploração, puzzle, plataforma: golpe curto e salto sobre inimigos). Pedido de tiro, arco ou espada exige a weapon correspondente.
COMPORTAMENTO: behavior={type,speed,range,damage,health,attack,flying,delay,routine,reaction}: enemy patrulha e persegue dentro de range (health = golpes/tiros para derrotar: comuns 2–4, elites 6–10, chefe 25–60; attack touch|melee|ranged|charge; flying para drones/dragões; delay = segundos até surgir), hazard, checkpoint, goal, climbable, npc (passeia, conversa e segue routine), launcher (lança range metros para cima). Inimigos a ≥8 m do spawn.
INTERAÇÃO: interaction={trigger,key,radius,action,targetId,message,item,requires,amount,power} ou null. trigger click (mirar + E dentro de radius), proximity ou key (0–9, b, g, j–p, r, t, u, x, y, z). action toggleAnimation (alvo ou filhos animados), toggleVisibility (grupos, luzes), collect (some e conta; item entra no inventário), message (placas, dicas), heal (amount de vida), powerup (power speed|jump|shield|strength por amount segundos), dialogue (falas separadas por "|"). requires bloqueia a ação até o inventário ter o item: chave → porta, gate, chest, ponte. Todo requires precisa de um collect/key com o MESMO nome, alcançável antes da passagem. collect/heal/powerup usam targetId null; message curta em português. collidable=false para grama, partículas, folhagem e decoração fina.
OBJETIVO: environment.objective={type:explore|collectAll|reachGoal|defeatEnemies|survive,title,timeLimit}. survive = resistir timeLimit segundos (60–300) a ondas: inimigos com delay 0, 20, 40… vindos de lados diferentes e hearts entre ondas. reachGoal com timeLimit = corrida contra o relógio com checkpoints. Veículos dirigíveis não existem; armas decorativas não disparam — só player.weapon.
GÊNEROS: combate → coberturas, flancos, inimigos corpo a corpo e à distância, recompensas após encontros; chefe → arena ampla com coberturas, um dragon/golem de health alta, lacaios antes e portal/chest depois; RPG/aventura → NPCs com dialogue que dão pistas e missões, key/item num ponto de interesse e gate/chest com requires em outro; plataformas → alturas progressivas, movingPlatform, jumpPad, checkpoints, spikes; furtividade → patrulhas de range curto, sombras, rotas alternativas; puzzle → lever/console com targetId num mecanismo real animado/visível; corrida → checkpoints em sequência, reachGoal e timeLimit; exploração → segredos, mirantes e coletáveis opcionais. Obedeça topologia e objetivo pedidos; não imponha combate, coleta, portas, vilas ou relevo a todo jogo.
ESPAÇO E FOLGAS: planeje envelopes antes de posicionar; respeite dimensões/rotações/escala globais, raios de órbita e folgas ao longo do movimento (inclusive portas abertas e plataformas móveis). overlapWith declara SOMENTE contatos intencionais por ID (eixo dentro do cubo, objeto encaixado); nunca marque todos para esconder erros. O motor inspeciona superfícies e contenções em poses amostradas e mostra cada sobreposição inesperada; entregue uma cena limpa na primeira resposta. Assets GLB importados existem como malhas; nunca invente URLs ou base64. Não prometa recursos fora deste contrato.`

async function completion(provider: LLMProvider, messages: AgentMessage[], signal: AbortSignal, schema: JsonSchema = sceneRecipeSchema): Promise<unknown> {
  if (signal.aborted) throw signal.reason ?? new DOMException('Cancelado', 'AbortError')
  let abort: () => void = () => {}
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => { void provider.cancel?.().catch(() => {}); reject(signal.reason ?? new DOMException('Cancelado', 'AbortError')) }
    signal.addEventListener('abort', abort, { once: true })
  })
  try { return await Promise.race([provider.generateStructured<unknown>(messages, schema, { temperature: 0.4, maxTokens: Math.min(16384, provider.maxOutputTokens ?? 8192) }), cancelled]) }
  finally { signal.removeEventListener('abort', abort) }
}
export class SceneSpatialError extends Error {
  readonly inspection: SceneInspection
  constructor(inspection: SceneInspection) {
    super(!inspection.complete ? 'A inspeção espacial não terminou dentro do orçamento. Reduza a complexidade.' : `A cena apresenta ${inspection.intersections.length} pares com cruzamento/contenção inesperados. ${inspection.intersections.slice(0, 3).map((issue) => `${issue.nameA} ↔ ${issue.nameB}`).join("; ")}. A proposta foi recusada; a cena atual foi preservada.`)
    this.name = 'SceneSpatialError'
    this.inspection = inspection
  }
}
export function spatialSummary(report: SceneInspection): string {
  return JSON.stringify({ complete: report.complete, pairs: report.intersections.length, samples: report.sampledTimes,
    surfaceConflicts:report.surfaceConflicts??[],surfaceCheckComplete:report.surfaceCheckComplete??true,
    intersections: report.intersections.slice(0, 16).map(({ a, b, kind, times }) => ({ a, b, kind, times })) })
}

export type SceneGenerationStage = 'prepare' | 'planning' | 'waiting' | 'validation' | 'expansion' | 'inspection' | 'application'
export interface SceneGenerationEvent {
  stage: SceneGenerationStage
  maxAttempts?: number
  attempt: number
  detail: string
  templates?: number
  objects?: number
}
export const generationStageLabels: Record<SceneGenerationStage, string> = {
  prepare: 'Preparar pedido', planning:'Agente de planejamento', waiting: 'Construção da cena na IA', validation: 'Validar receita',
  expansion: 'Construir objetos', inspection: 'Verificar superfícies e movimentos', application: 'Aplicar cena',
}
export class SceneGenerationTimeoutError extends Error {
  constructor(seconds: number, event: SceneGenerationEvent) {
    super(`O prazo de ${seconds / 60} minutos foi atingido na etapa “${generationStageLabels[event.stage]}” (chamada ${event.attempt}). A cena anterior foi preservada. Ajuste o tempo máximo e envie o pedido novamente; a resposta interrompida não pode ser retomada.`)
    this.name = 'SceneGenerationTimeoutError'
  }
}
/** What the AI action changed automatically and what the spatial check found in the applied scene. */
export interface SceneGenerationReport { warnings: string[]; inspection: SceneInspection | null }
interface Candidate { document: ThreeSceneDocument; inspection: SceneInspection | null; warnings: string[]; direction?: string[] }
const severity = (candidate: Candidate) => candidate.inspection?.complete ? candidate.inspection.intersections.length+(candidate.inspection.surfaceConflicts?.length??0) : Number.MAX_SAFE_INTEGER / 2
/** Only an explicit user cancellation discards the work; deadlines and provider failures keep the best scene obtained. */
const cancelledByUser = (signal: AbortSignal) => signal.aborted && !(signal.reason instanceof SceneGenerationTimeoutError)
const surfaceDirection=(inspection:SceneInspection|null)=>(inspection?.surfaceConflicts??[]).map(issue=>`Superfícies coplanares visíveis: ${issue.nameA} e ${issue.nameB} disputam ${issue.area} m² perto de [${issue.point.map(v=>v.toFixed(2)).join(',')}]. Separe as camadas por espessura real; não oculte objetos nem ignore o par.`)
function overlapWarning(inspection: SceneInspection | null): string[] {
  if (!inspection) return ['A inspeção espacial não foi concluída; use Verificar sobreposições.']
  if (!inspection.complete) return ['A inspeção espacial cobriu parte dos pares dentro do orçamento; use Verificar sobreposições.']
  return [...(inspection.intersections.length ? [`${inspection.intersections.length} pares de objetos ainda se sobrepõem. A cena foi aplicada; use Corrigir sobreposições para ajustá-los.`] : []),
    ...(inspection.surfaceCheckComplete===false?['A verificação de superfícies coplanares atingiu o orçamento; sua cobertura é parcial.']:[])]
}
async function inspectCandidate(document: ThreeSceneDocument, signal: AbortSignal): Promise<SceneInspection | null> {
  try { return await inspectSceneAsync(document, signal) }
  catch (error) { if (cancelledByUser(signal)) throw error; return null }
}

/**
 * Scene doctor without AI: flattens terrain under structures, rescues objects from the water, rests floating/buried
 * objects, fixes the spawn, then resolves verified intersections and unreachable collectibles in up to four rounds
 * (keeping only rounds that do not add intersections) and audits what remains.
 */
export async function healScene(document: ThreeSceneDocument, inspection: SceneInspection | null, signal: AbortSignal, movable?: Set<string>): Promise<{ document: ThreeSceneDocument; inspection: SceneInspection | null; notes: string[]; audit: SceneAudit }> {
  const prepared = prepareScene(document, movable)
  let current = prepared.document, report = current === document ? inspection : await inspectCandidate(current, signal)
  let moved = 0, grounded = prepared.grounded, removed = prepared.removed, relocated = 0
  for (let round = 0; round < 4 && report && !signal.aborted; round++) {
    const result = settleLayout(current, report, movable)
    if (result.document === current) break
    const next = await inspectCandidate(result.document, signal)
    if (!next || (next.complete && report.complete && next.intersections.length > report.intersections.length) || (!next.complete && next.intersections.length > report.intersections.length)) break
    current = result.document; report = next; moved += result.moved; grounded += result.grounded; removed += result.removed.length; relocated += result.relocated
    if (!report.intersections.length) break
  }
  const parts = [prepared.flattened && `terreno aplainado sob ${prepared.flattened} construções`, prepared.rescued && `${prepared.rescued} objetos tirados da água`, moved && `${moved} objetos afastados`,
    grounded && `${grounded} assentados no terreno`, removed && `${removed} peças decorativas sem espaço removidas`, relocated && `${relocated} coletáveis trazidos ao alcance do jogador`,
    prepared.spawnMoved && 'início do jogador levado para terra firme'].filter(Boolean)
  return { document: current, inspection: report, notes: parts.length ? [`Correção automática: ${parts.join(', ')}, sem chamada de IA.`] : [], audit: auditScene(current, report) }
}
/** Remaining non-overlap problems, phrased for the report (overlaps have their own warning). */
const remainingProblems = (audit: SceneAudit) => describeAudit({ ...audit, overlaps: 0 }).map((item) => `Ainda há ${item}; use Corrigir cena.`)

export async function generateThreeScene(provider: LLMProvider, request: string, signal: AbortSignal,
  onPhase: (phase: string) => void = () => {}, onProgress: (event: SceneGenerationEvent) => void = () => {}, onReport: (report: SceneGenerationReport) => void = () => {}): Promise<ThreeSceneDocument> {
  if (!request.trim() || request.length > 4000) throw new Error('Descreva sua cena em até 4.000 caracteres.')
  let callOffset=0,lastAttempt=1,scenePlan:ScenePlan|null=null
  const chain=shouldPlanScene(request),planningWarnings:string[]=[]
  const report = (event: SceneGenerationEvent) => { onPhase(event.detail); onProgress({...event,attempt:event.attempt?event.attempt+callOffset:0,maxAttempts:chain?3:2}) }
  report({ stage: 'prepare', attempt: 1, detail: 'Pedido e contrato preparados para a IA.' })
  if(chain) {
    try {scenePlan=await planScene(provider,request,signal,detail=>report({stage:'planning',attempt:1,detail}))}
    catch(error) {
      if(signal.aborted || (error && typeof error==='object' && 'limit' in error && ['quota','rate'].includes(String((error.limit as {kind?:string}|undefined)?.kind)))) throw error
      planningWarnings.push(`O planejamento especializado não foi validado (${error instanceof Error?error.message:String(error)}); o construtor recebeu o pedido original.`)
    }
    callOffset=1
  }
  const messages: AgentMessage[] = [{ role: 'system', content: SYSTEM }, { role: 'user', content: request + directionBrief(request)+(scenePlan?planningBrief(scenePlan,request):'') }]
  let best: Candidate | null = null, interruption = ''
  for (let attempt = 0; attempt < 2; attempt++) {
    lastAttempt=attempt+1
    report({ stage: 'waiting', attempt: attempt + 1, detail: attempt ? best ? 'A IA está refinando a composição e corrigindo os problemas encontrados…' : 'Corrigindo o contrato da cena…' : 'Aguardando a IA planejar e produzir a receita completa…' })
    let recipe: unknown
    try { recipe = await completion(provider, messages, signal) }
    catch (error) {
      if (!best || cancelledByUser(signal)) throw error
      interruption = `A chamada de ajuste não terminou (${error instanceof Error ? error.message : String(error)}); a melhor cena obtida foi aplicada.`
      break
    }
    report({ stage: 'validation', attempt: attempt + 1, detail: 'Resposta recebida. Ajustando a receita ao contrato…' })
    const log = new SanitizeLog()
    let document: ThreeSceneDocument
    try {
      document = expandSceneRecipe(recipe, (templates) => report({ stage: 'expansion', attempt: attempt + 1,
        detail: `Construindo os objetos a partir de ${templates} templates e verificando a hierarquia…`, templates }), [], { lenient: true, log })
    } catch (error) {
      if (best) break
      if (attempt) throw error
      report({ stage: 'validation', attempt: attempt + 1, detail: `A receita precisa de correção: ${error instanceof Error ? error.message : String(error)}` })
      messages.push({ role: 'assistant', content: JSON.stringify(recipe).slice(0, 50000) },
        { role: 'user', content: `Corrija a receita completa preservando a intenção original. Falha: ${error instanceof Error ? error.message : String(error)}. Última tentativa; entregue JSON.` })
      continue
    }
    const realization=scenePlan?applyScenePlanIntent(document,scenePlan,request):{document,notes:[]}
    const themed=applyThemeDefaults(realization.document,request)
    document=validateScene(conformTerrainPaths(themed.document))
    const warnings = [...log.summary(),...realization.notes,...themed.notes]
    if (warnings.length) report({ stage: 'expansion', attempt: attempt + 1, detail: `Ajustes automáticos: ${warnings.join(' ')}`, objects: document.nodes.length })
    report({ stage: 'inspection', attempt: attempt + 1, detail: 'Inspecionando superfícies e movimentos em worker…' })
    const settled = await healScene(document, await inspectCandidate(document, signal), signal)
    const inspection = settled.inspection
    const planIssues=scenePlan?reviewScenePlan(settled.document,scenePlan,request):[]
    if(scenePlan) report({stage:'inspection',attempt:attempt+1,detail:`Revisão do plano construído: ${scenePlan.zones.length} zonas, ${scenePlan.routes.length} ligações e ${scenePlan.buildings.reduce((sum,family)=>sum+family.count,0)} casas previstas; ${planIssues.length} requisitos pendentes na verificação espacial e de jogabilidade.`})
    const direction = [...reviewSceneDirection(settled.document, request),...planIssues,...surfaceDirection(inspection),...(settled.audit.groundProblems??[])]
    const candidate: Candidate = { document: settled.document, inspection, direction, warnings: [...warnings, ...settled.notes, ...remainingProblems(settled.audit)] }
    if (!best || severity(candidate) < severity(best) || (severity(candidate) === severity(best) && direction.length < (best.direction?.length ?? 0))) best = candidate
    if (attempt || !inspection?.complete || (!inspection.intersections.length && !direction.length) || signal.aborted) break
    report({ stage: 'inspection', attempt: 1, detail: `Revisão: ${inspection.intersections.length} pares sobrepostos e ${direction.length} pontos de composição/jogabilidade. Refinando a cena…` })
    messages.push({ role: 'assistant', content: JSON.stringify(recipe).slice(0, 50000) },
      { role: 'user', content: `Refine a receita preservando o pedido original: ${request}. Corrija os cruzamentos inesperados, mantendo detalhes e objetos solicitados. Contatos legítimos podem ser declarados individualmente; não ignore pares arbitrários. Diagnóstico: ${spatialSummary(inspection)}. Revisão de direção: ${direction.length ? direction.join(' ') : 'Preserve a composição atual.'} Entregue a receita completa.` })
  }
  if (!best) throw new Error('Não foi possível construir a cena.')
  const warnings = [...planningWarnings,...best.warnings, ...(interruption ? [interruption] : []), ...overlapWarning(best.inspection), ...(best.direction ?? []).map((issue) => `Revisão de qualidade: ${issue}`)]
  report({ stage: 'application', attempt: lastAttempt, detail: `${best.document.nodes.length} objetos prontos${warnings.length ? ` com ${warnings.length} observações` : ''}. Aplicando…`, objects: best.document.nodes.length })
  onReport({ warnings, inspection: best.inspection })
  return best.document
}

const nodeChanges = { kind: kinds, name: { type: 'string' }, parentId: { type: ['string', 'null'] },
  visible: { type: 'boolean' }, position: tuple(-10000, 10000), rotation: tuple(-360, 360), scale: tuple(0.01, 100), dimensions: tuple(0.01, 1000),
  material: materialSchema, geometry: geometrySchema, animation: partial(animationFields), light: lightSchema, interaction: nullable(interactionSchema), collidable: { type: 'boolean' },
  behavior: nullable(partial(behaviorFields)), emitter: nullable(emitterSchema) }
export const sceneEditSchema: JsonSchema = object({
  updates: { type: 'array', maxItems: 500, items: object({ id: { type: 'string' }, changes: partial(nodeChanges) }) },
  additions: { type: 'array', maxItems: MAX_TEMPLATES, items: nodeSchema },
  removals: { type: 'array', maxItems: 500, items: { type: 'string', minLength: 1, maxLength: 100 } },
  rebuilds: { type: 'array', maxItems: 40, items: object({ id: { type: 'string' }, prefab: nodeSchema.properties.prefab }) },
  environment: nullable(partial({ ...environmentFields, player: partial(environmentFields.player.properties) })),
})
/** Applies an ID patch. Without `log` it is strict; with `log` (AI output) invalid updates are skipped individually and reported. */
export function applySceneEdit(doc: ThreeSceneDocument, value: unknown, log?: SanitizeLog): ThreeSceneDocument {
  const plan = record(value)
  const updates = Array.isArray(plan.updates) ? plan.updates : [], additions = Array.isArray(plan.additions) ? plan.additions : []
  if (!log && (!Array.isArray(plan.updates) || plan.updates.length > 500 || !Array.isArray(plan.additions) || plan.additions.length > MAX_TEMPLATES)) throw new Error('Edição exige updates/additions dentro dos limites.')
  const unknownKeys = Object.keys(plan).filter((key) => !['updates', 'additions', 'removals', 'rebuilds', 'environment'].includes(key))
  if (unknownKeys.length) {
    if (!log) throw new Error('A edição contém operações desconhecidas; exclusões não são permitidas neste fluxo.')
    log.note(`Operações não suportadas foram ignoradas: ${unknownKeys.join(', ')}. Remoções devem usar removals com IDs existentes.`)
  }
  const patches = new Map<string, Record<string, unknown>>()
  for (const entry of updates.slice(0, 500)) {
    try {
      const update = record(entry), changes = record(update.changes)
      if (typeof update.id !== 'string' || !doc.nodes.some((node) => node.id === update.id) || patches.has(update.id)) throw new Error('Edição referencia um ID inexistente ou duplicado.')
      const unknown = Object.keys(changes).filter((key) => !Object.hasOwn(nodeChanges, key))
      if (unknown.length && !log) throw new Error('Campo de edição desconhecido. Contatos intencionais não podem ser alterados para mascarar interferências.')
      for (const key of unknown) delete changes[key]
      patches.set(update.id, changes)
    } catch (error) { if (!log) throw error; log.note(`Uma alteração foi ignorada: ${error instanceof Error ? error.message : String(error)}`) }
  }
  let nodes = doc.nodes.map((node) => {
    const changes = patches.get(node.id)
    if (!changes) return node
    const kindChanged = changes.kind && changes.kind !== node.kind
    const next: SceneNode = { ...node, ...changes,
      material: changes.material ? { ...node.material, ...record(changes.material) } : node.material,
      geometry: changes.geometry ? { ...(kindChanged ? defaultGeometry(String(changes.kind)) : node.geometry), ...record(changes.geometry) } : kindChanged ? defaultGeometry(String(changes.kind)) : node.geometry,
      animation: changes.animation ? { ...node.animation, ...record(changes.animation) } : node.animation } as SceneNode
    if (changes.light) next.light = { ...node.light, ...record(changes.light) } as SceneNode['light']
    if (changes.behavior) {
      const merged = { ...node.behavior, ...record(changes.behavior) }
      next.behavior = (log ? sanitizeBehavior(log, merged) : merged) as SceneBehavior
    }
    if (changes.behavior === null) delete next.behavior
    if (changes.interaction === null) delete next.interaction
    if (changes.emitter !== undefined) {
      const emitter = changes.emitter === null ? null : log ? sanitizeEmitter(log, changes.emitter) : changes.emitter
      if (emitter) next.emitter = emitter as SceneNode['emitter']; else delete next.emitter
    }
    if (!log) return next
    try { validateScene({ ...createEmptyScene(), nodes: [{ ...next, parentId: null, overlapWith: [], interaction: undefined, behavior: withoutPlaces(next.behavior) }] }); return next }
    catch (error) { log.note(`A alteração de “${node.name}” foi ignorada: ${error instanceof Error ? error.message : String(error)}`); return node }
  })
  if (plan.rebuilds !== undefined) {
    if (!Array.isArray(plan.rebuilds) || plan.rebuilds.length > 40) { if (!log) throw new Error('Use até 40 reconstruções.'); log.note('Reconstruções inválidas ignoradas.') }
    else for (const value of plan.rebuilds) {
      try {
        const entry = record(value), root = nodes.find(node => node.id === entry.id)
        if (!root || root.kind !== 'group') throw new Error('Reconstrução exige um grupo existente.')
        const spec = prefabSpec(entry.prefab, log ? label => log.adjust(label) : undefined)
        if (!spec) throw new Error('Tipo de asset desconhecido.')
        const rebuilt = expandSceneRecipe({ name: doc.name, background: doc.environment.background, exposure: 1, lightIntensity: 1, duration: doc.timeline.duration,
          nodes: [{ ...root, parentId: null, prefab: spec, behavior: withoutPlaces(root.behavior), color: root.material.color, metalness: root.material.metalness, roughness: root.material.roughness, repeat: singleRepeat }] }).nodes
          .map((node) => node.id === root.id && node.behavior?.type === 'npc' && root.behavior?.routine ? { ...node, behavior: { ...node.behavior, routine: root.behavior.routine } } : node)
        const replacement=replaceAssetNodes({...doc,nodes},root,rebuilt)
        nodes = validateScene({ ...doc,nodes:replacement }).nodes
      } catch (error) { if (!log) throw error; log.note(`Reconstrução ignorada: ${error instanceof Error ? error.message : String(error)}`) }
    }
  }
  if (additions.length) {
    try {
      nodes = expandSceneRecipe({ name: doc.name, background: doc.environment.background, exposure: doc.environment.exposure, lightIntensity: doc.environment.lightIntensity,
        duration: doc.timeline.duration, environment: doc.environment, nodes: additions }, () => {}, nodes, log ? { lenient: true, log } : {}).nodes
    } catch (error) { if (!log) throw error; log.note(`Os objetos novos foram ignorados: ${error instanceof Error ? error.message : String(error)}`) }
  }
  if (plan.removals !== undefined) {
    if (!Array.isArray(plan.removals) || plan.removals.length > 500) {
      if (!log) throw new Error('Remoções: use até 500 IDs.')
      log.note('A lista de remoções inválida foi ignorada.')
    } else {
      const requested = new Set(plan.removals)
      for (const id of requested) {
        if (typeof id !== 'string' || !doc.nodes.some((node) => node.id === id)) {
          if (!log) throw new Error('Remoção referencia um ID inexistente.')
          log.note('Uma remoção com ID inexistente foi ignorada.'); continue
        }
        nodes = removeSubtree({ ...doc, nodes }, id).nodes
      }
      // Places of a routine that the user removed are forgotten, like interaction targets.
      const kept = new Set(nodes.map((node) => node.id))
      nodes = nodes.map((node) => ({ ...node }))
      clearRoutineTargets(nodes, (id) => kept.has(id) || !doc.nodes.some((node) => node.id === id), () => log?.adjust('Locais de rotina removidos'))
    }
  }
  if (log) {
    const present = new Set(nodes.map((node) => node.id))
    nodes = nodes.map((node) => ({ ...node }))
    clearRoutineTargets(nodes, (id) => present.has(id), () => log.adjust('Locais de rotina inexistentes'))
  }
  const envPatch = plan.environment ? record(plan.environment) : null
  const merged = envPatch ? { ...doc.environment, ...envPatch,
    ...(envPatch.player ? { player: { ...doc.environment.player, ...record(envPatch.player) } } : {}) } : doc.environment
  const environment = envPatch ? { ...merged, ...(log ? sanitizeEnvironment(log, merged) : {}) } : doc.environment
  let result: ThreeSceneDocument
  try { result = validateScene({ ...doc, environment, nodes }) }
  catch (error) {
    if (!log) throw error
    log.note(`Parte da edição conflitava com o contrato (${error instanceof Error ? error.message : String(error)}); somente o ambiente foi aplicado.`)
    result = validateScene({ ...doc, environment })
  }
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 32 * 1024 * 1024) throw new Error('O projeto editado excede 32 MB.')
  return result
}
const CONTEXT_LIMIT = 120_000
function compactNode(node: SceneNode, selectedId?: string | null) {
  const r = (values: number[]) => values.map((value) => Math.round(value * 1000) / 1000)
  return { id: node.id, parentId: node.parentId, name: node.name, kind: node.kind, position: r(node.position),
    ...(node.asset ? { asset: node.asset } : {}),
    ...(node.role ? { role: node.role } : {}),
    ...(node.rotation.some(Boolean) ? { rotation: r(node.rotation) } : {}), ...(node.scale.some((value) => value !== 1) ? { scale: r(node.scale) } : {}),
    ...(node.kind !== 'group' ? { dimensions: r(node.dimensions) } : {}), ...(node.animation.kind !== 'none' ? { animation: node.animation } : {}),
    ...(node.overlapWith.length ? { overlapWith: node.overlapWith } : {}), ...(node.light ? { light: node.light } : {}), ...(node.interaction ? { interaction: node.interaction } : {}),
    ...(node.collidable === false ? { collidable: false } : {}), ...(node.visible ? {} : { visible: false }),
    ...(node.behavior ? { behavior: node.behavior } : {}), ...(node.emitter ? { emitter: node.emitter } : {}),
    ...(hasSurface(node.kind) ? { material: { ...node.material, textureImage: node.material.textureImage ? '[imagem incorporada preservada]' : '' } } : {}),
    ...(node.id === selectedId || ['terrain', 'polyhedron', 'extrude', 'lathe', 'tube'].includes(node.kind) ? {
      geometry: node.kind === 'mesh' ? { vertices: node.geometry.vertices.length / 3, triangles: node.geometry.indices.length / 3 } : node.geometry } : {}) }
}
/** Compact context; very large scenes keep groups, selection and diagnosed nodes and report the omission. */
function editContext(doc: ThreeSceneDocument, inspection: SceneInspection, selectedId?: string | null): string {
  const priority = new Set([selectedId ?? '', ...inspection.intersections.flatMap((issue) => [issue.a, issue.b])])
  let nodes = doc.nodes.map((node) => compactNode(node, selectedId))
  let omitted = 0
  if (JSON.stringify(nodes).length > CONTEXT_LIMIT) {
    const byId = new Map(doc.nodes.map((node) => [node.id, node]))
    for (const id of [...priority]) for (let node = byId.get(id); node?.parentId; node = byId.get(node.parentId)) priority.add(node.parentId)
    const rank = (node: SceneNode) => priority.has(node.id) ? 0 : node.kind === 'group' ? 1 : !/[~@]/.test(node.id) ? 2 : 3
    const kept = [...doc.nodes].sort((a, b) => rank(a) - rank(b))
    nodes = []; let size = 0
    for (const node of kept) {
      const compact = compactNode(node, selectedId), bytes = JSON.stringify(compact).length + 1
      if (size + bytes > CONTEXT_LIMIT) continue
      nodes.push(compact); size += bytes
    }
    omitted = doc.nodes.length - nodes.length
  }
  return JSON.stringify({ name: doc.name, selectedId: selectedId ?? null, timeline: doc.timeline, environment: doc.environment, nodes,
    ...(omitted ? { omittedNodes: omitted, note: 'Cópias repetidas (IDs com ~) foram omitidas; elas permanecem intactas. Edite apenas IDs listados.' } : {}),
    inspection: JSON.parse(spatialSummary(inspection)) })
}
/** Repairs may only move, turn and retime objects: other changes are dropped instead of rejecting the proposal. */
function repairOnly(doc: ThreeSceneDocument, candidate: ThreeSceneDocument, log: SanitizeLog): ThreeSceneDocument {
  const proposed = new Map(candidate.nodes.map((node) => [node.id, node]))
  let dropped = candidate.nodes.length !== doc.nodes.length || JSON.stringify(candidate.environment) !== JSON.stringify(doc.environment)
  const nodes = doc.nodes.map((node) => {
    const next = proposed.get(node.id)
    if (!next) return node
    if (next.visible !== node.visible || next.parentId !== node.parentId || next.kind !== node.kind || JSON.stringify([next.dimensions, next.scale, next.geometry]) !== JSON.stringify([node.dimensions, node.scale, node.geometry])) dropped = true
    return { ...node, position: next.position, rotation: next.rotation, animation: next.animation }
  })
  if (dropped) log.note('O reparo só move, gira e reajusta órbitas; outras mudanças propostas foram descartadas.')
  return validateScene({ ...doc, nodes })
}
const pairKey = (issue: { a: string; b: string }) => [issue.a, issue.b].sort().join('|')

export async function editThreeScene(provider: LLMProvider, doc: ThreeSceneDocument, request: string, signal: AbortSignal,
  options: { mode: 'edit' | 'repair'; selectedId?: string | null; healed?: boolean; onProgress?: (event: SceneGenerationEvent) => void; onInspection?: (report: SceneInspection) => void; onReport?: (report: SceneGenerationReport) => void }): Promise<ThreeSceneDocument> {
  if (request.length > 4000) throw new Error('Descreva a alteração em até 4.000 caracteres.')
  const report = options.onProgress ?? (() => {})
  report({ stage: 'prepare', attempt: 0, detail: 'Inspecionando a cena existente antes de propor alterações…' })
  const before = await inspectSceneAsync(doc, signal)
  options.onInspection?.(before)
  if (options.mode === 'repair' && !options.healed) {
    // "Corrigir cena": the scene doctor fixes everything it can without AI; only remaining overlaps go to the model.
    const audit = auditScene(doc, before)
    if (!audit.total) {
      report({ stage: 'application', attempt: 0, detail: 'Nenhum problema encontrado: sem sobreposições, objetos na água, flutuando, enterrados ou fora de alcance.', objects: doc.nodes.length })
      options.onReport?.({ warnings: [], inspection: before })
      return doc
    }
    report({ stage: 'inspection', attempt: 0, detail: `Corrigindo automaticamente: ${describeAudit(audit).join('; ')}…` })
    const healed = await healScene(doc, before, signal)
    if (healed.inspection) options.onInspection?.(healed.inspection)
    const deliver = (extra: string[]) => {
      report({ stage: 'application', attempt: 0, detail: `Correção automática: ${audit.total} → ${healed.audit.total} problemas.`, objects: healed.document.nodes.length })
      options.onReport?.({ warnings: [...healed.notes, ...remainingProblems(healed.audit), ...extra], inspection: healed.inspection })
      return healed.document
    }
    if (!(healed.audit.overlaps+(healed.audit.surfaceConflicts?.length??0)) || !healed.inspection?.complete) return deliver(healed.audit.overlaps ? overlapWarning(healed.inspection) : [])
    try { return await editThreeScene(provider, healed.document, request, signal, { ...options, healed: true }) }
    catch (error) {
      if (cancelledByUser(signal) || healed.document === doc) throw error
      return deliver([`A IA não conseguiu reduzir os ${healed.audit.overlaps} pares restantes (${error instanceof Error ? error.message : String(error)}); as correções automáticas foram aplicadas.`])
    }
  }
  if (options.mode === 'repair' && !before.complete) throw new SceneSpatialError(before)
  if (options.mode === 'repair' && !before.intersections.length && !before.surfaceConflicts?.length) return doc
  const messages: AgentMessage[] = [{ role: 'system', content: SYSTEM + `
Reconstruções arquitetônicas usam rebuilds:[{id,prefab}], além de updates, additions, removals e environment. Retorne rebuilds:[] quando não necessário. Para dar um novo andar ou planta a uma casa existente, prefira reconstruir o grupo por ID com building explícito; preservar os outros nós não impede substituir suas peças geradas.
updates aceitam emitter (null remove) e behavior com routine/reaction; rebuilds aceitam prefab.character para mudar o arquétipo; environment aceita motion, dayCycle e premise (null remove).
Agora você EDITA uma cena existente. Retorne {updates:[{id,changes:{somente campos alterados}}],additions:[templates de receita],removals:[IDs a excluir somente se o usuário pediu remoção],environment:null ou somente campos de ambiente alterados}. Preserve IDs, todos os nós não mencionados, materiais/mapas, interações e movimentos. Remover um grupo exclui seus descendentes e limpa as referências. Nunca exclua nem oculte objetos para esconder colisões, não troque toda a cena por outra e não altere overlapWith. interaction:null remove uma interação; behavior:null remove um comportamento. Edições de reparo usam removals:[] e só ajustam posições/rotações/órbitas, preservando dimensões/geometria/hierarquia/visibilidade/ambiente, para reduzir os pares diagnosticados sem criar novos. A geometria de malhas importadas omitida no contexto deve permanecer intacta. Adicione detalhes somente quando solicitado. A posição é local ao grupo, dimensões são caixas locais; considere rotações e escalas de todos os pais. Mudanças parciais em environment.player preservam os demais parâmetros do jogador.` },
    { role: 'user', content: `${options.mode === 'repair' ? 'Corrija as sobreposições diagnosticadas conservando a composição, objetos e animações.' : request}
${options.mode === 'repair' ? request : ''}
CENA E DIAGNÓSTICO: ${editContext(doc, before, options.selectedId)}` }]
  const originalPairs = new Set(before.intersections.map(pairKey))
  const newPairs = (inspection: SceneInspection | null) => inspection?.complete ? inspection.intersections.filter((issue) => !originalPairs.has(pairKey(issue))).length : Number.MAX_SAFE_INTEGER / 2
  let best: Candidate | null = null, interruption = '',lastAttempt=1
  for (let attempt = 1; attempt <= 2; attempt++) {
    lastAttempt=attempt
    report({ stage: 'waiting', attempt, detail: attempt === 1 ? 'A IA está revisando a cena existente e propondo alterações por ID…' : 'A IA está corrigindo a proposta com base no novo diagnóstico…' })
    let plan: unknown
    try { plan = await completion(provider, messages, signal, sceneEditSchema) }
    catch (error) {
      if (!best || cancelledByUser(signal)) throw error
      interruption = `A chamada de ajuste não terminou (${error instanceof Error ? error.message : String(error)}); a melhor versão obtida foi aplicada.`
      break
    }
    report({ stage: 'validation', attempt, detail: 'Ajustando as alterações por ID ao contrato e preservando a cena existente…' })
    const log = new SanitizeLog()
    let candidate = applySceneEdit(doc, plan, log)
    if (options.mode === 'repair') candidate = repairOnly(doc, candidate, log)
    report({ stage: 'inspection', attempt, detail: 'Verificando as superfícies e os movimentos da cena editada…' })
    let after = await inspectCandidate(candidate, signal)
    if (options.mode === 'edit') {
      const original = new Map(doc.nodes.map((node) => [node.id, JSON.stringify(node)]))
      const settled = await healScene(candidate, after, signal, new Set(candidate.nodes.filter((node) => original.get(node.id) !== JSON.stringify(node)).map((node) => node.id)))
      candidate = settled.document; after = settled.inspection
      for (const note of [...settled.notes, ...remainingProblems(settled.audit)]) log.note(note)
    }
    if (options.mode === 'repair') {
      if (after && repairImproved(before, after)) {
        options.onInspection?.(after)
        report({ stage: 'application', attempt, detail: `Alterações verificadas: ${before.intersections.length} → ${after.intersections.length} pares inesperados.`, objects: candidate.nodes.length })
        options.onReport?.({ warnings: [...log.summary(), ...overlapWarning(after)], inspection: after })
        return candidate
      }
      if (attempt === 2 || !after || signal.aborted) throw new Error(`O reparo proposto não reduziu as interferências sem criar novas; a cena atual foi mantida. ${after ? `${after.intersections.length} pares permaneceriam nas poses amostradas.` : ''} Tente novamente ou ajuste os objetos indicados no diagnóstico.`)
      messages.push({ role: 'assistant', content: JSON.stringify(plan).slice(0, 50000) }, { role: 'user', content: `Corrija o patch a partir da cena ORIGINAL. A proposta não reduziu os pares existentes ou criou novos: ${spatialSummary(after)}. Não oculte nem remova objetos.` })
      continue
    }
    const direction = [...reviewSceneDirection(candidate,request),...surfaceDirection(after),...(auditScene(candidate,after).groundProblems??[])]
    const current: Candidate = { document: candidate, inspection: after, direction, warnings: log.summary() }
    if (!best || newPairs(current.inspection) < newPairs(best.inspection) || (newPairs(current.inspection) === newPairs(best.inspection) && direction.length <= (best.direction?.length ?? 0))) best = current
    if (attempt === 2 || !after?.complete || (!newPairs(after) && !direction.length) || signal.aborted) break
    report({ stage: 'inspection', attempt, detail: `${newPairs(after)} novos pares sobrepostos e ${direction.length} requisitos pendentes. Refinando o patch…` })
    messages.push({ role: 'assistant', content: JSON.stringify(plan).slice(0, 50000) }, { role: 'user', content: `Corrija o patch a partir da cena ORIGINAL, preservando o pedido: ${request}. Diagnóstico: ${spatialSummary(after)}. Requisitos pendentes: ${direction.join(' ') || 'Nenhum.'}. Use rebuilds para alterar a arquitetura de um grupo existente; não oculte nem remova objetos para esconder erros.` })
  }
  if (!best) throw new Error('Não foi possível aplicar a edição.')
  if (best.inspection) options.onInspection?.(best.inspection)
  const warnings = [...best.warnings, ...(interruption ? [interruption] : []), ...overlapWarning(best.inspection), ...(best.direction ?? []).map(issue=>`Revisão de qualidade: ${issue}`)]
  report({ stage: 'application', attempt: lastAttempt, detail: `Alterações aplicadas${best.inspection ? `: ${before.intersections.length} → ${best.inspection.intersections.length} pares sobrepostos` : ''}.`, objects: best.document.nodes.length })
  options.onReport?.({ warnings, inspection: best.inspection })
  return best.document
}
