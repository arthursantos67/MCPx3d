import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three'
import { createNode, type NodeKind, type SceneRoutineStep, type ThreeSceneDocument, type Vector3Tuple } from '../../src/three/sceneDocument.ts'
import { expandSceneRecipe } from '../../src/three/sceneGeneration.ts'
import { createMarketTownScene } from '../../src/three/sceneExperiences.ts'
import { activitySpot, inPeriod, isGuardPlan, planRoutines, routineAt, routineHour, routinePoints, routineTask } from '../../src/three/sceneRoutines.ts'
import { sceneMatrices } from '../../src/three/scenePlacement.ts'

const single = { mode: 'linear', count: 1, offset: [0, 0, 0], radius: 0, axis: 'y' }
const node = (id: string, kind: NodeKind, position: Vector3Tuple, dimensions: Vector3Tuple, patch: Record<string, unknown> = {}) => ({ ...createNode(kind), id, name: id, position, dimensions, color: '#9aaebc', metalness: 0, roughness: 0.7, repeat: single, ...patch })
const asset = (id: string, type: string, position: Vector3Tuple, patch: Record<string, unknown> = {}) => node(id, 'group', position, [1, 1, 1], { prefab: { type, size: 1, seed: 5, primary: null, secondary: null, text: '', lit: false, interactive: true }, ...patch })
const npc = (id: string, position: Vector3Tuple, routine: SceneRoutineStep[], reaction = 'greet') =>
  asset(id, 'villager', position, { behavior: { type: 'npc', speed: 1, range: 8, damage: 0, routine, reaction } })
const village = (nodes: unknown[]): ThreeSceneDocument => expandSceneRecipe({ name: 'Vila', background: '#18212e', exposure: 1, lightIntensity: 1, duration: 12,
  nodes: [node('ground', 'box', [0, -0.1, 0], [60, 0.2, 60]), ...nodes] })
const steps = (activity: SceneRoutineStep['activity'], target: string | null, from = 0, to = 24): SceneRoutineStep => ({ activity, target, from, to })
const forward = (heading: number) => new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading))
const worldOf = (doc: ThreeSceneDocument, id: string) => new THREE.Vector3().setFromMatrixPosition(sceneMatrices(doc).get(id)!)
const local = (doc: ThreeSceneDocument, id: string, point: THREE.Vector3) => point.clone().applyMatrix4(sceneMatrices(doc).get(id)!.clone().invert())

test('routine periods follow the clock with a day cycle, wrap past midnight, and alternate by time slices without one', () => {
  const routine = [steps('work', 'stall', 7, 17), steps('chat', 'fountain', 17, 21), steps('sleep', null, 21, 7)]
  assert.equal(routineAt(routine, 9, 0)!.activity, 'work')
  assert.equal(routineAt(routine, 17, 0)!.activity, 'chat')
  assert.equal(routineAt(routine, 23.5, 0)!.activity, 'sleep')
  assert.equal(routineAt(routine, 3, 0)!.activity, 'sleep')
  assert.equal(routineAt(routine, 24 + 8, 0)!.activity, 'work', 'hours wrap modulo 24')
  assert.equal(routineAt([steps('sit', null, 9, 12)], 14, 0), null, 'outside every period the NPC wanders')
  assert.equal(routineAt(undefined, 9, 0), null)
  assert.ok(inPeriod(steps('guard', null, 0, 24), 23.99) && inPeriod(steps('guard', null, 5, 5), 1))
  const sliced = [0, 30, 46, 91, 136, 1e6].map((elapsed) => routineAt(routine, null, elapsed)!.activity)
  assert.deepEqual(sliced.slice(0, 5), ['work', 'work', 'chat', 'sleep', 'work'])
  assert.equal(routineAt(routine, null, 61, 20)!.activity, 'work', 'slice length is configurable')
  assert.equal(routineHour({ dayCycle: { enabled: true, duration: 480, start: 8 } } as never, 240), 20)
  assert.equal(routineHour({ dayCycle: { enabled: true, duration: 480, start: 20 } } as never, 240), 8)
  assert.equal(routineHour({ dayCycle: { enabled: false, duration: 480, start: 8 } } as never, 240), null)
  assert.equal(routineHour({} as never, 240), null)
})

