import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildWorldMacro, runWorldJob } from '../../src/three/world/worldJobs.ts'
import { BIOMES } from '../../src/three/world/worldMacro.ts'
import { createHeightSource } from '../../src/three/world/worldTerrain.ts'
import { BIOME_VEGETATION, INSTANCE_STRIDE, placeVegetation, SPECIES, VEGETATION_CELL, type VegetationInput } from '../../src/three/world/worldVegetation.ts'
import type { WorldSeed } from '../../src/three/world/worldProtocol.ts'
import { buildVegetation } from '../../src/three/sceneVegetation.ts'
import type { PrefabPart, PrefabSpec } from '../../src/three/scenePrefabs.ts'

const world: WorldSeed = { seed: 31, terrain: { kind: 'climate', size: [1024, 1024], heightRange: [-40, 600], seaLevel: 0, ruggedness: 0.6, erosion: 0.5, climate: { temperature: 16, humidity: 0.7, wind: 0 } } }
const macro = buildWorldMacro(world), heights = createHeightSource(world, macro), origin: [number, number] = [-512, -512]
const input: VegetationInput = { seed: world.seed, density: 120, heightAt: heights.heightAt, macro, seaLevel: 0 }
const all = (cx: number, cz: number) => { const cell = placeVegetation(input, origin, cx, cz), out: number[][] = []; for (const [species, list] of Object.entries(cell)) for (let i = 0; i < list!.length; i += INSTANCE_STRIDE) out.push([SPECIES.indexOf(species as typeof SPECIES[number]), ...list!.slice(i, i + INSTANCE_STRIDE)]); return out }

test('the middle tree LOD reduces authored mesh triangles while keeping the canopy and trunk', () => {
  const triangles = (parts: PrefabPart[]) => parts.reduce((sum, part) => sum + (part.geometry?.indices?.length ?? 0) / 3, 0)
  const bounds = (parts: PrefabPart[]) => [0, 1, 2].map((axis) => {
    const values = parts.flatMap((part) => (part.geometry?.vertices ?? []).filter((_, index) => index % 3 === axis))
    return [Math.min(...values), Math.max(...values)]
  })
  for (const type of ['tree', 'pine'] as const) for (const seed of [3, 10, 31]) {
    const spec: PrefabSpec = { type, size: 1, seed, primary: null, secondary: null, text: '', lit: false, interactive: false }
    const full = buildVegetation(spec, type === 'pine'), mid = buildVegetation(spec, type === 'pine', true)
    assert.ok(triangles(mid) < triangles(full) / 4, 'mesh-based prefabs must actually simplify, independently of segments')
    assert.deepEqual(mid, buildVegetation(spec, type === 'pine', true))
    assert.ok(mid.some((part) => part.id === 'trunk' && part.collidable))
    assert.ok(mid.filter((part) => part.id.startsWith('foliage')).every((part) => part.material?.alphaTest === 0.45))
    const a = bounds(full), b = bounds(mid)
    for (let axis = 0; axis < 3; axis++) for (let end = 0; end < 2; end++) assert.ok(Math.abs(a[axis][end] - b[axis][end]) < (a[axis][1] - a[axis][0]) * 0.2, 'canopy silhouette remains within 20% of the full tree')
  }
})

test('placement is deterministic per cell and independent of neighbours', () => {
  assert.deepEqual(all(2, 6), all(2, 6))
  const seen = new Set<string>()
  for (let cz = 5; cz < 8; cz++) for (let cx = 1; cx < 4; cx++) for (const plant of all(cx, cz)) {
    const [, x, , z] = plant, key = `${x.toFixed(3)}:${z.toFixed(3)}`
    assert.ok(!seen.has(key), 'a plant appears in only one cell')
    seen.add(key)
    assert.ok(x >= origin[0] + cx * VEGETATION_CELL && x < origin[0] + (cx + 1) * VEGETATION_CELL)
  }
  assert.ok(seen.size > 20)
})

test('plants stand on dry land at the terrain height, with species allowed by the biome', () => {
  let count = 0
  for (let cz = 0; cz < 8; cz++) for (let cx = 0; cx < 8; cx++) for (const [species, x, y, z, , scale] of all(cx, cz)) {
    count++
    assert.ok(Math.abs(y - heights.heightAt(x, z)) < 1e-3 && y > 0.5)
    const i = Math.round((x - macro.origin[0]) / macro.cell), j = Math.round((z - macro.origin[1]) / macro.cell), k = j * macro.points[0] + i
    assert.ok(Number.isNaN(macro.water[k]), 'no plant in water')
    assert.ok((BIOME_VEGETATION[BIOMES[macro.biome[k]]].mix[SPECIES[species]] ?? 0) > 0, 'species belongs to the biome')
    assert.ok(scale >= 0.75 && scale <= 1.25)
  }
  assert.ok(count > 100)
})

test('density follows the budget, and the worker job returns the same plants', () => {
  const sparse = placeVegetation({ ...input, density: 30 }, origin, 2, 6), dense = placeVegetation(input, origin, 2, 6)
  const total = (cell: ReturnType<typeof placeVegetation>) => Object.values(cell).reduce((sum, list) => sum + list!.length / INSTANCE_STRIDE, 0)
  assert.ok(total(dense) > total(sparse))
  assert.equal(total(placeVegetation({ ...input, density: 0 }, origin, 2, 6)), 0)
  runWorldJob({ type: 'install', world, fields: { delta: macro.delta, cell: macro.cell, points: macro.points, origin: macro.origin, biome: macro.biome, water: macro.water, river: macro.river, ground: macro.ground, clear: macro.clear } })
  const job = runWorldJob({ type: 'vegetation', world, origin, density: 120, cells: [[2, 6]] }).result as { cells: { plants: Record<string, Float32Array> }[] }
  assert.deepEqual(Object.fromEntries(Object.entries(job.cells[0].plants).map(([k, v]) => [k, [...v]])), Object.fromEntries(Object.entries(dense).map(([k, v]) => [k, [...v!]])))
})

test('the ground window is a 1.x ground field: terrain heights, no grass on water and a live reload', async () => {
  const { groundWindow, createWorldGroundField, GROUND_WINDOW } = await import('../../src/three/world/worldGround.ts')
  const first = groundWindow(heights.heightAt, macro, [-150, 250], 0), field = createWorldGroundField(first)
  for (const [x, z] of [[-150, 250], [-180, 230], [-100, 300]]) assert.ok(Math.abs(field.heightAt(x, z) - heights.heightAt(x, z)) < 0.15, 'heights follow the terrain')
  const n = Math.sqrt(first.data.length / 4)
  for (let k = 0; k < n * n; k++) if (!first.data[k * 4 + 3]) assert.equal(first.data[k * 4 + 2], 0, 'no grass where the ground is not covered')
  const next = groundWindow(heights.heightAt, macro, [-150 + GROUND_WINDOW / 2, 250], 0)
  field.load(next)
  assert.deepEqual(field.bounds, [-150, 250 - GROUND_WINDOW / 2, GROUND_WINDOW, GROUND_WINDOW])
  assert.ok(Math.abs(field.heightAt(-60, 250) - heights.heightAt(-60, 250)) < 0.15)
  field.dispose()
})
