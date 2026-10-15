import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three'
import { createEnemyMotion, enemyCanSee, stepEnemyMotion } from '../../src/three/sceneEnemies.ts'
import { boxFromMatrix, buildStaticCollider, type PlayerCollider } from '../../src/three/scenePlayer.ts'

function obstacle(x: number, y: number, z: number, width: number, height: number, depth: number, angle = 0) {
  return boxFromMatrix(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle), new THREE.Vector3(width, height, depth)))
}
const empty = (): PlayerCollider => ({ bvh: null, boxes: [], floor: 0 })
const settings = { speed: 3, range: 12 }

test('enemy perception is blocked by static walls and rotating dynamic doors', () => {
  const geometry = new THREE.BoxGeometry(0.1, 3, 8)
  const { bvh } = buildStaticCollider([{ geometry, matrix: new THREE.Matrix4().makeTranslation(2, 1.5, 0) }])
  const from = new THREE.Vector3(0, 0.8, 0), target = new THREE.Vector3(5, 1.4, 0)
  assert.equal(enemyCanSee(from, target, { ...empty(), bvh }), false)
  assert.equal(enemyCanSee(from, new THREE.Vector3(-5, 1.4, 0), { ...empty(), bvh }), true)
  assert.equal(enemyCanSee(from, target, { ...empty(), boxes: [obstacle(2, 1.5, 0, 0.08, 3, 3, 0.25)] }), false)
  assert.equal(enemyCanSee(from, target, empty()), true)
  geometry.dispose(); bvh!.geometry.dispose()
})

test('blocked player does not trigger chase; last seen position is searched then forgotten', () => {
  const enemy = createEnemyMotion(new THREE.Vector3(0, 0, 0), 0), player = new THREE.Vector3(5, 0, 0), collider = empty()
  stepEnemyMotion(enemy, settings, player, collider, 0.1)
  assert.equal(enemy.mode, 'chase')
  assert.equal(enemy.lastSeen!.x, 5)
  collider.boxes = [obstacle(2, 1.5, 0, 0.1, 3, 30)]
  const hiddenPlayer = new THREE.Vector3(5, 0, 8)
  for (let i = 0; i < 3; i++) stepEnemyMotion(enemy, settings, hiddenPlayer, collider, 0.1)
  assert.equal(enemy.mode, 'search')
  assert.equal(enemy.lastSeen!.z, 0, 'search must not track a player through a wall')
  for (let i = 0; i < 60; i++) stepEnemyMotion(enemy, settings, hiddenPlayer, collider, 0.1)
  assert.ok(enemy.mode === 'return' || enemy.mode === 'patrol')
  const unaware = createEnemyMotion(new THREE.Vector3(0, 0, 0), 0)
  stepEnemyMotion(unaware, settings, hiddenPlayer, collider, 0.1)
  assert.equal(unaware.mode, 'patrol')
  assert.equal(unaware.lastSeen, null)
})

test('enemy sweeps stop tunnelling through thin walls at maximum speed and low frame rate', () => {
  const geometry = new THREE.BoxGeometry(0.03, 3, 20)
  const { bvh } = buildStaticCollider([{ geometry, matrix: new THREE.Matrix4().makeTranslation(1, 1.5, 0) }])
  const enemy = createEnemyMotion(new THREE.Vector3(0, 0, 0), 0), player = new THREE.Vector3(5, 0, 0)
  stepEnemyMotion(enemy, { ...settings, speed: 12 }, player, empty(), 0.01)
  for (let i = 0; i < 30; i++) {
    stepEnemyMotion(enemy, { ...settings, speed: 12 }, player, { ...empty(), bvh }, 0.1)
    assert.ok(enemy.position.x <= 1 - 0.43 + 0.005, `wall crossed at ${enemy.position.toArray()}`)
  }
  geometry.dispose(); bvh!.geometry.dispose()
})

