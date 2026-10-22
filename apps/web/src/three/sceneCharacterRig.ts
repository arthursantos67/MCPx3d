import type { Object3D } from 'three'
import { characterRig, isCharacterType, type RigKind } from './sceneCharacters.ts'
import type { SceneNode, ThreeSceneDocument, Vector3Tuple } from './sceneDocument.ts'
import { hashNoise } from './sceneGeometrySpec.ts'
import type { PrefabPart } from './scenePrefabs.ts'

/**
 * `time` in seconds; `speed` in m/s; `attack` -1 when idle, otherwise the swing progress 0..1; `hurt` and `dead` are 0..1 envelopes.
 * `cycle` is the optional accumulated stride phase (cycles); integrating `strideRate` keeps the gait continuous when the speed changes.
 */
export interface LocomotionState { time: number; speed: number; airborne: boolean; attack: number; hurt: number; dead: number; talk?: boolean; cycle?: number }
/** One leg for foot IK: `hip` and `knee` are joint names; `offset` is the sole contact point in the knee frame (derived from sole/foot/hoof/paw parts). */
export interface RigFoot { hip: string; knee: string; offset: Vector3Tuple }
/** `feet` and `height` (rest height of the root joint) are filled by bindRigs/bindParts; bindings built elsewhere may omit them. */
export interface RigBinding { rootId: string; kind: RigKind; phase: number; size: number; joints: { nodeId: string; joint: string; base: Vector3Tuple; basePosition: Vector3Tuple }[]; feet?: RigFoot[]; height?: number }

export const rigJoints: Record<RigKind, readonly string[]> = {
  biped: ['j_hips', 'j_spine', 'j_neck', 'j_head', 'j_shoulderL', 'j_shoulderR', 'j_elbowL', 'j_elbowR', 'j_hipL', 'j_hipR', 'j_kneeL', 'j_kneeR'],
  quadruped: ['j_body', 'j_neck', 'j_head', 'j_tail', 'j_legFL', 'j_legFR', 'j_legBL', 'j_legBR', 'j_kneeFL', 'j_kneeFR', 'j_kneeBL', 'j_kneeBR'],
  arachnid: ['j_body', ...Array.from({ length: 8 }, (_, i) => `j_leg${i}`), ...Array.from({ length: 8 }, (_, i) => `j_knee${i}`)],
  flyer: ['j_body', 'j_neck', 'j_head', 'j_jaw', 'j_wingL', 'j_wingR', 'j_tail'],
  hover: ['j_body'],
}
export const rigRootJoint: Record<RigKind, string> = { biped: 'j_hips', quadruped: 'j_body', arachnid: 'j_body', flyer: 'j_body', hover: 'j_body' }
const rootJoint = rigRootJoint
/** Fraction of the root height lost when the character collapses. */
export const rigCollapse: Record<RigKind, number> = { biped: 0.86, quadruped: 0.65, arachnid: 0.45, flyer: 0.58, hover: 0.8 }
const collapse = rigCollapse
/** Metres per unit of authored bob: bipeds follow their real hip height (goblins, golems), the rest their size. */
export function rigUnit(binding: RigBinding): number {
  const root = binding.height ?? binding.joints.find((joint) => joint.joint === rootJoint[binding.kind])?.basePosition[1] ?? 0
  return binding.kind === 'biped' && root > 0 ? root / 0.95 : binding.size
}
const TAU = Math.PI * 2
const clamp01 = (v: number) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0))
const smooth = (a: number, b: number, x: number) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t) }
const BOUND = 179

