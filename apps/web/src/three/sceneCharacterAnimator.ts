import type { Object3D } from 'three'
import type { RigKind } from './sceneCharacters.ts'
import type { Vector3Tuple } from './sceneDocument.ts'
import { hashNoise } from './sceneGeometrySpec.ts'
import type { FaceState } from './sceneRuntimeTypes.ts'
import { rigBob, rigCollapse, rigJoints, rigPose, rigRootJoint, rigUnit, strideRate, type RigBinding } from './sceneCharacterRig.ts'

export type AnimState = 'locomotion' | 'jump' | 'fall' | 'land' | 'attack' | 'dodge' | 'hurt' | 'death' | 'interact' | 'talk' | 'activity'
export type AnimActivity = 'sit' | 'work' | 'sleep' | 'chat' | 'perform' | 'guard'
export type AnimMood = 'calm' | 'happy' | 'angry' | 'afraid'
/** Events fired on the frame they happen, for footstep sounds, dust and hit timing. */
export type AnimEvent = 'footL' | 'footR' | 'jump' | 'land' | 'swing' | 'impact' | 'dodge' | 'hurt' | 'death' | 'bodyfall' | 'interact' | 'wave'
/**
 * One frame of intent. `speed` is the horizontal speed (m/s) and `verticalSpeed` the vertical one; `attack`, `dodge`, `hurt`, `interact` and `wave`
 * trigger on their rising edge (the frame they become set), so holding them does not repeat the action. `dead` is terminal.
 */
export interface AnimatorInput {
  dt: number; time: number; speed: number; grounded: boolean; verticalSpeed: number; dead: boolean; talk: boolean
  attack?: 'light' | 'heavy' | null; dodge?: boolean; hurt?: boolean; interact?: boolean; wave?: boolean; crouch?: boolean
  activity?: AnimActivity | null; mood?: AnimMood
}
/**
 * `joints`: delta Euler degrees added to each joint's rest rotation. `bob` metres (per rig unit) on the root joint; `collapse` 0..1 lowers the root as in a fall
 * (death, lying asleep); `seat` 0..1 lowers a biped's pelvis onto a seat of 0.45 m × size. `footIK` and `look` are suggested weights for solveFootIK/solveLookAt.
 */
export interface AnimatorPose {
  state: AnimState; joints: Map<string, Vector3Tuple>; bob: number; collapse: number; face: FaceState; combo: number; events: string[]
  seat: number; footIK: number; look: number
}
type V = Vector3Tuple
type Joints = Record<string, V>
interface Frame { joints: Joints; bob: number; collapse: number; seat: number }
interface Swing { a: number; s: number; r: number; windup: Joints; strike: Joints; bobW: number; bobS: number }
/** Plain mutable data: updateAnimator is deterministic given the same sequence of inputs. */
export interface Animator {
  kind: RigKind; phase: number; seed: number; joints: readonly string[]
  state: AnimState; time: number; clock: number; activity: AnimActivity | null
  from: Frame | null; fade: number; span: number; last: Frame
  cycle: number; speed: number; crouch: number; flight: number; airTime: number; fallSpeed: number; landing: number
  combo: number; comboUntil: number; heavy: boolean; swing: Swing | null
  roll: boolean; dodges: number; hurtAt: number; hurts: number; hurtLevel: number; hurtSide: number; waveAt: number; deathSide: number; fell: boolean
  fidgetAt: number; fidgetEnd: number; fidgetKind: number; fidgets: number; nextFidget: number
  blinkAt: number; nextBlink: number; blinks: number; gazeAt: number; gazes: number; gaze: [number, number]
  face: FaceState; footIK: number; look: number
  previous: { attack: boolean; dodge: boolean; hurt: boolean; interact: boolean; wave: boolean }
}

const TAU = Math.PI * 2
const fin = (v: number | undefined, fallback = 0) => typeof v === 'number' && Number.isFinite(v) ? v : fallback
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
const clamp01 = (v: number) => clamp(fin(v), 0, 1)
const smooth = (a: number, b: number, x: number) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t) }
const ease = (t: number) => { const x = clamp01(t); return x * x * (3 - 2 * x) }
const bump = (t: number, a: number, b: number, c: number, d: number) => smooth(a, b, t) * (1 - smooth(c, d, t))
const mix = (a: number, b: number, t: number) => a + (b - a) * t
const approach = (value: number, target: number, rate: number, dt: number) => value + (target - value) * (1 - Math.exp(-rate * dt))
const wrap = (deg: number) => deg - 360 * Math.round(deg / 360)
const BOUND = 179

export const animatorJoints: Record<RigKind, readonly string[]> = {
  biped: [...rigJoints.biped, 'j_jaw'],
  quadruped: [...rigJoints.quadruped, 'j_jaw'],
  arachnid: rigJoints.arachnid,
  flyer: [...rigJoints.flyer, 'j_tail2', 'j_legFL', 'j_legFR', 'j_legBL', 'j_legBR', 'j_kneeFL', 'j_kneeFR', 'j_kneeBL', 'j_kneeBR'],
  hover: ['j_body', 'j_rotor0', 'j_rotor1', 'j_rotor2', 'j_rotor3'],
}
const aerial = (kind: RigKind) => kind === 'flyer' || kind === 'hover'
const fadeTime: Record<AnimState, number> = { locomotion: 0.22, jump: 0.1, fall: 0.2, land: 0.1, attack: 0.1, dodge: 0.1, hurt: 0.15, death: 0.25, interact: 0.18, talk: 0.25, activity: 0.3 }

export function createAnimator(kind: RigKind, phase: number, seed = Math.floor(fin(phase) * 2 ** 31)): Animator {
  const s = Math.abs(Math.floor(fin(seed))) % 2147483647, r = (k: number) => hashNoise(s, k, 9173), joints = animatorJoints[kind]
  return { kind, phase: fin(phase), seed: s, joints, state: 'locomotion', time: 0, clock: 0, activity: null, from: null, fade: 1, span: 0.2,
    last: { joints: Object.fromEntries(joints.map((joint) => [joint, [0, 0, 0] as V])), bob: 0, collapse: 0, seat: 0 },
    cycle: 0, speed: 0, crouch: 0, flight: 0, airTime: 0, fallSpeed: 0, landing: 0, combo: 0, comboUntil: -1, heavy: false, swing: null,
    roll: false, dodges: 0, hurtAt: -1e9, hurts: 0, hurtLevel: 0, hurtSide: 1, waveAt: -1e9, deathSide: r(1) < 0.5 ? -1 : 1, fell: false,
    fidgetAt: -1e9, fidgetEnd: -1e9, fidgetKind: 0, fidgets: 0, nextFidget: 2 + 5 * r(2),
    blinkAt: -1e9, nextBlink: 0.5 + 3 * r(3), blinks: 0, gazeAt: 0, gazes: 0, gaze: [0, 0],
    face: { blink: 0, jaw: 0, brow: 0, smile: 0.1 * r(4), gaze: [0, 0] }, footIK: 1, look: 1,
    previous: { attack: false, dodge: false, hurt: false, interact: false, wave: false } }
}
/** Animator for a bound character, desynchronised by the binding's phase. */
export const animatorForBinding = (binding: RigBinding) => createAnimator(binding.kind, binding.phase)

const blank = (joints: readonly string[]): Joints => Object.fromEntries(joints.map((joint) => [joint, [0, 0, 0] as V]))
function add(p: Joints, joint: string, x: number, y = 0, z = 0, w = 1) {
  const v = p[joint] ?? (p[joint] = [0, 0, 0])
  v[0] += x * w; v[1] += y * w; v[2] += z * w
}
function addAll(p: Joints, q: Joints, w: number) { if (w) for (const joint in q) add(p, joint, q[joint][0], q[joint][1], q[joint][2], w) }
function blendTo(p: Joints, joint: string, target: V, w: number) {
  const v = p[joint] ?? (p[joint] = [0, 0, 0])
  for (let i = 0; i < 3; i++) v[i] = mix(v[i], target[i], w)
}
const sides = [['L', 1], ['R', -1]] as const
const r3 = (a: Animator, k: number, j = 0) => hashNoise(a.seed + j * 7919, k, 5431)