test('bench and chair spots are distinct seats with the back to the backrest; extra NPCs stand in front', () => {
  const doc = village([asset('bench', 'bench', [3, 0, 2], { rotation: [0, 90, 0] }), asset('chair', 'chair', [-4, 0, 0])])
  const seats = [0, 1, 2, 3].map((index) => activitySpot(doc, 'bench', index, { activity: 'sit' })!)
  for (let i = 0; i < seats.length; i++) for (let j = i + 1; j < seats.length; j++) assert.ok(seats[i].position.distanceTo(seats[j].position) > 0.5, `slots ${i}/${j} overlap`)
  assert.deepEqual(seats.map((seat) => seat.kind), ['seat', 'seat', 'point', 'point'])
  // The backrest sits at local -z, so a seated NPC faces local +z: with the bench turned 90°, that is world +x.
  assert.ok(forward(seats[0].facing).distanceTo(new THREE.Vector3(1, 0, 0)) < 1e-6, `facing ${seats[0].facing}`)
  for (const seat of seats.slice(0, 2)) { const p = local(doc, 'bench', seat.position); assert.ok(Math.abs(p.z - 0.22) < 1e-6 && Math.abs(p.x) <= 0.4 + 1e-6) }
  const chair = activitySpot(doc, 'chair', 0, { activity: 'sit' })!
  assert.equal(chair.kind, 'seat')
  assert.ok(forward(chair.facing).distanceTo(new THREE.Vector3(0, 0, 1)) < 1e-6)
  assert.equal(activitySpot(doc, null, 0), null)
  assert.equal(activitySpot(doc, 'missing', 0), null)
})

test('stall vendors stand behind the counter facing customers; wells, fountains and campfires gather NPCs around them', () => {
  const doc = village([asset('stall', 'marketStall', [10, 0, 0], { rotation: [0, 45, 0] }), asset('well', 'well', [-10, 0, 0]), asset('fountain', 'fountain', [0, 0, 12]),
    asset('fire', 'campfire', [0, 0, -12]), asset('crate', 'crate', [12, 0, 12]), node('marker', 'box', [-12, 0.25, -12], [0.5, 0.5, 0.5])])
  for (let index = 0; index < 3; index++) {
    const spot = activitySpot(doc, 'stall', index, { activity: 'work' })!, p = local(doc, 'stall', spot.position)
    assert.equal(spot.kind, 'counter')
    assert.ok(p.z < -0.2 && p.z > -0.6, `behind the counter: ${p.toArray()}`)
    const ahead = local(doc, 'stall', spot.position.clone().add(forward(spot.facing)))
    assert.ok(ahead.z - p.z > 0.99, 'faces the customer side (+z)')
  }
  for (const [id, radius] of [['well', 1.35], ['fountain', 2.6], ['fire', 1.45]] as const) {
    const center = worldOf(doc, id), spots = [0, 1, 2, 3, 4, 5].map((index) => activitySpot(doc, id, index, { activity: 'perform' })!)
    for (const spot of spots) {
      assert.ok(Math.abs(Math.hypot(spot.position.x - center.x, spot.position.z - center.z) - radius) < 1e-6, `${id} ring radius`)
      const inward = center.clone().sub(spot.position).setY(0).normalize()
      assert.ok(forward(spot.facing).dot(inward) > 0.999, `${id}: faces the center`)
    }
    const distances = spots.flatMap((a, i) => spots.slice(i + 1).map((b) => a.position.distanceTo(b.position)))
    assert.ok(Math.min(...distances) > 1, `${id}: distinct places`)
    const guard = activitySpot(doc, id, 0, { activity: 'guard' })!
    assert.ok(forward(guard.facing).dot(center.clone().sub(guard.position).setY(0).normalize()) < -0.999, 'guards look away from what they protect')
  }
  const crate = activitySpot(doc, 'crate', 0)!, crateCenter = worldOf(doc, 'crate')
  assert.ok(Math.hypot(crate.position.x - crateCenter.x, crate.position.z - crateCenter.z) > 0.4 + 0.6, 'other assets: around the footprint')
  const marker = activitySpot(doc, 'marker', 0)!
  assert.ok(Math.hypot(marker.position.x + 12, marker.position.z + 12) < 1.4, 'plain nodes: near the center')
})

