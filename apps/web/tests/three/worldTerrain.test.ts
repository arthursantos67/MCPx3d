import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three'
import { boxDistanceSq, buildLodField, cellPlaneDistance, fieldRange, GRID, levelCount, nodeSize, projectionScale, QUARTER, selectNodes, type LodField, type QuarterDraw } from '../../src/three/world/cdlod.ts'
import { combineShapes, createTerrainCollider } from '../../src/three/world/terrainCollider.ts'
import { collisionNodes, createTerrainStream } from '../../src/three/world/terrainStream.ts'
import { assembleCellErrors, errorBlocks, generateTile, measureBlockErrors, tileHeight, tileSurface, type TileData } from '../../src/three/world/terrainTile.ts'
import { runWorldJob } from '../../src/three/world/worldJobs.ts'
import { createHeightSource } from '../../src/three/world/worldTerrain.ts'
import { quarterGeometry } from '../../src/three/world/terrainRenderer.ts'
import type { ThreeWorldDocument } from '../../src/three/world/worldDocument.ts'

const world = (size = 1024, seed = 7): Pick<ThreeWorldDocument, 'seed' | 'terrain'> => ({ seed, terrain: { kind: 'synthetic', size: [size, size], heightRange: [-40, 600], seaLevel: 0, ruggedness: 0.8, erosion: 0, climate: { temperature: 16, humidity: 0.55, wind: 0 } } })
const settings = { pixelHeight: 1080, fovY: THREE.MathUtils.degToRad(70), tolerancePx: 1, morphFraction: 0.3 }

test('frustum culling tests each drawn quarter without changing terrain residency requests', () => {
  const field = buildLodField([new Float32Array(1)], [1, 1], settings)
  const input = { camera: [0, 100, 0] as [number, number, number], origin: [-32, -32] as [number, number], levels: 1, field, roots: [1, 1] as [number, number], bounds: () => ({ minY: 0, maxY: 2 }), resident: () => true }
  const all = selectNodes(input)
  const view = selectNodes({ ...input, visible: (_x0, _y0, _z0, x1, _y1, z1) => x1 > 0 && z1 > 0 })
  assert.equal(all.draws.length, 4)
  assert.deepEqual(view.draws, [{ level: 0, ix: 0, iz: 0, quarter: 3 }])
  assert.deepEqual(view.wanted, all.wanted)
  assert.equal(view.deficit, 0)
  const finer = selectNodes({ ...input, camera: [0, 1, 0], origin: [-64, -64], levels: 2,
    field: buildLodField([new Float32Array(4), new Float32Array(4)], [2, 2], settings),
    resident: (level, ix, iz) => level === 1 || (ix === 1 && iz === 1),
    visible: (_x0, _y0, _z0, x1, _y1, z1) => x1 > 0 && z1 > 0 })
  assert.equal(finer.deficit, 0, 'missing quarters outside the view are prefetched without reporting a visible shortfall')
  assert.equal(finer.wanted.length, 3)
  assert.ok(finer.draws.every((draw) => draw.level === 0 && draw.ix === 1 && draw.iz === 1))
})

function measured(size: number, seed = 7) {
  const source = createHeightSource(world(size, seed)), levels = levelCount(size), origin: [number, number] = [-size / 2, -size / 2], blocks = errorBlocks([size, size], origin, levels)
  const cells: [number, number] = [size / 64, size / 64]
  const assembled = assembleCellErrors(blocks, blocks.map((block) => measureBlockErrors(source, block.x, block.z, levels, block.last)), origin, cells, levels)
  const errors = assembled.max, cellErrors = assembled.cells, field = buildLodField(cellErrors, cells, settings)
  /** Largest level-L error over the 64 m cells of a box. */
  const errorIn = (level: number, x0: number, z0: number, x1: number, z1: number) => {
    let worst = 0
    for (let cz = Math.floor((z0 - origin[1]) / 64); cz < Math.ceil((z1 - origin[1]) / 64); cz++) for (let cx = Math.floor((x0 - origin[0]) / 64); cx < Math.ceil((x1 - origin[0]) / 64); cx++) worst = Math.max(worst, cellErrors[level][cz * cells[0] + cx])
    return worst
  }
  const tiles = new Map<string, TileData>(), tile = (level: number, ix: number, iz: number) => {
    const key = `${level}:${ix}:${iz}`
    if (!tiles.has(key)) tiles.set(key, generateTile(source, origin, level, ix, iz))
    return tiles.get(key)!
  }
  /** The reference surface: level 0, the mesh drawn nearby and used for collision. */
  const surface = (x: number, z: number) => {
    const ix = Math.min(size / 64 - 1, Math.floor((x - origin[0]) / 64)), iz = Math.min(size / 64 - 1, Math.floor((z - origin[1]) / 64))
    return tileSurface(tile(0, ix, iz), origin, x, z)
  }
  return { source, levels, origin, errors, cellErrors, field, errorIn, tile, surface }
}

