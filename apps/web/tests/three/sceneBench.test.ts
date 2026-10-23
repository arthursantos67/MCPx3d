import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three'
import { createSceneBench, estimateSceneMemory, planBenchRoute, routeInput } from '../../src/three/sceneBench.ts'
import { createIslandScene } from '../../src/three/scenePreset.ts'
import { emptyInput, type PlayerState } from '../../src/three/scenePlayer.ts'

test('the probe exists only with ?bench=1 and reads ratio, invulnerability and fixed routes', () => {
  assert.equal(createSceneBench(''), null)
  assert.equal(createSceneBench('?bench=0'), null)
  const bench = createSceneBench('?bench=1&ratio=0.25&route=0,0;100,-50&sprint=1')!
  assert.equal(bench.ratio, 0.25)
  assert.equal(bench.invulnerable, true)
  assert.deepEqual(bench.fixedRoute, { points: [[0, 0], [100, -50]], sweep: 6, sprint: true })
  assert.equal(createSceneBench('?bench=1&invulnerable=0')!.invulnerable, false)
})

test('frames are recorded only while recording', () => {
  const bench = createSceneBench('?bench=1')!
  bench.frame(10, 2, { calls: 5, triangles: 100 }, true)
  assert.equal(bench.frames.length, 0)
  bench.recording = true
  bench.frame(26, 3, { calls: 6, triangles: 120 }, true, { selectMs: 0.2, deficit: 0, stream: { applyMs: 0.4 } })
  assert.deepEqual(bench.frames[0], { at: 26, interval: 16, cpu: 3, calls: 6, triangles: 120, game: true, streamMs: 0.4, selectMs: 0.2, deficit: 0 })
})

test('the route visits the same points of interest every run and starts with a full turn', () => {
  const doc = createIslandScene(), spawn = new THREE.Vector3(0, 0, 8)
  const positions = new Map(doc.nodes.map((node) => [node.id, new THREE.Vector3(...node.position)]))
  const a = planBenchRoute(doc, spawn, (id) => positions.get(id) ?? null), b = planBenchRoute(doc, spawn, (id) => positions.get(id) ?? null)
  assert.deepEqual(a, b)
  assert.ok(a.points.length >= 3)
  const player: PlayerState = { position: new THREE.Vector3(), velocity: new THREE.Vector3(), yaw: 0, pitch: 0, onGround: true, fly: false }
  const steer = { index: 0, since: 0, best: Infinity, turned: 0 }, input = emptyInput()
  for (let i = 0; i < 6 * 60; i++) routeInput(a, player, steer, 1 / 60, input)
  assert.ok(Math.abs(steer.turned - Math.PI * 2) < 1e-9)
  routeInput({ points: [[0, -10]], sweep: 6 }, player, steer, 1 / 60, input)
  assert.equal(input.forward, true)
})

test('memory estimate counts unique geometry and texture bytes', () => {
  const scene = new THREE.Scene(), geometry = new THREE.BoxGeometry(), texture = new THREE.DataTexture(new Uint8Array(16 * 16 * 4), 16, 16)
  const material = new THREE.MeshStandardMaterial({ map: texture })
  scene.add(new THREE.Mesh(geometry, material), new THREE.Mesh(geometry, material))
  const estimate = estimateSceneMemory(scene)
  assert.equal(estimate.geometries, 1)
  assert.equal(estimate.textures, 1)
  assert.ok(estimate.geometryBytes > 0 && estimate.textureBytes >= 1024)
})