/** Builds a joint map from a compact literal; biped symmetric entries use `L`/`R` names directly. */
const J = (entries: Record<string, V>): Joints => entries

function swingFor(kind: RigKind, combo: number, heavy: boolean): Swing {
  const S = (a: number, s: number, r: number, windup: Joints, strike: Joints, bobW = 0, bobS = 0): Swing => ({ a, s, r, windup, strike, bobW, bobS })
  if (kind === 'biped') {
    if (heavy) return S(0.45, 0.12, 0.45,
      J({ j_shoulderR: [-170, 0, -10], j_shoulderL: [-160, 0, 10], j_elbowR: [-55, 0, 0], j_elbowL: [-55, 0, 0], j_spine: [-16, 0, 0], j_neck: [-5, 0, 0], j_head: [-10, 0, 0], j_hipL: [-12, 0, 0], j_kneeL: [14, 0, 0] }),
      J({ j_shoulderR: [-45, 0, -8], j_shoulderL: [-45, 0, 8], j_elbowR: [-10, 0, 0], j_elbowL: [-10, 0, 0], j_spine: [32, 0, 0], j_head: [12, 0, 0], j_hipL: [-30, 0, 0], j_kneeL: [38, 0, 0], j_kneeR: [22, 0, 0] }), 0.02, -0.12)
    const guard = { j_shoulderL: [-30, 0, 10] as V, j_elbowL: [-70, 0, 0] as V }
    if (combo === 1) return S(0.12, 0.1, 0.28,
      J({ ...guard, j_shoulderR: [0, -45, -85], j_elbowR: [-50, 0, 0], j_spine: [0, -30, 0], j_hips: [0, -10, 0], j_head: [0, 10, 0] }),
      J({ ...guard, j_shoulderR: [0, 115, -80], j_elbowR: [-15, 0, 0], j_spine: [6, 35, 0], j_hips: [0, 12, 0], j_head: [0, -15, 0] }))
    if (combo === 2) return S(0.1, 0.1, 0.3,
      J({ ...guard, j_shoulderR: [-150, 0, 30], j_elbowR: [-80, 0, 0], j_spine: [-8, 25, 0], j_hips: [0, 8, 0] }),
      J({ ...guard, j_shoulderR: [-35, 0, -45], j_elbowR: [-10, 0, 0], j_spine: [14, -30, 0], j_hips: [0, -10, 0], j_kneeR: [12, 0, 0] }))
    return S(0.14, 0.1, 0.36,
      J({ ...guard, j_shoulderR: [15, 0, -20], j_elbowR: [-105, 0, 0], j_spine: [0, -28, 0], j_hipR: [6, 0, 0] }),
      J({ ...guard, j_shoulderR: [-85, 0, -5], j_elbowR: [-4, 0, 0], j_spine: [12, 22, 0], j_head: [-6, 0, 0], j_hipL: [-35, 0, 0], j_kneeL: [40, 0, 0], j_hipR: [18, 0, 0], j_kneeR: [10, 0, 0] }), 0, -0.06)
  }
  if (kind === 'quadruped') {
    if (heavy) return S(0.4, 0.14, 0.45,
      J({ j_body: [-14, 0, 0], j_legBL: [25, 0, 0], j_legBR: [25, 0, 0], j_kneeBL: [45, 0, 0], j_kneeBR: [45, 0, 0], j_legFL: [-10, 0, 0], j_legFR: [-10, 0, 0], j_neck: [-10, 0, 0], j_jaw: [20, 0, 0] }),
      J({ j_body: [-18, 0, 0], j_legFL: [-55, 0, 0], j_legFR: [-55, 0, 0], j_kneeFL: [20, 0, 0], j_kneeFR: [20, 0, 0], j_legBL: [35, 0, 0], j_legBR: [35, 0, 0], j_neck: [20, 0, 0], j_jaw: [40, 0, 0] }), -0.12, 0.12)
    const yaw = combo === 2 ? 18 : 0
    if (combo < 3) return S(0.14, 0.1, 0.3,
      J({ j_neck: [-16, yaw, 0], j_head: [-12, 0, 0], j_jaw: [28, 0, 0], j_body: [-6, 0, 0], j_legBL: [10, 0, 0], j_legBR: [10, 0, 0] }),
      J({ j_neck: [22, -yaw * 1.1, 0], j_head: [14, 0, 0], j_jaw: [2, 0, 0], j_body: [8, 0, 0], j_legFL: [-20, 0, 0], j_legFR: [-20, 0, 0] }), -0.03, 0.02)
    return S(0.18, 0.12, 0.38,
      J({ j_body: [-10, 0, 0], j_kneeBL: [35, 0, 0], j_kneeBR: [35, 0, 0], j_jaw: [25, 0, 0] }),
      J({ j_body: [10, 0, 0], j_legFL: [-45, 0, 0], j_legFR: [-45, 0, 0], j_kneeFL: [10, 0, 0], j_kneeFR: [10, 0, 0], j_legBL: [30, 0, 0], j_legBR: [30, 0, 0], j_neck: [18, 0, 0], j_jaw: [8, 0, 0] }), -0.08, 0.03)
  }
  if (kind === 'arachnid') {
    if (heavy) return S(0.4, 0.12, 0.4, J({ j_body: [-28, 0, 0], j_leg0: [0, 0, 70], j_leg4: [0, 0, 70], j_knee0: [0, 0, -30], j_knee4: [0, 0, -30] }),
      J({ j_body: [18, 0, 0], j_leg0: [0, 0, -15], j_leg4: [0, 0, -15] }), 0.05, -0.05)
    const legs = combo === 1 ? ['0'] : combo === 2 ? ['4'] : ['0', '4']
    const windup: Joints = { j_body: [-10, 0, 0] }, strike: Joints = { j_body: [combo === 3 ? 14 : 8, 0, 0] }
    for (const leg of legs) { windup[`j_leg${leg}`] = [0, 0, 55]; windup[`j_knee${leg}`] = [0, 0, -30]; strike[`j_leg${leg}`] = [0, 0, -12] }
    return S(0.12, 0.1, 0.28, windup, strike)
  }
  if (kind === 'flyer') {
    if (heavy) return S(0.5, 0.2, 0.6, J({ j_neck: [-38, 0, 0], j_head: [-20, 0, 0], j_jaw: [12, 0, 0], j_body: [-10, 0, 0], j_wingL: [0, 0, -20], j_wingR: [0, 0, 20] }),
      J({ j_neck: [16, 0, 0], j_head: [6, 0, 0], j_jaw: [55, 0, 0], j_body: [6, 0, 0] }))
    if (combo === 1) return S(0.16, 0.12, 0.32, J({ j_neck: [-24, 0, 0], j_head: [-8, 0, 0], j_jaw: [30, 0, 0] }), J({ j_neck: [26, 0, 0], j_head: [12, 0, 0], j_jaw: [5, 0, 0] }))
    if (combo === 2) return S(0.16, 0.12, 0.34, J({ j_legFL: [-70, 0, 0], j_legFR: [-70, 0, 0], j_kneeFL: [40, 0, 0], j_kneeFR: [40, 0, 0], j_body: [-8, 0, 0] }),
      J({ j_legFL: [10, 0, 0], j_legFR: [10, 0, 0], j_body: [6, 0, 0] }))
    return S(0.2, 0.12, 0.4, J({ j_tail: [0, -45, 0], j_tail2: [0, -30, 0], j_body: [0, 10, 0] }), J({ j_tail: [0, 55, 0], j_tail2: [0, 40, 0], j_body: [0, -12, 0] }))
  }
  if (heavy) return S(0.4, 0.14, 0.4, J({ j_body: [-18, 0, 0] }), J({ j_body: [28, 0, 0] }), 0.1, -0.05)
  return S(0.08, 0.06, 0.25, J({ j_body: [-4, 0, 0] }), J({ j_body: [-20, 0, 0] }))
}
function swingPose(sw: Swing, t: number): { joints: Joints; bob: number } {
  const joints: Joints = {}
  let bob: number
  if (t < sw.a) { const k = ease(t / sw.a); addAll(joints, sw.windup, k); bob = sw.bobW * k }
  else if (t < sw.a + sw.s) { const k = ease((t - sw.a) / sw.s); addAll(joints, sw.windup, 1 - k); addAll(joints, sw.strike, k); bob = mix(sw.bobW, sw.bobS, k) }
  else { const k = 1 - ease((t - sw.a - sw.s) / sw.r); addAll(joints, sw.strike, k); bob = sw.bobS * k }
  return { joints, bob }
}
const swingTotal = (sw: Swing) => sw.a + sw.s + sw.r
const UPPER = /^j_(spine|neck|head|shoulder|elbow|jaw)/