test('heights are deterministic across sources and match the worker job bit for bit', () => {
  const a = createHeightSource(world(4096, 99)), b = createHeightSource(world(4096, 99)), c = createHeightSource(world(4096, 100))
  let differs = false
  for (let i = 0; i < 500; i++) {
    const x = (i * 37.17) % 4096 - 2048, z = (i * 91.3) % 4096 - 2048
    assert.equal(a.heightAt(x, z), b.heightAt(x, z))
    if (a.heightAt(x, z) !== c.heightAt(x, z)) differs = true
  }
  assert.ok(differs, 'another seed changes the relief')
  const job = runWorldJob({ type: 'tile', world: world(4096, 99), origin: [-2048, -2048], level: 2, ix: 3, iz: 5 }).result as TileData
  assert.deepEqual([...job.heights], [...generateTile(a, [-2048, -2048], 2, 3, 5).heights])
})

test('synthetic relief has sea at the borders, mountains and stays inside the height range', () => {
  const source = createHeightSource(world(4096, 3))
  let low = Infinity, high = -Infinity
  for (let j = 0; j < 64; j++) for (let i = 0; i < 64; i++) { const h = source.heightAt(-2048 + i * 64, -2048 + j * 64); low = Math.min(low, h); high = Math.max(high, h) }
  assert.ok(low >= -40 && high <= 600)
  assert.ok(source.heightAt(-2040, 0) < 0, 'world border is under the sea')
  assert.ok(high > 250, `mountains reach ${high} m`)
})

test('measured level errors are exact maxima of the nested meshes', () => {
  const { source, origin, errors, errorIn } = measured(512)
  assert.equal(errors[0], 0)
  for (let level = 1; level < errors.length; level++) assert.ok(errors[level] >= errors[level - 1])
  // Independent check: evaluate each level's tile surface at every 1 m lattice point of one node.
  for (const level of [1, 2, 3]) {
    const tile = generateTile(source, origin, level, 0, 0), size = nodeSize(level), step = size / GRID
    let worst = 0
    for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
      const ci = Math.floor(i / step), cj = Math.floor(j / step)
      worst = Math.max(worst, cellPlaneDistance(tileHeight(tile, ci, cj), tileHeight(tile, ci + 1, cj), tileHeight(tile, ci, cj + 1), tileHeight(tile, ci + 1, cj + 1),
        (i - ci * step) / step, (j - cj * step) / step, step, Math.fround(source.heightAt(origin[0] + i, origin[1] + j))))
    }
    assert.ok(worst <= errors[level] + 1e-3, `level ${level}: ${worst} > ${errors[level]}`)
    assert.ok(Math.abs(worst - errorIn(level, origin[0], origin[1], origin[0] + size, origin[1] + size)) < 1e-3, 'per-cell maxima match the brute-force value')
  }
})

/** CPU copy of the vertex shader morph, for checking selections. */
function morphVertex(draw: QuarterDraw, i: number, j: number, field: LodField, camera: THREE.Vector3, origin: [number, number], tile: TileData) {
  const size = nodeSize(draw.level), spacing = size / GRID, cx = i + (draw.quarter & 1) * QUARTER, cz = j + (draw.quarter >> 1) * QUARTER
  const height = tileHeight(tile, cx, cz), x = origin[0] + draw.ix * size + cx * spacing, z = origin[1] + draw.iz * size + cz * spacing
  const end = Math.min(1e9, fieldRange(field, draw.level, origin, x, z, draw.ix, draw.iz)), start = end * (1 - field.morphFraction), distance = camera.distanceTo(new THREE.Vector3(x, height, z))
  const k = Math.min(1, Math.max(0, (distance - start) / (end - start)))
  const ox = cx % 2, oz = cz % 2
  return { k, distance, position: new THREE.Vector3(x - ox * k * spacing, height + (tileHeight(tile, cx - ox, cz - oz) - height) * k, z - oz * k * spacing) }
}

