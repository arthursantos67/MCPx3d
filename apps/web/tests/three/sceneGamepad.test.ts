import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BUTTON, createGamepadState, deadzone, firstGamepad, glyph, lookDelta, mergeInput, readGamepad, type GamepadLike } from '../../src/three/sceneGamepad.ts'
import { emptyInput } from '../../src/three/scenePlayer.ts'

const pad = (axes: number[] = [0, 0, 0, 0], pressed: number[] = [], values: Record<number, number> = {}): GamepadLike => ({
  axes, connected: true, mapping: 'standard', buttons: Array.from({ length: 17 }, (_, index) => ({ pressed: pressed.includes(index), value: values[index] ?? (pressed.includes(index) ? 1 : 0) })) })

test('radial dead zone removes drift and rescales to reach full deflection', () => {
  assert.deepEqual(deadzone(0.1, 0.1), { x: 0, y: 0 })
  assert.deepEqual(deadzone(NaN, 0), { x: 0, y: 0 })
  assert.equal(deadzone(0.96, 0).x, 1)
  const half = deadzone(0, -0.565)
  assert.ok(half.y < -0.45 && half.y > -0.55)
  const diagonal = deadzone(0.5, 0.5)
  assert.ok(Math.abs(diagonal.x - diagonal.y) < 1e-12, 'direction preserved')
})

test('sticks map to movement booleans and analog look; noise does not mark the pad active', () => {
  const state = createGamepadState()
  const idle = readGamepad(pad([0.05, -0.08, 0.1, 0.02]), state)
  assert.equal(idle.active, false); assert.deepEqual(idle.input, emptyInput())
  const frame = readGamepad(pad([-0.9, -0.9, 0.8, 0]), state)
  assert.equal(frame.input.forward, true); assert.equal(frame.input.left, true); assert.equal(frame.input.back, false); assert.equal(frame.input.right, false)
  assert.ok(frame.look.x > 0.7); assert.equal(frame.active, true); assert.ok(frame.held.has('move') && frame.held.has('look'))
  assert.deepEqual(readGamepad(null, state).input, emptyInput())
})

test('buttons fire on the rising edge only; triggers count past the threshold', () => {
  const state = createGamepadState()
  const first = readGamepad(pad([0, 0, 0, 0], [BUTTON.A, BUTTON.RB, BUTTON.MENU]), state)
  assert.ok(first.pressed.has('jump') && first.pressed.has('attack') && first.pressed.has('pause') && first.pressed.has('confirm'))
  assert.equal(first.input.jump, true)
  const held = readGamepad(pad([0, 0, 0, 0], [BUTTON.A, BUTTON.RB, BUTTON.MENU]), state)
  assert.equal(held.pressed.size, 0); assert.equal(held.input.jump, true); assert.ok(held.held.has('attack'))
  readGamepad(pad(), state)
  assert.ok(readGamepad(pad([0, 0, 0, 0], [BUTTON.A]), state).pressed.has('jump'), 'released then pressed again')
  assert.ok(readGamepad(pad([0, 0, 0, 0], [], { [BUTTON.RT]: 0.6 }), createGamepadState()).pressed.has('heavy'))
  assert.ok(!readGamepad(pad([0, 0, 0, 0], [], { [BUTTON.RT]: 0.2 }), createGamepadState()).pressed.has('heavy'))
  const mapping = readGamepad(pad([0, 0, 0, 0], [BUTTON.B, BUTTON.X, BUTTON.Y, BUTTON.VIEW, BUTTON.LB, BUTTON.UP]), createGamepadState())
  for (const action of ['dodge', 'interact', 'camera', 'help', 'down', 'fly', 'back'] as const) assert.ok(mapping.pressed.has(action), action)
  assert.equal(mapping.input.down, true)
})

test('sprint latches with the stick click until the stick rests; LT holds sprint', () => {
  const state = createGamepadState()
  readGamepad(pad([0, -1, 0, 0], [BUTTON.LS]), state)
  assert.equal(readGamepad(pad([0, -1, 0, 0]), state).input.sprint, true)
  assert.equal(readGamepad(pad([0, 0, 0, 0]), state).input.sprint, false)
  assert.equal(readGamepad(pad([0, -1, 0, 0]), state).input.sprint, false)
  assert.equal(readGamepad(pad([0, -1, 0, 0], [], { [BUTTON.LT]: 1 }), state).input.sprint, true)
})

test('menu steps come from d-pad or stick edges', () => {
  const state = createGamepadState()
  assert.ok(readGamepad(pad([0, 0.9, 0, 0]), state).pressed.has('menuDown'))
  assert.ok(!readGamepad(pad([0, 0.9, 0, 0]), state).pressed.has('menuDown'))
  readGamepad(pad(), state)
  assert.ok(readGamepad(pad([0, 0, 0, 0], [BUTTON.UP]), state).pressed.has('menuUp'))
})

test('look delta, input merge, pad discovery and glyphs', () => {
  const look = lookDelta({ x: 1, y: 0.5 }, 0.1, 1, false)
  assert.ok(look.yaw < 0 && look.pitch < 0)
  assert.ok(lookDelta({ x: 0, y: 0.5 }, 0.1, 1, true).pitch > 0)
  assert.ok(Math.abs(lookDelta({ x: 1, y: 0 }, 0.1, 2).yaw) > Math.abs(look.yaw))
  const merged = mergeInput({ ...emptyInput(), forward: true }, { ...emptyInput(), jump: true })
  assert.equal(merged.forward && merged.jump, true)
  const connected = pad()
  assert.equal(firstGamepad([null, { ...pad(), connected: false }, connected]), connected)
  assert.equal(firstGamepad(undefined), null)
  assert.deepEqual(glyph('interact', 'keyboard'), { label: 'E', kind: 'key' })
  assert.deepEqual(glyph('interact', 'gamepad'), { label: 'X', kind: 'face', tone: 'x' })
  assert.equal(glyph('dodge', 'keyboard').label, 'Q'); assert.equal(glyph('heavy', 'keyboard').kind, 'mouse-right'); assert.equal(glyph('pause', 'keyboard').label, 'Esc')
  assert.equal(glyph('pause', 'gamepad').label, 'Start'); assert.equal(glyph('heavy', 'gamepad').label, 'RT'); assert.equal(glyph('attack', 'gamepad').label, 'RB'); assert.equal(glyph('look', 'gamepad').label, 'RS')
})
