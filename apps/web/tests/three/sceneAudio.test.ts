import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ambiencePresets, createEmptyScene, createNode, musicPresets, soundPresets, validateScene, type SceneNode, type ThreeSceneDocument } from '../../src/three/sceneDocument.ts'
import { createAudioEngine, musicBar, resolveAmbience, resolveMusic, type AudioEmitter, type SfxName } from '../../src/three/sceneAudio.ts'

type Env = ThreeSceneDocument['environment']
function scene(env: Partial<Env> = {}, nodes: SceneNode[] = [], name = 'Nova cena'): ThreeSceneDocument {
  const doc = createEmptyScene()
  return validateScene({ ...doc, name, nodes, environment: { ...doc.environment, ...env } })
}
function terrain(biome: NonNullable<SceneNode['geometry']['biome']>) {
  const node = createNode('terrain')
  node.geometry = { ...node.geometry, biome }
  return node
}
function enemy() {
  const node = createNode('capsule')
  node.behavior = { type: 'enemy', speed: 2, range: 10, damage: 10 }
  return node
}
const audio = (ambience: typeof ambiencePresets[number], music: typeof musicPresets[number]) => ({ audio: { ambience, music, volume: 0.6 } })
const moods = musicPresets.filter((m) => m !== 'auto' && m !== 'none') as Exclude<typeof musicPresets[number], 'auto' | 'none'>[]

test('explicit ambience and music presets are kept, none stays none', () => {
  const night = scene({ sky: 'night', weather: 'rain', ...audio('cave', 'heroic') }, [terrain('desert'), enemy(), enemy(), enemy()])
  assert.equal(resolveAmbience(night), 'cave')
  assert.equal(resolveMusic(night), 'heroic')
  const silent = scene({ sky: 'day', ...audio('none', 'none') }, [terrain('forest')])
  assert.equal(resolveAmbience(silent), 'none')
  assert.equal(resolveMusic(silent), 'none')
})

test('auto ambience follows biome, sky, weather, water and names', () => {
  assert.equal(resolveAmbience(scene()), 'none', 'empty studio scene stays silent')
  assert.equal(resolveAmbience(scene({ sky: 'day' }, [terrain('desert')])), 'desert')
  assert.equal(resolveAmbience(scene({ sky: 'day' }, [terrain('snow')])), 'snow')
  assert.equal(resolveAmbience(scene({ sky: 'day' }, [terrain('forest')])), 'forest')
  assert.equal(resolveAmbience(scene({ sky: 'night' }, [terrain('forest')])), 'night')
  assert.equal(resolveAmbience(scene({ sky: 'day' }, [terrain('swamp')])), 'swamp')
  assert.equal(resolveAmbience(scene({ sky: 'day' }, [terrain('volcanic')])), 'volcanic')
  assert.equal(resolveAmbience(scene({ sky: 'space' })), 'space')
  assert.equal(resolveAmbience(scene({ sky: 'day' })), 'meadow')
  assert.equal(resolveAmbience(scene({ sky: 'overcast', weather: 'rain' }, [terrain('meadow')])), 'rain')
  assert.equal(resolveAmbience(scene({ sky: 'day', weather: 'bubbles' })), 'underwater')
  const sea = createNode('plane')
  sea.dimensions = [80, 0.01, 80]; sea.material = { ...sea.material, texture: 'water' }
  assert.equal(resolveAmbience(scene({ sky: 'sunset' }, [sea])), 'beach')
  assert.equal(resolveAmbience(scene({ sky: 'day' }, [], 'Caverna de cristal')), 'cave')
  assert.equal(resolveAmbience(scene({ sky: 'night' }, [], 'Cidade neon')), 'city')
  assert.equal(resolveAmbience(scene({ sky: 'studio' }, [], 'Estação espacial')), 'scifi')
})

