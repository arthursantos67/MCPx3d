import * as THREE from 'three'
import type { RigBinding } from './sceneCharacterRig.ts'
import type { SpringChainSpec } from './sceneRuntimeTypes.ts'

/** Secondary motion for a set of chains; `step` after the animated pose (and IK) is applied, `reset` snaps every chain back to it. */
export interface SpringSystem { step(dt: number, wind?: THREE.Vector3): void; reset(): void; readonly count: number }

interface Chain {
  spec: SpringChainSpec; bones: THREE.Object3D[]; tips: THREE.Vector3[]; lengths: number[]
  pose: THREE.Quaternion[]; written: (THREE.Quaternion | null)[]; x: THREE.Vector3[]; v: THREE.Vector3[]; goals: THREE.Vector3[]; ready: boolean
}
const fin = (v: number, fallback = 0) => Number.isFinite(v) ? v : fallback
const MAX_DT = 0.1, q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion(), a1 = new THREE.Vector3(), a2 = new THREE.Vector3(), a3 = new THREE.Vector3()

/** Tip of each bone in its own frame: the next bone, else the farthest child, else the bone's own offset continued. */
function tipOf(bones: THREE.Object3D[], i: number): THREE.Vector3 {
  const bone = bones[i], next = bones[i + 1]
  if (next) return next.parent === bone ? next.position.clone() : bone.worldToLocal(next.getWorldPosition(new THREE.Vector3()))
  let far: THREE.Vector3 | null = null
  for (const child of bone.children) if (child.position.lengthSq() > (far?.lengthSq() ?? 1e-8)) far = child.position
  if (far) return far.clone()
  const own = bone.position.clone().applyQuaternion(bone.quaternion.clone().invert())
  return own.lengthSq() > 1e-8 ? own : new THREE.Vector3(0, -0.1, 0)
}
function rotateWorld(object: THREE.Object3D, rotation: THREE.Quaternion) {
  const parent = object.parent
  if (parent) { parent.getWorldQuaternion(q2); object.quaternion.premultiply(q2.clone().invert().multiply(rotation).multiply(q2)) }
  else object.quaternion.premultiply(rotation)
  object.updateWorldMatrix(false, true)
}

/**
 * Damped springs: each segment tip is a particle pulled toward its animated position (acceleration = stiffness·offset − damping·velocity + gravity + wind),
 * kept at the bone length from the previous tip and within `limit` radians of the animated direction; bones then turn to point at the particles.
 * dt is clamped to 0.1 s and split into substeps short enough for the stiffness, so long frames stay stable.
 */
