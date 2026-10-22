import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three'
import { createEmptyScene, createNode, validateBehavior, validateScene, avatarKinds, type SceneNode, type ThreeSceneDocument } from '../../src/three/sceneDocument.ts'
import { expandSceneRecipe } from '../../src/three/sceneGeneration.ts'
import { buildNodeGeometry } from '../../src/three/sceneGeometry.ts'
import { sceneMatrices } from '../../src/three/scenePlacement.ts'
import { buildAvatar, buildCharacter, characterBehavior, characterRig, characterTypes, type CharacterType, type RigKind } from '../../src/three/sceneCharacters.ts'
import { applyRig, bindParts, bindRigs, rigBob, rigJoints, rigPose, strideRate, type LocomotionState } from '../../src/three/sceneCharacterRig.ts'

const single = { mode: 'linear', count: 1, offset: [0, 0, 0], radius: 0, axis: 'y', columns: 1, jitter: 0, seed: 1, onto: null }
function character(type: CharacterType, seed = 0, size = 1, lit = false): ThreeSceneDocument {
  const base = createNode('box')
  return expandSceneRecipe({ name: type, background: '#112233', exposure: 1, lightIntensity: 1, duration: 12, nodes: [{
    id: type, parentId: null, name: type, kind: 'group', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], dimensions: [1, 1, 1],
    color: base.material.color, metalness: 0, roughness: 0.5, animation: base.animation, repeat: single, overlapWith: [],
    prefab: { type, size, seed, primary: null, secondary: null, text: '', lit, interactive: true } }] })
}
function bounds(doc: ThreeSceneDocument): THREE.Box3 {
  const matrices = sceneMatrices(doc), box = new THREE.Box3()
  for (const node of doc.nodes) if (node.kind !== 'group' && node.kind !== 'light') {
    const geometry = buildNodeGeometry(node)
    box.union(geometry.boundingBox!.clone().applyMatrix4(matrices.get(node.id)!.clone().scale(new THREE.Vector3(...node.dimensions))))
    geometry.dispose()
  }
  return box
}
const rest: LocomotionState = { time: 0, speed: 0, airborne: false, attack: -1, hurt: 0, dead: 0 }
const kinds: RigKind[] = ['biped', 'quadruped', 'arachnid', 'flyer', 'hover']
const jointsOf = (kind: RigKind) => [...new Set([...rigJoints[kind], 'j_jaw', 'j_tail', 'j_tail2', 'j_legFL', 'j_kneeBR', 'j_rotor0'])]

test('every character expands to a valid rigged scene grounded at its origin', () => {
  for (const type of characterTypes) for (const [seed, size] of [[0, 1], [3, 2], [5, 0.6]] as const) {
    const doc = character(type, seed, size), kind = characterRig[type]
    const joints = doc.nodes.filter((node) => node.assetPart?.startsWith('j_'))
    assert.ok(joints.every((node) => node.kind === 'group'), `${type}: joints must be groups`)
    for (const joint of rigJoints[kind]) assert.ok(joints.some((node) => node.assetPart === joint), `${type} lacks ${joint}`)
    const [binding] = bindRigs(doc)
    assert.equal(binding.rootId, type)
    assert.equal(binding.kind, kind)
    assert.equal(binding.size, size)
    assert.equal(binding.joints.length, joints.length)
    assert.ok(doc.nodes.length >= 30, `${type} is too simple (${doc.nodes.length} parts)`)
    const box = bounds(doc)
    if (type !== 'drone') assert.ok(Math.abs(box.min.y) < 0.03 * size, `${type} floats or sinks: ${box.min.y}`)
    else assert.ok(box.min.y > 0.8 * size, 'the drone hovers above its origin')
    const material = doc.nodes.find((node) => node.assetPart?.startsWith('eye') || node.assetPart === 'visor')
    if (type !== 'drone' && type !== 'golem') assert.ok(material, `${type} needs eyes or a visor`)
  }
  const pick = (doc: ThreeSceneDocument, part: string) => doc.nodes.find((node) => node.assetPart === part)!
  const knight = character('knight')
  assert.equal(pick(knight, 'j_elbowL').parentId, pick(knight, 'j_shoulderL').id)
  assert.equal(pick(knight, 'j_kneeR').parentId, pick(knight, 'j_hipR').id)
  assert.ok(pick(knight, 'j_shoulderL').position[0] > 0, 'left side is +X')
  const height = (type: CharacterType) => bounds(character(type)).max.y
  for (const type of ['villager', 'knight', 'astronaut', 'skeleton'] as const) assert.ok(height(type) > 1.6 && height(type) < 2.05, `${type} height ${height(type)}`)
  assert.ok(height('goblin') < 1.35 && height('orc') > 1.9 && height('golem') > 2.3)
  const dragon = bounds(character('dragon'))
  assert.ok(dragon.max.z - dragon.min.z > 4 && dragon.max.x - dragon.min.x > 5, 'the boss dragon has a long body and a wide wingspan')
})