test('auto music reacts to objective, enemies, night and space', () => {
  assert.equal(resolveMusic(scene()), 'none', 'a plain studio model has no music')
  assert.equal(resolveMusic(scene({ sky: 'day' }, [terrain('meadow')])), 'calm')
  assert.equal(resolveMusic(scene({ sky: 'space' })), 'space')
  assert.equal(resolveMusic(scene({ sky: 'day', objective: { type: 'defeatEnemies', title: '', timeLimit: 0 } }, [enemy()])), 'combat')
  assert.equal(resolveMusic(scene({ sky: 'day', objective: { type: 'survive', title: '', timeLimit: 60 } })), 'tension')
  assert.equal(resolveMusic(scene({ sky: 'day' }, [enemy(), enemy(), enemy()])), 'tension')
  assert.equal(resolveMusic(scene({ sky: 'night' }, [enemy(), enemy(), enemy()])), 'spooky')
  assert.equal(resolveMusic(scene({ sky: 'night' }, [terrain('forest')])), 'mystery')
  assert.equal(resolveMusic(scene({ sky: 'day', objective: { type: 'collectAll', title: 'Moedas', timeLimit: 0 } })), 'adventure')
  assert.equal(resolveMusic(scene({ sky: 'day' }, [enemy()])), 'adventure')
  assert.equal(resolveMusic(scene({ sky: 'day' }, [], 'Festa junina')), 'festive')
  assert.equal(resolveMusic(scene({ sky: 'sunset' }, [], 'Castelo do reino')), 'heroic')
})

test('musicBar is deterministic, stays inside the bar and every mood plays', () => {
  for (const mood of moods) {
    const first = musicBar(mood, 3, 7)
    assert.deepEqual(musicBar(mood, 3, 7), first)
    assert.ok(first.tempo >= 50 && first.tempo <= 160, `${mood} tempo ${first.tempo}`)
    const length = 240 / first.tempo
    let notes = 0
    for (let bar = 0; bar < 16; bar++) {
      const schedule = musicBar(mood, bar, 7)
      assert.equal(schedule.tempo, first.tempo)
      notes += schedule.notes.length
      assert.ok(schedule.notes.some((n) => n.voice === 'pad'), `${mood} bar ${bar} has harmony`)
      for (const n of schedule.notes) {
        assert.ok(n.time >= 0 && n.time < length && n.duration > 0 && n.time + n.duration <= length + 1e-9, `${mood} note inside bar`)
        assert.ok(Number.isInteger(n.midi) && n.midi >= 24 && n.midi <= 108, `${mood} midi ${n.midi}`)
      }
      for (const d of schedule.drums) assert.ok(d.time >= 0 && d.time < length)
    }
    assert.ok(notes > 16 * 3, `${mood} produces notes`)
  }
  assert.ok(musicBar('combat', 0).tempo > musicBar('calm', 0).tempo)
  assert.ok(musicBar('combat', 0).drums.length > 0)
  assert.equal(musicBar('space', 0).drums.length, 0)
  assert.notDeepEqual(musicBar('adventure', 1, 1), musicBar('adventure', 1, 2))
})

test('createAudioEngine returns null without Web Audio and does not throw', () => {
  assert.equal(typeof (globalThis as Record<string, unknown>).AudioContext, 'undefined')
  assert.equal(createAudioEngine(), null)
})

interface FakeNode { kind: string; started: boolean; stopped: boolean; stopAt: number; ended: boolean; disconnected: boolean; onended: null | (() => void) }
function fakeAudio() {
  const violations: string[] = [], nodes: FakeNode[] = []
  const check = (label: string, ...values: number[]) => { if (!values.every(Number.isFinite)) violations.push(`${label}: ${values.join(',')}`) }
  const param = (label: string) => ({ value: 0,
    setValueAtTime: (v: number, t: number) => check(`${label}.set`, v, t),
    linearRampToValueAtTime: (v: number, t: number) => check(`${label}.linear`, v, t),
    exponentialRampToValueAtTime: (v: number, t: number) => { check(`${label}.exp`, v, t); if (!(v > 0)) violations.push(`${label}.exp to ${v}`) },
    setTargetAtTime: (v: number, t: number, c: number) => { check(`${label}.target`, v, t, c); if (c < 0) violations.push(`${label} time constant ${c}`) },
    cancelScheduledValues: (t: number) => check(`${label}.cancel`, t) })
  const node = (kind: string) => {
    const state: FakeNode & Record<string, unknown> = { kind, started: false, stopped: false, stopAt: Infinity, ended: false, disconnected: false, onended: null }
    nodes.push(state)
    return new Proxy(state, { get(target, prop) {
      if (typeof prop !== 'string') return undefined
      if (prop in target) return target[prop]
      if (prop === 'connect') return (destination: unknown) => destination
      if (prop === 'disconnect') return () => { target.disconnected = true }
      if (prop === 'start') return (t = 0, offset = 0) => { check(`${kind}.start`, t, offset); target.started = true }
      if (prop === 'stop') return (t = 0) => { check(`${kind}.stop`, t); target.stopped = true; target.stopAt = Math.min(target.stopAt, t) }
      if (/^(gain|frequency|detune|Q|playbackRate|pan|threshold|knee|ratio|attack|release|(position|forward|up)[XYZ])$/.test(prop)) return (target[prop] = param(`${kind}.${prop}`))
      return () => undefined
    } })
  }
  const context = { currentTime: 0, sampleRate: 4000, state: 'running', destination: node('destination'), listener: node('listener'),
    createBuffer: (_channels: number, length: number) => ({ getChannelData: () => new Float32Array(length) }),
    resume: () => Promise.resolve(), suspend: () => Promise.resolve(), close: () => Promise.resolve() }
  const ctx = new Proxy(context, { get: (target, prop) => typeof prop === 'string' && prop.startsWith('create') && !(prop in target) ? () => node(prop.slice(6)) : (target as Record<string | symbol, unknown>)[prop] })
  function FakeContext() { return ctx }
  const settle = () => { for (const n of nodes) if (n.started && !n.ended && n.stopAt <= context.currentTime) { n.ended = true; n.onended?.() } }
  return { violations, nodes, context, FakeContext, settle }
}