function locomotion(a: Animator, input: AnimatorInput): Frame {
  const kind = a.kind, flying = a.flight > 0.5, joints = blank(a.joints), f = a.flight
  const state = { time: fin(input.time), speed: a.speed, airborne: false, attack: -1, hurt: 0, dead: 0, cycle: a.cycle }, aloft = { ...state, airborne: true }
  for (const joint of a.joints) {
    const ground = f < 1 ? rigPose(kind, joint, state, a.phase) : null, sky = f > 0 ? rigPose(kind, joint, aloft, a.phase) : null
    joints[joint] = ground && sky ? [mix(ground[0], sky[0], f), mix(ground[1], sky[1], f), mix(ground[2], sky[2], f)] : (ground ?? sky)!
  }
  let bob = f <= 0 ? rigBob(kind, state, a.phase) : f >= 1 ? rigBob(kind, aloft, a.phase) : mix(rigBob(kind, state, a.phase), rigBob(kind, aloft, a.phase), f)
  const idle = (1 - smooth(0.05, 0.8, a.speed)) * (flying && kind !== 'hover' ? 0.5 : 1), fid = fidget(a)
  if (fid.w > 0 && idle > 0) bob += fidgetPose(a, joints, fid.kind, fid.u, fid.w * idle)
  const c = a.crouch
  if (c > 0 && kind === 'biped') {
    for (const [s, side] of sides) { add(joints, `j_hip${s}`, -55, 0, 0, c); add(joints, `j_knee${s}`, 100, 0, 0, c); add(joints, `j_shoulder${s}`, -12, 0, side * 6, c); add(joints, `j_elbow${s}`, -25, 0, 0, c) }
    add(joints, 'j_spine', 22, 0, 0, c); add(joints, 'j_neck', -10, 0, 0, c); add(joints, 'j_head', -8, 0, 0, c); bob -= 0.3 * c
  } else if (c > 0 && kind === 'quadruped') {
    for (const leg of ['FL', 'FR', 'BL', 'BR']) { add(joints, `j_leg${leg}`, leg[0] === 'F' ? -15 : 15, 0, 0, c); add(joints, `j_knee${leg}`, 30, 0, 0, c) }
    add(joints, 'j_neck', 10, 0, 0, c); bob -= 0.12 * c
  }
  return { joints, bob, collapse: 0, seat: 0 }
}
function fidget(a: Animator): { w: number; kind: number; u: number } {
  if (a.clock > a.fidgetEnd) return { w: 0, kind: 0, u: 0 }
  const span = a.fidgetEnd - a.fidgetAt
  return { w: bump(a.clock, a.fidgetAt, a.fidgetAt + 0.45, a.fidgetEnd - 0.55, a.fidgetEnd), kind: a.fidgetKind, u: (a.clock - a.fidgetAt) / span }
}
/** Additive idle variation (look around, stretch, scratch, weight shift, check gear); returns extra bob. */
function fidgetPose(a: Animator, p: Joints, kind: number, u: number, w: number): number {
  const t = a.clock - a.fidgetAt, side = r3(a, a.fidgets, 2) < 0.5 ? 1 : -1
  if (a.kind === 'biped') {
    if (kind === 0) { add(p, 'j_head', -4, 50 * Math.sin(TAU * u) * side, 0, w); add(p, 'j_neck', 0, 15 * Math.sin(TAU * u) * side, 0, w); return 0 }
    if (kind === 1) {
      for (const [s, sd] of sides) { add(p, `j_shoulder${s}`, -150, 0, sd * 20, w); add(p, `j_elbow${s}`, -10, 0, 0, w) }
      add(p, 'j_spine', -12, 0, 0, w); add(p, 'j_head', -15, 0, 0, w); return 0.01 * w
    }
    if (kind === 2) { add(p, 'j_shoulderR', -130, 0, -35, w); add(p, 'j_elbowR', -120, 0, 8 * Math.sin(TAU * 6 * t), w); add(p, 'j_head', 10, 0, -8, w); return 0 }
    if (kind === 3) {
      add(p, 'j_hips', 0, 0, 5 * side, w); add(p, 'j_spine', 0, 0, -6 * side, w)
      for (const [s] of sides) add(p, `j_hip${s}`, 0, 0, -5 * side, w)
      add(p, side > 0 ? 'j_kneeR' : 'j_kneeL', 15, 0, 0, w); return -0.012 * w
    }
    add(p, 'j_shoulderL', -50, 0, 10, w); add(p, 'j_elbowL', -80, 0, 0, w); add(p, 'j_head', 28, 12, 0, w); add(p, 'j_spine', 8, 0, 0, w); return 0
  }
  if (a.kind === 'quadruped') {
    if (kind === 0 || kind === 4) { add(p, 'j_neck', 0, 25 * Math.sin(TAU * u) * side, 0, w); add(p, 'j_head', 0, 30 * Math.sin(TAU * u) * side, 0, w); return 0 }
    if (kind === 1) { add(p, 'j_neck', 35, 0, 0, w); add(p, 'j_head', 20 + 6 * Math.sin(TAU * 4 * t), 0, 0, w); return 0 }
    if (kind === 2) { add(p, 'j_head', 0, 0, 25 * Math.sin(TAU * 5 * t) * smooth(0, 0.2, u) * (1 - smooth(0.5, 0.7, u)), w); return 0 }
    add(p, 'j_tail', -15, 35 * Math.sin(TAU * 3 * t), 0, w); add(p, 'j_head', -6, 0, 0, w); return 0
  }
  if (a.kind === 'arachnid') { add(p, 'j_leg0', 0, 0, 30 + 12 * Math.sin(TAU * 3 * t), w); add(p, 'j_leg4', 0, 0, 30 - 12 * Math.sin(TAU * 3 * t), w); add(p, 'j_body', -6, 0, 0, w); return 0 }
  if (a.kind === 'flyer') {
    if (kind % 3 === 0) { add(p, 'j_neck', 0, 25 * Math.sin(TAU * u) * side, 0, w); add(p, 'j_head', 0, 20 * Math.sin(TAU * u) * side, 0, w); return 0 }
    if (kind % 3 === 1) { add(p, 'j_wingL', 0, -20, 40, w); add(p, 'j_wingR', 0, 20, -40, w); return 0 }
    add(p, 'j_jaw', 35, 0, 0, w); add(p, 'j_neck', -12, 0, 0, w); return 0
  }
  add(p, 'j_body', 0, 40 * Math.sin(TAU * u) * side, 0, w); return 0
}

