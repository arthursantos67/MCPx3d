import assert from 'node:assert/strict'
import { test } from 'node:test'
import { levelCount } from '../../src/three/world/cdlod.ts'
import { assembleCellErrors, errorBlocks, measureBlockErrors } from '../../src/three/world/terrainTile.ts'
import { buildWorldMacro, runWorldJob } from '../../src/three/world/worldJobs.ts'
import { BIOMES, GROUND_LAYERS, sampleMacro, waterMesh, type WorldMacro } from '../../src/three/world/worldMacro.ts'
import { regionAt } from '../../src/three/world/worldRegions.ts'
import { createHeightSource } from '../../src/three/world/worldTerrain.ts'
import type { WorldSeed } from '../../src/three/world/worldProtocol.ts'

const climate = (seed = 9, size = 1024): WorldSeed => ({ seed, terrain: { kind: 'climate', size: [size, size], heightRange: [-40, 700], seaLevel: 0, ruggedness: 0.7, erosion: 0.6, climate: { temperature: 18, humidity: 0.6, wind: 0 } } })
const macro = buildWorldMacro(climate())

test('the macro pass is deterministic and depends on the seed', () => {
  const again = buildWorldMacro(climate())
  for (const key of ['delta', 'water', 'temperature', 'humidity', 'ground', 'biome', 'drain'] as const) assert.deepEqual([...again[key]], [...macro[key]], key)
  const other = buildWorldMacro(climate(10))
  assert.notDeepEqual([...other.delta.slice(0, 2000)], [...macro.delta.slice(0, 2000)])
  assert.ok(macro.stats.droplets > 0)
})

test('every land point drains downhill to the sea, a border or a lake level, and rivers exist', () => {
  const macro = buildWorldMacro(climate(9, 2048)), [nx, nz] = macro.points, count = nx * nz
  let rivers = 0
  for (let k = 0; k < count; k++) {
    if (macro.river[k] > 0.99) rivers++
    let at = k, steps = 0
    while (macro.drain[at] >= 0) {
      assert.ok(macro.filled[macro.drain[at]] <= macro.filled[at] + 1e-6, 'filled levels never rise downstream')
      at = macro.drain[at]
      assert.ok(++steps < count, 'drainage has no cycles')
    }
    const i = at % nx, j = Math.floor(at / nx)
    assert.ok(macro.filled[at] <= 0 || i === 0 || j === 0 || i === nx - 1 || j === nz - 1, 'drainage ends at an outlet')
  }
  assert.ok(rivers > 0, 'the eroded relief has rivers')
})

test('climate gets colder with altitude, ground weights sum to one and biomes are valid', () => {
  const [nx] = macro.points, heights = createHeightSource(climate(), macro)
  let warm = -Infinity, cold = Infinity
  for (let k = 0; k < macro.temperature.length; k++) {
    const x = macro.origin[0] + (k % nx) * macro.cell, z = macro.origin[1] + Math.floor(k / nx) * macro.cell, h = heights.heightAt(x, z)
    if (h > 5 && h < 60) warm = Math.max(warm, macro.temperature[k])
    if (h > 400) cold = Math.min(cold, macro.temperature[k])
    let sum = 0
    for (let l = 0; l < GROUND_LAYERS.length; l++) sum += macro.ground[k * GROUND_LAYERS.length + l]
    assert.ok(Math.abs(sum - 255) <= GROUND_LAYERS.length, `weights sum ${sum}`)
    assert.ok(macro.biome[k] < BIOMES.length)
  }
  assert.ok(warm - cold > 5, `lowlands ${warm} °C vs peaks ${cold} °C`)
})

test('the smooth macro reading is continuous across grid lines and the eroded terrain keeps LOD errors small', () => {
  const x = macro.origin[0] + macro.cell * 40, z = macro.origin[1] + macro.cell * 33
  for (const step of [1e-3, 1e-4]) assert.ok(Math.abs(sampleMacro(macro.delta, macro, x - step, z) - sampleMacro(macro.delta, macro, x + step, z)) < 0.05)
  const world = climate(), source = createHeightSource(world, macro), levels = levelCount(1024), origin: [number, number] = [-512, -512], blocks = errorBlocks([1024, 1024], origin, levels)
  const assembled = assembleCellErrors(blocks, blocks.map((block) => measureBlockErrors(source, block.x, block.z, levels, block.last)), origin, [16, 16], levels)
  assert.ok(assembled.max[1] < 0.5, `level-1 error ${assembled.max[1].toFixed(3)} m`)
})

