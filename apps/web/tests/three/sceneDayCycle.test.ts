import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createEmptyScene, createNode, validateScene, type SceneNode, type ThreeSceneDocument } from '../../src/three/sceneDocument.ts'
import { dayState, formatHour, hourDelta, nightAmount, practicalLightFactor, reflectionRefresh, REFLECTION_INTERVAL, type DayState, type ReflectionStamp } from '../../src/three/sceneDayCycle.ts'
import { timeOfDayLighting } from '../../src/three/sceneEnvironment.ts'
import { createAudioEngine } from '../../src/three/sceneAudio.ts'

type Env = ThreeSceneDocument['environment']
const base = createEmptyScene().environment
const env = (patch: Partial<Env> = {}): Env => ({ ...base, sky: 'day', sunElevation: 38, sunAzimuth: 35, dayCycle: { enabled: true, duration: 600, start: 9 }, ...patch })
const at = (elapsed: number, patch: Partial<Env> = {}) => dayState(env(patch), elapsed)!

test('no cycle, a disabled cycle and studio/space skies leave the scene untouched', () => {
  assert.equal(dayState({ ...base, sky: 'day' }, 100), null)
  assert.equal(dayState(env({ dayCycle: { enabled: false, duration: 600, start: 9 } }), 100), null)
  assert.equal(dayState(env({ sky: 'studio' }), 100), null)
  assert.equal(dayState(env({ sky: 'space' }), 100), null)
  assert.equal(practicalLightFactor(null), 1, 'authored lights keep their intensity without a cycle')
  assert.equal(nightAmount({ ...base, sky: 'night' }, null), 1)
  assert.equal(nightAmount({ ...base, sky: 'day' }, null), 0)
})

test('hour follows the start, duration and wraps over days', () => {
  assert.equal(at(0).hour, 9)
  assert.ok(Math.abs(at(150).hour - 15) < 1e-9)
  assert.ok(Math.abs(at(900).hour - 21) < 1e-9)
  assert.ok(Math.abs(at(600 * 7 + 75).hour - 12) < 1e-9)
  assert.ok(Math.abs(at(-75).hour - 6) < 1e-9, 'negative time wraps backwards')
  assert.ok(Math.abs(dayState(env({ dayCycle: { enabled: true, duration: 60, start: 23 } }), 5)!.hour - 1) < 1e-9)
  assert.equal(at(Number.NaN).hour, 9)
  assert.equal(at(0).elapsed, 0)
})

test('midnight is night, noon is day, dusk is a sunset and the authored azimuth holds at the start', () => {
  const noon = at(75), midnight = at(375), dusk = at(225)
  assert.ok(noon.sunElevation >= 55 && noon.night === 0 && noon.sky === 'day' && noon.light > 0.99, JSON.stringify(noon))
  assert.ok(midnight.sunElevation <= -55 && midnight.night === 1 && midnight.sky === 'night' && midnight.light < 0.15)
  assert.ok(Math.abs(dusk.hour - 18) < 1e-9 && Math.abs(dusk.sunElevation) < 1e-9 && dusk.sky === 'sunset' && dusk.night > 0 && dusk.night < 1)
  assert.ok(Math.abs(at(0).sunAzimuth - 35) < 1e-9)
  assert.ok(Math.abs(at(75).sunAzimuth - (35 + 45)) < 1e-9, 'the sun sweeps 15° per hour')
  assert.equal(at(75, { sky: 'overcast' }).sky, 'overcast')
  assert.equal(at(375, { sky: 'overcast' }).sky, 'night')
  assert.equal(at(75, { sunElevation: 72 }).sunElevation, 72)
  assert.equal(at(0, { sky: 'night' }).sky, 'day', 'a night sky with a cycle starting at 9 h begins in daylight')
})