/** Stride cycles per second for a gait at `speed` (m/s); flyers beat their wings once per cycle. */
export function strideRate(kind: RigKind, speed: number): number {
  const s = Math.max(0, Number.isFinite(speed) ? speed : 0)
  if (kind === 'arachnid') return Math.min(4, 0.9 + s * 0.6)
  if (kind === 'quadruped') return Math.min(3.2, 0.6 + s * 0.34)
  if (kind === 'flyer') return Math.min(1.6, 0.8 + s * 0.15)
  if (kind === 'hover') return 0.6
  return Math.min(2.6, 0.55 + s * 0.3)
}
interface Envelopes { c: number; w: number; run: number; idle: number; breath: number; look: number; air: number; wind: number; strike: number; hurt: number; dead: number; talk: number; t: number }
function envelopes(kind: RigKind, state: LocomotionState, phase: number): Envelopes {
  const t = Number.isFinite(state.time) ? state.time : 0, speed = Math.max(0, Number.isFinite(state.speed) ? state.speed : 0), air = state.airborne ? 1 : 0
  const dead = smooth(0, 1, state.dead), alive = 1 - dead, cycle = (Number.isFinite(state.cycle) ? state.cycle! : t * strideRate(kind, speed)) + phase
  const p = Number.isFinite(state.attack) && state.attack >= 0 ? clamp01(state.attack) : -1
  const wind = p < 0 ? 0 : smooth(0, 0.35, p) * (1 - smooth(0.35, 0.55, p)), strike = p < 0 ? 0 : smooth(0.35, 0.55, p) * (1 - smooth(0.7, 1, p))
  const w = smooth(0.05, 1.2, speed) * alive * (kind === 'biped' || kind === 'quadruped' || kind === 'arachnid' ? 1 - air : 1)
  return { c: TAU * cycle, w, run: smooth(2.2, 4.5, speed) * w, idle: (1 - smooth(0.05, 1.2, speed)) * alive, breath: Math.sin(TAU * (t / 4 + phase)), look: Math.sin(TAU * (t / 8 + phase * 0.5)),
    air: air * alive, wind: wind * alive, strike: strike * alive, hurt: clamp01(state.hurt) * alive, dead, talk: state.talk ? alive : 0, t }
}