test('every selected patch stays within 1 px of the level-0 surface', () => {
  const size = 1024, { source, levels, origin, field, errorIn, tile, surface } = measured(size), scale = projectionScale(settings)
  const cameras = [new THREE.Vector3(0, 30, 0), new THREE.Vector3(300, 200, -250), new THREE.Vector3(-480, 8, 470), new THREE.Vector3(120, 600, 60)]
  for (const camera of cameras) {
    camera.y = Math.max(camera.y, source.heightAt(camera.x, camera.z) + 1.7)
    const { draws, deficit } = selectNodes({ camera: [camera.x, camera.y, camera.z], origin, levels, field, roots: [1, 1], bounds: tile, resident: () => true })
    assert.equal(deficit, 0)
    const boxes = draws.map((draw) => {
      const half = nodeSize(draw.level) / 2
      return { level: draw.level, x0: origin[0] + draw.ix * nodeSize(draw.level) + (draw.quarter & 1) * half, z0: origin[1] + draw.iz * nodeSize(draw.level) + (draw.quarter >> 1) * half, half }
    })
    for (const [index, draw] of draws.entries()) {
      const t = tile(draw.level, draw.ix, draw.iz), { x0, z0, half } = boxes[index]
      // Unmorphed triangles deviate up to errors[level] inside: they must be far enough for that to stay under 1 px.
      assert.ok(Math.sqrt(boxDistanceSq(camera.x, camera.y, camera.z, x0, t.minY, z0, x0 + half, t.maxY, z0 + half)) * 1.0001 >= errorIn(draw.level, x0, z0, x0 + half, z0 + half) * scale, `level ${draw.level} too close`)
      for (let j = 0; j <= QUARTER; j++) for (let i = 0; i <= QUARTER; i++) {
        const vertex = morphVertex(draw, i, j, field, camera, origin, t)
        const pixels = Math.abs(vertex.position.y - surface(vertex.position.x, vertex.position.z)) * scale / Math.max(1e-6, camera.distanceTo(vertex.position))
        assert.ok(pixels <= 1.001, `vertex error ${pixels.toFixed(3)} px at level ${draw.level}`)
      }
    }
  }
})

test('borders between patches of different levels stay within 2 px and the skirts are deep enough to close them', () => {
  const size = 1024, { source, levels, origin, field, tile, surface } = measured(size), scale = projectionScale(settings)
  const camera = new THREE.Vector3(37, source.heightAt(37, -12) + 1.7, -12)
  const { draws } = selectNodes({ camera: [camera.x, camera.y, camera.z], origin, levels, field, roots: [1, 1], bounds: tile, resident: () => true })
  const borders = new Map<string, { y: number; skirt: number; level: number }[]>()
  for (const draw of draws) {
    const t = tile(draw.level, draw.ix, draw.iz), skirt = field.skirt(draw.level, draw.ix, draw.iz), half = nodeSize(draw.level) / 2
    const x0 = origin[0] + draw.ix * nodeSize(draw.level) + (draw.quarter & 1) * half, z0 = origin[1] + draw.iz * nodeSize(draw.level) + (draw.quarter >> 1) * half
    for (let j = 0; j <= QUARTER; j++) for (let i = 0; i <= QUARTER; i++) {
      if (!(i === 0 || j === 0 || i === QUARTER || j === QUARTER)) continue
      const step = half / QUARTER, x = x0 + i * step, z = z0 + j * step, vertex = morphVertex(draw, i, j, field, camera, origin, t)
      const key = `${x.toFixed(2)}:${z.toFixed(2)}`
      borders.set(key, [...(borders.get(key) ?? []), { y: vertex.position.y + (surface(x, z) - surface(vertex.position.x, vertex.position.z)), skirt, level: draw.level }])
    }
  }
  let mixed = 0
  for (const [key, list] of borders) {
    if (list.length < 2 || new Set(list.map((item) => item.level)).size < 2) continue
    mixed++
    const [x, z] = key.split(':').map(Number), distance = camera.distanceTo(new THREE.Vector3(x, surface(x, z), z))
    const gap = Math.max(...list.map((item) => item.y)) - Math.min(...list.map((item) => item.y))
    assert.ok(gap * scale / distance <= 2.01, `gap ${(gap * scale / distance).toFixed(2)} px`)
    assert.ok(Math.min(...list.map((item) => item.skirt)) >= gap - 1e-6, 'skirt shorter than the gap')
  }
  assert.ok(mixed > 20, 'the view contains borders between levels')
})

