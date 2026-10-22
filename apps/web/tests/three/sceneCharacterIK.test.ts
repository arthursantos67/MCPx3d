import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three'
import { createNode, type ThreeSceneDocument } from '../../src/three/sceneDocument.ts'
import { expandSceneRecipe } from '../../src/three/sceneGeneration.ts'
import type { CharacterType } from '../../src/three/sceneCharacters.ts'
import { bindRigs, type RigBinding } from '../../src/three/sceneCharacterRig.ts'
import { applyAnimatorPose, animatorForBinding, updateAnimator } from '../../src/three/sceneCharacterAnimator.ts'
import { createFootIKMemory, createLookMemory, solveFootIK, solveLookAt } from '../../src/three/sceneCharacterIK.ts'
import type { GroundSampler } from '../../src/three/sceneRuntimeTypes.ts'

const single = { mode: 'linear', count: 1, offset: [0, 0, 0], radius: 0, axis: 'y', columns: 1, jitter: 0, seed: 1, onto: null }
function character(type: CharacterType, size = 1): ThreeSceneDocument {
  const box = createNode('box')
  return expandSceneRecipe({ name: type, background: '#112233', exposure: 1, lightIntensity: 1, duration: 12, nodes: [{ id: type, parentId: null, name: type, kind: 'group', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], dimensions: [1, 1, 1],
    color: box.material.color, metalness: 0, roughness: 0.5, animation: box.animation, repeat: single, overlapWith: [], prefab: { type, size, seed: 2, primary: null, secondary: null, text: '', lit: false, interactive: true } }] })
}
/** Holder tree like sceneBuild: one Object3D per node, parented by parentId. */
function rig(type: CharacterType, size = 1, yaw = 0) {
  const doc = character(type, size), holders = new Map<string, THREE.Object3D>(), world = new THREE.Group()
  for (const node of doc.nodes) {
    const object = new THREE.Object3D()
    object.position.set(...node.position); object.rotation.set(...node.rotation.map(THREE.MathUtils.degToRad) as [number, number, number])
    holders.set(node.id, object)
  }
  for (const node of doc.nodes) (node.parentId ? holders.get(node.parentId)! : world).add(holders.get(node.id)!)
  const [binding] = bindRigs(doc)
  holders.get(binding.rootId)!.rotation.y = yaw
  world.updateMatrixWorld(true)
  return { doc, holders, binding, world }
}
const joint = (binding: RigBinding, holders: Map<string, THREE.Object3D>, name: string) => holders.get(binding.joints.find((item) => item.joint === name)!.nodeId)!
const soles = (binding: RigBinding, holders: Map<string, THREE.Object3D>) => {
  holders.get(binding.rootId)!.updateWorldMatrix(true, true)
  return binding.feet!.map((foot) => joint(binding, holders, foot.knee).localToWorld(new THREE.Vector3(...foot.offset)))
}
const errorTo = (ground: GroundSampler, points: THREE.Vector3[]) => Math.max(...points.map((p) => Math.abs(p.y - ground(p.x, p.z, p.y + 1)!)))

test('IK updates joint paths without traversing decorative meshes at every solve', () => {
  const { binding, holders } = rig('knight'), head = joint(binding, holders, 'j_head')
  let visits = 0
  for (let i = 0; i < 100; i++) {
    const ornament = new THREE.Object3D(), update = ornament.updateMatrix.bind(ornament)
    ornament.updateMatrix = () => { visits++; update() }
    head.add(ornament)
  }
  solveFootIK(binding, holders, (x) => x > 0 ? 0.15 : 0)
  solveLookAt(binding, holders, new THREE.Vector3(3, 2, 5), 1)
  assert.equal(visits, 0, 'rendered meshes update during rendering, rather than on every IK iteration')
  assert.ok(errorTo((x) => x > 0 ? 0.15 : 0, soles(binding, holders)) < 0.02)
})
const reach = (binding: RigBinding, holders: Map<string, THREE.Object3D>) => binding.feet!.map((foot) => {
  const hip = joint(binding, holders, foot.hip).getWorldPosition(new THREE.Vector3()), knee = joint(binding, holders, foot.knee), k = knee.getWorldPosition(new THREE.Vector3())
  const ankle = knee.localToWorld(new THREE.Vector3(0, foot.offset[1], 0))
  return { stretch: hip.distanceTo(ankle) - hip.distanceTo(k) - k.distanceTo(ankle), bend: new THREE.Vector3().subVectors(k, hip).cross(new THREE.Vector3().subVectors(ankle, k)) }
})