function air(a: Animator, input: AnimatorInput): Frame {
  const joints = blank(a.joints), vy = fin(input.verticalSpeed), r = smooth(-2, 2, vy), f = 1 - r
  if (a.kind === 'biped') {
    add(joints, 'j_hipL', -48 * r - 22 * f); add(joints, 'j_kneeL', 75 * r + 30 * f); add(joints, 'j_hipR', -12 * r - 8 * f); add(joints, 'j_kneeR', 30 * r + 18 * f)
    add(joints, 'j_spine', 8 * r - 4 * f); add(joints, 'j_head', -6 * r + 12 * f)
    const flail = smooth(0.8, 1.6, a.airTime) * Math.sin(TAU * 2.2 * a.clock) * 18
    for (const [s, side] of sides) { add(joints, `j_shoulder${s}`, -40 * r - 25 * f + flail * side, 0, side * (20 * r + 55 * f)); add(joints, `j_elbow${s}`, -45 * r - 25 * f) }
  } else if (a.kind === 'quadruped') {
    for (const leg of ['FL', 'FR', 'BL', 'BR']) { const front = leg[0] === 'F'; add(joints, `j_leg${leg}`, front ? -35 * r - 10 * f : 35 * r + 5 * f); add(joints, `j_knee${leg}`, front ? 50 * r + 15 * f : 45 * r + 10 * f) }
    add(joints, 'j_body', -6 * r + 6 * f); add(joints, 'j_neck', -6 * r + 8 * f); add(joints, 'j_tail', -10, 0, 0)
  } else if (a.kind === 'arachnid') {
    for (let i = 0; i < 8; i++) { add(joints, `j_leg${i}`, 0, 0, 18 * r + 6 * f); add(joints, `j_knee${i}`, 0, 0, -10 * r - 20 * f) }
  } else return locomotion(a, input)
  if (a.state === 'jump') {
    const push = 1 - smooth(0, 0.15, a.time)
    if (push > 0) {
      const crouch = blank(a.joints)
      if (a.kind === 'biped') { for (const [s] of sides) { add(crouch, `j_hip${s}`, -30); add(crouch, `j_knee${s}`, 55); add(crouch, `j_shoulder${s}`, 20) } add(crouch, 'j_spine', 15) }
      else if (a.kind === 'quadruped') for (const leg of ['FL', 'FR', 'BL', 'BR']) add(crouch, `j_knee${leg}`, 40)
      for (const joint of a.joints) blendTo(joints, joint, crouch[joint], push)
      return { joints, bob: -0.1 * push, collapse: 0, seat: 0 }
    }
  }
  return { joints, bob: 0, collapse: 0, seat: 0 }
}

function landing(a: Animator, input: AnimatorInput): Frame {
  const frame = locomotion(a, input), c = a.landing * smooth(0, 0.05, a.time) * (1 - smooth(0.05, landTime(a), a.time)), p = frame.joints
  if (a.kind === 'biped') {
    for (const [s, side] of sides) { add(p, `j_hip${s}`, -40, 0, 0, c); add(p, `j_knee${s}`, 75, 0, 0, c); add(p, `j_shoulder${s}`, -15, 0, side * 10, c); add(p, `j_elbow${s}`, -20, 0, 0, c) }
    add(p, 'j_spine', 18, 0, 0, c); add(p, 'j_neck', -8, 0, 0, c); frame.bob -= 0.18 * c
  } else if (a.kind === 'quadruped') {
    for (const leg of ['FL', 'FR', 'BL', 'BR']) add(p, `j_knee${leg}`, 40, 0, 0, c)
    add(p, 'j_neck', 12, 0, 0, c); frame.bob -= 0.1 * c
  } else if (a.kind === 'arachnid') { for (let i = 0; i < 8; i++) add(p, `j_knee${i}`, 0, 0, 15, c); frame.bob -= 0.08 * c }
  return frame
}
const landTime = (a: Animator) => 0.16 + 0.3 * a.landing

function attackFrame(a: Animator, input: AnimatorInput): Frame {
  const frame = locomotion(a, input), sw = a.swing!, pose = swingPose(sw, a.time), walk = smooth(0.3, 1.5, a.speed), p = frame.joints
  if (a.kind === 'biped') for (const joint of a.joints) {
    if (UPPER.test(joint) && joint !== 'j_jaw') { const v = p[joint]; v[0] *= 0.25; v[1] *= 0.25 }
  }
  for (const joint in pose.joints) {
    const lower = a.kind === 'biped' && !UPPER.test(joint) && joint !== 'j_hips'
    add(p, joint, pose.joints[joint][0], pose.joints[joint][1], pose.joints[joint][2], lower ? 1 - walk : 1)
  }
  frame.bob += pose.bob * (1 - walk)
  return frame
}

const dodgeTime = (a: Animator) => a.roll ? 0.62 : a.kind === 'flyer' ? 0.5 : 0.38
function dodgeFrame(a: Animator, input: AnimatorInput): Frame {
  const u = a.time / dodgeTime(a), side = a.dodges % 2 ? 1 : -1
  if (a.kind === 'biped' && a.roll) {
    const joints = blank(a.joints), tuck = bump(u, 0, 0.25, 0.8, 1), spin = ease((a.time - 0.06) / 0.5)
    add(joints, 'j_hips', wrap(360 * spin))
    for (const [s, sd] of sides) { add(joints, `j_hip${s}`, -100 * tuck); add(joints, `j_knee${s}`, 120 * tuck); add(joints, `j_shoulder${s}`, -60 * tuck, 0, sd * 15 * tuck); add(joints, `j_elbow${s}`, -90 * tuck) }
    add(joints, 'j_spine', 40 * tuck); add(joints, 'j_neck', 20 * tuck); add(joints, 'j_head', 15 * tuck)
    return { joints, bob: -0.48 * Math.sin(Math.PI * spin) - 0.1 * tuck, collapse: 0, seat: 0 }
  }
  const frame = locomotion(a, input), p = frame.joints, e = bump(u, 0, 0.25, 0.55, 1), hop = Math.sin(Math.PI * clamp01(u))
  if (a.kind === 'biped') {
    add(p, 'j_hips', 0, 0, side * 18, e); add(p, 'j_spine', 10, 0, -side * 10, e)
    for (const [s, sd] of sides) { add(p, `j_hip${s}`, 0, 0, side * 12, e); add(p, `j_knee${s}`, 25, 0, 0, e); add(p, `j_shoulder${s}`, -10, 0, sd * 20, e) }
    frame.bob -= 0.12 * e
  } else if (a.kind === 'quadruped') {
    add(p, 'j_body', 0, 0, side * 18, e)
    for (const leg of ['FL', 'FR', 'BL', 'BR']) add(p, `j_leg${leg}`, leg[0] === 'F' ? -15 : 15, 0, 0, e)
    frame.bob += 0.12 * hop
  } else if (a.kind === 'arachnid') {
    for (let i = 0; i < 8; i++) add(p, `j_leg${i}`, 0, 0, 15, e)
    add(p, 'j_body', -8, 0, 0, e); frame.bob += 0.15 * hop
  } else if (a.kind === 'flyer') {
    add(p, 'j_body', 0, 0, side * 45, e); add(p, 'j_wingL', 0, 0, 25 * Math.sin(TAU * 3 * a.time), e); add(p, 'j_wingR', 0, 0, -25 * Math.sin(TAU * 3 * a.time), e)
  } else { add(p, 'j_body', 0, 0, side * 30, e); frame.bob += 0.05 * hop }
  return frame
}

function interactFrame(a: Animator, input: AnimatorInput): Frame {
  const frame = locomotion(a, input), p = frame.joints, e = bump(a.time, 0, 0.3, 0.6, 0.9)
  if (a.kind === 'biped') { add(p, 'j_shoulderR', -72, 8, 4, e); add(p, 'j_elbowR', -22, 0, 0, e); add(p, 'j_spine', 10, 0, 0, e); add(p, 'j_neck', 4, 0, 0, e); add(p, 'j_head', 14, 0, 0, e) }
  else if (a.kind === 'quadruped' || a.kind === 'flyer') { add(p, 'j_neck', 28, 0, 0, e); add(p, 'j_head', 18, 0, 0, e) }
  else add(p, 'j_body', 8, 0, 0, e)
  return frame
}