test('skirt strips face outwards on every border', () => {
  const geometry = quarterGeometry(), position = geometry.getAttribute('position'), index = geometry.index!, side = QUARTER + 1
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), normal = new THREE.Vector3(), center = new THREE.Vector3(QUARTER / 2, 0, QUARTER / 2)
  let strips = 0
  for (let t = 0; t < index.count; t += 3) {
    const ids = [index.getX(t), index.getX(t + 1), index.getX(t + 2)]
    for (const [k, v] of [a, b, c].entries()) v.set(position.getX(ids[k]), -position.getY(ids[k]), position.getZ(ids[k]))
    normal.subVectors(b, a).cross(c.clone().sub(a)).normalize()
    if (ids.every((id) => id < side * side)) { assert.ok(normal.y > 0.99, 'ground faces up'); continue }
    strips++
    const outward = a.clone().add(b).add(c).divideScalar(3).sub(center).setY(0)
    assert.ok(normal.dot(outward) > 0, 'skirt faces outwards')
  }
  assert.equal(strips, QUARTER * 4 * 2)
})

test('the range field keeps detail only around rough ground and never lets a coarser level stop short of a finer one', () => {
  const cells: [number, number] = [16, 16], levels = 5, flat = Array.from({ length: levels }, (_, level) => new Float32Array(256).fill(level ? 0.01 * level : 0))
  const rough = flat.map((grid, level) => { const copy = grid.slice(); if (level) copy[8 * 16 + 8] = 1.5 * level; return copy })
  const smooth = buildLodField(flat, cells, settings), cliff = buildLodField(rough, cells, settings)
  assert.ok(cliff.reach(0, 8, 8) > smooth.reach(0, 8, 8) * 5, 'a cliff keeps level 0 much farther')
  assert.equal(cliff.reach(0, 0, 0), smooth.reach(0, 0, 0), 'far from the cliff the field is unchanged')
  for (const field of [smooth, cliff]) for (let level = 1; level < levels - 1; level++) {
    const [nx, nz] = field.nodes[level]
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
      const own = field.corner(level, i, j), finer = field.corner(level - 1, Math.min(field.nodes[level - 1][0], i * 2), Math.min(field.nodes[level - 1][1], j * 2))
      assert.ok(own >= finer, 'coarser levels reach at least as far as finer ones')
    }
  }
  assert.ok(cliff.reach(levels - 1, 0, 0) >= 1e9)
})

test('the stream applies tiles within the frame budget, never evicts tiles in use and resolves preloads', async () => {
  const source = createHeightSource(world(4096)), origin: [number, number] = [-2048, -2048]
  let clock = 0
  const stream = createTerrainStream({ capacity: 4, levels: 7, errors: [0, 0, 0, 0, 0, 0, 0], range: [-40, 600], maxInFlight: 8, maxPerFrame: 16,
    generate: async (level, ix, iz) => generateTile(source, origin, level, ix, iz) })
  const nodes = [{ level: 6, ix: 0, iz: 0 }, { level: 5, ix: 0, iz: 0 }, { level: 5, ix: 1, iz: 0 }, { level: 5, ix: 0, iz: 1 }, { level: 5, ix: 1, iz: 1 }]
  const preload = stream.whenResident(nodes.slice(0, 2))
  stream.request(nodes)
  await new Promise((resolve) => setTimeout(resolve, 0))
  // Each apply step costs 1 ms on the fake clock; a 2 ms budget admits two tiles.
  assert.equal(stream.apply(2, () => (clock += 0.9)), 2)
  assert.equal(stream.resident(6, 0, 0), true)
  await preload
  stream.beginFrame()
  for (const node of nodes) stream.resident(node.level, node.ix, node.iz)
  stream.apply(100, () => clock)
  assert.equal(stream.stats.resident, 4, 'capacity is respected')
  assert.equal(stream.resident(6, 0, 0), true, 'the root is never evicted')
  stream.beginFrame(); stream.beginFrame()
  stream.request([{ level: 4, ix: 0, iz: 0 }])
  await new Promise((resolve) => setTimeout(resolve, 0))
  stream.apply(100, () => clock)
  assert.equal(stream.resident(4, 0, 0), true, 'stale tiles make room')
  assert.ok(stream.stats.evicted >= 1)
  assert.equal(stream.takeDirty().length > 0, true)
})

