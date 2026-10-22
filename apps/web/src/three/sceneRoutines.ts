import * as THREE from 'three'
import { hasSurface, type RoutineActivity, type SceneEnvironment, type SceneNode, type SceneRoutineStep, type ThreeSceneDocument } from './sceneDocument.ts'
import { sceneMatrices } from './scenePlacement.ts'

/** Poses and reactions the animator plays while an NPC holds a spot or reacts; null means plain locomotion/idle. */
export type NpcActivity = 'sit' | 'work' | 'sleep' | 'chat' | 'perform' | 'guard' | 'greet' | 'flee' | 'alert'
export type SpotKind = 'seat' | 'counter' | 'ring' | 'table' | 'door' | 'point'
/**
 * `position` is where the body belongs while the activity runs (hips over a seat, behind a counter); the collision capsule may stop
 * short of it next to furniture, so the renderer blends the visual body toward it. `facing` uses EnemyMotion.heading (atan2(x, z)).
 */
export interface ActivitySpot { position: THREE.Vector3; facing: number; face: THREE.Vector3; kind: SpotKind; indoors?: boolean }
export interface NpcTask { key: string; activity: RoutineActivity; spot: ActivitySpot | null; patrol: [THREE.Vector3, THREE.Vector3] | null }
export interface RoutinePlan { npcId: string; steps: { step: SceneRoutineStep; spot: ActivitySpot | null; patrol: [THREE.Vector3, THREE.Vector3] | null }[] }
/** Seconds each routine period lasts when the scene has no day cycle; periods alternate in authored order. */
export const ROUTINE_SLICE = 45

const wrapHour = (hour: number) => ((hour % 24) + 24) % 24
/** Whether `hour` falls in [from, to), wrapping past midnight; equal bounds cover the whole day. */
export function inPeriod(step: Pick<SceneRoutineStep, 'from' | 'to'>, hour: number): boolean {
  const h = wrapHour(hour), from = wrapHour(step.from), to = wrapHour(step.to)
  if (Math.abs(step.to - step.from) >= 24 || from === to) return true
  return from < to ? h >= from && h < to : h >= from || h < to
}

/** Active period: by clock hour with a day cycle, otherwise by slices of game time. */
export function routineAt(routine: SceneRoutineStep[] | undefined, hour: number | null, elapsed: number, slice = ROUTINE_SLICE): SceneRoutineStep | null {
  const index = routineIndex(routine, hour, elapsed, slice)
  return index < 0 ? null : routine![index]
}
export function routineIndex(routine: SceneRoutineStep[] | undefined, hour: number | null, elapsed: number, slice = ROUTINE_SLICE): number {
  if (!routine?.length) return -1
  if (hour !== null && Number.isFinite(hour)) return routine.findIndex((step) => inPeriod(step, hour))
  const time = Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0
  return Math.floor(time / Math.max(1, slice)) % routine.length
}

/** Clock hour of a scene with an enabled day cycle; null otherwise. */
export function routineHour(env: SceneEnvironment, elapsed: number): number | null {
  const cycle = env.dayCycle
  return cycle?.enabled ? wrapHour(cycle.start + Math.max(0, elapsed) / cycle.duration * 24) : null
}

const yawOf = (direction: THREE.Vector3) => Math.atan2(direction.x, direction.z)
interface Frame { matrix: THREE.Matrix4; size: number; type: string | null; node: SceneNode }

function frameOf(doc: ThreeSceneDocument, targetId: string, matrices: Map<string, THREE.Matrix4>): Frame | null {
  const node = doc.nodes.find((item) => item.id === targetId), matrix = matrices.get(targetId)
  return node && matrix ? { node, matrix, size: node.asset?.size ?? 1, type: node.asset?.type ?? null } : null
}

/** Ground-plane radius of a node's surfaces around its origin (children included). */
function footprint(doc: ThreeSceneDocument, frame: Frame, matrices: Map<string, THREE.Matrix4>): number {
  const inverse = frame.matrix.clone().invert(), unit = new THREE.Box3(new THREE.Vector3(-0.5, -0.5, -0.5), new THREE.Vector3(0.5, 0.5, 0.5)), box = new THREE.Box3()
  const inside = new Set([frame.node.id])
  for (const item of doc.nodes) if (item.parentId && inside.has(item.parentId)) inside.add(item.id)
  for (const item of doc.nodes) if (inside.has(item.id) && hasSurface(item.kind) && item.collidable !== false)
    box.union(unit.clone().applyMatrix4(inverse.clone().multiply(matrices.get(item.id)!).scale(new THREE.Vector3(...item.dimensions))))
  if (box.isEmpty()) return 0
  return Math.max(Math.abs(box.min.x), Math.abs(box.max.x), Math.abs(box.min.z), Math.abs(box.max.z))
}

