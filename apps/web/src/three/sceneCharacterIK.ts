import * as THREE from 'three'
import { rigRootJoint, type RigBinding, type RigFoot } from './sceneCharacterRig.ts'
import type { GroundSampler } from './sceneRuntimeTypes.ts'

/** Per-character smoothing between frames; pass the same object every frame with its `dt`. */
export interface FootIKMemory { offsets: number[]; pitch: number; ready: boolean }
export interface LookMemory { yaw: number; pitch: number; weight: number; ready: boolean }
export const createFootIKMemory = (): FootIKMemory => ({ offsets: [], pitch: 0, ready: false })
export const createLookMemory = (): LookMemory => ({ yaw: 0, pitch: 0, weight: 0, ready: false })

const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3(), v4 = new THREE.Vector3(), q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion(), q3 = new THREE.Quaternion()
const AXIS_X = new THREE.Vector3(1, 0, 0), AXIS_Y = new THREE.Vector3(0, 1, 0), FORWARD = new THREE.Vector3(0, 0, 1)
const fin = (v: number, fallback = 0) => Number.isFinite(v) ? v : fallback
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
const smooth = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t) }
const wrapAngle = (a: number) => a - Math.PI * 2 * Math.round(a / (Math.PI * 2))
const follow = (value: number, target: number, rate: number, dt: number | undefined) => dt === undefined ? target : value + (target - value) * (1 - Math.exp(-rate * Math.max(0, fin(dt))))

function holderOf(binding: RigBinding, holders: Map<string, THREE.Object3D>, joint: string) {
  const entry = binding.joints.find((item) => item.joint === joint)
  return entry ? holders.get(entry.nodeId) : undefined
}
/** The character's own frame (origin at the feet, facing +Z): its root holder, or the root joint's parent for bindings without one (the avatar). */
export const characterRoot = (binding: RigBinding, holders: Map<string, THREE.Object3D>) => holders.get(binding.rootId) ?? holderOf(binding, holders, rigRootJoint[binding.kind])?.parent ?? undefined
/** Rotates `object` by a world-space rotation about its own pivot. */
function rotateWorld(object: THREE.Object3D, rotation: THREE.Quaternion) {
  const parent = object.parent
  if (parent) { parent.getWorldQuaternion(q3); object.quaternion.premultiply(q3.clone().invert().multiply(rotation).multiply(q3)) }
  else object.quaternion.premultiply(rotation)
  object.updateWorldMatrix(false, true)
}
function setWorldY(object: THREE.Object3D, dy: number) {
  object.getWorldPosition(v1)
  v1.y += dy
  if (object.parent) object.parent.worldToLocal(v1)
  object.position.copy(v1)
  object.updateWorldMatrix(false, true)
}

interface Leg { hip: THREE.Object3D; knee: THREE.Object3D; foot: THREE.Vector3; ankle: THREE.Vector3; front: boolean }
function legs(binding: RigBinding, holders: Map<string, THREE.Object3D>): Leg[] {
  return (binding.feet ?? []).flatMap((foot: RigFoot) => {
    const hip = holderOf(binding, holders, foot.hip), knee = holderOf(binding, holders, foot.knee)
    return hip && knee ? [{ hip, knee, foot: new THREE.Vector3(...foot.offset), ankle: new THREE.Vector3(0, foot.offset[1], 0), front: /F[LR]$/.test(foot.knee) }] : []
  })
}

/**
 * Two-bone solve so the foot point reaches `target` (world): the knee bends by the law of cosines in its own plane (positive local X = anatomical bend,
 * so knees keep pointing forward), then the thigh turns the chain onto the target. Never stretches past the limb length.
 */