function deathFrame(a: Animator): Frame {
  const t = a.time, joints = blank(a.joints), u1 = smooth(0, 0.35, t), u2 = clamp01((t - 0.25) / 0.6) ** 2, side = a.deathSide
  const collapse = mix(0.22 * u1, 1, u2)
  if (a.kind === 'biped') {
    const back = side < 0
    add(joints, 'j_hips', back ? -85 * u2 : 80 * u2)
    for (const [s, sd] of sides) {
      add(joints, `j_hip${s}`, -40 * u1 * (1 - u2) - 8 * u2); add(joints, `j_knee${s}`, 70 * u1 * (1 - u2) + 20 * u2)
      add(joints, `j_shoulder${s}`, -10 * u1 + (back ? 15 : -40) * u2, 0, sd * (20 * u1 + 50 * u2)); add(joints, `j_elbow${s}`, -25 * u1 - 10 * u2)
    }
    add(joints, 'j_spine', 12 * u1 - (back ? 8 : 0) * u2); add(joints, 'j_neck', 10 * u1); add(joints, 'j_head', 18 * u1, side * 25 * u2); add(joints, 'j_jaw', 12 * u2)
    return { joints, bob: 0, collapse, seat: 0 }
  }
  if (a.kind === 'quadruped') {
    add(joints, 'j_body', 0, 0, side * 80 * u2)
    for (const leg of ['FL', 'FR', 'BL', 'BR']) { add(joints, `j_knee${leg}`, 40 * u1 * (1 - u2) + 25 * u2); add(joints, `j_leg${leg}`, (leg[0] === 'F' ? -10 : 10) * u2) }
    add(joints, 'j_neck', 20 * u2); add(joints, 'j_head', 10 * u2); add(joints, 'j_jaw', 15 * u2); add(joints, 'j_tail', 10 * u2)
    return { joints, bob: 0, collapse, seat: 0 }
  }
  if (a.kind === 'arachnid') {
    const u = smooth(0, 0.8, t)
    for (let i = 0; i < 8; i++) { add(joints, `j_leg${i}`, 0, 0, -10 * u); add(joints, `j_knee${i}`, 0, 0, -80 * u) }
    return { joints, bob: 0, collapse: u, seat: 0 }
  }
  if (a.kind === 'flyer') {
    add(joints, 'j_body', 0, 0, side * 22 * u2); add(joints, 'j_neck', 35 * u2); add(joints, 'j_head', 10 * u2); add(joints, 'j_jaw', 20 * u2)
    add(joints, 'j_wingL', 0, 0, -30 * u2); add(joints, 'j_wingR', 0, 0, 30 * u2); add(joints, 'j_tail', 10 * u2)
    for (const leg of ['FL', 'FR', 'BL', 'BR']) add(joints, `j_leg${leg}`, (leg[0] === 'B' ? 75 : -75) * u2)
    return { joints, bob: 0, collapse, seat: 0 }
  }
  add(joints, 'j_body', 12 * u2, 0, side * 18 * u2)
  return { joints, bob: 0, collapse: u2, seat: 0 }
}

/** Speaking rhythm: syllables of ~0.2 s with deterministic loudness and silent gaps between words. */
function syllable(a: Animator): number {
  const s = a.clock * 4.8, k = Math.floor(s), loud = r3(a, k, 11)
  return loud < 0.22 ? 0 : (0.3 + 0.6 * r3(a, k, 12)) * Math.sin(Math.PI * (s - k)) ** 0.8
}
function gestures(a: Animator, p: Joints, w: number) {
  if (a.kind !== 'biped' || !w) return
  const slot = Math.floor(a.clock / 2.4), kindOf = (i: number) => Math.floor(r3(a, i, 21) * 5), blend = smooth(0, 0.5, a.clock - slot * 2.4), beat = Math.sin(TAU * 2.1 * a.clock)
  const gesture = (g: number): Joints => {
    if (g === 0) return { j_shoulderL: [-35, 0, 18], j_shoulderR: [-35, 0, -18], j_elbowL: [-75 + 8 * beat, 0, 0], j_elbowR: [-75 - 8 * beat, 0, 0] }
    if (g === 1) return { j_shoulderR: [-80 + 5 * beat, 10, -5], j_elbowR: [-12, 0, 0], j_shoulderL: [-10, 0, 6], j_elbowL: [-20, 0, 0] }
    if (g === 2) return { j_shoulderR: [-40, 0, -12], j_elbowR: [-85 + 15 * beat, 0, 0], j_elbowL: [-15, 0, 0] }
    if (g === 3) return { j_shoulderL: [-20, 0, 25], j_shoulderR: [-20, 0, -25], j_elbowL: [-95, 0, 0], j_elbowR: [-95, 0, 0], j_head: [0, 0, 10], j_spine: [-4, 0, 0] }
    return { j_shoulderL: [-40, 0, -10], j_elbowL: [-115, 0, 0], j_shoulderR: [-15, 0, -8], j_elbowR: [-30 + 6 * beat, 0, 0] }
  }
  addAll(p, gesture(kindOf(slot - 1)), w * (1 - blend)); addAll(p, gesture(kindOf(slot)), w * blend)
  add(p, 'j_head', 4 * Math.sin(TAU * 1.3 * a.clock), 6 * Math.sin(TAU * 0.37 * a.clock), 0, w); add(p, 'j_spine', 2, 0, 0, w)
}
/** 0..1 share of a chat spent speaking, blended over 0.5 s between deterministic 3.5 s turns. */
function chatTurn(a: Animator): number {
  const slot = Math.floor(a.clock / 3.5), speaks = (i: number) => r3(a, i, 31) > 0.45 ? 1 : 0
  return mix(speaks(slot - 1), speaks(slot), smooth(0, 0.5, a.clock - slot * 3.5))
}
const speaking = (a: Animator) => a.state === 'talk' ? 1 : a.state === 'activity' && a.activity === 'chat' ? chatTurn(a) : 0

function talkFrame(a: Animator, input: AnimatorInput): Frame {
  const frame = locomotion(a, input)
  if (a.kind === 'biped') for (const joint of a.joints) if (/^j_(shoulder|elbow)/.test(joint)) { frame.joints[joint][0] *= 0.3; frame.joints[joint][2] *= 0.5 }
  gestures(a, frame.joints, 1)
  return frame
}

