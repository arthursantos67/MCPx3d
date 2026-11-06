import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three'
import { boxFromMatrix, buildStaticCollider, emptyInput, GRAVITY, resetPlayerMotion, stepPlayer, type PlayerCollider, type PlayerState } from '../../src/three/scenePlayer.ts'

const settings = { speed: 4.5, jumpHeight: 1.1 }
const player = (): PlayerState => ({ position: new THREE.Vector3(), velocity: new THREE.Vector3(), yaw: 0, pitch: 0, onGround: true, fly: false })
const floor: PlayerCollider = { bvh: null, boxes: [], floor: 0 }
const box = (x: number, y: number, z: number, w: number, h: number, d: number) => boxFromMatrix(new THREE.Matrix4().makeScale(w, h, d).setPosition(x, y, z))
const run = (state: PlayerState, input = emptyInput(), collider = floor, frames = 120, fps = 60) => {
  for (let i = 0; i < frames; i++) stepPlayer(state, input, collider, settings, 1 / fps)
}

for (const degrees of [8, 15, 25, 45]) test(`standing for a minute on a ${degrees} degree slope never drifts downhill`, () => {
  const geometry = new THREE.PlaneGeometry(200, 200), matrix = new THREE.Matrix4().makeRotationX(-Math.PI / 2 + THREE.MathUtils.degToRad(degrees))
  const { bvh } = buildStaticCollider([{ geometry, matrix }]), state = player(), collider = { bvh, boxes: [], floor: -100 }
  run(state, emptyInput(), collider, 120)
  const settled = state.position.clone()
  run(state, emptyInput(), collider, 3600)
  assert.ok(state.onGround)
  assert.ok(state.position.distanceTo(settled) < 0.001, `idle drift: ${state.position.distanceTo(settled)}`)
  assert.ok(state.velocity.length() < 0.001)
  bvh?.geometry.dispose(); geometry.dispose()
})

test('walking and turning cover the same route at 30, 60, 120 and 144 Hz', () => {
  const positions = [30, 60, 120, 144].map(fps => {
    const state = player()
    run(state, { ...emptyInput(), forward: true, turnLeft: true }, floor, fps * 2, fps)
    return state.position
  })
  for (const position of positions.slice(1)) assert.ok(position.distanceTo(positions[0]) < 0.015, `${position.toArray()} vs ${positions[0].toArray()}`)
})

test('holding jump produces one jump, releasing and pressing produces another', () => {
  const state = player(), jump = { ...emptyInput(), jump: true }
  run(state, jump, floor, 120)
  assert.ok(state.onGround && Math.abs(state.position.y) < 0.001, `holding jump bounced again at ${state.position.y}`)
  run(state, emptyInput(), floor, 1)
  run(state, jump, floor, 1)
  assert.ok(state.velocity.y > 0 && !state.onGround)
})

test('jump pressed shortly before landing is buffered and consumed once', () => {
  const state = player()
  state.position.y = 0.18; state.velocity.y = -4; state.onGround = false
  run(state, { ...emptyInput(), jump: true }, floor, 1)
  run(state, emptyInput(), floor, 5)
  assert.ok(state.velocity.y > 0 && state.position.y > 0.1, `buffered jump lost at ${state.position.y}`)
  run(state, emptyInput(), floor, 120)
  assert.ok(state.onGround)
})

test('walking off a ledge allows a short grace period, never an unlimited air jump', () => {
  const state = player(), abyss = { ...floor, floor: -100 }
  run(state, emptyInput(), abyss, 3)
  run(state, { ...emptyInput(), jump: true }, abyss, 1)
  assert.ok(state.velocity.y > 0, 'jump just after the ledge should work')
  run(state, emptyInput(), abyss, 20)
  const velocity = state.velocity.y
  run(state, { ...emptyInput(), jump: true }, abyss, 1)
  assert.ok(state.velocity.y < velocity, 'cannot jump a second time in the air')
})

test('a ceiling stops upward velocity immediately and a wall preserves tangential travel', () => {
  const collider = { ...floor, boxes: [box(0, 2, 0, 8, 0.2, 8), box(2, 1, 0, 0.2, 4, 20)] }
  const state = player()
  run(state, { ...emptyInput(), jump: true }, collider, 10)
  assert.ok(state.velocity.y <= 0, `ceiling left vertical velocity ${state.velocity.y}`)
  run(state, { ...emptyInput(), right: true, forward: true }, collider, 180)
  assert.ok(state.position.x < 1.59 && state.position.z < -6, `wall snagged player at ${state.position.toArray()}`)
})

