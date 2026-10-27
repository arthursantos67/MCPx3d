import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildWorldMacro } from '../../src/three/world/worldJobs.ts'
import { createFog, FOG_CELL, mapImage } from '../../src/three/world/worldMap.ts'
import { createHeightSource } from '../../src/three/world/worldTerrain.ts'
import type { WorldSeed } from '../../src/three/world/worldProtocol.ts'

test('fog of war reveals a disc around the player and survives a save', () => {
  const fog = createFog([2048, 2048])
  assert.equal(fog.seen(0, 0), false)
  assert.equal(fog.reveal(0, 0, 160), true)
  assert.equal(fog.reveal(0, 0, 160), false, 'nothing new the second time')
  assert.ok(fog.seen(100, 0) && fog.seen(0, -120) && !fog.seen(400, 0))
  const restored = createFog([2048, 2048], fog.serialize())
  assert.deepEqual([...restored.cells], [...fog.cells])
  assert.equal(fog.nx, 2048 / FOG_CELL)
})

test('the map image is the world seen from above, north up: sea at the borders, land inside', () => {
  const world: WorldSeed = { seed: 4, terrain: { kind: 'climate', size: [1024, 1024], heightRange: [-40, 600], seaLevel: 0, ruggedness: 0.6, erosion: 0.4, climate: { temperature: 16, humidity: 0.6, wind: 0 } } }
  const macro = buildWorldMacro(world), pixels = mapImage(createHeightSource(world, macro).heightAt, macro, world.terrain, 64)
  assert.equal(pixels.length, 64 * 64 * 4)
  const at = (column: number, row: number) => [...pixels.slice((row * 64 + column) * 4, (row * 64 + column) * 4 + 3)]
  assert.deepEqual(at(0, 0), [58, 104, 128], 'the corner is open sea')
  assert.notDeepEqual(at(32, 32), [58, 104, 128], 'the centre is land')
  assert.ok(pixels.every((value, index) => index % 4 !== 3 || value === 255))
})