test('feet follow flat, sloped and stepped ground within 2 cm; the pelvis drops only as needed', () => {
  for (const type of ['villager', 'goblin', 'golem', 'knight'] as const) for (const yaw of [0, 0.9]) {
    const flat = rig(type, 1, yaw), before = soles(flat.binding, flat.holders)
    assert.equal(solveFootIK(flat.binding, flat.holders, () => 0).pelvis, 0)
    soles(flat.binding, flat.holders).forEach((p, i) => assert.ok(p.distanceTo(before[i]) < 0.005, `${type}: flat ground keeps the pose`))
    const cases: [string, GroundSampler][] = [['slope', (x) => 0.3 * x], ['cross slope', (x, z) => 0.25 * z - 0.2 * x], ['step up', (x) => x > 0 ? 0.18 : 0], ['step down', (x) => x > 0 ? -0.15 : 0]]
    for (const [name, ground] of cases) {
      const { binding, holders } = rig(type, 1, yaw), result = solveFootIK(binding, holders, ground)
      const error = errorTo(ground, soles(binding, holders))
      assert.ok(error < 0.02, `${type}/${name}/${yaw}: foot error ${error}`)
      assert.ok(result.pelvis <= 0 && result.pelvis > -0.5, `${type}/${name}: pelvis ${result.pelvis}`)
      for (const leg of reach(binding, holders)) assert.ok(leg.stretch <= 1e-6, `${type}/${name}: leg stretched`)
      if (name === 'step down') assert.ok(result.pelvis < -0.1, 'lowers the pelvis to reach the lower foot')
      if (name === 'step up') assert.ok(Math.abs(result.pelvis) < 1e-6, 'a raised foot bends its knee instead')
      const knee = joint(binding, holders, 'j_kneeL').getWorldPosition(new THREE.Vector3()).applyAxisAngle(new THREE.Vector3(0, 1, 0), -yaw)
      const hip = joint(binding, holders, 'j_hipL').getWorldPosition(new THREE.Vector3()).applyAxisAngle(new THREE.Vector3(0, 1, 0), -yaw)
      if (name === 'step up') assert.ok(knee.z > hip.z + 0.05, 'the bent knee points forward')
    }
  }
})

test('unreachable or missing ground never stretches the leg nor produces NaN; weight 0 keeps FK', () => {
  for (const ground of [() => -5, () => 5, () => null, () => Number.NaN] as GroundSampler[]) {
    const { binding, holders } = rig('villager'), result = solveFootIK(binding, holders, ground)
    assert.ok(Number.isFinite(result.pelvis) && result.pelvis >= -0.6)
    for (const p of soles(binding, holders)) assert.ok(Number.isFinite(p.x + p.y + p.z))
    for (const leg of reach(binding, holders)) assert.ok(leg.stretch <= 1e-6)
  }
  const { binding, holders } = rig('villager'), before = soles(binding, holders)
  solveFootIK(binding, holders, (x) => 0.4 * x, 0)
  soles(binding, holders).forEach((p, i) => assert.ok(p.distanceTo(before[i]) < 1e-9))
  const half = rig('villager'), full = rig('villager')
  solveFootIK(half.binding, half.holders, (x) => x > 0 ? 0.2 : 0, 0.5); solveFootIK(full.binding, full.holders, (x) => x > 0 ? 0.2 : 0, 1)
  const lift = (r: typeof half) => soles(r.binding, r.holders).reduce((m, p) => Math.max(m, p.y), 0)
  assert.ok(Math.abs(lift(half) - 0.1) < 0.02 && Math.abs(lift(full) - 0.2) < 0.02, 'weight scales the correction')
})