test('house spots are in front of the door; sleepers there are indoors', () => {
  const doc = village([asset('home', 'house', [0, 0, 0], { rotation: [0, 180, 0] })])
  const door = doc.nodes.find((item) => item.parentId === 'home' && item.assetPart === 'hinge')!
  const hinge = new THREE.Vector3(0.57, 0, 0).applyMatrix4(sceneMatrices(doc).get(door.id)!), spot = activitySpot(doc, 'home', 0, { activity: 'sleep' })!, other = activitySpot(doc, 'home', 1, { activity: 'work' })!
  const center = worldOf(doc, 'home')
  assert.ok(Math.hypot(spot.position.x - hinge.x, spot.position.z - hinge.z) < 1.2, `near the door: ${spot.position.toArray()} vs ${hinge.toArray()}`)
  assert.ok(Math.hypot(spot.position.x - center.x, spot.position.z - center.z) > Math.hypot(hinge.x - center.x, hinge.z - center.z), 'outside the wall')
  assert.equal(spot.kind, 'door'); assert.equal(spot.indoors, true); assert.equal(other.indoors, false)
  assert.ok(spot.position.distanceTo(other.position) > 0.5)
  assert.ok(forward(spot.facing).dot(hinge.clone().sub(spot.position).setY(0).normalize()) > 0.9, 'faces the door')
})

test('chat groups at one target form a circle facing each other; plans share slots and expose guards', () => {
  const doc = village([asset('fountain', 'fountain', [0, 0, 0]), asset('bench', 'bench', [6, 0, 0]),
    npc('a', [4, 0, 4], [steps('chat', 'fountain', 8, 18), steps('sit', 'bench', 18, 8)]),
    npc('b', [-4, 0, 4], [steps('chat', 'fountain', 8, 18), steps('sit', 'bench', 18, 8)]),
    npc('c', [0, 0, -5], [steps('chat', 'fountain', 8, 18)]),
    npc('g', [8, 0, 8], [steps('patrol', 'bench', 6, 20), steps('guard', null, 20, 6)])])
  const plans = planRoutines(doc)
  assert.deepEqual([...plans.keys()].sort(), ['a', 'b', 'c', 'g'])
  const chat = ['a', 'b', 'c'].map((id) => routineTask(plans.get(id), 10, 0)!.spot!), center = worldOf(doc, 'fountain')
  for (const spot of chat) assert.ok(forward(spot.facing).dot(center.clone().sub(spot.position).setY(0).normalize()) > 0.999, 'each one faces the circle center')
  const radii = chat.map((spot) => Math.hypot(spot.position.x - center.x, spot.position.z - center.z))
  assert.ok(radii.every((r) => Math.abs(r - radii[0]) < 1e-9 && r > 2.05), `outside the basin: ${radii}`)
  assert.ok(Math.min(chat[0].position.distanceTo(chat[1].position), chat[1].position.distanceTo(chat[2].position), chat[0].position.distanceTo(chat[2].position)) > 2)
  const seats = ['a', 'b'].map((id) => routineTask(plans.get(id), 20, 0)!.spot!)
  assert.ok(seats[0].position.distanceTo(seats[1].position) > 0.7 && seats.every((seat) => seat.kind === 'seat'), 'two NPCs, two seats')
  const patrol = routineTask(plans.get('g'), 10, 0)!
  assert.equal(patrol.activity, 'patrol')
  assert.ok(patrol.patrol![0].distanceTo(worldOf(doc, 'g')) < 1e-6 && patrol.patrol![1].distanceTo(worldOf(doc, 'bench')) < 3)
  const night = routineTask(plans.get('g'), 22, 0)!
  assert.equal(night.activity, 'guard'); assert.ok(night.spot!.position.distanceTo(worldOf(doc, 'g')) < 1e-6)
  assert.notEqual(patrol.key, night.key)
  assert.ok(isGuardPlan(plans.get('g')) && !isGuardPlan(plans.get('a')))
  assert.equal(routineTask(plans.get('c'), 20, 0), null, 'outside its periods: wander')
  assert.ok(routinePoints(plans).length >= 7)
})

test('the market scene routines resolve to concrete spots', () => {
  const doc = createMarketTownScene(), plans = planRoutines(doc)
  assert.ok(plans.size >= 4)
  for (const plan of plans.values()) for (const { step, spot, patrol } of plan.steps) {
    if (step.activity === 'wander') { assert.equal(spot, null); continue }
    if (step.activity === 'patrol') { assert.ok(patrol && patrol[0].distanceTo(patrol[1]) > 1, `${plan.npcId}: patrol has two ends`); continue }
    assert.ok(spot && Number.isFinite(spot.facing) && [spot.position.x, spot.position.y, spot.position.z].every(Number.isFinite), `${plan.npcId}: ${step.activity}`)
  }
  const chatters = [...plans.values()].flatMap((plan) => plan.steps.filter(({ step }) => step.activity === 'chat' && step.target === 'fountain').map(({ spot }) => spot!))
  const keys = new Set(chatters.map((spot) => spot.position.toArray().map((v) => v.toFixed(3)).join()))
  assert.equal(keys.size, chatters.length, 'every chatting NPC has its own place in the circle')
})