test('terrain collision matches the rendered level-0 surface: ground probes, capsules and line of sight', () => {
  const source = createHeightSource(world(4096, 11)), origin: [number, number] = [-2048, -2048]
  const nodes = collisionNodes(100, 140, origin, 72), tiles = nodes.map((node) => generateTile(source, origin, 0, node.ix, node.iz))
  const collider = createTerrainCollider(() => tiles, origin)
  for (let i = 0; i < 40; i++) {
    const x = 60 + i * 2.137, z = 110 + (i * 7.31) % 60, tile = tiles.find((item) => x >= origin[0] + item.ix * 64 && x < origin[0] + item.ix * 64 + 64 && z >= origin[1] + item.iz * 64 && z < origin[1] + item.iz * 64 + 64)!
    const ray = new THREE.Ray(new THREE.Vector3(x, 2000, z), new THREE.Vector3(0, -1, 0))
    const hit = collider.raycastFirst(ray, THREE.DoubleSide)!
    assert.ok(Math.abs(hit.point.y - tileSurface(tile, origin, x, z)) < 1e-3)
    assert.ok(hit.face!.normal.y > 0)
  }
  const ground = tileSurface(tiles[0], origin, origin[0] + tiles[0].ix * 64 + 10, origin[1] + tiles[0].iz * 64 + 10)
  const feet = new THREE.Vector3(origin[0] + tiles[0].ix * 64 + 10, ground - 0.2, origin[1] + tiles[0].iz * 64 + 10)
  const segment = new THREE.Line3(feet.clone().setY(feet.y + 0.3), feet.clone().setY(feet.y + 1.5)), a = new THREE.Vector3(), b = new THREE.Vector3()
  let touching = false
  combineShapes([collider]).shapecast({ intersectsBounds: (box) => box.distanceToPoint(segment.start) < 1, intersectsTriangle: (triangle) => { if (triangle.closestPointToSegment(segment, a, b) < 0.3) touching = true } })
  assert.ok(touching, 'a capsule sunk into the ground touches terrain triangles')
  const slanted = collider.raycastFirst(new THREE.Ray(new THREE.Vector3(feet.x, ground + 40, feet.z), new THREE.Vector3(0.6, -1, 0.3).normalize()), THREE.DoubleSide)!
  const owner = tiles.find((item) => slanted.point.x >= origin[0] + item.ix * 64 && slanted.point.x < origin[0] + item.ix * 64 + 64 && slanted.point.z >= origin[1] + item.iz * 64 && slanted.point.z < origin[1] + item.iz * 64 + 64)!
  assert.ok(Math.abs(slanted.point.y - tileSurface(owner, origin, slanted.point.x, slanted.point.z)) < 1e-3, 'line-of-sight hits lie on the drawn surface')
})

test('render-space vertices keep sub-pixel precision 4 km from the origin only with the floating origin', () => {
  const f = Math.fround, scale = projectionScale(settings)
  // Shader math in float32: clip position from a float32 vertex and a float32 model-view translation.
  const project = (vertexX: number, translation: number) => f(f(vertexX) + f(translation))
  let rebased = 0, absolute = 0
  for (let step = 0; step < 200; step++) {
    const camera = 3900.0123 + step * 0.0037, vertex = 3901.25, renderOrigin = 3840
    const exact = vertex - camera
    rebased = Math.max(rebased, Math.abs(project(vertex - renderOrigin, renderOrigin - camera) - exact))
    absolute = Math.max(absolute, Math.abs(project(vertex, -camera) - exact))
  }
  assert.ok(rebased * scale < 0.01, `rebased error ${(rebased * scale).toFixed(4)} px at 1 m`)
  assert.ok(absolute > rebased * 10)
})
