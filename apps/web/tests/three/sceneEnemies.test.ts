import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three'
import { alertGuard, createEnemyMotion, enemyCanSee, NPC_LIFE, provokeNpc, stepEnemyMotion, type EnemyStep } from '../../src/three/sceneEnemies.ts'
import { buildNavigation, createRouter } from '../../src/three/sceneNavigation.ts'
import { chatSpot, type ActivitySpot, type NpcTask } from '../../src/three/sceneRoutines.ts'
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

const wallBox = (width: number, depth: number, x: number, z: number) => ({ geometry: new THREE.BoxGeometry(width, 3, depth), matrix: new THREE.Matrix4().makeTranslation(x, 1.5, z) })
/** A floor with a cup open to -x: back wall at x = 2 and two wings, so steering straight to +x from inside is a dead end. */
function cupArena() {
  const entries = [{ geometry: new THREE.BoxGeometry(30, 0.2, 30), matrix: new THREE.Matrix4().makeTranslation(0, -0.1, 0) }, wallBox(0.2, 6.2, 2, 0), wallBox(3.6, 0.2, 0.3, 3), wallBox(3.6, 0.2, 0.3, -3)]
  const { bvh } = buildStaticCollider(entries)
  const insideWall = (p: THREE.Vector3) => (Math.abs(p.x - 2) < 0.1 && Math.abs(p.z) < 3.1) || (p.x > -1.5 && p.x < 2.1 && Math.abs(Math.abs(p.z) - 3) < 0.1)
  return { entries, collider: { bvh, boxes: [], floor: -10 } as PlayerCollider, insideWall, dispose: () => { for (const entry of entries) entry.geometry.dispose(); bvh!.geometry.dispose() } }
}
const far = new THREE.Vector3(60, 0, 60)
const forwardOf = (heading: number) => new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading))
const task = (activity: NpcTask['activity'], position: THREE.Vector3 | null, facing = 0, patrol: [THREE.Vector3, THREE.Vector3] | null = null, kind: ActivitySpot['kind'] = 'point'): NpcTask => ({
  key: `${activity}:${position?.toArray()}`, activity, patrol, spot: position ? { position, facing, face: position.clone().add(forwardOf(facing).multiplyScalar(3)).setY(1.5), kind } : null })
const arenaFocus = new THREE.Box3(new THREE.Vector3(-15, -1, -15), new THREE.Vector3(15, 3, 15))

test('a routed enemy leaves a dead-end cup that traps direct steering, without crossing its walls', async () => {
  const arena = cupArena(), nav = await buildNavigation(arena.entries, arenaFocus, { radius: 0.43, height: 1.1, climb: 0.27 })
  assert.ok(nav, 'navmesh available')
  const router = createRouter(nav), base = new THREE.Vector3(7, 0, 0)
  let closest = Infinity
  const run = (routed: boolean) => {
    const enemy = createEnemyMotion(base, 0)
    closest = Infinity
    enemy.position.set(0, 0, 0); enemy.mode = 'return'
    for (let i = 0; i < 300; i++) {
      stepEnemyMotion(enemy, { ...settings, ...(routed ? { route: (from: THREE.Vector3, to: THREE.Vector3) => router.next('e', from, to, i * 0.1) } : {}) }, far, arena.collider, 0.1)
      assert.ok(!arena.insideWall(enemy.position), `crossed a wall at ${enemy.position.toArray()}`)
      closest = Math.min(closest, Math.hypot(enemy.position.x - base.x, enemy.position.z - base.z))
    }
    return { enemy, closest }
  }
  const direct = run(false).closest, routed = run(true)
  assert.ok(direct > 3, `direct steering is expected to stay trapped: ${direct}`)
  assert.ok(routed.closest < 0.5, `routed enemy reaches its base: ${routed.closest}`)
  assert.equal(routed.enemy.mode, 'patrol', 'then resumes patrolling around it')
  nav.dispose(); arena.dispose()
})

