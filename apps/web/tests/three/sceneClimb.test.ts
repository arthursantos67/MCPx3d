import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three'
import { createNode, hasSurface, validateScene, type SceneNode, type ThreeSceneDocument } from '../../src/three/sceneDocument.ts'
import { expandSceneRecipe } from '../../src/three/sceneGeneration.ts'
import { buildNodeGeometry } from '../../src/three/sceneGeometry.ts'
import { sceneMatrices } from '../../src/three/scenePlacement.ts'
import { prefabParts } from '../../src/three/scenePrefabs.ts'
import { boxFromMatrix, buildStaticCollider, emptyInput, stepPlayer, type PlayerCollider, type PlayerState } from '../../src/three/scenePlayer.ts'
import { createClimbMemory, ladderNear, solveClimb } from '../../src/three/sceneClimb.ts'
import { createAvatar } from '../../src/three/sceneAvatar.ts'
import { animatorForBinding, applyAnimatorPose, updateAnimator } from '../../src/three/sceneCharacterAnimator.ts'

const repeat = { mode: 'linear', count: 1, offset: [0, 0, 0], radius: 0, axis: 'y' }
function scene(type: string, size = 1): ThreeSceneDocument {
  return expandSceneRecipe({ name: type, background: '#112233', exposure: 1, lightIntensity: 1, duration: 8, nodes: [
    { ...createNode('box'), id: 'floor', name: 'Piso', color: '#888888', metalness: 0, roughness: 0.9, position: [0, -0.1, 0], dimensions: [20, 0.2, 20], repeat },
    { ...createNode('group'), id: type, name: type, kind: 'group', position: [0, 0, 0], color: '#cccccc', metalness: 0, roughness: 0.6, repeat,
      prefab: { type, size, seed: 1, primary: null, secondary: null, text: '', lit: false, interactive: true } }] })
}
/** The same split the game makes: climbable parts become ladder boxes, the rest a static BVH. */
function collider(doc: ThreeSceneDocument): PlayerCollider {
  const matrices = sceneMatrices(doc), byId = new Map(doc.nodes.map((node) => [node.id, node]))
  const climbable = (node: SceneNode) => { for (let item: SceneNode | undefined = node; item; item = item.parentId ? byId.get(item.parentId) : undefined) if (item.behavior?.type === 'climbable') return true; return false }
  const surface = (node: SceneNode) => matrices.get(node.id)!.clone().scale(new THREE.Vector3(...node.dimensions))
  const solid = doc.nodes.filter((node) => hasSurface(node.kind) && node.collidable !== false && !climbable(node))
  return { bvh: buildStaticCollider(solid.map((node) => ({ geometry: buildNodeGeometry(node), matrix: surface(node) }))).bvh, boxes: [], floor: 0,
    climb: doc.nodes.filter((node) => hasSurface(node.kind) && climbable(node)).map((node) => boxFromMatrix(surface(node))) }
}

test('the ladder finder reads rungs, spacing and the climber side', () => {
  const ladder = ladderNear(collider(scene('ladder')).climb, new THREE.Vector3(0, 0.2, 0.4))!
  assert.ok(ladder)
  assert.equal(ladder.rungs.length, 7)
  assert.ok(Math.abs(ladder.spacing - 0.55) < 1e-6)
  assert.ok(ladder.normal.z > 0.99, 'the normal points to the climber')
  assert.ok(Math.abs(ladder.across.x) > 0.99)
  assert.equal(ladderNear(collider(scene('ladder')).climb, new THREE.Vector3(5, 0, 5)), null)
})

test('a watchtower can be climbed onto its deck, with headroom under the roof, even looking sideways', () => {
  for (const yaw of [0, 0.5]) {
    const doc = scene('tower'), world = collider(doc)
    const player: PlayerState = { position: new THREE.Vector3(0, 0, 2.02), velocity: new THREE.Vector3(), yaw, pitch: 0, onGround: true, fly: false }
    let deck = false
    for (let i = 0; i < 60 * 8 && !deck; i++) {
      stepPlayer(player, { ...emptyInput(), forward: true }, world, { speed: 4, jumpHeight: 1 }, 1 / 60)
      deck = player.onGround && !player.climbing && player.position.y > 5
    }
    assert.ok(deck, `reaches the deck (yaw ${yaw}): ${player.position.toArray().map((v) => v.toFixed(2))}`)
    assert.ok(player.position.z < 1.5, 'stands on the deck, past the ladder')
  }
})