test('walking FK keeps its swing lift on slopes and quadrupeds pitch along the terrain', () => {
  const { binding, holders } = rig('villager'), animator = animatorForBinding(binding), ground: GroundSampler = (x, z) => 0.2 * x + 0.15 * z
  for (let i = 0; i < 90; i++) {
    const pose = updateAnimator(animator, { dt: 1 / 60, time: i / 60, speed: 1.6, grounded: true, verticalSpeed: 0, dead: false, talk: false })
    applyAnimatorPose(binding, holders, pose)
    const fk = soles(binding, holders).map((p) => p.y)
    solveFootIK(binding, holders, ground, pose.footIK)
    const after = soles(binding, holders)
    after.forEach((p, i) => { assert.ok(Number.isFinite(p.y)); assert.ok(p.y - ground(p.x, p.z, 0)! > fk[i] - 0.02, 'the swing foot keeps its lift above the terrain') })
    assert.ok(Math.min(...after.map((p) => p.y - ground(p.x, p.z, 0)!)) < 0.02 + Math.min(...fk), 'the planted foot touches the ground')
  }
  for (const type of ['wolf', 'deer'] as const) {
    const { binding, holders } = rig(type), slope: GroundSampler = (_, z) => 0.35 * z
    solveFootIK(binding, holders, slope)
    const error = errorTo(slope, soles(binding, holders))
    assert.ok(error < 0.02, `${type} paws on the slope: ${error}`)
    const body = joint(binding, holders, 'j_body').getWorldQuaternion(new THREE.Quaternion()), nose = new THREE.Vector3(0, 0, 1).applyQuaternion(body)
    assert.ok(nose.y > 0.15, `${type} pitches nose-up on an uphill`)
  }
  const memory = createFootIKMemory(), { binding: b, holders: h } = rig('villager')
  solveFootIK(b, h, () => 0, 1, memory, 1 / 60)
  const eased = rig('villager')
  solveFootIK(eased.binding, eased.holders, (x) => x > 0 ? 0.2 : 0, 1, memory, 1 / 60)
  assert.ok(Math.max(...memory.offsets) > 0 && Math.max(...memory.offsets) < 0.1, 'memory eases sudden terrain changes')
})

test('look-at turns neck and head toward the target within limits, with weight and smoothing', () => {
  const yawOf = (r: ReturnType<typeof rig>) => {
    const head = joint(r.binding, r.holders, 'j_head').getWorldQuaternion(new THREE.Quaternion()), f = new THREE.Vector3(0, 0, 1).applyQuaternion(head)
    return [Math.atan2(f.x, f.z) * 180 / Math.PI, Math.atan2(-f.y, Math.hypot(f.x, f.z)) * 180 / Math.PI]
  }
  for (const yaw of [0, 2]) {
    const front = rig('villager', 1, yaw), target = new THREE.Vector3(Math.sin(0.5), 1.6, Math.cos(0.5)).multiplyScalar(3).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw)
    target.y = 1.6
    solveLookAt(front.binding, front.holders, target, 1)
    const head = joint(front.binding, front.holders, 'j_head').getWorldPosition(new THREE.Vector3()), want = target.clone().sub(head).normalize()
    const facing = new THREE.Vector3(0, 0, 1).applyQuaternion(joint(front.binding, front.holders, 'j_head').getWorldQuaternion(new THREE.Quaternion()))
    assert.ok(facing.angleTo(want) < 0.03, `looks straight at a reachable target (${facing.angleTo(want)})`)
  }
  const side = rig('villager')
  solveLookAt(side.binding, side.holders, new THREE.Vector3(5, 1.6, 0), 1)
  assert.ok(Math.abs(yawOf(side)[0] - 70) < 1.5, `yaw limited to 70°: ${yawOf(side)[0]}`)
  const up = rig('villager')
  solveLookAt(up.binding, up.holders, new THREE.Vector3(0, 9, 1), 1)
  assert.ok(Math.abs(yawOf(up)[1] + 35) < 1.5, `pitch limited to 35°: ${yawOf(up)[1]}`)
  const behind = rig('villager')
  solveLookAt(behind.binding, behind.holders, new THREE.Vector3(0, 1.6, -5), 1)
  assert.ok(Math.abs(yawOf(behind)[0]) < 1, 'targets behind are ignored')
  const half = rig('villager')
  solveLookAt(half.binding, half.holders, new THREE.Vector3(5, 1.6, 5), 0.5)
  assert.ok(Math.abs(yawOf(half)[0] - 22.5) < 2, `half weight turns halfway: ${yawOf(half)[0]}`)
  const none = rig('villager'), [rest] = yawOf(none)
  solveLookAt(none.binding, none.holders, null, 1)
  assert.equal(yawOf(none)[0], rest)
  const memory = createLookMemory(), seen: number[] = []
  for (let i = 0; i < 90; i++) {
    const r = rig('villager')
    solveLookAt(r.binding, r.holders, new THREE.Vector3(5, 1.6, 5), 1, memory, 1 / 60)
    seen.push(yawOf(r)[0])
  }
  assert.ok(seen[1] < 20 && Math.abs(seen.at(-1)! - 45) < 2 && seen.every((v, i) => i === 0 || Math.abs(v - seen[i - 1]) < 6), 'smoothed head turn')
  for (const type of ['wolf', 'dragon'] as const) {
    const r = rig(type)
    solveLookAt(r.binding, r.holders, new THREE.Vector3(4, 1, 4), 1)
    assert.ok(yawOf(r)[0] > 30, `${type} turns its head`)
  }
})