/** Smooth interpolation through [time, value] keys over 0..1. */
function curve(f: number, keys: [number, number][]): number {
  for (let i = 1; i < keys.length; i++) if (f <= keys[i][0]) return mix(keys[i - 1][1], keys[i][1], ease((f - keys[i - 1][0]) / (keys[i][0] - keys[i - 1][0])))
  return keys[keys.length - 1][1]
}
const variant = (a: Animator, k: number, n: number) => Math.floor(r3(a, k, 41) * n) % n
function activityFrame(a: Animator, input: AnimatorInput): Frame {
  const t = a.clock, kind = a.kind, activity = a.activity ?? 'guard', breath = Math.sin(TAU * (t / 4.5 + a.phase))
  if (kind !== 'biped' && kind !== 'quadruped') {
    const frame = locomotion(a, { ...input, speed: 0 })
    if (activity === 'sleep') {
      const p = frame.joints
      if (kind === 'arachnid') for (let i = 0; i < 8; i++) add(p, `j_knee${i}`, 0, 0, -45)
      if (kind === 'flyer') { add(p, 'j_neck', 30); add(p, 'j_wingL', 0, 0, -20); add(p, 'j_wingR', 0, 0, 20) }
      frame.collapse = kind === 'hover' ? 0 : 0.7
    } else if (activity === 'guard') add(frame.joints, kind === 'flyer' ? 'j_neck' : 'j_body', 0, 30 * Math.sin(TAU * t / 7 + a.phase), 0)
    return frame
  }
  const frame = locomotion(a, { ...input, speed: 0 }), p = frame.joints
  if (kind === 'quadruped') {
    if (activity === 'sit') {
      add(p, 'j_body', -22); add(p, 'j_legFL', 22); add(p, 'j_legFR', 22); add(p, 'j_legBL', 60); add(p, 'j_legBR', 60); add(p, 'j_kneeBL', 70); add(p, 'j_kneeBR', 70); add(p, 'j_tail', 10); frame.bob -= 0.18
    } else if (activity === 'sleep') {
      for (const leg of ['FL', 'FR', 'BL', 'BR']) { add(p, `j_leg${leg}`, leg[0] === 'F' ? -60 : 60); add(p, `j_knee${leg}`, leg[0] === 'F' ? 100 : 90) }
      add(p, 'j_neck', 35); add(p, 'j_head', 10); add(p, 'j_tail', 0, 40); add(p, 'j_body', 1.5 * breath); frame.collapse = 0.9
    } else if (activity === 'guard') { add(p, 'j_neck', -10, 25 * Math.sin(TAU * t / 7 + a.phase)); add(p, 'j_head', -5); add(p, 'j_tail', -15) }
    else if (activity === 'perform') { for (const leg of ['FL', 'FR']) add(p, `j_leg${leg}`, -35); add(p, 'j_body', 15); add(p, 'j_tail', -10, 30 * Math.sin(TAU * 3 * t)); frame.bob -= 0.06 }
    else { const graze = bump((t / 6 + a.phase) % 1, 0.05, 0.2, 0.7, 0.85); add(p, 'j_neck', 45 * graze); add(p, 'j_head', 25 * graze); add(p, 'j_jaw', 8 * graze * Math.max(0, Math.sin(TAU * 2.5 * t))) }
    return frame
  }
  const quiet = (joint: string, k: number) => { const v = p[joint]; v[0] *= k; v[1] *= k; v[2] *= k }
  for (const joint of a.joints) if (/^j_(shoulder|elbow|hip|knee)/.test(joint)) quiet(joint, 0.3)
  if (activity === 'sit' || (activity === 'sleep' && variant(a, 1, 2) === 1)) {
    for (const [s, side] of sides) { add(p, `j_hip${s}`, -88); add(p, `j_knee${s}`, 88); add(p, `j_shoulder${s}`, -38, 0, side * 6); add(p, `j_elbow${s}`, -58) }
    add(p, 'j_spine', 4 + 1.5 * breath); add(p, 'j_head', 0, 14 * Math.sin(TAU * t / 9 + a.phase))
    if (activity === 'sleep') { add(p, 'j_spine', 18); add(p, 'j_neck', 18); add(p, 'j_head', 25) }
    return { ...frame, bob: 0, seat: 1 }
  }
  if (activity === 'sleep') {
    add(p, 'j_hips', -88)
    for (const [s, side] of sides) { add(p, `j_knee${s}`, 8); add(p, `j_shoulder${s}`, 0, 0, side * 25); add(p, `j_elbow${s}`, -20) }
    add(p, 'j_spine', 2 * breath); add(p, 'j_head', -10, 20 * a.deathSide)
    return { ...frame, bob: 0, collapse: 1 }
  }
  if (activity === 'work') {
    const v = variant(a, 2, 3)
    if (v === 0) {
      const f = (t * 1.1) % 1
      add(p, 'j_shoulderR', curve(f, [[0, -40], [0.6, -120], [0.72, -30], [1, -40]]), 0, -8); add(p, 'j_elbowR', curve(f, [[0, -70], [0.6, -95], [0.72, -30], [1, -70]])); add(p, 'j_spine', 15); add(p, 'j_head', 22)
      add(p, 'j_shoulderL', -35, 0, 10); add(p, 'j_elbowL', -60)
    } else if (v === 1) {
      const s = Math.sin(TAU * 0.8 * t)
      add(p, 'j_spine', 18, 20 * s); add(p, 'j_hips', 0, -6 * s); add(p, 'j_shoulderL', -35, 25 * s, 10); add(p, 'j_shoulderR', -55, 25 * s, -10); add(p, 'j_elbowL', -30); add(p, 'j_elbowR', -30); add(p, 'j_head', 15)
    } else {
      const c = TAU * 0.6 * t
      add(p, 'j_shoulderR', -45 + 10 * Math.cos(c), 0, -10 + 12 * Math.sin(c)); add(p, 'j_elbowR', -70); add(p, 'j_spine', 12); add(p, 'j_head', 20); add(p, 'j_shoulderL', -30, 0, 8); add(p, 'j_elbowL', -80)
    }
    return frame
  }
  if (activity === 'chat') {
    const talk = chatTurn(a), listen = 1 - talk
    gestures(a, p, talk)
    add(p, 'j_head', 6 * Math.max(0, Math.sin(TAU * 0.7 * t)), 0, 4, listen); add(p, 'j_shoulderL', -30, 0, -6, listen); add(p, 'j_shoulderR', -30, 0, 6, listen); add(p, 'j_elbowL', -100, 0, 0, listen); add(p, 'j_elbowR', -100, 0, 0, listen)
    add(p, 'j_hips', 0, 0, 4 * a.deathSide); add(p, a.deathSide > 0 ? 'j_kneeR' : 'j_kneeL', 12)
    return frame
  }
  if (activity === 'perform') {
    if (variant(a, 3, 2) === 0) {
      const s = Math.sin(TAU * t), half = Math.sin(Math.PI * t)
      add(p, 'j_hips', 0, 12 * half, 10 * half); add(p, 'j_spine', 0, -8 * half, -6 * half); add(p, 'j_head', 0, 0, 8 * s)
      add(p, 'j_shoulderL', -120 - 30 * s, 0, 30); add(p, 'j_shoulderR', -120 + 30 * s, 0, -30); add(p, 'j_elbowL', -40); add(p, 'j_elbowR', -40)
      add(p, 'j_kneeL', 15 + 15 * Math.abs(s)); add(p, 'j_kneeR', 15 + 15 * Math.abs(Math.cos(TAU * t)))
      return { ...frame, bob: frame.bob + 0.04 * Math.abs(s) - 0.03 }
    }
    add(p, 'j_shoulderL', -50, 30, 25); add(p, 'j_elbowL', -80); add(p, 'j_shoulderR', -30, 0, -15); add(p, 'j_elbowR', -90 + 10 * Math.sin(TAU * 4 * t))
    add(p, 'j_head', 15, 0, 6 * Math.sin(Math.PI * t)); add(p, 'j_kneeR', 8 * Math.max(0, Math.sin(TAU * 2 * t)))
    return frame
  }
  const scan = Math.sin(TAU * t / 7 + a.phase * TAU), hold = Math.sign(scan) * Math.abs(scan) ** 0.6
  add(p, 'j_hipL', 0, 0, 6); add(p, 'j_hipR', 0, 0, -6); add(p, 'j_kneeL', 6); add(p, 'j_kneeR', 6); add(p, 'j_spine', -3)
  add(p, 'j_shoulderL', -22, 0, 4); add(p, 'j_shoulderR', -28, 0, -4); add(p, 'j_elbowL', -60); add(p, 'j_elbowR', -70); add(p, 'j_head', 0, 38 * hold); add(p, 'j_neck', 0, 12 * hold)
  return frame
}

function hurtLayer(a: Animator, p: Joints): number {
  const t = a.clock - a.hurtAt, h = a.hurtLevel
  if (h <= 1e-4) return 0
  const side = a.hurtSide, shake = Math.sin(t * 40)
  if (a.kind === 'biped') {
    add(p, 'j_spine', -16, side * 10, 0, h); add(p, 'j_neck', -6, 0, 0, h); add(p, 'j_head', -12, 0, side * 6, h)
    for (const [s, sd] of sides) { add(p, `j_shoulder${s}`, -12, 0, sd * 12, h); add(p, `j_elbow${s}`, -18, 0, 0, h); add(p, `j_knee${s}`, 10, 0, 0, h) }
    return -0.03 * h
  }
  if (a.kind === 'quadruped') { add(p, 'j_body', 6, 0, shake * 4, h); add(p, 'j_neck', -14, 0, 0, h); add(p, 'j_head', -10, 0, 0, h); add(p, 'j_jaw', 12, 0, 0, h); return 0 }
  if (a.kind === 'arachnid') { add(p, 'j_body', -8, 0, shake * 5, h); for (let i = 0; i < 8; i++) add(p, `j_leg${i}`, 0, 0, 10, h); return 0 }
  if (a.kind === 'flyer') { add(p, 'j_body', 4, 0, 0, h); add(p, 'j_neck', -16, 0, 0, h); add(p, 'j_head', -8, 0, 0, h); add(p, 'j_jaw', 10, 0, 0, h); return 0 }
  add(p, 'j_body', -8, 0, shake * 12, h); return 0
}
function waveLayer(a: Animator, p: Joints) {
  const t = a.clock - a.waveAt, e = bump(t, 0, 0.3, 1.4, 1.8)
  if (e <= 0) return
  if (a.kind === 'biped') {
    blendTo(p, 'j_shoulderL', [0, 0, 95], e); blendTo(p, 'j_elbowL', [0, 0, 65 + 22 * Math.sin(TAU * 2.4 * a.clock)], e); add(p, 'j_head', 0, 10, 0, e)
  } else if (a.kind === 'quadruped') { add(p, 'j_tail', -20, 40 * Math.sin(TAU * 3 * a.clock), 0, e); add(p, 'j_neck', -8, 0, 0, e) }
}