test('characters are deterministic, vary by seed and honor palette colors', () => {
  const spec = { type: 'villager' as const, size: 1, seed: 4, primary: null, secondary: null, text: '', lit: false, interactive: true }
  assert.deepEqual(buildCharacter(spec), buildCharacter(spec))
  const variants = new Set([0, 1, 2, 3, 4, 5].map((seed) => JSON.stringify(buildCharacter({ ...spec, seed }))))
  assert.ok(variants.size >= 5)
  const tinted = buildCharacter({ ...spec, primary: '#123456', secondary: '#654321' })
  assert.equal(tinted.find((part) => part.id === 'torso')!.material!.color, '#123456')
  assert.equal(tinted.find((part) => part.id === 'thighL')!.material!.color, '#654321')
  const lit = character('wizard', 0, 1, true)
  assert.ok(lit.nodes.some((node) => node.kind === 'light'))
  const spin = character('drone').nodes.filter((node) => node.animation.kind === 'spin')
  assert.equal(spin.length, 4)
  assert.ok(spin.every((node) => !node.assetPart!.startsWith('j_')), 'animated rotors are not rig joints')
})

test('rig poses are finite, bounded and smooth for any state', () => {
  const states: LocomotionState[] = []
  for (const speed of [0, 0.6, 1.4, 3, 6, 12, Number.NaN]) for (const attack of [-1, 0, 0.3, 0.5, 0.9, 1]) for (const [hurt, dead] of [[0, 0], [1, 0], [0.4, 0.5], [0, 1]])
    for (const airborne of [false, true]) states.push({ time: speed * 1.37 + attack, speed, airborne, attack, hurt, dead, talk: attack === 0 })
  for (const kind of kinds) for (const joint of jointsOf(kind)) for (const state of states) {
    const pose = rigPose(kind, joint, state, 0.3)
    assert.ok(pose.every((v) => Number.isFinite(v) && Math.abs(v) < 180), `${kind}/${joint}: ${pose}`)
    const later = rigPose(kind, joint, { ...state, time: state.time + 0.01 }, 0.3)
    assert.ok(pose.every((v, i) => Math.abs(v - later[i]) < 12), `${kind}/${joint} jumps: ${pose} -> ${later}`)
    assert.ok(Math.abs(rigBob(kind, state)) <= 0.5)
  }
  assert.deepEqual(rigPose('biped', 'j_unknown', rest), [0, 0, 0])
})