test('transitions are continuous over two days, including the sun-to-moon handover', () => {
  let previous: DayState | null = null, lighting = timeOfDayLighting(env(), at(0))
  for (let elapsed = 0; elapsed <= 1200; elapsed += 0.1) {
    const day = at(elapsed), look = timeOfDayLighting(env(), day)
    for (const value of [day.hour, day.sunElevation, day.sunAzimuth, day.night, day.twilight, day.light, look.lightIntensity, look.hemisphereIntensity, look.skyFade, look.stars, look.environmentIntensity]) assert.ok(Number.isFinite(value))
    assert.ok(day.night >= 0 && day.night <= 1 && day.twilight >= 0 && day.twilight <= 1 && day.light >= 0.12 && day.light <= 1)
    if (previous) {
      assert.ok(Math.abs(day.sunElevation - previous.sunElevation) < 0.6, `elevation step at ${elapsed}`)
      assert.ok(Math.abs(day.night - previous.night) < 0.05, `night step at ${elapsed}`)
      assert.ok(Math.abs(((day.sunAzimuth - previous.sunAzimuth + 540) % 360) - 180) < 0.5, `azimuth step at ${elapsed}`)
      assert.ok(Math.abs(look.lightIntensity - lighting.lightIntensity) < 0.05, `light pops at ${elapsed}: ${lighting.lightIntensity} → ${look.lightIntensity}`)
      assert.ok(Math.abs(look.hemisphereIntensity - lighting.hemisphereIntensity) < 0.02 && Math.abs(look.skyFade - lighting.skyFade) < 0.05 && Math.abs(look.stars - lighting.stars) < 0.05)
      assert.ok(Math.max(Math.abs(look.fog.r - lighting.fog.r), Math.abs(look.fog.g - lighting.fog.g), Math.abs(look.fog.b - lighting.fog.b)) < 0.03, `fog step at ${elapsed}`)
    }
    previous = day; lighting = look
  }
  const noon = timeOfDayLighting(env(), at(75)), night = timeOfDayLighting(env(), at(375))
  assert.ok(noon.light.y > 0.8 && night.light.y > 0.4, 'the shadow light always comes from above the horizon')
  assert.ok(noon.lightIntensity > night.lightIntensity * 5 && night.stars === 1 && noon.stars === 0 && noon.skyFade === 1 && night.skyFade === 0)
})

test('practical lights switch on at dusk and off by day', () => {
  assert.equal(practicalLightFactor(at(75)), 0)
  assert.equal(practicalLightFactor(at(375)), 1)
  let last = -1
  for (let elapsed = 200; elapsed <= 260; elapsed += 1) { const factor = practicalLightFactor(at(elapsed)); assert.ok(factor >= last - 1e-12, 'monotonic through dusk'); last = factor }
  assert.ok(practicalLightFactor(at(225)) > 0 && practicalLightFactor(at(225)) < 1)
})

test('reflection captures are throttled to a few play seconds, but edits and restarts refresh at once', () => {
  let stamp: ReflectionStamp | null = null, refreshes = 0
  for (let frame = 0; frame <= 60 * 60; frame++) {
    const day = dayState(env({ dayCycle: { enabled: true, duration: 60, start: 0 } }), frame / 60)!
    if (reflectionRefresh(stamp, day)) { refreshes++; stamp = { elapsed: day.elapsed, hour: day.hour, night: day.night } }
  }
  assert.ok(refreshes >= 2 && refreshes <= 60 / REFLECTION_INTERVAL + 1, `refreshes ${refreshes}`)
  const still: ReflectionStamp = { elapsed: 0, hour: 9, night: 0 }
  assert.equal(reflectionRefresh(still, at(0)), false, 'the editor redraw at the same hour reuses the capture')
  assert.equal(reflectionRefresh(still, at(0, { dayCycle: { enabled: true, duration: 600, start: 20 } })), true, 'changing the starting hour recaptures')
  assert.equal(reflectionRefresh({ elapsed: 50, hour: 11, night: 0 }, at(0)), true, 'restarting play recaptures')
  assert.equal(reflectionRefresh(null, at(0)), true)
  assert.equal(hourDelta(23.5, 0.5), -1)
  assert.equal(formatHour(9.5), '09:30')
  assert.equal(formatHour(23.999), '00:00')
  assert.equal(formatHour(-1), '23:00')
})