test('crowds keep their distance while chasing, never overlap or cross walls', () => {
  const geometry = new THREE.BoxGeometry(0.2, 3, 30), { bvh } = buildStaticCollider([{ geometry, matrix: new THREE.Matrix4().makeTranslation(3, 1.5, 0) }])
  const collider = { ...empty(), bvh }, player = new THREE.Vector3(2, 0, 0), melee = { ...settings, attack: 'melee' as const }
  const pack = (avoid: boolean) => {
    const enemies = [-2.5, -1.5, -0.5, 0.5, 1.5, 2.5].map((z, i) => createEnemyMotion(new THREE.Vector3(-6, 0, z), 0, i * 1.7))
    let closest = Infinity
    for (let frame = 0; frame < 150; frame++) {
      for (const enemy of enemies) {
        stepEnemyMotion(enemy, { ...melee, ...(avoid ? { neighbors: enemies.filter((other) => other !== enemy).map((other) => other.position) } : {}) }, player, collider, 0.1)
        assert.ok(enemy.position.x <= 3 - 0.1 - 0.43 + 0.005, `crossed the wall: ${enemy.position.toArray()}`)
      }
      if (frame > 20) for (let i = 0; i < enemies.length; i++) for (let j = i + 1; j < enemies.length; j++) closest = Math.min(closest, Math.hypot(enemies[i].position.x - enemies[j].position.x, enemies[i].position.z - enemies[j].position.z))
    }
    return { closest, nearPlayer: enemies.filter((enemy) => enemy.position.distanceTo(player) < 2.2).length }
  }
  const plain = pack(false), crowd = pack(true)
  assert.ok(plain.closest < 0.5, `without neighbors they pile up: ${plain.closest}`)
  assert.ok(crowd.closest >= 0.86 - 0.05, `minimum spacing kept: ${crowd.closest}`)
  assert.ok(crowd.nearPlayer >= 3, `the pack still surrounds the player: ${crowd.nearPlayer}`)
  geometry.dispose(); bvh!.geometry.dispose()
})

test('NPC routines walk to a spot, settle facing its direction and expose pose, look target and anchor', async () => {
  const arena = cupArena(), nav = await buildNavigation(arena.entries, arenaFocus, { radius: 0.3, height: 1.7, climb: 0.27 })
  assert.ok(nav)
  const router = createRouter(nav), seat = new THREE.Vector3(5, 0, 0.5), npc = { speed: 2, range: 6, npc: true, radius: 0.3, height: 1.7 }
  const villager = createEnemyMotion(new THREE.Vector3(0, 0, 0), 0, 0.4), sitting = task('sit', seat, Math.PI / 2, null, 'seat')
  let result: EnemyStep | null = null
  for (let i = 0; i < 400 && result?.activity !== 'sit'; i++) result = stepEnemyMotion(villager, { ...npc, task: sitting, route: (from, to) => router.next('v', from, to, i * 0.1) }, far, arena.collider, 0.1)
  assert.equal(result!.activity, 'sit', 'sat down after routing out of the cup')
  assert.ok(villager.position.distanceTo(seat) < 0.4 && Math.abs(villager.heading - Math.PI / 2) < 1e-9)
  assert.ok(result!.anchor!.equals(seat) && result!.face!.y > 1)
  const settled = villager.position.clone()
  for (let i = 0; i < 20; i++) result = stepEnemyMotion(villager, { ...npc, task: sitting }, far, arena.collider, 0.1)
  assert.ok(villager.position.equals(settled) && result!.activity === 'sit', 'stays seated')
  // A seated NPC only turns its head toward a nearby player; it keeps sitting.
  const visitor = villager.position.clone().add(new THREE.Vector3(0, 0, 2))
  result = stepEnemyMotion(villager, { ...npc, task: sitting }, visitor, arena.collider, 0.1)
  assert.equal(result.activity, 'sit'); assert.ok(result.face!.distanceTo(visitor.clone().setY(visitor.y + 1.5)) < 1e-6); assert.ok(Math.abs(villager.heading - Math.PI / 2) < 1e-9)
  // Furniture in the way: the NPC settles close by instead of jittering forever.
  const blocked = createEnemyMotion(new THREE.Vector3(0, 0, 0), 0, 0.4), behind = new THREE.Vector3(2.6, 0, 0)
  for (let i = 0; i < 120; i++) result = stepEnemyMotion(blocked, { ...npc, task: task('work', behind) }, far, arena.collider, 0.1)
  assert.equal(result!.activity, 'work')
  assert.ok(blocked.position.distanceTo(behind) < 1.8 && blocked.position.x < 2 - 0.1)
  nav.dispose(); arena.dispose()
})