function biped(joint: string, e: Envelopes): Vector3Tuple {
  const { c, w, run, idle, breath, look, air, wind, strike, hurt, dead, talk, t } = e
  const side = joint.endsWith('L') ? 1 : -1, legPhase = side > 0 ? c : c + Math.PI
  const stride = (22 + 16 * run) * w, armSwing = (18 + 22 * run) * w, gesture = talk * Math.sin(TAU * t * 1.3)
  switch (joint) {
    case 'j_hips': return [-85 * dead, -Math.sin(c) * 6 * w, Math.sin(c) * 3 * w]
    case 'j_spine': return [4 * w + 8 * run + breath * 1.5 * idle - 6 * wind + 14 * strike - 18 * hurt - 8 * dead, Math.sin(c) * 6 * w + 28 * wind - 22 * strike, breath * 0.8 * idle]
    case 'j_neck': return [-3 * w - 4 * run + 6 * dead, look * 6 * idle, 0]
    case 'j_head': return [breath * 2 * idle - 3 * run - 12 * hurt + 4 * talk * Math.sin(TAU * t * 2.2) + 10 * dead, look * 16 * idle + 10 * wind, Math.sin(TAU * t / 6) * 3 * idle]
    case 'j_jaw': return [6 * talk * (0.5 + 0.5 * Math.sin(TAU * t * 5)) + 18 * strike + 12 * dead, 0, 0]
    case 'j_shoulderL': case 'j_shoulderR': {
      const attack = side < 0 ? -165 * wind - 22 * strike : -18 * strike + 10 * wind, talking = side < 0 ? -30 * talk + gesture * 8 : 0
      return [Math.sin(legPhase) * armSwing + attack + talking - 15 * air + 10 * dead, 0, side * (breath * 1.5 * idle + 4 * run + 25 * air + 14 * hurt + 55 * dead + (side < 0 ? 16 * wind : 0))]
    }
    case 'j_elbowL': case 'j_elbowR': return [-(8 + 50 * run) * w - (6 + Math.sin(legPhase) * 4) * w - 30 * air - (side < 0 ? 55 * wind + 40 * talk : 0) + (side < 0 ? 6 * strike : 0) - 4 * idle, 0, 0]
    case 'j_hipL': case 'j_hipR': return [-Math.sin(legPhase) * stride - (side > 0 ? 38 : 12) * air + 6 * hurt - 10 * dead, 0, side * (2 * run + 4 * air)]
    case 'j_kneeL': case 'j_kneeR': return [(6 + (35 + 35 * run) * Math.max(0, Math.cos(legPhase))) * w + (side > 0 ? 60 : 30) * air + 25 * dead, 0, 0]
  }
  return [0, 0, 0]
}
function quadruped(joint: string, e: Envelopes): Vector3Tuple {
  const { c, w, run, idle, breath, look, air, wind, strike, hurt, dead, t } = e
  const leg = joint.slice(-2), front = leg[0] === 'F'
  const offset = { FL: 0, BR: 0.5 * (1 - run) + 0.6 * run, FR: 0.5 * (1 - run) + 0.1 * run, BL: 0.5 }[leg] ?? 0
  const lp = c + offset * TAU, wag = Math.sin(TAU * t * 1.6)
  switch (joint) {
    case 'j_body': return [Math.sin(2 * c) * 2 * w + Math.sin(c) * 5 * run - 8 * wind + 10 * strike + 6 * hurt, Math.sin(c) * 2 * w, Math.sin(c) * 2 * w + 80 * dead + Math.sin(t * 40) * 4 * hurt]
    case 'j_neck': return [Math.sin(2 * c) * 4 * w + breath * 2 * idle - 14 * wind + 12 * strike - 14 * hurt + 20 * dead, look * 12 * idle, 0]
    case 'j_head': return [-Math.sin(2 * c) * 3 * w + breath * 2 * idle + 18 * strike - 10 * hurt, look * 18 * idle, Math.sin(TAU * t / 5) * 4 * idle]
    case 'j_jaw': return [6 * run * (0.5 + 0.5 * Math.sin(2 * c)) + 30 * wind + 10 * strike + 15 * dead, 0, 0]
    case 'j_tail': return [-12 * run - 10 * idle * breath + 10 * dead, (wag * 12 * idle + Math.sin(c) * 6 * w) * (1 - dead), 0]
    case 'j_legFL': case 'j_legFR': case 'j_legBL': case 'j_legBR':
      return [-Math.sin(lp) * (20 + 18 * run) * w + (front ? -30 * wind - 25 * strike - 30 * air : 10 * wind + 35 * air), 0, 0]
    case 'j_kneeFL': case 'j_kneeFR': case 'j_kneeBL': case 'j_kneeBR':
      return [(4 + (30 + 25 * run) * Math.max(0, Math.cos(lp))) * w + (front ? 25 * wind + 55 * air : 45 * air) + 25 * dead, 0, 0]
  }
  return [0, 0, 0]
}
function arachnid(joint: string, e: Envelopes): Vector3Tuple {
  const { c, w, run, idle, breath, air, wind, strike, hurt, dead, t } = e
  if (joint === 'j_body') return [-14 * wind + 12 * strike + breath * 1.5 * idle, Math.sin(c) * 3 * w, Math.sin(2 * c) * 2 * w + Math.sin(t * 45) * 5 * hurt]
  const leg = /^j_(leg|knee)(\d)$/.exec(joint)
  if (!leg) return [0, 0, 0]
  const index = Number(leg[2]), left = index < 4, pair = index % 4, set = (pair + (left ? 0 : 1)) % 2
  const lp = c + set * Math.PI, front = pair === 0, twitch = Math.sin(TAU * t * 0.7 + index * 1.7) * 2 * idle
  const attack = front ? 50 * wind - 10 * strike : 0
  if (leg[1] === 'leg') return [0, (left ? -1 : 1) * Math.sin(lp) * (14 + 10 * run) * w, Math.max(0, Math.cos(lp)) * 20 * w + twitch + attack + 18 * air - 10 * dead + 6 * hurt]
  return [0, 0, -Math.max(0, Math.cos(lp)) * 12 * w - (front ? 25 * wind : 0) - 10 * air - 80 * dead]
}
function flyer(joint: string, e: Envelopes): Vector3Tuple {
  const { c, w, run, idle, breath, look, air, wind, strike, hurt, dead, t } = e
  const flight = Math.max(air, smooth(0.5, 3, w * 4)), beat = Math.sin(c), side = joint.endsWith('L') ? 1 : -1
  const flap = beat * (14 + 24 * Math.max(run, 0.4 * air)) * flight
  switch (joint) {
    case 'j_body': return [-6 * wind + 8 * strike + 4 * hurt + 8 * run * air, 0, Math.sin(TAU * t / 7) * 4 * air + 22 * dead]
    case 'j_neck': return [Math.sin(TAU * t / 4) * 4 + breath * 2 * idle - 24 * wind + 26 * strike - 16 * hurt + 35 * dead, look * 10 * idle, Math.sin(TAU * t / 5) * 4 * (1 - dead)]
    case 'j_head': return [-8 * wind + 12 * strike - 8 * hurt + 10 * dead, look * 14 * idle, 0]
    case 'j_jaw': return [3 + 3 * breath * idle + 30 * wind + 40 * strike + 10 * hurt + 20 * dead, 0, 0]
    case 'j_wingL': case 'j_wingR': return [0, side * (38 * (1 - flight) * (1 - dead) - 6 * flap / 30), side * (flap - 22 * (1 - flight) + 15 * wind - 30 * dead + 8 * breath * idle * (1 - flight))]
    case 'j_tail': return [Math.sin(TAU * t / 3) * 3 + 10 * dead, Math.sin(TAU * t * 0.4) * (10 + 6 * w) * (1 - dead), 0]
    case 'j_tail2': return [Math.sin(TAU * t / 3 - 1) * 4, Math.sin(TAU * t * 0.4 - 1) * (14 + 8 * w) * (1 - dead), 0]
  }
  if (/^j_leg[FB][LR]$/.test(joint)) return [-Math.sin(c + (joint.endsWith('FL') || joint.endsWith('BR') ? 0 : Math.PI)) * 18 * w * (1 - air) + (joint[5] === 'B' ? 55 : 35) * air + (joint[5] === 'B' ? 75 : -75) * dead, 0, 0]
  if (/^j_knee[FB][LR]$/.test(joint)) return [(5 + 25 * Math.max(0, Math.cos(c))) * w * (1 - air) + 60 * air, 0, 0]
  return [0, 0, 0]
}
function hover(joint: string, e: Envelopes, speed: number): Vector3Tuple {
  const { wind, strike, hurt, dead, t, idle } = e, tilt = smooth(0, 4, speed) * (1 - dead)
  if (joint === 'j_body') return [10 * tilt - 6 * wind - 12 * strike + 12 * dead, Math.sin(TAU * t / 9) * 6 * idle, Math.sin(TAU * t * 0.37) * 3 + Math.sin(t * 40) * 12 * hurt + 18 * dead]
  if (joint.startsWith('j_rotor')) return [6 * tilt, 0, Math.sin(TAU * t * 0.5 + Number(joint.slice(7))) * 3]
  return [0, 0, 0]
}
/** Pure: delta Euler rotation in degrees [x, y, z] for one joint; `phase` (cycles) desynchronises crowds. */
export function rigPose(kind: RigKind, joint: string, state: LocomotionState, phase = 0): Vector3Tuple {
  const e = envelopes(kind, state, phase)
  const pose = kind === 'biped' ? biped(joint, e) : kind === 'quadruped' ? quadruped(joint, e) : kind === 'arachnid' ? arachnid(joint, e) : kind === 'flyer' ? flyer(joint, e) : hover(joint, e, Math.max(0, state.speed || 0))
  return pose.map((v) => Number.isFinite(v) ? Math.max(-BOUND, Math.min(BOUND, v)) : 0) as Vector3Tuple
}
/** Vertical offset (metres at size 1) of the root joint: step bounce, breathing, hover bob and wingbeat lift. */
export function rigBob(kind: RigKind, state: LocomotionState, phase = 0): number {
  const e = envelopes(kind, state, phase), { c, w, run, idle, breath, air, t } = e, alive = 1 - e.dead
  const value = kind === 'biped' ? (0.015 + 0.03 * run) * w * Math.cos(2 * c) + 0.004 * breath * idle + 0.05 * air
    : kind === 'quadruped' ? (0.02 + 0.05 * run) * w * Math.cos(2 * c) + 0.006 * breath * idle
      : kind === 'arachnid' ? 0.015 * w * Math.cos(2 * c) + 0.008 * breath * idle
        : kind === 'flyer' ? (0.12 * Math.sin(c - 1.2) * Math.max(air, w) + 0.02 * breath * idle) * alive
          : (0.06 * Math.sin(TAU * t * 0.6) + 0.015 * Math.sin(TAU * t * 1.7)) * alive
  return Number.isFinite(value) ? Math.max(-0.5, Math.min(0.5, value)) : 0
}