test('gait cycles are periodic, speed dependent and different from idle', () => {
  for (const kind of ['biped', 'quadruped', 'arachnid'] as const) {
    const moving = { ...rest, speed: 3, time: 0.4 }, period = 1 / strideRate(kind, 3)
    let difference = 0
    for (const joint of jointsOf(kind)) {
      const a = rigPose(kind, joint, moving), b = rigPose(kind, joint, { ...moving, time: moving.time + period * 2 }), idle = rigPose(kind, joint, { ...moving, speed: 0 })
      a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-6, `${kind}/${joint} is not periodic`))
      difference = Math.max(difference, ...a.map((v, i) => Math.abs(v - idle[i])))
    }
    assert.ok(difference > 10, `${kind}: walking must move the limbs`)
    assert.ok(strideRate(kind, 5) > strideRate(kind, 1))
    const viaCycle = rigPose(kind, rigJoints[kind][4], { ...rest, speed: 3, time: 99, cycle: 0.25 }), viaTime = rigPose(kind, rigJoints[kind][4], { ...rest, speed: 3, time: 0.25 / strideRate(kind, 3) })
    viaCycle.forEach((v, i) => assert.ok(Math.abs(v - viaTime[i]) < 1e-6, `${kind}: cycle drives the gait`))
  }
  const walk = (time: number) => rigPose('biped', 'j_hipL', { ...rest, speed: 1.4, time })[0]
  assert.ok(Math.sign(walk(0.1)) !== Math.sign(walk(0.1 + 0.5 / strideRate('biped', 1.4))), 'legs swing back and forth')
  assert.ok(rigPose('biped', 'j_hipL', { ...rest, speed: 1.4, time: 0.2 })[0] * rigPose('biped', 'j_hipR', { ...rest, speed: 1.4, time: 0.2 })[0] < 0, 'legs alternate')
  assert.ok(rigPose('biped', 'j_shoulderL', { ...rest, speed: 1.4, time: 0.2 })[0] * rigPose('biped', 'j_hipL', { ...rest, speed: 1.4, time: 0.2 })[0] < 0, 'arms counter-swing')
  const flap = [0, 0.2, 0.4, 0.6].map((time) => rigPose('flyer', 'j_wingL', { ...rest, airborne: true, speed: 4, time })[2])
  assert.ok(Math.max(...flap) - Math.min(...flap) > 25, 'flying wings flap')
  const left = rigPose('flyer', 'j_wingL', { ...rest, airborne: true, speed: 4, time: 0.3 }), right = rigPose('flyer', 'j_wingR', { ...rest, airborne: true, speed: 4, time: 0.3 })
  assert.ok(Math.abs(left[2] + right[2]) < 1e-9, 'wings mirror')
  const spider = (leg: number) => rigPose('arachnid', `j_leg${leg}`, { ...rest, speed: 3, time: 0.1 })[2]
  assert.ok(Math.abs(spider(0) - spider(1)) > 1 && Math.abs(spider(0) - spider(5)) < 1e-9, 'alternating tetrapod gait')
})