test('engine drives every ambience, mood, emitter and sfx without invalid automation', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] })
  const fake = fakeAudio(), scope = globalThis as Record<string, unknown>
  scope.AudioContext = fake.FakeContext
  try {
    const engine = createAudioEngine()
    assert.ok(engine)
    const advance = (seconds: number) => { for (let i = 0; i < seconds * 10; i++) { fake.context.currentTime += 0.1; fake.settle(); t.mock.timers.tick(100) } }
    engine.sfx('collect')
    engine.update({ position: [0, 0, 0], forward: [0, 0, -1] }, [], 0.016)
    const sources = () => fake.nodes.filter((n) => n.kind === 'Oscillator' || n.kind === 'BufferSource')
    for (const ambience of ambiencePresets.filter((a) => a !== 'auto')) {
      for (const music of [moods[ambiencePresets.indexOf(ambience) % moods.length]]) {
        const before = sources().length
        engine.start(scene({ sky: 'day', ...audio(ambience, music) }, [], ambience))
        advance(6)
        assert.ok(sources().length > before, `${ambience}/${music} produced sound`)
        engine.setIntensity('danger'); advance(2); engine.setIntensity('calm'); advance(1)
      }
    }
    const emitters: AudioEmitter[] = soundPresets.map((preset, i) => ({ id: `e${i}`, position: [i - 7, 0, 2], sound: { preset, volume: 0.8, radius: 30 } }))
    for (let frame = 0; frame < 40; frame++) { engine.update({ position: [frame * 0.1, 1.6, 0], forward: [0, 0, -1] }, emitters, 0.016); advance(0.1) }
    const panners = fake.nodes.filter((n) => n.kind === 'Panner')
    assert.ok(panners.length >= 12 && panners.filter((p) => !p.disconnected).length <= 12, 'at most 12 emitters stay alive')
    engine.update({ position: [1000, 0, 0], forward: [1, 0, 0] }, emitters, 0.016)
    advance(2)
    assert.ok(fake.nodes.filter((n) => n.kind === 'Panner').every((p) => p.disconnected), 'far emitters are released')
    const names: SfxName[] = ['step', 'jump', 'land', 'collect', 'hurt', 'enemyHit', 'enemyDefeat', 'alert', 'mechanism', 'checkpoint', 'victory', 'defeat', 'swing', 'shoot', 'magic', 'powerup', 'heal', 'unlock', 'locked', 'launch', 'talk', 'splash', 'respawn']
    for (const [i, name] of names.entries()) {
      const before = sources().length
      engine.sfx(name, i % 2 ? [i, 0, 0] : undefined)
      const created = sources().slice(before)
      assert.ok(created.length > 0 && created.every((n) => n.started && n.stopped), `${name} schedules complete one-shots`)
      advance(0.1)
    }
    engine.setMuted(true); assert.equal(engine.muted, true); engine.setMuted(false)
    engine.stop(); advance(5)
    for (const n of sources()) if (n.started && !n.stopped) assert.fail(`${n.kind} left running after stop`)
    engine.dispose()
    engine.start(scene({ sky: 'day' })); engine.sfx('step'); engine.update({ position: [0, 0, 0], forward: [0, 0, 1] }, emitters, 0.1); engine.stop()
    assert.deepEqual(fake.violations, [])
  } finally { delete scope.AudioContext }
})
