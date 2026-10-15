import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three'
import { createEmptyScene, createNode, type SceneNode } from '../../src/three/sceneDocument.ts'
import { checkOutcome, createRuntime, runtimeVisible, triggerInteraction } from '../../src/three/sceneRuntime.ts'
import { buildStaticCollider, emptyInput, stepPlayer, type PlayerState } from '../../src/three/scenePlayer.ts'

const scene = (nodes: SceneNode[], objective?: 'collectAll' | 'defeatEnemies') => ({ ...createEmptyScene(), nodes,
  environment: { ...createEmptyScene().environment, ...(objective ? { objective: { type: objective, title: '', timeLimit: 0 } } : {}) } })

test('a switch reveals a passage authored as hidden, and hides it again', () => {
  const bridge = { ...createNode('box'), id: 'bridge', visible: false }
  const lever = { ...createNode('box'), id: 'lever', interaction: { trigger: 'click' as const, key: '', radius: 3, action: 'toggleVisibility' as const, targetId: 'bridge', message: '' } }
  const runtime = createRuntime(scene([bridge, lever]))
  assert.equal(runtimeVisible(runtime, bridge), false)
  triggerInteraction(runtime, 'lever')
  assert.equal(runtimeVisible(runtime, bridge), true)
  triggerInteraction(runtime, 'lever')
  assert.equal(runtimeVisible(runtime, bridge), false)
})

test('an objective without matching content is not won on the first frame, and hidden items do not count', () => {
  const enemy = { ...createNode('box'), id: 'foe', behavior: { type: 'enemy' as const, speed: 2, range: 8, damage: 10 } }
  const runtime = createRuntime(scene([enemy], 'collectAll'))
  checkOutcome(runtime)
  assert.equal(runtime.outcome, 'playing')
  const hiddenGroup = { ...createNode('group'), id: 'vault', visible: false }
  const coin = { ...createNode('box'), id: 'coin', parentId: 'vault', interaction: { trigger: 'proximity' as const, key: '', radius: 1.4, action: 'collect' as const, targetId: null, message: '' } }
  const visibleCoin = { ...coin, id: 'coin-2', parentId: null }
  assert.equal(createRuntime(scene([hiddenGroup, coin, visibleCoin], 'collectAll')).collectibles, 1)
})

test('a long fall lands on a thin floor instead of tunnelling through it', () => {
  const floor = new THREE.BoxGeometry(20, 0.1, 20)
  const { bvh } = buildStaticCollider([{ geometry: floor, matrix: new THREE.Matrix4().makeTranslation(0, -0.05, 0) }])
  const player: PlayerState = { position: new THREE.Vector3(0, 80, 0), velocity: new THREE.Vector3(), yaw: 0, pitch: 0, onGround: false, fly: false }
  for (let i = 0; i < 600; i++) stepPlayer(player, emptyInput(), { bvh, boxes: [], floor: -50 }, { speed: 4.5, jumpHeight: 1.1 }, 1 / 60)
  assert.ok(Math.abs(player.position.y) < 0.05, `player rests on the floor (y=${player.position.y})`)
  floor.dispose()
})