interface LocalSlot { x: number; z: number; facing: [number, number]; kind: SpotKind; lookHeight?: number; indoors?: boolean }
const ring = (radius: number, count: number, index: number, offset = 0): LocalSlot => {
  const round = Math.floor(index / count), angle = offset + (index % count + (round % 2) * 0.5) / count * Math.PI * 2, r = radius + round * 0.9
  return { x: Math.sin(angle) * r, z: Math.cos(angle) * r, facing: [-Math.sin(angle), -Math.cos(angle)], kind: 'ring' }
}
const front = (slots: LocalSlot[], index: number, depth: number): LocalSlot => {
  if (index < slots.length) return slots[index]
  const extra = index - slots.length, side = extra % 2 ? 1 : -1
  return { x: side * (0.45 + Math.floor(extra / 2) * 0.8), z: depth, facing: [0, -1], kind: 'point' }
}

/** Slots in prefab units (multiplied by `size`), facing given as a local ground direction. */
function slotFor(type: string | null, index: number, activity: RoutineActivity | undefined, radius: number): LocalSlot {
  const seat = (x: number): LocalSlot => ({ x, z: 0.22, facing: [0, 1], kind: 'seat' })
  switch (type) {
    case 'bench': return front([seat(-0.4), seat(0.4)], index, 1.2)
    case 'chair': return front([seat(0)], index, 1)
    case 'table': {
      const sides: LocalSlot[] = [[-0.35, 0.8], [0.35, -0.8], [0.35, 0.8], [-0.35, -0.8], [-1.15, 0], [1.15, 0]].map(([x, z]) => ({ x, z, facing: Math.abs(z) > 0 ? [0, -Math.sign(z)] : [-Math.sign(x), 0], kind: 'table' }))
      return index < sides.length ? sides[index] : ring(1.6, 8, index - sides.length)
    }
    case 'marketStall': {
      const counter: LocalSlot[] = [0, -0.8, 0.8].map((x) => ({ x, z: -0.36, facing: [0, 1], kind: 'counter', lookHeight: 1.2 }))
      return index < counter.length ? counter[index] : { ...ring(2.4, 6, index - counter.length, Math.PI / 6), kind: 'point' }
    }
    case 'well': return ring(1.35, 6, index)
    case 'fountain': return ring(2.6, 8, index)
    case 'campfire': return ring(1.45, 6, index)
    case 'tent': return { x: (index % 2 ? 1 : -1) * Math.ceil(index / 2) * 0.7, z: 2, facing: [0, -1], kind: 'door', indoors: activity === 'sleep' }
    default: return ring(radius > 0 ? radius + 0.7 : 0.9, 6, index)
  }
}

/**
 * Concrete pose for the `npcIndex`-th NPC using `targetId`: seats on benches and chairs (back to the backrest), behind a stall's
 * counter, around wells, fountains and campfires, at table sides, in front of a house door, or near the center of any other node.
 * Guards face away from the target. A null target yields null.
 */
export function activitySpot(doc: ThreeSceneDocument, targetId: string | null, npcIndex: number, options: { activity?: RoutineActivity; matrices?: Map<string, THREE.Matrix4> } = {}): ActivitySpot | null {
  if (!targetId) return null
  const matrices = options.matrices ?? sceneMatrices(doc), frame = frameOf(doc, targetId, matrices)
  if (!frame) return null
  const index = Math.max(0, Math.floor(npcIndex)), guard = options.activity === 'guard'
  const origin = new THREE.Vector3().setFromMatrixPosition(frame.matrix)
  const toWorld = (x: number, z: number) => new THREE.Vector3(x, 0, z).applyMatrix4(frame.matrix)
  const direction = (x: number, z: number) => new THREE.Vector3(x, 0, z).transformDirection(frame.matrix).setY(0).normalize()
  let slot: LocalSlot, door: THREE.Vector3 | null = null
  if (frame.type === 'house') {
    const hinge = doc.nodes.find((item) => item.parentId === targetId && item.assetPart === 'hinge')
    door = hinge ? new THREE.Vector3(0.57 * frame.size, 0, 0).applyMatrix4(matrices.get(hinge.id)!).setY(origin.y) : toWorld(0, 4.5 * frame.size)
    const out = direction(0, 1), side = direction(1, 0), offset = (index % 2 ? 1 : -1) * Math.ceil(index / 2) * 0.75
    const position = door.clone().addScaledVector(out, 1).addScaledVector(side, offset)
    const facing = guard ? out : out.clone().negate()
    return { position, facing: yawOf(facing), face: position.clone().addScaledVector(facing, 3).setY(origin.y + 1.5), kind: 'door', indoors: options.activity === 'sleep' }
  }
  const known = frame.type && ['bench', 'chair', 'table', 'marketStall', 'well', 'fountain', 'campfire', 'tent'].includes(frame.type)
  const radius = known ? 0 : footprint(doc, frame, matrices) / frame.size
  slot = slotFor(known ? frame.type : null, index, options.activity, radius)
  const position = toWorld(slot.x * frame.size, slot.z * frame.size)
  const facing = direction(slot.facing[0], slot.facing[1])
  if (guard) facing.negate()
  const center = origin.clone().setY(origin.y + 1.2 * frame.size)
  const face = slot.kind === 'ring' && !guard ? center : position.clone().addScaledVector(facing, 3).setY(origin.y + (slot.lookHeight ?? 1.5) * frame.size)
  return { position, facing: yawOf(facing), face, kind: slot.kind, ...(slot.indoors ? { indoors: true } : {}) }
}