export function createSprings(specs: SpringChainSpec[]): SpringSystem {
  const chains: Chain[] = specs.filter((spec) => spec.bones.length).map((spec) => {
    const bones = [...spec.bones], tips = bones.map((_, i) => tipOf(bones, i))
    return { spec, bones, tips, lengths: tips.map((tip) => Math.max(1e-4, tip.length())), pose: bones.map((bone) => bone.quaternion.clone()), written: bones.map(() => null),
      x: bones.map(() => new THREE.Vector3()), v: bones.map(() => new THREE.Vector3()), goals: bones.map(() => new THREE.Vector3()), ready: false }
  })
  let clock = 0
  /** Bones written by us last frame return to their rest pose; bones re-posed by the animator keep the new pose as their animated reference. */
  const restore = (chain: Chain) => chain.bones.forEach((bone, i) => {
    const written = chain.written[i]
    if (written && bone.quaternion.angleTo(written) < 1e-6) bone.quaternion.copy(chain.pose[i])
    else chain.pose[i].copy(bone.quaternion)
  })
  const animate = (chain: Chain) => {
    chain.bones[0].updateWorldMatrix(true, true)
    chain.bones.forEach((bone, i) => bone.localToWorld(chain.goals[i].copy(chain.tips[i])))
  }
  const snap = (chain: Chain) => { chain.goals.forEach((goal, i) => { chain.x[i].copy(goal); chain.v[i].set(0, 0, 0) }); chain.ready = true }
  const step = (dt: number, wind?: THREE.Vector3) => {
    const span = Math.min(MAX_DT, Math.max(0, fin(dt)))
    clock += span
    for (const chain of chains) {
      restore(chain); animate(chain)
      if (!chain.ready) snap(chain)
      const { spec, x, v, goals, lengths } = chain, k = Math.max(0, fin(spec.stiffness, 40)), c = Math.max(0, fin(spec.damping, 6)), g = fin(spec.gravity, 0)
      const limit = Math.max(0, fin(spec.limit, Math.PI / 2)), gust = wind && Number.isFinite(wind.x + wind.y + wind.z) ? wind : null, windScale = fin(spec.wind ?? 1, 1)
      const h0 = Math.min(1 / 90, 0.5 / Math.sqrt(Math.max(1, k))), steps = span > 0 ? Math.min(32, Math.ceil(span / h0)) : 0, h = steps ? span / steps : 0
      const pivot = chain.bones[0].getWorldPosition(new THREE.Vector3())
      for (let s = 0; s < steps; s++) for (let i = 0; i < x.length; i++) {
        const before = a3.copy(x[i]), acc = a1.copy(goals[i]).sub(x[i]).multiplyScalar(k)
        acc.y -= g
        if (gust) acc.addScaledVector(gust, windScale * (1 + 0.35 * Math.sin(clock * 3.1 + i * 1.3 + s * 0.01)))
        v[i].addScaledVector(acc, h).divideScalar(1 + c * h)
        const prev = i ? x[i - 1] : pivot, prevGoal = i ? goals[i - 1] : pivot
        const dir = a1.copy(x[i]).addScaledVector(v[i], h).sub(prev), rest = a2.copy(goals[i]).sub(prevGoal)
        if (dir.lengthSq() < 1e-12) dir.copy(rest)
        dir.normalize(); rest.normalize()
        const angle = dir.angleTo(rest)
        if (angle > limit && angle > 1e-6) dir.applyQuaternion(q1.setFromUnitVectors(dir.clone(), rest).slerp(new THREE.Quaternion(), limit / angle))
        const moved = before.clone()
        x[i].copy(prev).addScaledVector(dir, lengths[i])
        v[i].copy(x[i]).sub(moved).divideScalar(h)
      }
      chain.bones.forEach((bone, i) => {
        const base = bone.getWorldPosition(a1), from = bone.localToWorld(a2.copy(chain.tips[i])).sub(base), to = a3.copy(x[i]).sub(base)
        if (from.lengthSq() > 1e-12 && to.lengthSq() > 1e-12) rotateWorld(bone, q1.setFromUnitVectors(from.normalize(), to.normalize()))
        chain.written[i] = bone.quaternion.clone()
      })
    }
  }
  const reset = () => { for (const chain of chains) { restore(chain); chain.written.fill(null); animate(chain); snap(chain) } }
  return { step, reset, get count() { return chains.length } }
}

const SPRING_JOINT = /^j_(tail|hair|cape|ear|strap|braid|antenna|tentacle)/
const PRESETS: Record<string, Omit<SpringChainSpec, 'bones'>> = {
  tail: { stiffness: 55, damping: 7, gravity: 3, limit: 0.55, wind: 0.3 }, hair: { stiffness: 35, damping: 6, gravity: 6, limit: 0.9, wind: 1 },
  cape: { stiffness: 25, damping: 4, gravity: 8, limit: 1.1, wind: 1.4 }, ear: { stiffness: 120, damping: 10, gravity: 1, limit: 0.35, wind: 0.4 },
  strap: { stiffness: 45, damping: 5, gravity: 7, limit: 0.8, wind: 0.6 }, braid: { stiffness: 35, damping: 6, gravity: 6, limit: 0.9, wind: 1 },
  antenna: { stiffness: 90, damping: 6, gravity: 1, limit: 0.4, wind: 0.5 }, tentacle: { stiffness: 30, damping: 5, gravity: 3, limit: 0.8, wind: 0.4 },
}
/**
 * Chains for rig joints that should trail (tails, ears, hair, capes, straps): each run of parent→child spring joints becomes one chain.
 * Longer chains are softer; bigger characters are slower. Wings stay with the animator.
 */
export function rigSpringChains(binding: RigBinding, holders: Map<string, THREE.Object3D>): SpringChainSpec[] {
  const entries = binding.joints.filter((joint) => SPRING_JOINT.test(joint.joint) && holders.has(joint.nodeId)), set = new Set(entries.map((joint) => holders.get(joint.nodeId)!))
  const chains: SpringChainSpec[] = []
  for (const entry of entries) {
    const first = holders.get(entry.nodeId)!
    if (first.parent && set.has(first.parent)) continue
    const bones = [first]
    for (let next = first.children.find((child) => set.has(child)); next; next = next.children.find((child) => set.has(child))) bones.push(next)
    const preset = PRESETS[SPRING_JOINT.exec(entry.joint)![1]], size = Math.max(0.3, binding.size || 1), soft = bones.length > 1 ? 0.55 : 1
    chains.push({ bones, ...preset, stiffness: preset.stiffness * soft / Math.sqrt(size), damping: preset.damping * (bones.length > 1 ? 0.75 : 1) })
  }
  return chains
}
