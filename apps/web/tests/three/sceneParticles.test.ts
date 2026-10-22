import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three'
import { createParticles, createRing, emissionCount, emitterSources, MAX_PARTICLES, particleBudget, particleKinds, particleProfile, sceneEmitters } from '../../src/three/sceneParticles.ts'
import { node, prefab, scene } from './worldFixtures.ts'

test('particle profiles are finite and split by blend mode', () => {
  for (const kind of particleKinds) {
    const p = particleProfile(kind)
    for (const value of [p.rate, p.gravity, p.drag, p.turbulence, p.wind, p.size, p.grow, p.alpha, ...p.life, ...p.speed]) assert.ok(Number.isFinite(value), kind)
    assert.ok(p.life[0] > 0 && p.life[0] <= p.life[1] && p.life[1] <= 10 && p.size > 0 && p.size < 1 && p.drag > 0, kind)
  }
  assert.deepEqual(particleKinds.filter((k) => particleProfile(k).additive), ['fire', 'sparks', 'magic', 'embers', 'impact'])
  const [low, medium, high] = (['low', 'medium', 'high'] as const).map(particleBudget)
  assert.ok(low.capacity < medium.capacity && medium.capacity < high.capacity && high.capacity === MAX_PARTICLES)
})

test('ring buffer never exceeds capacity, reuses the oldest slots and merges upload ranges', () => {
  const ring = createRing(100)
  assert.deepEqual(ring.take(30), [[0, 30]]); assert.deepEqual(ring.take(20), [[30, 20]])
  assert.deepEqual(ring.flush(), [[0, 50]]); assert.deepEqual(ring.flush(), [])
  assert.deepEqual(ring.take(70), [[50, 50], [0, 20]])
  assert.deepEqual(ring.flush(), [[0, 20], [50, 50]])
  assert.deepEqual(ring.take(500), [[20, 80], [0, 20]])
  assert.equal(ring.high, 100)
  ring.setCapacity(40)
  assert.deepEqual(ring.take(50), [[20, 20], [0, 20]])
  for (const [start, count] of ring.flush()) assert.ok(start >= 0 && start + count <= 100)
  let total = 0
  for (let carry = 0, i = 0; i < 60; i++) { const r = emissionCount(7, 1 / 60, carry); carry = r.carry; total += r.count; assert.ok(r.carry >= 0 && r.carry < 1) }
  assert.equal(total, 7)
  assert.deepEqual(emissionCount(-3, 1, 0.5), { count: 0, carry: 0.5 })
})

test('scene emitters combine explicit presets with campfire, torch, fountain, reactor and chimney sources', () => {
  const crate = node('box', 'crate', { emitter: { preset: 'magic', rate: 2, spread: 0.5 }, dimensions: [1, 2, 1] })
  const chimney = node('box', 'chimney', { name: 'Chaminé', dimensions: [0.6, 1.6, 0.6] })
  const doc = scene([crate, chimney, ...prefab('campfire', 'fire', [0, 0, 0]), ...prefab('torch', 'torch', [3, 0, 0]), ...prefab('fountain', 'fount', [8, 0, 0]), ...prefab('reactor', 'core', [14, 0, 0]),
    ...prefab('rock', 'rock', [20, 0, 0]), ...prefab('campfire', 'quiet', [25, 0, 0], {})])
  doc.nodes.find((n) => n.id === 'quiet')!.emitter = { preset: 'steam', rate: 1, spread: 0.2 }
  const emitters = sceneEmitters(doc), by = (nodeId: string) => emitters.filter((e) => e.nodeId === nodeId).map((e) => e.kind).sort()
  assert.deepEqual(emitters.find((e) => e.nodeId === 'crate'), { id: 'crate:magic', nodeId: 'crate', kind: 'magic', rate: 2, spread: 0.5, offset: [0, 1, 0] })
  assert.deepEqual(by('fire.flame'), ['embers', 'fire', 'smoke'])
  assert.deepEqual(by('torch.flame'), ['embers', 'fire'])
  assert.deepEqual(by('fount.jet'), ['fountain']); assert.deepEqual(by('core.vent'), ['steam']); assert.deepEqual(by('chimney'), ['smoke'])
  assert.ok(!emitters.some((e) => e.nodeId.startsWith('rock')))
  assert.deepEqual(emitters.filter((e) => e.nodeId.startsWith('quiet')).map((e) => e.kind), ['steam'])
  assert.equal(new Set(emitters.map((e) => e.id)).size, emitters.length)
  const holder = new THREE.Object3D(), parent = new THREE.Group().add(holder)
  holder.position.set(2, 0, 0); parent.updateMatrixWorld(true)
  const [source] = emitterSources([emitters[0]], new Map([['crate', holder]]))
  assert.deepEqual(source.position()!.toArray(), [2, 1, 0])
  parent.visible = false; assert.equal(source.position(), null)
})

test('particle system respects budgets, uploads only new slots and expires particles', () => {
  const particles = createParticles(), camera = new THREE.PerspectiveCamera()
  particles.setQuality('low')
  particles.update(camera, 0, 0)
  particles.burst('impact', new THREE.Vector3(1, 1, 1), { count: 5000, direction: new THREE.Vector3(0, 1, 0) })
  particles.burst('splash', new THREE.Vector3(0, 0, 0), { count: 10 })
  const [normal, additive] = (particles.object.children as THREE.Mesh[]).map((mesh) => mesh.geometry as THREE.InstancedBufferGeometry)
  assert.equal(additive.instanceCount, 150, 'um oitavo da capacidade por quadro')
  assert.equal(normal.instanceCount, 10)
  particles.update(camera, 0.016, 0.016)
  const buffer = (additive.getAttribute('pStart') as THREE.InterleavedBufferAttribute).data
  assert.deepEqual(buffer.updateRanges, [{ start: 0, count: 150 * 16 }])
  const data = buffer.array as Float32Array
  for (let i = 0; i < 150; i++) { assert.ok(data[i * 16 + 5] > 0, 'impacto sai na direção do golpe'); assert.equal(data[i * 16 + 9], particleKinds.indexOf('impact')) }
  const hold = { x: 0, y: 0, z: 0 }
  particles.setEmitters([{ id: 'f', kind: 'fire', rate: 1, spread: 0.2, position: () => new THREE.Vector3(hold.x, hold.y, hold.z) }, { id: 'far', kind: 'smoke', rate: 4, spread: 0, position: () => new THREE.Vector3(500, 0, 0) }, { id: 'off', kind: 'smoke', rate: 4, spread: 0, position: () => null }])
  for (let t = 0.1; t < 3; t += 0.05) particles.update(camera, t, 0.05)
  const live = particles.stats()
  assert.ok(live.additive > 0 && live.additive <= particleBudget('low').capacity)
  assert.equal(live.normal, 0, 'respingos expiraram; fumaça distante e oculta não emite')
  particles.setEmitters([])
  for (let t = 3; t < 5; t += 0.1) particles.update(camera, t, 0.1)
  assert.equal(particles.stats().additive, 0)
  particles.dispose()
})
