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

test('flyers hover above their base with a slight bob, cross ledges without support and rise toward the player', () => {
  const floor = new THREE.BoxGeometry(4, 0.2, 4)
  const { bvh } = buildStaticCollider([{ geometry: floor, matrix: new THREE.Matrix4().makeTranslation(0, -0.1, 0) }])
  const bat = createEnemyMotion(new THREE.Vector3(0, 3, 0), 0), collider = { ...empty(), floor: -20, bvh }, flyer = { ...settings, flying: true }
  const player = new THREE.Vector3(7, 4, 0)
  let low = Infinity, high = -Infinity
  for (let i = 0; i < 60; i++) { stepEnemyMotion(bat, flyer, player, collider, 0.1); low = Math.min(low, bat.position.y); high = Math.max(high, bat.position.y) }
  assert.ok(bat.position.x > 4, `flyer must cross the ledge: ${bat.position.toArray()}`)
  assert.ok(high > 4.5 && high <= 3 + 3 + 0.16, `rises toward the player within limits: ${high}`)
  assert.ok(low > 2.8, `never drops to the ground: ${low}`)
  const idle = createEnemyMotion(new THREE.Vector3(0, 3, 0), 0), heights: number[] = []
  for (let i = 0; i < 30; i++) { stepEnemyMotion(idle, flyer, new THREE.Vector3(60, 0, 0), collider, 0.1); heights.push(idle.position.y) }
  assert.ok(Math.max(...heights) - Math.min(...heights) > 0.1 && heights.every((y) => Math.abs(y - 3) <= 0.151), 'bobs around its base altitude')
  const walled = createEnemyMotion(new THREE.Vector3(0, 3, 0), 0)
  for (let i = 0; i < 40; i++) stepEnemyMotion(walled, flyer, new THREE.Vector3(6, 3, 0), { ...collider, boxes: [obstacle(2, 3, 0, 0.1, 10, 30)] }, 0.1)
  assert.ok(walled.position.x < 2 - 0.43 + 0.01, 'colliders still block flyers')
  floor.dispose(); bvh!.geometry.dispose()
})

test('chargers wind up, dash at high speed, then cool down', () => {
  const bull = createEnemyMotion(new THREE.Vector3(), 0), player = new THREE.Vector3(5, 0, 0), charger = { ...settings, speed: 2, attack: 'charge' as const }
  const attacks: string[] = []
  let windupTime = 0, fastest = 0
  for (let i = 0; i < 30; i++) {
    const before = bull.position.clone(), result = stepEnemyMotion(bull, charger, player, empty(), 0.05)
    if (bull.action === 'windup') { windupTime += 0.05; assert.equal(result.moved, false) }
    if (result.attack) attacks.push(result.attack)
    fastest = Math.max(fastest, before.distanceTo(bull.position) / 0.05)
  }
  assert.deepEqual(attacks, ['charge'])
  assert.ok(windupTime >= 0.35 && windupTime <= 0.45, `windup ${windupTime}`)
  assert.ok(fastest > 2 * 2.3, `dash speed ${fastest}`)
  assert.ok(bull.cooldown > 0 || bull.action === 'dash')
})

test('ranged enemies keep their distance, strafe and shoot on a cooldown; turrets only shoot', () => {
  const archer = createEnemyMotion(new THREE.Vector3(), 0), player = new THREE.Vector3(3, 0, 0), ranged = { ...settings, attack: 'ranged' as const }
  const shots: THREE.Vector3[] = []
  let sideways = 0
  for (let i = 0; i < 40; i++) {
    const result = stepEnemyMotion(archer, ranged, player, empty(), 0.1)
    if (result.attack === 'shoot') { assert.ok(result.aim && Math.abs(result.aim.length() - 1) < 1e-6 && result.muzzle); shots.push(result.aim!) }
    sideways = Math.max(sideways, Math.abs(archer.position.z))
  }
  assert.ok(shots.length >= 2 && shots.length <= 3, `shots ${shots.length}`)
  assert.ok(shots[0].x > 0.9, 'aims at the player')
  assert.ok(archer.position.distanceTo(player) > 5, `keeps distance: ${archer.position.distanceTo(player)}`)
  assert.ok(sideways > 0.3, 'strafes')
  const turret = createEnemyMotion(new THREE.Vector3(), 0)
  let fired = 0
  for (let i = 0; i < 40; i++) if (stepEnemyMotion(turret, { ...ranged, speed: 0 }, player, empty(), 0.1).attack === 'shoot') fired++
  assert.equal(turret.position.length(), 0)
  assert.ok(fired >= 2)
  const blind = createEnemyMotion(new THREE.Vector3(), 0)
  for (let i = 0; i < 20; i++) assert.equal(stepEnemyMotion(blind, { ...ranged, speed: 0 }, player, { ...empty(), boxes: [obstacle(1.5, 1.5, 0, 0.1, 3, 10)] }, 0.1).attack, undefined)
})

