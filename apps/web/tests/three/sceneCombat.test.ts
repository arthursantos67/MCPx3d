import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three'
import { enemyShot, fireWeapon, meleeTargets, stepProjectiles, weaponStats, type Projectile } from '../../src/three/sceneCombat.ts'
import { boxFromMatrix, buildStaticCollider, type PlayerCollider } from '../../src/three/scenePlayer.ts'

const box = (x: number, y: number, z: number, w: number, h: number, d: number, angle = 0) =>
  boxFromMatrix(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle), new THREE.Vector3(w, h, d)))
const empty = (): PlayerCollider => ({ bvh: null, boxes: [], floor: -10 })
const run = (list: Projectile[], collider: PlayerCollider, targets: Parameters<typeof stepProjectiles>[3], player?: { position: THREE.Vector3 }, frames = 40, dt = 0.1) => {
  const hits: ReturnType<typeof stepProjectiles>['hits'] = []
  for (let i = 0; i < frames && list.length; i++) { const result = stepProjectiles(list, dt, collider, targets, player); list = result.alive; hits.push(...result.hits) }
  return { hits, alive: list }
}

test('weapon table: fists match the legacy strike, melee weapons have no projectile', () => {
  assert.equal(weaponStats.none.range, 2.8)
  assert.equal(weaponStats.sword.damage, 2)
  assert.ok(weaponStats.sword.arc! > weaponStats.none.arc!)
  assert.equal(fireWeapon('sword', new THREE.Vector3(), new THREE.Vector3(0, 0, -1)), null)
  const bolt = fireWeapon('blaster', new THREE.Vector3(), new THREE.Vector3(0, 0, -2), 2)!
  assert.equal(bolt.owner, 'player'); assert.equal(bolt.damage, 2); assert.equal(bolt.velocity.length(), weaponStats.blaster.speed)
  assert.ok(weaponStats.staff.radius! > weaponStats.blaster.radius! && weaponStats.staff.speed! < weaponStats.blaster.speed!)
})

test('a static wall stops a projectile before the target behind it', () => {
  const geometry = new THREE.BoxGeometry(0.05, 4, 4)
  const { bvh } = buildStaticCollider([{ geometry, matrix: new THREE.Matrix4().makeTranslation(5, 1, 0) }])
  const { hits, alive } = run([fireWeapon('blaster', new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0))!], { ...empty(), bvh }, [{ id: 'foe', box: box(8, 1, 0, 1, 2, 1) }])
  assert.equal(alive.length, 0)
  assert.equal(hits.length, 1)
  assert.equal(hits[0].target, 'world')
  assert.ok(Math.abs(hits[0].point.x - 4.975) < 0.01, `stops at the wall face: ${hits[0].point.x}`)
  geometry.dispose(); bvh!.geometry.dispose()
})

test('fast projectiles hit thin rotated boxes without tunnelling at 0.1 s steps', () => {
  const target = box(6, 1, 0, 0.05, 2, 1.2, 0.3), shot = fireWeapon('blaster', new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0))!
  const { hits } = run([shot], empty(), [{ id: 'other', box: box(0, 1, 6, 1, 1, 1) }, { id: 'thin', box: target }])
  assert.deepEqual(hits.map((hit) => hit.target), ['thin'])
  assert.ok(hits[0].point.x < 6.2 && hits[0].point.x > 5.7)
  const door = { ...empty(), boxes: [box(3, 1, 0, 0.04, 3, 3)] }
  assert.deepEqual(run([fireWeapon('blaster', new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0))!], door, [{ id: 'thin', box: target }]).hits.map((hit) => hit.target), ['world'])
})

test('enemy shots hit the player capsule, ignore other enemies and expire', () => {
  const player = { position: new THREE.Vector3(8, 0, 0.2) }
  const shot = enemyShot('archer', new THREE.Vector3(0, 1.2, 0), new THREE.Vector3(1, 0, 0), 15)
  const { hits } = run([shot], empty(), [{ id: 'archer', box: box(0, 1, 0, 1, 2, 1) }, { id: 'ally', box: box(4, 1, 0, 1, 2, 1) }], player)
  assert.deepEqual(hits.map((hit) => [hit.target, hit.projectile.damage]), [['player', 15]])
  assert.ok(Math.abs(hits[0].point.x - (8 - Math.sqrt((0.32 + 0.15) ** 2 - 0.04))) < 0.02, `hits the capsule surface: ${hits[0].point.x}`)
  const miss = run([enemyShot('archer', new THREE.Vector3(0, 1.2, 0), new THREE.Vector3(0, 0, 1), 15)], empty(), [], player, 50)
  assert.equal(miss.hits.length, 0)
  assert.equal(miss.alive.length, 0, 'expired after its life')
  const own = run([fireWeapon('blaster', new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0))!], empty(), [], { position: new THREE.Vector3(3, 0, 0) })
  assert.equal(own.hits.length, 0, 'player shots never hit the player')
})

test('arrows follow a gravity arc and land on the ground', () => {
  const ground = new THREE.BoxGeometry(200, 0.2, 10)
  const { bvh } = buildStaticCollider([{ geometry: ground, matrix: new THREE.Matrix4().makeTranslation(0, -0.1, 0) }])
  const arrow = fireWeapon('bow', new THREE.Vector3(0, 1.5, 0), new THREE.Vector3(1, 0, 0))!
  const heights: number[] = []
  let list = [arrow], hit
  for (let i = 0; i < 40 && list.length; i++) { const result = stepProjectiles(list, 0.1, { ...empty(), bvh }, []); list = result.alive; heights.push(arrow.position.y); hit ??= result.hits[0] }
  assert.ok(hit && hit.target === 'world', 'lands')
  assert.ok(Math.abs(hit.point.y) < 0.01)
  const expected = Math.sqrt(2 * 1.5 / weaponStats.bow.gravity!) * weaponStats.bow.speed!
  assert.ok(Math.abs(hit.point.x - expected) < 1, `range ${hit.point.x} vs ${expected}`)
  assert.ok(heights.every((y, i) => i === 0 || y <= heights[i - 1]))
  ground.dispose(); bvh!.geometry.dispose()
})

test('melee targets: range, arc, nearest first and line of sight', () => {
  const origin = new THREE.Vector3(0, 1.4, 0), forward = new THREE.Vector3(0, 0, -1)
  const targets = [{ id: 'far', box: box(0, 1, -2.6, 1, 2, 1) }, { id: 'near', box: box(0.3, 1, -1.5, 1, 2, 1) }, { id: 'behind', box: box(0, 1, 2, 1, 2, 1) },
    { id: 'side', box: box(1.5, 1, -1.5, 1, 2, 1) }, { id: 'out', box: box(0, 1, -5, 1, 2, 1) }, { id: 'near', box: box(0.3, 1, -1.2, 0.5, 0.5, 0.5) }]
  assert.deepEqual(meleeTargets(origin, forward, 2.8, 50, targets), ['near', 'far'])
  assert.deepEqual(meleeTargets(origin, forward, 3.2, 110, targets), ['near', 'side', 'far'])
  const wall = { ...empty(), boxes: [box(0, 1, -1.9, 4, 3, 0.1)] }
  assert.deepEqual(meleeTargets(origin, forward, 3.2, 110, targets, wall), ['near', 'side'])
})
