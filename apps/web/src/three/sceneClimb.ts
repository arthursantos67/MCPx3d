import * as THREE from 'three'
import type { RigBinding } from './sceneCharacterRig.ts'
import { solveLeg } from './sceneCharacterIK.ts'
import type { PlayerBox } from './scenePlayer.ts'

/** Rungs of the ladder being climbed: heights (world Y, ascending), the ladder's centre line, the rung direction and the side facing the climber. */
export interface Ladder { rungs: number[]; center: THREE.Vector3; across: THREE.Vector3; normal: THREE.Vector3; spacing: number }

const flat = (v: THREE.Vector3) => v.clone().setY(0)
/** Finds the rungs (thin horizontal climbable boxes) next to the climber; rails and other climbable surfaces only count when no rung is near. */
export function ladderNear(boxes: PlayerBox[] | undefined, feet: THREE.Vector3, reach = 1.1): Ladder | null {
  const rungs = (boxes ?? []).filter((box) => {
    const vertical = box.axes.map((axis, i) => ({ i, up: Math.abs(axis.y) })).sort((a, b) => b.up - a.up)[0]
    const halves = [box.half.x, box.half.y, box.half.z], thin = halves[vertical.i], long = Math.max(...halves.filter((_, i) => i !== vertical.i))
    return vertical.up > 0.9 && thin < 0.08 && long > 0.12 && box.center.y > feet.y - 1.5 && box.center.y < feet.y + 3.5 && flat(box.center).distanceTo(flat(feet)) < reach + long
  })
  if (rungs.length < 2) return null
  const pick = rungs.reduce((best, box) => Math.abs(box.center.y - feet.y - 1) < Math.abs(best.center.y - feet.y - 1) ? box : best)
  const ladder = rungs.filter((box) => flat(box.center).distanceTo(flat(pick.center)) < 0.3).sort((a, b) => a.center.y - b.center.y)
  if (ladder.length < 2) return null
  const halves = [pick.half.x, pick.half.y, pick.half.z], axis = pick.axes[halves.indexOf(Math.max(...halves))].clone().setY(0).normalize()
  const center = ladder.reduce((sum, box) => sum.add(box.center), new THREE.Vector3()).divideScalar(ladder.length)
  const normal = new THREE.Vector3(-axis.z, 0, axis.x)
  if (normal.dot(flat(feet).sub(flat(center))) < 0) normal.negate()
  const ys = ladder.map((box) => box.center.y + box.half.y)
  const spacing = ys.slice(1).reduce((sum, y, i) => sum + y - ys[i], 0) / (ys.length - 1)
  return { rungs: ys, center: center.setY(0), across: axis, normal, spacing: Math.max(0.2, spacing) }
}

export interface ClimbMemory { weight: number }
export const createClimbMemory = (): ClimbMemory => ({ weight: 0 })
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }
/** Height of rung `index` (beyond the ends the ladder spacing continues, so limbs never stop on air). */
const rungAt = (ladder: Ladder, index: number) => {
  const last = ladder.rungs.length - 1
  return index < 0 ? ladder.rungs[0] + index * ladder.spacing : index > last ? ladder.rungs[last] + (index - last) * ladder.spacing : ladder.rungs[index]
}
/**
 * Hand-over-hand climbing on the real rungs: opposite hand and foot move together, each limb holds its rung, then releases and arcs to the next.
 * `hands` are the fist points in each forearm frame. Call after the animator pose; `weight` blends in when the climb starts.
 */
export function solveClimb(binding: RigBinding, holders: Map<string, THREE.Object3D>, ladder: Ladder, feetY: number, hands: Partial<Record<'L' | 'R', THREE.Vector3>>, memory: ClimbMemory, dt: number, active: boolean, unit = 1): void {
  memory.weight += ((active ? 1 : 0) - memory.weight) * Math.min(1, Math.max(0, dt) * 8)
  if (memory.weight < 0.02) return
  const joint = (name: string) => holders.get(binding.joints.find((item) => item.joint === name)?.nodeId ?? '')
  const progress = (feetY - ladder.rungs[0]) / ladder.spacing, handRung = Math.round(1.55 * unit / ladder.spacing)
  const limb = (phase: number, offset: number) => {
    const s = progress + phase, i = Math.floor(s), move = smooth(0.62, 1, s - i)
    return { y: THREE.MathUtils.lerp(rungAt(ladder, i + offset), rungAt(ladder, i + offset + 1), move), lift: Math.sin(Math.PI * move) }
  }
  const point = (side: number, lateral: number, depth: number, y: number, lift: number) => ladder.center.clone().addScaledVector(ladder.across, side * lateral).addScaledVector(ladder.normal, depth + lift * 0.09).setY(y)
  for (const [side, s, phase] of [[1, 'L', 0], [-1, 'R', 0.5]] as const) {
    const shoulder = joint(`j_shoulder${s}`), elbow = joint(`j_elbow${s}`), hand = hands[s]
    if (shoulder && elbow && hand) {
      const grip = limb(phase, handRung), goal = point(side, 0.16 * unit, 0.03 * unit, grip.y + 0.02, grip.lift)
      const fk = elbow.localToWorld(hand.clone())
      solveLeg(shoulder, elbow, hand, fk.lerp(goal, memory.weight), 3, 1)
    }
    const hip = joint(`j_hip${s}`), knee = joint(`j_knee${s}`), foot = binding.feet?.find((item) => item.hip === `j_hip${s}`)
    if (hip && knee && foot) {
      const step = limb(phase + 0.5, 0), sole = new THREE.Vector3(...foot.offset), goal = point(side, 0.11 * unit, 0.07 * unit, step.y + 0.01, step.lift)
      const fk = knee.localToWorld(sole.clone())
      solveLeg(hip, knee, sole, fk.lerp(goal, memory.weight))
    }
  }
}