test('chatting NPCs face each other; patrols go back and forth with guard pauses', () => {
  const center = new THREE.Vector3(0, 0, 0), npc = { speed: 2, range: 6, npc: true }
  const a = createEnemyMotion(new THREE.Vector3(-3, 0, 1), 0, 0.2), b = createEnemyMotion(new THREE.Vector3(3, 0, -1), 0, 1.3)
  const tasks = [chatSpot(center, 1.2, 2, 0), chatSpot(center, 1.2, 2, 1)].map((spot): NpcTask => ({ key: 'chat', activity: 'chat', spot, patrol: null }))
  let steps: EnemyStep[] = []
  for (let i = 0; i < 100; i++) steps = [stepEnemyMotion(a, { ...npc, task: tasks[0], neighbors: [b.position] }, far, empty(), 0.1), stepEnemyMotion(b, { ...npc, task: tasks[1], neighbors: [a.position] }, far, empty(), 0.1)]
  assert.deepEqual(steps.map((step) => step.activity), ['chat', 'chat'])
  const ab = b.position.clone().sub(a.position).setY(0).normalize()
  assert.ok(forwardOf(a.heading).dot(ab) > 0.99 && forwardOf(b.heading).dot(ab) < -0.99, 'they look at each other')
  const guard = createEnemyMotion(new THREE.Vector3(0, 0, 0), 0, 0.5), end = new THREE.Vector3(6, 0, 0), patrol = task('patrol', end, 0, [new THREE.Vector3(0, 0, 0), end])
  const visits = { base: 0, end: 0 }
  let guarding = 0, wasPaused = false
  for (let i = 0; i < 600; i++) {
    const step = stepEnemyMotion(guard, { ...npc, range: 4, task: patrol }, far, empty(), 0.1)
    if (step.activity === 'guard') guarding++
    const paused = guard.action === 'pause'
    if (paused && !wasPaused) { if (guard.position.distanceTo(end) < 0.5) visits.end++; else if (guard.position.length() < 0.5) visits.base++ }
    wasPaused = paused
  }
  assert.ok(visits.end >= 2 && visits.base >= 2, `back and forth: ${JSON.stringify(visits)}`)
  assert.ok(guarding > 50, 'stands guard at each end')
})

test('NPCs greet the player for a moment; ignoring NPCs carry on', () => {
  const npc = { speed: 2, range: 6, npc: true }
  const friendly = createEnemyMotion(new THREE.Vector3(), 0, 0.7), player = new THREE.Vector3(2, 0, 0)
  const activities = Array.from({ length: 20 }, () => stepEnemyMotion(friendly, npc, player, empty(), 0.1).activity)
  assert.equal(activities[0], 'greet')
  assert.ok(activities.filter((activity) => activity === 'greet').length >= 10 && activities.at(-1) === null, `${activities}`)
  assert.equal(friendly.action, 'talk')
  const busy = createEnemyMotion(new THREE.Vector3(), 0, 0.7), start = busy.position.clone()
  for (let i = 0; i < 20; i++) assert.notEqual(stepEnemyMotion(busy, { ...npc, reaction: 'ignore' }, player, empty(), 0.1).activity, 'greet')
  assert.ok(busy.position.distanceTo(start) > 0.3 && busy.action !== 'talk', 'keeps wandering')
})