export function solveLeg(hip: THREE.Object3D, knee: THREE.Object3D, foot: THREE.Vector3, target: THREE.Vector3, iterations = 3): number {
  const ankle = v4.set(0, foot.y, 0).clone(), H = new THREE.Vector3(), K = new THREE.Vector3(), A = new THREE.Vector3(), F = new THREE.Vector3(), goal = new THREE.Vector3(), n = new THREE.Vector3(), u = new THREE.Vector3(), w = new THREE.Vector3()
  for (let i = 0; i < iterations; i++) {
    hip.getWorldPosition(H); knee.getWorldPosition(K); knee.localToWorld(A.copy(ankle)); knee.localToWorld(F.copy(foot))
    goal.copy(A).add(target).sub(F)
    const a = K.distanceTo(H), b = A.distanceTo(K)
    if (a < 1e-6 || b < 1e-6) return target.distanceTo(F)
    knee.getWorldQuaternion(q1); n.copy(AXIS_X).applyQuaternion(q1)
    u.copy(H).sub(K); w.copy(A).sub(K)
    const uh = u.dot(n), wh = w.dot(n)
    u.addScaledVector(n, -uh); w.addScaledVector(n, -wh)
    const au = u.length(), bw = w.length(), h = uh - wh
    if (au < 1e-6 || bw < 1e-6) return target.distanceTo(F)
    const reach = Math.sqrt(h * h + (au + bw) ** 2), d = clamp(goal.distanceTo(H), Math.abs(a - b) + 1e-4, reach * 0.9995)
    const interior = Math.acos(clamp((au * au + bw * bw + h * h - d * d) / (2 * au * bw), -1, 1))
    const current = Math.atan2(n.dot(v1.crossVectors(u, w)), u.dot(w)), turn = wrapAngle(-interior - current)
    if (Math.abs(turn) > 1e-7) rotateWorld(knee, q2.setFromAxisAngle(n, turn))
    knee.localToWorld(A.copy(ankle))
    const from = v2.copy(A).sub(H), to = v3.copy(goal).sub(H)
    if (from.lengthSq() > 1e-12 && to.lengthSq() > 1e-12) rotateWorld(hip, q2.setFromUnitVectors(from.normalize(), to.normalize()))
  }
  knee.localToWorld(F.copy(foot))
  return target.distanceTo(F)
}

/**
 * Foot IK after FK: each foot follows the terrain under it relative to the character origin (the flat ground the animation assumes), the root joint drops
 * by the lowest foot's need, quadrupeds pitch along slopes, and legs only bend. `weight` 0 keeps the FK pose. Returns the pelvis offset applied (≤ 0, metres).
 */
export function solveFootIK(binding: RigBinding, holders: Map<string, THREE.Object3D>, ground: GroundSampler, weight = 1, memory?: FootIKMemory, dt?: number): { pelvis: number } {
  const pelvis = holderOf(binding, holders, rigRootJoint[binding.kind]), root = characterRoot(binding, holders), w = clamp(fin(weight), 0, 1)
  if (!root || !pelvis || !(binding.feet ?? []).length) return { pelvis: 0 }
  root.updateWorldMatrix(true, true)
  const list = legs(binding, holders)
  if (!list.length) return { pelvis: 0 }
  const base = root.getWorldPosition(new THREE.Vector3()).y, feet = list.map((leg) => leg.knee.localToWorld(leg.foot.clone()))
  const length = Math.max(...list.map((leg) => { const h = leg.hip.getWorldPosition(new THREE.Vector3()), k = leg.knee.getWorldPosition(new THREE.Vector3()); return h.distanceTo(k) + leg.knee.localToWorld(leg.ankle.clone()).distanceTo(k) }))
  const raw = feet.map((foot) => { const y = ground(foot.x, foot.z, foot.y + length * 0.6); return y === null || !Number.isFinite(y) ? 0 : clamp(y - base, -0.55 * length, 0.45 * length) })
  const smoothing = memory && memory.ready && memory.offsets.length === raw.length ? dt : undefined
  const offsets = raw.map((value, i) => follow(memory?.offsets[i] ?? value, value, 14, smoothing))
  let pitch = 0
  if (binding.kind !== 'biped') {
    const front = list.flatMap((leg, i) => leg.front ? [i] : []), back = list.flatMap((leg, i) => leg.front ? [] : [i])
    if (front.length && back.length) {
      const avg = (ids: number[], values: number[]) => ids.reduce((sum, i) => sum + values[i], 0) / ids.length
      const span = Math.max(0.1, Math.abs(avg(front, feet.map((f) => root.worldToLocal(f.clone()).z)) - avg(back, feet.map((f) => root.worldToLocal(f.clone()).z))))
      pitch = clamp(-Math.atan2(avg(front, offsets) - avg(back, offsets), span), -0.45, 0.45)
    }
  }
  if (memory) { memory.pitch = follow(memory.ready ? memory.pitch : pitch, pitch, 10, smoothing); pitch = memory.pitch; memory.offsets = offsets; memory.ready = true }
  if (w <= 0) return { pelvis: 0 }
  const targets = feet.map((foot, i) => foot.clone().setY(foot.y + offsets[i] * w))
  if (pitch) {
    root.getWorldQuaternion(q1)
    rotateWorld(pelvis, q2.setFromAxisAngle(AXIS_X.clone().applyQuaternion(q1), pitch * w))
  }
  const now = list.map((leg) => leg.knee.localToWorld(leg.foot.clone()))
  const drop = Math.min(0, ...now.map((foot, i) => targets[i].y - foot.y))
  if (drop < 0) setWorldY(pelvis, drop)
  list.forEach((leg, i) => solveLeg(leg.hip, leg.knee, leg.foot, targets[i]))
  return { pelvis: drop }
}