/** Chatting NPCs at one target stand on a circle around it and face its center, so a group looks at each other. */
export function chatSpot(center: THREE.Vector3, radius: number, count: number, index: number): ActivitySpot {
  const n = Math.max(1, count), angle = (index % n) / n * Math.PI * 2 + (n === 2 ? Math.PI / 2 : 0)
  const position = new THREE.Vector3(center.x + Math.sin(angle) * radius, center.y, center.z + Math.cos(angle) * radius)
  const inward = new THREE.Vector3(center.x - position.x, 0, center.z - position.z).normalize()
  return { position, facing: yawOf(inward), face: new THREE.Vector3(center.x, center.y + 1.5, center.z), kind: 'ring' }
}

/**
 * Precomputes every NPC's routine spots. NPCs sharing a target get distinct slots (in document order); 'chat' NPCs at the same
 * target form one conversation circle sized to the group and to the target's footprint.
 */
export function planRoutines(doc: ThreeSceneDocument): Map<string, RoutinePlan> {
  const plans = new Map<string, RoutinePlan>(), matrices = sceneMatrices(doc)
  const npcs = doc.nodes.filter((node) => node.behavior?.type === 'npc' && node.behavior.routine?.length)
  const users = new Map<string, string[]>(), talkers = new Map<string, string[]>()
  for (const npc of npcs) for (const step of npc.behavior!.routine!) {
    if (!step.target) continue
    const list = step.activity === 'chat' ? talkers : users, group = list.get(step.target) ?? []
    if (!group.includes(npc.id)) group.push(npc.id)
    list.set(step.target, group)
  }
  for (const npc of npcs) {
    const base = new THREE.Vector3().setFromMatrixPosition(matrices.get(npc.id)!)
    const steps = npc.behavior!.routine!.map((step) => {
      let spot: ActivitySpot | null = null
      if (step.target && step.activity === 'chat') {
        const group = talkers.get(step.target)!, frame = frameOf(doc, step.target, matrices)!
        const center = new THREE.Vector3().setFromMatrixPosition(frame.matrix)
        const radius = Math.max(0.55 + 0.2 * group.length, footprint(doc, frame, matrices) + 0.75)
        spot = chatSpot(center, radius, group.length, group.indexOf(npc.id))
      } else if (step.target && step.activity !== 'wander') spot = activitySpot(doc, step.target, (users.get(step.target) ?? []).indexOf(npc.id), { activity: step.activity, matrices })
      else if (!step.target && step.activity !== 'wander' && step.activity !== 'patrol') {
        const facing = forwardOf(npc, matrices)
        spot = { position: base.clone(), facing: yawOf(facing), face: base.clone().addScaledVector(facing, 3).setY(base.y + 1.5), kind: 'point' }
      }
      const patrol: [THREE.Vector3, THREE.Vector3] | null = step.activity === 'patrol' ? [base.clone(), spot?.position.clone() ?? patrolEnd(npc, base, matrices)] : null
      return { step, spot, patrol }
    })
    plans.set(npc.id, { npcId: npc.id, steps })
  }
  return plans
}

function forwardOf(npc: SceneNode, matrices: Map<string, THREE.Matrix4>) {
  const forward = new THREE.Vector3(0, 0, 1).transformDirection(matrices.get(npc.id)!).setY(0)
  return forward.lengthSq() < 1e-6 ? forward.set(0, 0, 1) : forward.normalize()
}
const patrolEnd = (npc: SceneNode, base: THREE.Vector3, matrices: Map<string, THREE.Matrix4>) =>
  base.clone().addScaledVector(forwardOf(npc, matrices), Math.min(8, Math.max(3, (npc.behavior?.range ?? 6) * 0.6)))

/** Current task of a planned NPC, or null (wander) outside every authored period. */
export function routineTask(plan: RoutinePlan | undefined, hour: number | null, elapsed: number, slice = ROUTINE_SLICE): NpcTask | null {
  if (!plan) return null
  const index = routineIndex(plan.steps.map((entry) => entry.step), hour, elapsed, slice)
  if (index < 0) return null
  const { step, spot, patrol } = plan.steps[index]
  return { key: `${index}:${step.activity}:${step.target ?? ''}`, activity: step.activity, spot, patrol }
}

/** Guards answer alarms: NPCs whose routine includes guarding or patrolling. */
export const isGuardPlan = (plan: RoutinePlan | undefined) => !!plan?.steps.some(({ step }) => step.activity === 'guard' || step.activity === 'patrol')

/** Every place a routine sends an NPC, so the navmesh focus box can include it. */
export const routinePoints = (plans: Map<string, RoutinePlan>) => [...plans.values()].flatMap((plan) => plan.steps.flatMap(({ spot, patrol }) => [...(spot ? [spot.position] : []), ...(patrol ?? [])]))