test('workers only produce climate heights once the macro relief is installed, and then match the main thread', () => {
  const world = climate(11, 512), built = runWorldJob({ type: 'macro', world }).result as { macro: WorldMacro }
  assert.throws(() => runWorldJob({ type: 'tile', world, origin: [-256, -256], level: 1, ix: 0, iz: 0 }))
  const fields = { delta: built.macro.delta, cell: built.macro.cell, points: built.macro.points, origin: built.macro.origin, biome: built.macro.biome, water: built.macro.water, river: built.macro.river, ground: built.macro.ground, clear: built.macro.clear }
  runWorldJob({ type: 'install', world, fields })
  const tile = runWorldJob({ type: 'tile', world, origin: [-256, -256], level: 1, ix: 0, iz: 0 }).result as { heights: Float32Array }
  const main = createHeightSource(world, fields)
  // Sample (i = 3, j = 1) of the 67-wide tile, with its one-sample apron, at 2 m spacing.
  assert.equal(tile.heights[67 + 3], Math.fround(main.heightAt(-256 + 2 * 2, -256)))
})

test('the water mesh covers lakes and rivers, and regions resolve ambience from biome or region choice', () => {
  const mesh = waterMesh(buildWorldMacro(climate(9, 2048)))
  assert.ok(mesh.indices.length > 0 && mesh.indices.length % 3 === 0)
  assert.ok(mesh.positions.every((value) => Number.isFinite(value)))
  const base = { biome: 'auto' as const, weight: 1, weather: 'none' as const }
  const world = { terrain: climate().terrain, regions: [{ ...base, id: 'a', name: 'Norte', site: [0, 300] as [number, number], danger: 3, ambience: 'auto' as const, music: 'auto' as const },
    { ...base, id: 'b', name: 'Sul', site: [0, -300] as [number, number], danger: 0, ambience: 'snow' as const, music: 'calm' as const }] }
  assert.equal(regionAt(world, macro, 0, 250).region?.id, 'a')
  assert.equal(regionAt(world, macro, 0, 250).music, 'tension')
  const south = regionAt(world, macro, 0, -280)
  assert.deepEqual([south.region?.id, south.ambience, south.music], ['b', 'snow', 'calm'])
})

test('settlement footprints are flattened and cleared, and roads join them with gentle grades', () => {
  const world = climate(9, 2048), layout = { sites: [{ x: -400, z: -300, radius: 40 }, { x: 350, z: 250, radius: 30 }], roads: [{ from: 0, to: 1, width: 5 }] }
  const shaped = buildWorldMacro(world, layout), heights = createHeightSource(world, shaped)
  const ring = Array.from({ length: 12 }, (_, i) => heights.heightAt(-400 + Math.cos(i / 2) * 25, -300 + Math.sin(i / 2) * 25))
  assert.ok(Math.max(...ring) - Math.min(...ring) < 1.2, `footprint relief ${(Math.max(...ring) - Math.min(...ring)).toFixed(2)} m`)
  assert.equal(shaped.roads.length, 1)
  const road = shaped.roads[0]
  assert.ok(Math.hypot(road[0][0] + 400, road[0][1] + 300) < 16 && Math.hypot(road.at(-1)![0] - 350, road.at(-1)![1] - 250) < 16, 'the road starts and ends at the sites')
  // Grade along the road over 20 m of travel (switchbacks are fine; steep pitches are not). Fords, within two cells of
  // a river or lake, dip to the bed: there are no bridges yet.
  const k = (x: number, z: number) => Math.round((z - shaped.origin[1]) / shaped.cell) * shaped.points[0] + Math.round((x - shaped.origin[0]) / shaped.cell)
  const ford = (x: number, z: number) => { for (let r = -2; r <= 2; r++) for (let q = -2; q <= 2; q++) { const n = k(x + q * shaped.cell, z + r * shaped.cell); if (shaped.river[n] > 0.2 || !Number.isNaN(shaped.water[n])) return true } return false }
  let steepest = 0, from = 0, travelled = 0
  for (let i = 1; i < road.length; i++) {
    travelled += Math.hypot(road[i][0] - road[i - 1][0], road[i][1] - road[i - 1][1])
    if (travelled < 20) continue
    if (!ford(...road[i]) && !ford(...road[from])) steepest = Math.max(steepest, Math.abs(heights.heightAt(...road[i]) - heights.heightAt(...road[from])) / travelled)
    from = i; travelled = 0
  }
  assert.ok(steepest < 0.18, `road grade ${steepest.toFixed(3)}`)
  assert.ok(shaped.clear[k(-400, -300)] > 0.99 && shaped.clear[k(...road[road.length >> 1])] > 0.5)
})