test('enemy steers around a short moving obstacle without changing its world-space origin', () => {
  const base = new THREE.Vector3(100, 0, -80), enemy = createEnemyMotion(base, 0), player = new THREE.Vector3(107, 0, -80)
  stepEnemyMotion(enemy, settings, player, empty(), 0.1)
  const collider = { ...empty(), boxes: [obstacle(102, 1.5, -80, 0.12, 3, 1.8)] }
  let widest = 0
  for (let i = 0; i < 140; i++) {
    stepEnemyMotion(enemy, settings, player, collider, 0.1)
    widest = Math.max(widest, Math.abs(enemy.position.z + 80))
  }
  assert.ok(widest > 1.1, 'must route around the obstacle rather than through it')
  assert.ok(enemy.position.distanceTo(player) < 1.5, `did not reach target: ${enemy.position.toArray()}`)
  assert.deepEqual(enemy.base.toArray(), base.toArray())
})

test('enemy does not descend an unsupported ledge or snap to a roof above its head', () => {
  const floor = new THREE.BoxGeometry(6, 0.2, 6), roof = new THREE.BoxGeometry(20, 0.2, 20)
  const { bvh } = buildStaticCollider([{ geometry: floor, matrix: new THREE.Matrix4().makeTranslation(0, -0.1, 0) },
    { geometry: roof, matrix: new THREE.Matrix4().makeTranslation(0, 4, 0) }])
  const enemy = createEnemyMotion(new THREE.Vector3(0, 0, 0), 0), collider = { ...empty(), floor: -10, bvh }
  for (let i = 0; i < 100; i++) {
    stepEnemyMotion(enemy, settings, new THREE.Vector3(8, 0, 0), collider, 0.1)
    assert.ok(Math.abs(enemy.position.y) < 0.03, `snapped vertically: ${enemy.position.y}`)
    assert.ok(Math.abs(enemy.position.x) <= 3 && Math.abs(enemy.position.z) <= 3)
  }
  floor.dispose(); roof.dispose(); bvh!.geometry.dispose()
})

test('paused outcomes freeze motion and awareness; delta spikes remain bounded', () => {
  const enemy = createEnemyMotion(new THREE.Vector3(0, 2, 0), 0), player = new THREE.Vector3(6, 0, 0), collider = empty()
  const before = structuredClone(enemy)
  stepEnemyMotion(enemy, settings, player, collider, 5, false)
  assert.deepEqual(structuredClone(enemy), before)
  stepEnemyMotion(enemy, settings, player, collider, 50)
  assert.ok(enemy.position.distanceTo(new THREE.Vector3(0, 2, 0)) <= settings.speed * 0.1 + 0.001)
  assert.equal(enemy.hover, 2)
})

test('body dimensions distinguish low crawlers from tall sentinels at an overhead obstacle', () => {
  const player = new THREE.Vector3(5, 0, 0), low = createEnemyMotion(new THREE.Vector3(), 0), tall = createEnemyMotion(new THREE.Vector3(), 0)
  const crawler = { ...settings, radius: 0.28, height: 0.8, eyeHeight: 0.55 }, sentinel = { ...settings, radius: 0.4, height: 1.9, eyeHeight: 1.55 }
  stepEnemyMotion(low, crawler, player, empty(), 0.1)
  stepEnemyMotion(tall, sentinel, player, empty(), 0.1)
  const collider = { ...empty(), boxes: [obstacle(2, 1.7, 0, 1, 1, 20)] }
  for (let i = 0; i < 15; i++) { stepEnemyMotion(low, crawler, player, collider, 0.1); stepEnemyMotion(tall, sentinel, player, collider, 0.1) }
  assert.ok(low.position.x > 3, `crawler failed to pass under: ${low.position.toArray()}`)
  assert.ok(tall.position.x < 1.11, `sentinel clipped overhead obstacle: ${tall.position.toArray()}`)
})