test('every ladder in the catalogue leads onto its landing', () => {
  for (const [type, seed, start, yaw, landing] of [['castleWall', 1, [2.2, 0, -1.34], Math.PI, 4], ['castleTower', 1, [0, 0.21, -1.05], 0, 7.9], ['ladder', 1, [0, 0, 0.36], 0, -1]] as const) {
    const base = scene(type), doc = { ...base, nodes: base.nodes.map((node) => node.id === type ? { ...node, asset: { ...node.asset!, seed } } : node) }
    const rebuilt = expandSceneRecipe({ name: type, background: '#112233', exposure: 1, lightIntensity: 1, duration: 8, nodes: [
      { ...createNode('box'), id: 'floor', name: 'Piso', color: '#888888', metalness: 0, roughness: 0.9, position: [0, -0.1, 0], dimensions: [20, 0.2, 20], repeat },
      { ...createNode('group'), id: type, name: type, kind: 'group', position: [0, 0, 0], color: '#cccccc', metalness: 0, roughness: 0.6, repeat, prefab: { ...doc.nodes.find((node) => node.id === type)!.asset! } }] })
    const world = collider(rebuilt), player: PlayerState = { position: new THREE.Vector3(...start), velocity: new THREE.Vector3(), yaw, pitch: 0, onGround: true, fly: false }
    let top = 0
    for (let i = 0; i < 60 * 10; i++) {
      stepPlayer(player, { ...emptyInput(), forward: true }, world, { speed: 4, jumpHeight: 1 }, 1 / 60)
      if (player.onGround && !player.climbing) top = Math.max(top, player.position.y)
    }
    if (landing > 0) assert.ok(top > landing, `${type}: lands on top (${top.toFixed(2)}) at ${player.position.toArray().map((v) => v.toFixed(2))}`)
  }
})

test('climbing does not leave the ladder at its foot', () => {
  const world = collider(scene('tower'))
  const player: PlayerState = { position: new THREE.Vector3(0, 0, 2.02), velocity: new THREE.Vector3(), yaw: 0, pitch: 0, onGround: true, fly: false }
  for (let i = 0; i < 30; i++) stepPlayer(player, { ...emptyInput(), forward: true }, world, { speed: 4, jumpHeight: 1 }, 1 / 60)
  assert.ok(player.climbing && player.position.y > 0.5 && player.position.z > 1.9, 'still on the ladder, rising')
})

test('legacy watchtowers gain headroom on opening without touching the rest', () => {
  const doc = scene('tower'), roof = doc.nodes.find((node) => node.assetPart === 'roof')!, pillar = doc.nodes.find((node) => node.assetPart === 'pillar0')!
  const legacy = { ...doc, version: '1.3', nodes: doc.nodes.map((node) => node.id === roof.id ? { ...node, position: [0, 7.35, 0] } : node.id === pillar.id ? { ...node, position: [pillar.position[0], 5.95, pillar.position[2]], dimensions: [0.12, 1.4, 0.12] } : node) }
  const migrated = validateScene(legacy)
  assert.equal(migrated.nodes.find((node) => node.id === roof.id)!.position[1], prefabParts(roof && doc.nodes.find((node) => node.id === 'tower')!.asset!).find((part) => part.id === 'roof')!.position[1])
  assert.deepEqual(migrated.nodes.find((node) => node.id === pillar.id)!.dimensions, pillar.dimensions)
  assert.deepEqual(migrated.nodes.filter((node) => ![roof.id, pillar.id].includes(node.id)), doc.nodes.filter((node) => ![roof.id, pillar.id].includes(node.id)))
})

test('hand-over-hand climbing puts fists on rungs and soles on lower rungs', () => {
  const doc = scene('ladder'), ladder = ladderNear(collider(doc).climb, new THREE.Vector3(0, 0.6, 0.36))!
  const avatar = createAvatar('explorer', { quality: 'low', shadows: false }), skin = avatar.built.skins.get('avatar')!, holders = avatar.built.holders
  avatar.built.root.position.set(0, 0.6, 0.36); avatar.built.root.rotation.y = Math.PI
  const animator = animatorForBinding(avatar.binding), memory = createClimbMemory()
  for (let i = 0; i < 40; i++) {
    const pose = updateAnimator(animator, { dt: 1 / 60, time: i / 60, speed: 0, grounded: true, verticalSpeed: 0, dead: false, talk: false, climbing: true })
    avatar.built.root.updateMatrixWorld(true)
    applyAnimatorPose(avatar.binding, holders, pose)
    solveClimb(avatar.binding, holders, ladder, 0.6, { L: skin.grips.L!.position.clone(), R: skin.grips.R!.position.clone() }, memory, 1 / 60, true)
  }
  avatar.built.root.updateMatrixWorld(true)
  const onRung = (y: number) => Math.min(...ladder.rungs.map((rung) => Math.abs(rung - y)))
  for (const side of ['L', 'R'] as const) {
    const fist = skin.grips[side]!.getWorldPosition(new THREE.Vector3())
    assert.ok(onRung(fist.y - 0.02) < 0.12, `${side} fist near a rung: ${fist.y.toFixed(2)}`)
    assert.ok(fist.y > 1.4 && fist.y < 2.6, `${side} fist above the shoulders' reach band`)
    assert.ok(Math.abs(fist.z - ladder.center.z) < 0.15, `${side} fist on the ladder plane`)
  }
  assert.ok(memory.weight > 0.9)
  avatar.built.dispose(); avatar.resources.dispose()
})