function baseFrame(a: Animator, input: AnimatorInput): Frame {
  switch (a.state) {
    case 'jump': case 'fall': return air(a, input)
    case 'land': return landing(a, input)
    case 'attack': return a.swing ? attackFrame(a, input) : locomotion(a, input)
    case 'dodge': return dodgeFrame(a, input)
    case 'interact': return interactFrame(a, input)
    case 'death': return deathFrame(a)
    case 'talk': return talkFrame(a, input)
    case 'activity': return activityFrame(a, input)
    default: return locomotion(a, input)
  }
}
function enter(a: Animator, state: AnimState, fade = fadeTime[state]) {
  a.from = { joints: Object.fromEntries(Object.entries(a.last.joints).map(([joint, v]) => [joint, v.map(wrap) as V])), bob: a.last.bob, collapse: a.last.collapse, seat: a.last.seat }
  a.fade = fade > 0 ? 0 : 1
  a.state = state
  a.time = 0
  a.span = fade
}
const restState = (a: Animator, input: AnimatorInput): AnimState => a.speed > 0.6 ? 'locomotion' : input.talk ? 'talk' : a.activity ? 'activity' : 'locomotion'
const busy = (state: AnimState) => state === 'attack' || state === 'dodge' || state === 'interact' || state === 'death'
const crossed = (from: number, to: number, mark: number) => Math.floor(from - mark) !== Math.floor(to - mark)

/** Advances the state machine by `input.dt` and returns the blended pose; pure with respect to the animator's own data. */
export function updateAnimator(a: Animator, input: AnimatorInput): AnimatorPose {
  const dt = clamp(fin(input.dt), 0, 0.25), events: string[] = [], kind = a.kind, flying = aerial(kind)
  const grounded = flying || input.grounded !== false, vy = fin(input.verticalSpeed)
  a.clock += dt; a.time += dt
  a.speed = approach(a.speed, clamp(fin(input.speed), 0, 20), 10, dt)
  a.crouch = approach(a.crouch, input.crouch ? 1 : 0, 9, dt)
  if (flying) a.flight = approach(a.flight, input.grounded === false ? 1 : 0, 4, dt)
  const before = a.cycle + a.phase
  a.cycle += strideRate(kind, a.speed) * dt
  const edge = (key: keyof Animator['previous'], value: boolean) => { const fired = value && !a.previous[key]; a.previous[key] = value; return fired }
  const attack = edge('attack', !!input.attack), dodge = edge('dodge', !!input.dodge), hurt = edge('hurt', !!input.hurt), interact = edge('interact', !!input.interact), wave = edge('wave', !!input.wave)
  const activity = input.activity ?? null
  if (activity !== a.activity) { a.activity = activity; if (a.state === 'activity') enter(a, 'activity') }
  if (input.dead && a.state !== 'death') { enter(a, 'death'); a.swing = null; a.combo = 0; events.push('death') }
  if (a.state !== 'death') {
    if (hurt) { a.hurtAt = a.clock; a.hurts++; events.push('hurt') }
    if (wave) { const t = a.clock - a.waveAt; a.waveAt = t < 1.8 ? a.clock - Math.min(t, 0.3) : a.clock; events.push('wave') }
    if (!grounded) { a.airTime += dt; a.fallSpeed = Math.max(a.fallSpeed, -vy) }
    if (a.state === 'attack' && a.swing) {
      const sw = a.swing, end = swingTotal(sw)
      if (a.time - dt < sw.a && a.time >= sw.a) events.push('swing')
      if (a.time - dt < sw.a + sw.s * 0.6 && a.time >= sw.a + sw.s * 0.6) events.push('impact')
      if (a.time >= end) { a.swing = null; a.comboUntil = a.clock + 0.3; enter(a, restState(a, input)) }
    }
    if (dodge && grounded && a.state !== 'dodge') {
      a.dodges++; a.roll = kind === 'biped' && a.speed > 1.2; a.swing = null; a.combo = 0; enter(a, 'dodge'); events.push('dodge')
    } else if (attack && a.state !== 'dodge' && a.state !== 'interact') {
      const heavy = input.attack === 'heavy'
      if (a.state === 'attack' && a.swing) {
        if (a.time >= a.swing.a + a.swing.s && a.combo < 3) { a.combo++; a.heavy = heavy; a.swing = swingFor(kind, a.combo, heavy); enter(a, 'attack', 0.08) }
      } else {
        a.combo = a.clock <= a.comboUntil && a.combo < 3 ? a.combo + 1 : 1
        a.heavy = heavy; a.swing = swingFor(kind, a.combo, heavy); enter(a, 'attack')
      }
    } else if (interact && !busy(a.state)) enter(a, 'interact')
    if (a.state === 'dodge' && a.time >= dodgeTime(a)) enter(a, restState(a, input))
    if (a.state === 'interact' && a.time >= 0.9) enter(a, restState(a, input))
    if (a.state === 'interact' && a.time - dt < 0.35 && a.time >= 0.35) events.push('interact')
    if (a.state === 'activity' && a.activity === 'work' && variant(a, 2, 3) === 0 && crossed((a.clock - dt) * 1.1, a.clock * 1.1, 0.72)) events.push('impact')
    if (!busy(a.state)) {
      if (!grounded) {
        if (a.state !== 'jump' && a.state !== 'fall') {
          if (vy > 0.8 && a.airTime < 0.2) { enter(a, 'jump'); events.push('jump') }
          else if (a.airTime > 0.15 || vy < -2.5) enter(a, 'fall')
        } else if (a.state === 'jump' && vy < -0.3 && a.time > 0.15) enter(a, 'fall')
      } else {
        if (a.state === 'jump' || a.state === 'fall') {
          if (a.airTime > 0.25 || a.fallSpeed > 2) { a.landing = clamp(a.fallSpeed / 9, 0.2, 1); enter(a, 'land'); events.push('land') }
          else enter(a, restState(a, input))
        } else if (a.state === 'land') { if (a.time >= landTime(a)) enter(a, restState(a, input)) }
        else {
          const rest = restState(a, input)
          if (rest !== a.state) enter(a, rest)
        }
        a.airTime = 0; a.fallSpeed = 0
      }
    } else if (grounded) { a.airTime = 0; a.fallSpeed = 0 }
    if (a.state === 'locomotion' && a.speed < 0.2 && a.clock >= a.nextFidget && a.clock > a.fidgetEnd) {
      a.fidgets++; a.fidgetKind = Math.floor(r3(a, a.fidgets, 1) * 5) % 5; a.fidgetAt = a.clock; a.fidgetEnd = a.clock + 1.6 + 1.6 * r3(a, a.fidgets, 3)
      a.nextFidget = a.fidgetEnd + 3 + 6 * r3(a, a.fidgets, 4)
    } else if (a.speed >= 0.2 && a.clock >= a.nextFidget) a.nextFidget = a.clock + 2
  } else if (!a.fell && a.time >= 0.85) { a.fell = true; events.push('bodyfall') }
  const walking = grounded && !flying && smooth(0.05, 1.2, a.speed) > 0.25 && (a.state === 'locomotion' || a.state === 'talk' || a.state === 'attack' || a.state === 'land' || a.state === 'interact')
  if (walking) {
    const after = a.cycle + a.phase, [left, right] = kind === 'arachnid' ? [0, 0.5] : [0.25, 0.75]
    if (crossed(before, after, left)) events.push('footL')
    if (crossed(before, after, right)) events.push('footR')
  }
  const live = baseFrame(a, input)
  a.fade = a.span > 0 ? Math.min(1, a.fade + dt / a.span) : 1
  const w = ease(a.fade), from = a.from, joints: Joints = {}
  for (const joint of a.joints) {
    const target = live.joints[joint] ?? [0, 0, 0], source = from?.joints[joint]
    joints[joint] = source && w < 1 ? [mix(source[0], target[0], w), mix(source[1], target[1], w), mix(source[2], target[2], w)] : [target[0], target[1], target[2]]
  }
  const frame: Frame = { joints, bob: from && w < 1 ? mix(from.bob, live.bob, w) : live.bob, collapse: from && w < 1 ? mix(from.collapse, live.collapse, w) : live.collapse, seat: from && w < 1 ? mix(from.seat, live.seat, w) : live.seat }
  a.last = { joints: Object.fromEntries(Object.entries(joints).map(([joint, v]) => [joint, [...v] as V])), bob: frame.bob, collapse: frame.collapse, seat: frame.seat }
  let bob = frame.bob
  const since = a.clock - a.hurtAt
  a.hurtLevel = since < 0.07 ? approach(a.hurtLevel, 1, 45, dt) : approach(a.hurtLevel, 0, 8, dt)
  a.hurtSide = approach(a.hurtSide, a.hurts % 2 ? 1 : -1, 20, dt)
  if (a.state !== 'death') { bob += hurtLayer(a, joints); waveLayer(a, joints) }
  const face = faceFor(a, input, dt)
  if (joints.j_jaw) joints.j_jaw[0] += face.jaw * 22
  const out = new Map<string, V>()
  for (const joint of a.joints) {
    const v = joints[joint]
    out.set(joint, [bound(joint, v[0]), bound(joint, v[1]), bound(joint, v[2])])
  }
  const ikTarget = a.state === 'jump' || a.state === 'fall' || a.state === 'death' || (a.state === 'dodge' && a.roll) || frame.seat > 0.5 || frame.collapse > 0.5 ? 0 : a.state === 'dodge' ? 0.5 : 1
  const lookTarget = a.state === 'death' || a.state === 'dodge' || (a.state === 'activity' && (a.activity === 'sleep' || a.activity === 'work')) ? 0 : a.state === 'attack' ? 0.3 : a.state === 'jump' || a.state === 'fall' ? 0.5 : 1
  a.footIK = approach(a.footIK, ikTarget, 10, dt); a.look = approach(a.look, lookTarget, 6, dt)
  const state: AnimState = a.state === 'locomotion' && a.clock - a.hurtAt < 0.35 ? 'hurt' : a.state
  return { state, joints: out, bob: clamp(fin(bob), -1.2, 1.2), collapse: clamp01(frame.collapse), face, combo: a.state === 'attack' ? a.combo : 0, events, seat: clamp01(frame.seat), footIK: clamp01(a.footIK), look: clamp01(a.look) }
}
const bound = (joint: string, v: number) => { const x = fin(v); return joint === 'j_hips' ? wrap(x) : clamp(x, -BOUND, BOUND) }