interface FakeNode { kind: string; started: boolean; stopped: boolean; stopAt: number; ended: boolean; disconnected: boolean; onended: null | (() => void); [key: string]: unknown }
function fakeAudio() {
  const violations: string[] = [], nodes: FakeNode[] = []
  const check = (label: string, ...values: number[]) => { if (!values.every(Number.isFinite)) violations.push(`${label}: ${values.join(',')}`) }
  const param = (label: string) => ({ value: 0, setValueAtTime: (v: number, t: number) => check(label, v, t), linearRampToValueAtTime: (v: number, t: number) => check(label, v, t),
    exponentialRampToValueAtTime: (v: number, t: number) => { check(label, v, t); if (!(v > 0)) violations.push(`${label} exp ${v}`) }, setTargetAtTime: (v: number, t: number, c: number) => check(label, v, t, c), cancelScheduledValues: (t: number) => check(label, t) })
  const node = (kind: string) => {
    const state: FakeNode = { kind, started: false, stopped: false, stopAt: Infinity, ended: false, disconnected: false, onended: null }
    nodes.push(state)
    return new Proxy(state, { get(target, prop) {
      if (typeof prop !== 'string') return undefined
      if (prop in target) return target[prop]
      if (prop === 'connect') return (destination: unknown) => destination
      if (prop === 'disconnect') return () => { target.disconnected = true }
      if (prop === 'start') return () => { target.started = true }
      if (prop === 'stop') return (t = 0) => { target.stopped = true; target.stopAt = Math.min(target.stopAt, t) }
      if (/^(gain|frequency|detune|Q|playbackRate|pan|threshold|knee|ratio|attack|release|(position|forward|up)[XYZ])$/.test(prop)) return (target[prop] = param(`${kind}.${prop}`))
      return () => undefined
    } })
  }
  const context = { currentTime: 0, sampleRate: 4000, state: 'running', destination: node('destination'), listener: node('listener'),
    createBuffer: (_c: number, length: number) => ({ getChannelData: () => new Float32Array(length) }), resume: () => Promise.resolve(), suspend: () => Promise.resolve(), close: () => Promise.resolve() }
  const ctx = new Proxy(context, { get: (target, prop) => typeof prop === 'string' && prop.startsWith('create') && !(prop in target) ? () => node(prop.slice(6)) : (target as Record<string | symbol, unknown>)[prop] })
  function FakeContext() { return ctx }
  const settle = () => { for (const n of nodes) if (n.started && !n.ended && n.stopAt <= context.currentTime) { n.ended = true; n.onended?.() } }
  return { violations, nodes, context, FakeContext, settle }
}

test('audio night layer adds crickets and owls outdoors, softens music and stays silent indoors', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] })
  const fake = fakeAudio(), scope = globalThis as Record<string, unknown>
  scope.AudioContext = fake.FakeContext
  try {
    const engine = createAudioEngine()!
    const advance = (seconds: number) => { for (let i = 0; i < seconds * 10; i++) { fake.context.currentTime += 0.1; fake.settle(); t.mock.timers.tick(100) } }
    const terrain = (biome: 'forest'): SceneNode => { const node = createNode('terrain'); return { ...node, geometry: { ...node.geometry, biome } } }
    const forest = validateScene({ ...createEmptyScene(), nodes: [terrain('forest')], environment: { ...base, sky: 'day', audio: { ambience: 'auto', music: 'calm', volume: 0.6 } } })
    engine.start(forest); advance(3)
    const patches = () => fake.nodes.filter((n) => n.kind === 'StereoPanner').length
    const pulses = () => fake.nodes.filter((n) => n.kind === 'Oscillator' && n.started).length
    const beforeNight = patches()
    engine.setTimeOfDay(0); advance(1)
    assert.equal(patches(), beforeNight, 'daylight adds no night layer')
    engine.setTimeOfDay(1)
    const sounds = pulses(); advance(8)
    assert.ok(patches() > beforeNight, 'a night layer is created outdoors')
    assert.ok(pulses() > sounds, 'night insects and owls are scheduled')
    engine.setTimeOfDay(0.5); engine.setTimeOfDay(Number.NaN); engine.setTimeOfDay(0); advance(2)
    const cave = validateScene({ ...createEmptyScene(), name: 'Caverna', environment: { ...base, sky: 'day', audio: { ambience: 'cave', music: 'none', volume: 0.6 } } })
    engine.start(cave); advance(2)
    const indoor = patches()
    engine.setTimeOfDay(1); advance(3)
    assert.equal(patches(), indoor, 'enclosed places keep their own bed')
    engine.stop(); advance(5)
    engine.dispose()
    engine.setTimeOfDay(1)
    assert.deepEqual(fake.violations, [])
  } finally { delete scope.AudioContext }
})