const LOOK_YAW = 70 * Math.PI / 180, LOOK_PITCH = 35 * Math.PI / 180
function facing(head: THREE.Object3D, body: THREE.Quaternion): [number, number] {
  head.getWorldQuaternion(q1)
  const f = v1.copy(FORWARD).applyQuaternion(q1).applyQuaternion(q2.copy(body).invert())
  return [Math.atan2(f.x, f.z), Math.atan2(-f.y, Math.hypot(f.x, f.z))]
}
const lookRotation = (yaw: number, pitch: number) => new THREE.Quaternion().setFromAxisAngle(AXIS_Y, yaw).multiply(new THREE.Quaternion().setFromAxisAngle(AXIS_X, pitch))

/**
 * Turns neck (40 %) and head toward `target` relative to the character's facing (+Z of its root), limited to ±70° yaw and ±35° pitch in total; targets
 * behind the character fade out. With `memory` and `dt` the look angles and weight are smoothed; `target` null eases back to the animated pose.
 * Returns the applied change in radians.
 */
export function solveLookAt(binding: RigBinding, holders: Map<string, THREE.Object3D>, target: THREE.Vector3 | null, weight: number, memory?: LookMemory, dt?: number): { yaw: number; pitch: number } {
  const root = characterRoot(binding, holders), neck = holderOf(binding, holders, 'j_neck'), head = holderOf(binding, holders, 'j_head')
  if (!root || !head) return { yaw: 0, pitch: 0 }
  root.updateWorldMatrix(true, true)
  const body = root.getWorldQuaternion(new THREE.Quaternion()), [yaw0, pitch0] = facing(head, body)
  let yaw = 0, pitch = 0, w = 0
  if (target && Number.isFinite(target.x + target.y + target.z)) {
    const dir = target.clone().sub(head.getWorldPosition(v1)).applyQuaternion(q2.copy(body).invert())
    if (dir.lengthSq() > 1e-8) {
      const raw = Math.atan2(dir.x, dir.z)
      yaw = clamp(raw, -LOOK_YAW, LOOK_YAW); pitch = clamp(Math.atan2(-dir.y, Math.hypot(dir.x, dir.z)), -LOOK_PITCH, LOOK_PITCH)
      w = clamp(fin(weight), 0, 1) * (1 - smooth(1.75, 2.6, Math.abs(raw)))
    }
  }
  if (memory) {
    const tracking = memory.ready && memory.weight > 0.01
    if (w > 0) { memory.yaw = follow(tracking ? memory.yaw : yaw0, yaw, 8, dt); memory.pitch = follow(tracking ? memory.pitch : pitch0, pitch, 8, dt) }
    memory.weight = follow(memory.weight, w, 5, dt); memory.ready = true
    yaw = memory.yaw; pitch = memory.pitch; w = memory.weight
  }
  if (w <= 1e-4) return { yaw: 0, pitch: 0 }
  const yaw1 = yaw0 + (clamp(yaw, -LOOK_YAW, LOOK_YAW) - yaw0) * w, pitch1 = pitch0 + (clamp(pitch, -LOOK_PITCH, LOOK_PITCH) - pitch0) * w
  const delta = (from: [number, number]) => lookRotation(yaw1, pitch1).multiply(lookRotation(from[0], from[1]).invert())
  const toWorld = (local: THREE.Quaternion) => body.clone().multiply(local).multiply(body.clone().invert())
  if (neck) rotateWorld(neck, toWorld(new THREE.Quaternion().slerp(delta([yaw0, pitch0]), 0.4)))
  rotateWorld(head, toWorld(delta(facing(head, body))))
  return { yaw: yaw1 - yaw0, pitch: pitch1 - pitch0 }
}