test('attack, hurt and death poses are expressive; applyRig never mutates the document', () => {
  const swing = (attack: number) => rigPose('biped', 'j_shoulderR', { ...rest, attack })[0]
  assert.ok(swing(0.3) < -120 && swing(0.6) > swing(0.3) + 60, 'weapon arm winds up overhead then strikes')
  assert.ok(rigPose('biped', 'j_spine', { ...rest, hurt: 1 })[0] < -10, 'hurt recoils')
  assert.ok(rigPose('biped', 'j_hips', { ...rest, dead: 1 })[0] < -70, 'death collapses')
  assert.ok(rigPose('flyer', 'j_jaw', { ...rest, attack: 0.5 })[0] > 30, 'the dragon bites')
  assert.ok(rigPose('quadruped', 'j_body', { ...rest, dead: 1 })[2] > 60)
  const doc = character('orc'), before = structuredClone(doc), [binding] = bindRigs(doc)
  const holders = new Map(doc.nodes.map((node) => {
    const object = new THREE.Object3D()
    object.position.set(...node.position); object.rotation.set(...node.rotation.map(THREE.MathUtils.degToRad) as [number, number, number])
    return [node.id, object]
  }))
  const hips = binding.joints.find((joint) => joint.joint === 'j_hips')!
  applyRig(binding, holders, { ...rest, speed: 2, time: 0.3 })
  assert.notEqual(holders.get(binding.joints.find((joint) => joint.joint === 'j_hipL')!.nodeId)!.rotation.x, 0)
  applyRig(binding, holders, { ...rest, dead: 1 })
  assert.ok(holders.get(hips.nodeId)!.position.y < hips.basePosition[1] * 0.3, 'the body drops to the ground')
  applyRig(binding, holders, rest)
  assert.ok(Math.abs(holders.get(hips.nodeId)!.position.y - hips.basePosition[1]) < 0.05)
  for (const joint of binding.joints) {
    const rotation = holders.get(joint.nodeId)!.rotation
    assert.ok(Math.abs(rotation.x - THREE.MathUtils.degToRad(joint.base[0])) < 0.3, `${joint.joint} rest pose drifted`)
  }
  assert.deepEqual(doc, before)
  const scene = validateScene({ ...createEmptyScene(), nodes: [...character('wolf').nodes, ...character('villager').nodes] })
  assert.deepEqual(bindRigs(scene).map((rig) => rig.kind).sort(), ['biped', 'quadruped'])
  const phases = bindRigs(expandSceneRecipe({ name: 'crowd', background: '#112233', exposure: 1, lightIntensity: 1, duration: 12, nodes: [{
    id: 'mob', parentId: null, name: 'mob', kind: 'group', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], dimensions: [1, 1, 1], color: '#ffffff', metalness: 0, roughness: 0.5,
    repeat: { ...single, count: 3, offset: [3, 0, 0] }, overlapWith: [], prefab: { type: 'goblin', size: 1, seed: 1, primary: null, secondary: null, text: '', lit: false, interactive: true } }] })).map((rig) => rig.phase)
  assert.equal(new Set(phases).size, 3, 'copies walk out of sync')
})

test('player avatars are rigged bipeds about 1.75 m tall facing +Z', () => {
  for (const kind of avatarKinds) {
    const parts = buildAvatar(kind)
    const nodes: SceneNode[] = [{ ...createNode('group'), id: 'avatar' }, ...parts.map((part) => ({ ...createNode(part.kind), ...part, id: part.id, parentId: part.parentId ?? 'avatar', rotation: part.rotation ?? [0, 0, 0],
      material: { ...createNode('box').material, ...part.material }, geometry: { ...createNode(part.kind).geometry, ...part.geometry }, overlapWith: part.overlapWith ?? [] }) as SceneNode)]
    const doc = validateScene({ ...createEmptyScene(), nodes })
    const box = bounds(doc), binding = bindParts('avatar', 'biped', parts)
    const head = sceneMatrices(doc).get('j_head')!.elements[13]
    assert.ok(head > 1.45 && head < 1.7 && box.max.y > 1.7 && Math.abs(box.min.y) < 0.03, `${kind}: ${box.min.y}..${box.max.y}, head ${head}`)
    for (const joint of rigJoints.biped) assert.ok(binding.joints.some((entry) => entry.joint === joint), `${kind} lacks ${joint}`)
    const nose = doc.nodes.find((node) => ['visor', 'nose', 'eyeL'].includes(node.id))
    assert.ok(nose && sceneMatrices(doc).get(nose.id)!.elements[14] > 0.05, `${kind} must face +Z`)
  }
})

test('character behaviors stay inside the scene contract and scale with size', () => {
  for (const type of characterTypes) for (const size of [0.3, 1, 2.5, 5]) {
    const behavior = characterBehavior(type, size)!
    assert.deepEqual(validateBehavior(behavior), behavior, `${type} x${size}`)
    if (behavior.type === 'enemy') assert.ok(behavior.health! >= 2 && behavior.attack && behavior.damage > 0)
    else assert.equal(behavior.damage, 0)
  }
  assert.equal(characterBehavior('dragon', 5)!.range, 80)
  assert.ok(characterBehavior('wolf', 2)!.range > characterBehavior('wolf', 1)!.range)
  assert.equal(characterBehavior('drone', 1)!.flying, true)
  assert.equal(characterBehavior('golem', 1)!.health, 10)
})