test('melee enemies approach, wind up and strike only if the player stays in reach', () => {
  const knight = createEnemyMotion(new THREE.Vector3(), 0), melee = { ...settings, attack: 'melee' as const }
  const player = new THREE.Vector3(5, 0, 0), strikes: number[] = []
  for (let i = 0; i < 60; i++) if (stepEnemyMotion(knight, melee, player, empty(), 0.1).attack === 'melee') strikes.push(i)
  const gap = Math.hypot(player.x - knight.position.x, player.z - knight.position.z)
  assert.ok(gap > 0.9 && gap <= 1.45, `stops in reach: ${gap}`)
  assert.ok(strikes.length >= 2, `strikes ${strikes}`)
  assert.ok(strikes[1] - strikes[0] >= 10, 'cooldown between strikes')
  const dodger = createEnemyMotion(new THREE.Vector3(4, 0, 0), 0), near = new THREE.Vector3(5, 0, 0)
  for (let i = 0; i < 3; i++) stepEnemyMotion(dodger, melee, near, empty(), 0.1)
  assert.equal(dodger.action, 'windup')
  const far = new THREE.Vector3(9, 0, 0)
  let hit = false
  for (let i = 0; i < 4; i++) hit ||= stepEnemyMotion(dodger, melee, far, empty(), 0.1).attack === 'melee'
  assert.equal(hit, false, 'stepping away during the windup dodges the strike')
})

test('NPCs wander near their base, pause, face a nearby player and never chase or attack', () => {
  const villager = createEnemyMotion(new THREE.Vector3(10, 0, 10), 0, 0.7), npc = { speed: 2, range: 6, npc: true, attack: 'melee' as const }
  let farthest = 0, paused = false
  for (let i = 0; i < 300; i++) {
    const result = stepEnemyMotion(villager, npc, new THREE.Vector3(40, 0, 40), empty(), 0.1)
    assert.equal(result.attack, undefined); assert.equal(result.mode, 'patrol')
    farthest = Math.max(farthest, villager.position.distanceTo(villager.base))
    paused ||= villager.action === 'pause'
  }
  assert.ok(farthest > 0.5 && farthest <= 4.01, `wanders within range: ${farthest}`)
  assert.ok(paused)
  const twin = createEnemyMotion(new THREE.Vector3(10, 0, 10), 0, 0.7)
  for (let i = 0; i < 300; i++) stepEnemyMotion(twin, npc, new THREE.Vector3(40, 0, 40), empty(), 0.1)
  assert.deepEqual(twin.position.toArray(), villager.position.toArray(), 'deterministic')
  const visitor = villager.position.clone().add(new THREE.Vector3(2, 0, 0)), still = villager.position.clone()
  for (let i = 0; i < 20; i++) { const result = stepEnemyMotion(villager, npc, visitor, empty(), 0.1); assert.equal(result.attack, undefined); assert.equal(result.seesPlayer, true) }
  assert.ok(villager.position.distanceTo(still) < 1e-9, 'stops while the player is near')
  assert.ok(Math.abs(villager.heading - Math.PI / 2) < 1e-6, 'faces the player')
  assert.equal(villager.action, 'talk')
})