function faceFor(a: Animator, input: AnimatorInput, dt: number): FaceState {
  const f = a.face, closed = a.state === 'death' ? smooth(0.1, 0.6, a.time) : a.state === 'activity' && a.activity === 'sleep' ? 1 : 0
  if (a.clock >= a.nextBlink) {
    a.blinks++; a.blinkAt = a.clock
    a.nextBlink = a.clock + (r3(a, a.blinks, 51) < 0.18 ? 0.3 : 2 + 4.5 * r3(a, a.blinks, 52))
  }
  const d = a.clock - a.blinkAt, blink = d < 0.06 ? ease(d / 0.06) : d < 0.17 ? 1 - ease((d - 0.06) / 0.11) : 0
  if (a.clock >= a.gazeAt) {
    a.gazes++; a.gazeAt = a.clock + 0.6 + 2 * r3(a, a.gazes, 61)
    const focus = 1 - 0.6 * speaking(a)
    a.gaze = [(r3(a, a.gazes, 62) - 0.5) * 0.5 * focus, (r3(a, a.gazes, 63) - 0.5) * 0.16 * focus]
  }
  const mood = input.mood ?? 'calm', sw = a.state === 'attack' && a.swing ? a.swing : null
  const strike = sw ? bump(a.time, sw.a * 0.6, sw.a + sw.s * 0.3, sw.a + sw.s, swingTotal(sw)) : 0
  const pain = Math.max(0, 1 - Math.abs(a.clock - a.hurtAt - 0.1) / 0.4) * (a.state === 'death' ? 0 : 1)
  const waving = bump(a.clock - a.waveAt, 0, 0.3, 1.4, 1.8)
  const talking = Math.max(speaking(a), input.talk && a.state === 'locomotion' ? 1 : 0) * syllable(a)
  let brow = mood === 'angry' ? -0.6 : mood === 'afraid' ? 0.7 : mood === 'happy' ? 0.2 : 0, smile = mood === 'happy' ? 0.6 : mood === 'angry' ? -0.3 : mood === 'afraid' ? -0.4 : 0.12 * r3(a, 4, 0)
  if (a.state === 'attack') { brow = -0.7; smile = -0.3 }
  if (a.state === 'activity' && a.activity === 'guard') brow = Math.min(brow, -0.25)
  if (a.state === 'activity' && a.activity === 'perform') smile = Math.max(smile, 0.6)
  brow += speaking(a) * (0.25 + 0.2 * Math.sin(TAU * 0.45 * a.clock))
  brow = mix(brow, 0.6, pain); smile = mix(smile, 0.6, waving)
  const jaw = Math.max(talking, 0.35 * strike, 0.3 * pain, a.state === 'death' ? 0.25 * smooth(0.2, 0.8, a.time) : 0, a.state === 'activity' && a.activity === 'perform' && variant(a, 3, 2) === 0 ? 0.25 * syllable(a) : 0)
  f.brow = approach(f.brow, clamp(brow, -1, 1), 10, dt); f.smile = approach(f.smile, clamp(smile, -1, 1), 8, dt)
  f.jaw = approach(f.jaw, clamp01(jaw), 28, dt)
  f.gaze = [approach(f.gaze[0], a.gaze[0], 30, dt), approach(f.gaze[1], a.gaze[1], 30, dt)]
  f.blink = Math.max(blink, closed, 0.45 * pain)
  return { blink: clamp01(f.blink), jaw: clamp01(f.jaw), brow: clamp(fin(f.brow), -1, 1), smile: clamp(fin(f.smile), -1, 1), gaze: [fin(f.gaze[0]), fin(f.gaze[1])] }
}

const RAD = Math.PI / 180, SEAT = 0.45
/** Like applyRig: rotation = rest + delta (XYZ radians); the root joint takes bob, collapse and seat. Never mutates the document. */
export function applyAnimatorPose(binding: RigBinding, holders: Map<string, Object3D>, pose: AnimatorPose): void {
  const root = rigRootJoint[binding.kind], drop = rigCollapse[binding.kind], unit = rigUnit(binding)
  for (const joint of binding.joints) {
    const holder = holders.get(joint.nodeId)
    if (!holder) continue
    const d = pose.joints.get(joint.joint), [bx, by, bz] = joint.base
    if (d) holder.rotation.set((bx + d[0]) * RAD, (by + d[1]) * RAD, (bz + d[2]) * RAD)
    else holder.rotation.set(bx * RAD, by * RAD, bz * RAD)
    const [x, y, z] = joint.basePosition
    if (joint.joint !== root) { holder.position.set(x, y, z); continue }
    let height = y + pose.bob * unit - y * drop * pose.collapse
    if (pose.seat > 0 && binding.kind === 'biped') height = mix(height, SEAT * binding.size + 0.1 * unit, pose.seat)
    holder.position.set(x, height, z)
  }
}