const seedPhase = (id: string, seed: number) => { let h = seed | 0; for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619); return hashNoise(h, seed, 811) }
interface RigPiece { id: string; parentId: string | null; part: string; group: boolean; position: Vector3Tuple; rotation: Vector3Tuple; dimensions: Vector3Tuple }
const FOOT_PART = /^(sole|foot|hoof|paw)/
/** Lowest point of a part's rotated unit box, in its parent's frame (Euler XYZ, degrees). */
function bottom(piece: RigPiece): Vector3Tuple {
  const [x, y, z] = piece.rotation.map((v) => v * Math.PI / 180), [s1, c1, s2, c2, s3, c3] = [Math.sin(x), Math.cos(x), Math.sin(y), Math.cos(y), Math.sin(z), Math.cos(z)]
  const row = [s1 * s2 * c3 + c1 * s3, c1 * c3 - s1 * s2 * s3, -s1 * c2], [w, h, d] = piece.dimensions
  return [piece.position[0], piece.position[1] - (Math.abs(row[0]) * w + Math.abs(row[1]) * h + Math.abs(row[2]) * d) / 2, piece.position[2]]
}
function rigBinding(rootId: string, kind: RigKind, phase: number, size: number, pieces: RigPiece[]): RigBinding {
  const joints: RigBinding['joints'] = pieces.filter((piece) => piece.group && piece.part.startsWith('j_')).map((piece) => ({ nodeId: piece.id, joint: piece.part, base: [...piece.rotation], basePosition: [...piece.position] }))
  const byNode = new Map(joints.map((joint) => [joint.nodeId, joint])), feet: RigFoot[] = []
  if (kind !== 'arachnid' && kind !== 'hover') for (const knee of joints) {
    const leg = /^j_knee(.*)$/.exec(knee.joint)?.[1]
    if (!leg) continue
    const hip = joints.find((joint) => joint.joint === (kind === 'biped' ? `j_hip${leg}` : `j_leg${leg}`)), points = pieces.filter((piece) => piece.parentId === knee.nodeId && !byNode.has(piece.id) && FOOT_PART.test(piece.part)).map(bottom)
    if (hip && points.length) feet.push({ hip: hip.joint, knee: knee.joint, offset: points.reduce((low, point) => point[1] < low[1] ? point : low) })
  }
  return { rootId, kind, phase, size, joints, feet, height: joints.find((joint) => joint.joint === rootJoint[kind])?.basePosition[1] ?? 0 }
}
/** Finds character prefab groups (node.asset?.type is a character) and their descendant joint nodes (assetPart starting with 'j_'). */
export function bindRigs(doc: ThreeSceneDocument): RigBinding[] {
  const children = new Map<string, SceneNode[]>()
  for (const node of doc.nodes) if (node.parentId) children.set(node.parentId, [...children.get(node.parentId) ?? [], node])
  const bindings: RigBinding[] = []
  for (const root of doc.nodes) {
    if (!root.asset || !isCharacterType(root.asset.type)) continue
    const pieces: RigPiece[] = [], stack = [...children.get(root.id) ?? []]
    while (stack.length) {
      const node = stack.pop()!
      if (node.asset && isCharacterType(node.asset.type)) continue
      if (node.assetPart) pieces.push({ id: node.id, parentId: node.parentId, part: node.assetPart, group: node.kind === 'group', position: node.position, rotation: node.rotation, dimensions: node.dimensions })
      stack.push(...children.get(node.id) ?? [])
    }
    bindings.push(rigBinding(root.id, characterRig[root.asset.type], seedPhase(root.id, root.asset.seed), root.asset.size, pieces))
  }
  return bindings
}
/** Binding for parts that are not in a document (the player avatar); `nodeId` maps a part id to its holder id. */
export function bindParts(rootId: string, kind: RigKind, parts: PrefabPart[], size = 1, nodeId = (id: string) => id): RigBinding {
  return rigBinding(rootId, kind, 0, size, parts.map((part) => ({ id: nodeId(part.id), parentId: part.parentId ? nodeId(part.parentId) : null, part: part.id, group: part.kind === 'group',
    position: part.position, rotation: part.rotation ?? [0, 0, 0], dimensions: part.dimensions })))
}
const RAD = Math.PI / 180
/** Applies the pose to holders (rotation in radians, XYZ order); never mutates the document. */
export function applyRig(binding: RigBinding, holders: Map<string, Object3D>, state: LocomotionState): void {
  const root = rootJoint[binding.kind], dead = smooth(0, 1, state.dead)
  for (const joint of binding.joints) {
    const holder = holders.get(joint.nodeId)
    if (!holder) continue
    const delta = rigPose(binding.kind, joint.joint, state, binding.phase)
    holder.rotation.set((joint.base[0] + delta[0]) * RAD, (joint.base[1] + delta[1]) * RAD, (joint.base[2] + delta[2]) * RAD)
    const [x, y, z] = joint.basePosition
    holder.position.set(x, joint.joint === root ? y + rigBob(binding.kind, state, binding.phase) * binding.size - y * collapse[binding.kind] * dead : y, z)
  }
}