test('NPCs flee from chasing enemies and from a player who attacked them', () => {
  const npc = { speed: 2, range: 8, npc: true }, threat = new THREE.Vector3(1.5, 0, 0)
  const scared = createEnemyMotion(new THREE.Vector3(), 0, 0.7)
  let result = stepEnemyMotion(scared, { ...npc, reaction: 'flee', threats: [threat] }, far, empty(), 0.1)
  assert.equal(result.activity, 'flee')
  for (let i = 0; i < 20; i++) result = stepEnemyMotion(scared, { ...npc, reaction: 'flee', threats: [threat] }, far, empty(), 0.1)
  assert.ok(scared.position.distanceTo(threat) > 4, `ran away: ${scared.position.toArray()}`)
  let calm = 0
  for (let i = 0; i < 60 && result.activity === 'flee'; i++) { result = stepEnemyMotion(scared, { ...npc, reaction: 'flee' }, far, empty(), 0.1); calm++ }
  assert.ok(calm >= 25 && calm <= 40 && result.activity !== 'flee', `fear fades after ~3 s: ${calm}`)
  const brave = createEnemyMotion(new THREE.Vector3(), 0, 0.7)
  assert.notEqual(stepEnemyMotion(brave, { ...npc, reaction: 'ignore', threats: [threat] }, far, empty(), 0.1).activity, 'flee')
  const victim = createEnemyMotion(new THREE.Vector3(), 0, 0.7), attacker = new THREE.Vector3(1, 0, 0)
  provokeNpc(victim, attacker)
  for (let i = 0; i < 15; i++) result = stepEnemyMotion(victim, npc, attacker, empty(), 0.1)
  assert.equal(result.activity, 'flee')
  assert.ok(victim.position.distanceTo(attacker) > 3, 'flees from the attacker instead of greeting')
  const stoic = createEnemyMotion(new THREE.Vector3(), 0, 0.7)
  provokeNpc(stoic, attacker, 'ignore')
  assert.equal(stoic.fear, 0)
})

test('alerting NPCs run to the nearest guard, who then heads to the threat', () => {
  const npc = { speed: 2, range: 8, npc: true }, threat = new THREE.Vector3(-2, 0, 0)
  const herald = createEnemyMotion(new THREE.Vector3(), 0, 0.7), guardBase = new THREE.Vector3(9, 0, 0), farGuard = new THREE.Vector3(-30, 0, 0)
  let alarm: THREE.Vector3 | undefined, result: EnemyStep | null = null
  for (let i = 0; i < 80 && !alarm; i++) {
    result = stepEnemyMotion(herald, { ...npc, reaction: 'alert', threats: herald.position.distanceTo(threat) < 7 ? [threat] : [], guards: [farGuard, guardBase] }, far, empty(), 0.1)
    assert.equal(result.activity, 'alert')
    alarm = result.alarm
  }
  assert.ok(alarm && alarm.equals(threat), 'reports the threat')
  assert.ok(herald.position.distanceTo(guardBase) <= NPC_LIFE.report + 0.1, 'reached the nearest guard')
  const guard = createEnemyMotion(guardBase, 0, 0.3)
  alertGuard(guard, alarm!)
  for (let i = 0; i < 80; i++) result = stepEnemyMotion(guard, { ...npc, guard: true, task: task('guard', guardBase) }, far, empty(), 0.1)
  assert.equal(result!.activity, 'alert')
  assert.ok(guard.position.distanceTo(threat) < NPC_LIFE.guardStop + 0.3, `guard went to the threat: ${guard.position.toArray()}`)
  assert.ok(forwardOf(guard.heading).dot(threat.clone().sub(guard.position).normalize()) > 0.99)
  for (let i = 0; i < 200; i++) result = stepEnemyMotion(guard, { ...npc, guard: true, task: task('guard', guardBase) }, far, empty(), 0.1)
  assert.equal(result!.activity, 'guard', 'returns to its post once the alarm expires')
  assert.ok(guard.position.distanceTo(guardBase) < 0.4)
})