for (const dynamic of [false, true]) test(`stairs remain traversable using ${dynamic ? 'boxes' : 'triangles'} and tall walls cannot be stepped over`, () => {
  const geometry = new THREE.BoxGeometry(3, 0.2, 1)
  const entries = Array.from({ length: 6 }, (_, i) => ({ geometry, matrix: new THREE.Matrix4().makeTranslation(0, i * 0.2 + 0.1, -i - 1) }))
  const bvh = dynamic ? null : buildStaticCollider(entries).bvh
  const collider = { ...floor, bvh, boxes: dynamic ? entries.map(({ matrix }) => boxFromMatrix(matrix.clone().scale(new THREE.Vector3(3, 0.2, 1)))) : [] }
  const state = player()
  run(state, { ...emptyInput(), forward: true }, collider, 75)
  assert.ok(state.position.z < -4 && state.position.y > 0.7, `stairs blocked at ${state.position.toArray()}`)
  const wallState = player()
  run(wallState, { ...emptyInput(), forward: true }, { ...floor, boxes: [box(0, 0.6, -1, 3, 1.2, 1)] }, 120)
  assert.ok(wallState.position.z > -0.2 && wallState.position.y < 0.01)
  bvh?.geometry.dispose(); geometry.dispose()
})

test('steep slopes cannot become a floor or be climbed by holding forward', () => {
  const geometry = new THREE.PlaneGeometry(20, 20)
  const matrix = new THREE.Matrix4().makeRotationX(-Math.PI / 2 + THREE.MathUtils.degToRad(65)).setPosition(0, 4, -2)
  const { bvh } = buildStaticCollider([{ geometry, matrix }])
  const collider = { bvh, boxes: [], floor: -50 }, state = player()
  state.position.set(0, 5, 0); state.onGround = false
  let grounded = false
  for (let i = 0; i < 90; i++) {
    stepPlayer(state, { ...emptyInput(), forward: true }, collider, settings, 1 / 60)
    grounded ||= state.onGround
  }
  assert.equal(grounded, false, 'a 65 degree face is not walkable')
  assert.ok(state.position.y < 4, 'gravity must slide down the slope')
  bvh?.geometry.dispose(); geometry.dispose()
})

test('fall speed remains bounded and invalid or zero time never moves the player', () => {
  const state = player(); state.onGround = false; state.position.y = 100
  for (const dt of [0, NaN, Infinity, -1]) stepPlayer(state, { ...emptyInput(), jump: true, turnLeft: true }, floor, settings, dt)
  assert.deepEqual(state.position.toArray(), [0, 100, 0]); assert.equal(state.yaw, 0)
  run(state, emptyInput(), { ...floor, floor: -1000 }, 240)
  assert.ok(state.velocity.y >= -30 && state.velocity.y < -GRAVITY)
})

test('a speed power cannot tunnel through a thin wall at a low frame rate', () => {
  const geometry = new THREE.BoxGeometry(0.02,5,30), { bvh } = buildStaticCollider([{ geometry, matrix: new THREE.Matrix4().makeTranslation(2,2,0) }])
  const state = player()
  for (let i=0;i<20;i++) stepPlayer(state, { ...emptyInput(), right: true, sprint: true }, { ...floor, bvh }, { speed: 32, jumpHeight: 1 }, 0.1)
  assert.ok(state.position.x < 1.69, `tunnelled to ${state.position.x}`)
  bvh?.geometry.dispose(); geometry.dispose()
})

test('teleport clears buffered actions and previous support, and holding jump does not retrigger it', () => {
  const state = player()
  state.onGround = false; state.position.y = 5
  run(state, { ...emptyInput(), jump: true }, floor, 1)
  state.position.y = 0; resetPlayerMotion(state, true)
  run(state, { ...emptyInput(), jump: true }, floor, 30)
  assert.ok(state.onGround && state.position.y === 0)
})

test('a walkable slope supports ascent and descent while preserving contact', () => {
  const geometry = new THREE.PlaneGeometry(30,30), matrix = new THREE.Matrix4().makeRotationX(-Math.PI/2 + THREE.MathUtils.degToRad(35)), { bvh } = buildStaticCollider([{ geometry, matrix }])
  const collider = { bvh, boxes: [], floor: -50 }, state = player()
  run(state, { ...emptyInput(), forward: true }, collider, 90)
  assert.ok(state.position.y > 2 && state.onGround, `failed ascent at ${state.position.toArray()}`)
  const high = state.position.y
  run(state, { ...emptyInput(), back: true }, collider, 70)
  assert.ok(state.position.y < high - 1 && state.onGround, `failed descent at ${state.position.toArray()}`)
  bvh?.geometry.dispose(); geometry.dispose()
})
