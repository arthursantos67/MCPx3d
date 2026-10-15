import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createNode, type SceneNode } from '../../src/three/sceneDocument.ts'
import { terrainHeightAt } from '../../src/three/sceneGeometrySpec.ts'
import { expandSceneRecipe } from '../../src/three/sceneGeneration.ts'
import { inspectSceneGeometry } from '../../src/three/sceneInspection.ts'
import { settleLayout } from '../../src/three/sceneLayout.ts'
import { SanitizeLog } from '../../src/three/sceneRecipeSanitize.ts'

const single = { mode: 'linear', count: 1, offset: [0, 0, 0], radius: 0, axis: 'y', columns: 1, jitter: 0, seed: 1, onto: null }
const t = (node: Partial<SceneNode> & { kind: SceneNode['kind'] }, repeat: Record<string, unknown> = single, extra: Record<string, unknown> = {}) => {
  const base = createNode(node.kind)
  return { ...base, ...node, color: '#cccccc', metalness: 0, roughness: 0.6, repeat: { ...single, ...repeat }, ...extra }
}
const v = (x: number, y: number, z: number) => [x, y, z] as [number, number, number]

function sloppyVillage() {
  const row = { mode: 'linear', count: 5, offset: [9, 0, 0] }
  return { name: 'Vila desleixada', background: '#223344', exposure: 1, lightIntensity: 1.5, duration: 12, environment: { sky: 'sunset' }, nodes: [
    t({ id: 'island', kind: 'terrain', position: v(0, 2, 0), dimensions: v(90, 6, 90), geometry: { ...createNode('terrain').geometry, seed: 23, detail: 4, closed: true } }),
    // Houses built part by part at the root, repeated in parallel lists at a guessed absolute height.
    t({ id: 'foundation', kind: 'box', position: v(-18, 3, -6), dimensions: v(6.4, 0.5, 5.4) }, row),
    t({ id: 'walls', kind: 'box', position: v(-18, 4.6, -6), dimensions: v(6, 2.8, 5) }, row),
    t({ id: 'roof', kind: 'cone', position: v(-18, 7, -6), dimensions: v(7.2, 2, 6.2) }, row),
    t({ id: 'chimney', kind: 'box', position: v(-16.5, 7.4, -7), dimensions: v(0.6, 1.6, 0.6) }, row),
    t({ id: 'door', kind: 'box', position: v(-18, 4, -3.45), dimensions: v(1.1, 2.1, 0.12) }, row),
    t({ id: 'window', kind: 'box', position: v(-16.4, 5, -3.48), dimensions: v(0.9, 0.8, 0.08) }, row),
    // Lamp posts placed along the street, some into the houses' walls.
    t({ id: 'post', kind: 'cylinder', position: v(-20, 4, -2.9), dimensions: v(0.15, 3, 0.15) }, { mode: 'linear', count: 8, offset: [5.5, 0, 0] }),
    t({ id: 'lantern', kind: 'roundedBox', position: v(-20, 5.6, -2.9), dimensions: v(0.35, 0.45, 0.35) }, { mode: 'linear', count: 8, offset: [5.5, 0, 0] }),
    // Trees: trunks and crowns scattered with the same seed but no declared contact.
    t({ id: 'trunk', kind: 'cylinder', position: v(0, 1.5, 15), dimensions: v(0.4, 3, 0.4) }, { mode: 'scatter', count: 40, offset: [60, 0, 30], seed: 7, onto: 'island' }),
    t({ id: 'crown', kind: 'polyhedron', position: v(0, 4.2, 15), dimensions: v(2.8, 2.6, 2.8) }, { mode: 'scatter', count: 40, offset: [60, 0, 30], seed: 7, onto: 'island' }),
    // Market: tables and crates overlapping each other on the plaza, at absolute heights.
    t({ id: 'table', kind: 'box', position: v(10, 3.6, -14), dimensions: v(1.6, 0.8, 0.9) }, { mode: 'linear', count: 6, offset: [1.3, 0, 0] }),
    t({ id: 'crate', kind: 'box', position: v(10.4, 3.4, -13.4), dimensions: v(0.8, 0.8, 0.8) }, { mode: 'linear', count: 6, offset: [1.3, 0, 0] }),
    t({ id: 'well', kind: 'cylinder', position: v(4, 3, -8), dimensions: v(1.8, 1, 1.8) }),
    t({ id: 'rock', kind: 'polyhedron', position: v(0, 2.5, 25), dimensions: v(1.4, 1, 1.2) }, { mode: 'scatter', count: 20, offset: [70, 0, 20], seed: 11 }),
  ] }
}

function prefabVillage() {
  const prefab = (id: string, type: string, repeat: Record<string, unknown>, position = v(0, 0, 0), extra: Record<string, unknown> = {}) =>
    // Young trees keep this deliberately dense forest within the compact island's planting area.
    t({ id, kind: 'group', position }, repeat, { prefab: { type, size: type==='tree'||type==='pine'?0.65:1, seed: 4, primary: null, secondary: null, text: 'Vila Lume', lit: true, interactive: true }, ...extra })
  return { name: 'Vila Lume', background: '#223344', exposure: 1, lightIntensity: 1.5, duration: 12, environment: { sky: 'night', bloom: 0.8 }, nodes: [
    t({ id: 'island', kind: 'terrain', position: v(0, 2, 0), dimensions: v(120, 6, 120), geometry: { ...createNode('terrain').geometry, seed: 23, detail: 4, closed: true } }),
    prefab('house', 'house', { mode: 'grid', count: 6, columns: 3, offset: [10, 0, 10], onto: 'island' }, v(-12, 0, -12)),
    prefab('lamp', 'lampPost', { mode: 'linear', count: 8, offset: [3.5, 0, 0], onto: 'island' }, v(-14, 0, 6)),
    prefab('tree', 'tree', { mode: 'scatter', count: 40, offset: [90, 0, 30], seed: 7, jitter: 0.4, onto: 'island' }, v(0, 0, 30)),
    prefab('pine', 'pine', { mode: 'scatter', count: 25, offset: [90, 0, 20], seed: 9, jitter: 0.4, onto: 'island' }, v(0, 0, -35)),
    prefab('rocks', 'rock', { mode: 'scatter', count: 15, offset: [60, 0, 60], seed: 3, onto: 'island' }),
    prefab('well', 'well', { onto: 'island' }, v(14, 0, -4)),
    prefab('tower', 'tower', { onto: 'island' }, v(22, 0, 12)),
    prefab('fire', 'campfire', { onto: 'island' }, v(14, 0, 4)),
    prefab('coins', 'coin', { mode: 'scatter', count: 10, offset: [60, 0, 60], seed: 13, onto: 'island' }),
    prefab('mill', 'windmill', { onto: 'island' }, v(-25, 0, 18)),
    prefab('welcome', 'sign', { onto: 'island' }, v(0, 0, 30)),
    t({ id: 'sea', kind: 'plane', position: v(0, 0.3, 0), dimensions: v(400, 0.01, 400), collidable: false }, single, { surface: { texture: 'water' } }),
  ] }
}

function run(name: string, recipe: unknown) {
  const log = new SanitizeLog()
  const doc = expandSceneRecipe(recipe, () => {}, [], { lenient: true, log })
  let report = inspectSceneGeometry(doc, { maxMilliseconds: 60000 })
  const first = report.intersections.length
  if (process.env.LAYOUT_BENCHMARK) console.log(name, 'nodes', doc.nodes.length, 'pairs after expansion', report.intersections.length, 'assembly', report.assemblyContacts, 'skipped', report.skippedContacts)
  let current = doc
  for (let round = 0; round < 4; round++) {
    const result = settleLayout(current, report)
    if (result.document === current) break
    const next = inspectSceneGeometry(result.document, { maxMilliseconds: 60000 })
    if (process.env.LAYOUT_BENCHMARK) console.log(`round ${round + 1}: moved ${result.moved}, grounded ${result.grounded}, pairs ${next.intersections.length}`)
    if (next.intersections.length > report.intersections.length) break
    current = result.document; report = next
    if (!report.intersections.length) break
  }
  const kinds = new Map<string, number>()
  for (const issue of report.intersections) { const key = [issue.a, issue.b].map((id) => id.replace(/~\d+$/, '')).sort().join(' ↔ '); kinds.set(key, (kinds.get(key) ?? 0) + 1) }
  if (process.env.LAYOUT_BENCHMARK) console.log(name, 'remaining by template', JSON.stringify([...kinds]))
  return { before: first, after: report.intersections.length, document: current }
}

test('layout pipeline: sloppy part-by-part villages and prefab villages end with few or no intersections', () => {
  const sloppy = run('sloppy', sloppyVillage()), prefabs = run('prefabs', prefabVillage())
  assert.ok(sloppy.after <= 3, `sloppy village kept ${sloppy.after} pairs`)
  assert.equal(prefabs.after, 0)
  const doc = prefabs.document, island = doc.nodes.find((node) => node.id === 'island')!
  const ground = (x: number, z: number) => island.position[1] + terrainHeightAt(island.geometry, x / island.dimensions[0], z / island.dimensions[2]) * island.dimensions[1]
  const roots = doc.nodes.filter((node) => !node.parentId && node.kind === 'group')
  if(process.env.LAYOUT_BENCHMARK) console.log('retained roots',roots.length,Object.fromEntries([...new Set(roots.map(n=>n.asset?.type))].map(type=>[type,roots.filter(n=>n.asset?.type===type).length])))
  assert.ok(roots.length > 100)
  for (const root of roots) assert.ok(ground(root.position[0], root.position[2]) > 0.3, `${root.name} ended in the water`)
  for (const coin of doc.nodes.filter((node) => node.interaction?.action === 'collect')) {
    const root = doc.nodes.find((node) => node.id === coin.parentId)!
    assert.ok(ground(root.position[0], root.position[2]) > 0.3, `${root.name} is in the water`)
    assert.ok(root.position[1] + coin.position[1] - ground(root.position[0], root.position[2]) <= 2.2, `${root.name} is out of reach`)
  }
})

test('Corrigir cena heals an old-style scene without AI: slopes, water, floating posts, coins and spawn', async () => {
  const { editThreeScene, expandSceneRecipe: expand } = await import('../../src/three/sceneGeneration.ts')
  const { auditScene } = await import('../../src/three/sceneLayout.ts')
  const { validateScene } = await import('../../src/three/sceneDocument.ts')
  const { inspectSceneGeometry: inspect } = await import('../../src/three/sceneInspection.ts')
  const land = t({ id: 'island', kind: 'terrain', position: v(0, 2, 0), dimensions: v(90, 8, 90), geometry: { ...createNode('terrain').geometry, seed: 23, detail: 4, closed: true } })
  const sea = t({ id: 'sea', kind: 'plane', position: v(0, 0.5, 0), dimensions: v(300, 0.01, 300), collidable: false }, single, { surface: { texture: 'water' } })
  const base = expand({ name: 'Antiga', background: '#223344', exposure: 1, lightIntensity: 1.5, duration: 12, environment: { player: { spawn: [0, 0, 44], yaw: 0, speed: 5, jumpHeight: 1, mode: 'walk' } }, nodes: [land, sea] })
  const ground = (x: number, z: number) => 2 + terrainHeightAt(base.nodes[0].geometry, x / 90, z / 90) * 8
  // A house group placed by absolute height on a slope, trees in the sea, a floating post and an unreachable coin.
  let worst = { x: 0, z: 0, slope: 0 }
  for (let x = -25; x <= 25; x += 5) for (let z = -25; z <= 25; z += 5) { const slope = Math.abs(ground(x + 3, z) - ground(x - 3, z)) + Math.abs(ground(x, z + 3) - ground(x, z - 3)); if (slope > worst.slope && ground(x, z) > 1.5) worst = { x, z, slope } }
  const house = { ...createNode('group'), id: 'house', name: 'Casa antiga', position: v(worst.x, ground(worst.x, worst.z), worst.z) }
  const parts = [
    { ...createNode('box', 'house'), id: 'house.floor', name: 'Piso', position: v(0, 0.2, 0), dimensions: v(6, 0.4, 5) },
    { ...createNode('box', 'house'), id: 'house.walls', name: 'Paredes', position: v(0, 1.8, 0), dimensions: v(6, 2.8, 5) },
  ]
  const trees = [0, 1, 2].map((i) => ({ ...createNode('cylinder'), id: `tree~${i + 2}`, name: `Árvore ${i}`, position: v(41 + i * 2, ground(41 + i * 2, 0) + 1.5, 0), dimensions: v(0.4, 3, 0.4) }))
  const post = { ...createNode('cylinder'), id: 'post', name: 'Poste', position: v(worst.x + 9, ground(worst.x + 9, worst.z) + 2, worst.z), dimensions: v(0.15, 3, 0.15) }
  const coin = { ...createNode('cylinder'), id: 'coin', name: 'Moeda', position: v(-worst.x, ground(-worst.x, -worst.z) + 6, -worst.z), dimensions: v(0.6, 0.08, 0.6), collidable: false,
    interaction: { trigger: 'proximity' as const, key: '', radius: 1.4, action: 'collect' as const, targetId: null, message: '' } }
  const doc = validateScene({ ...base, nodes: [...base.nodes, house, ...parts, ...trees, post, coin] })
  const before = auditScene(doc, inspect(doc))
  assert.ok(before.inWater.length >= 3 && before.floating.includes('Poste') && before.uneven.includes('Casa antiga') && before.unreachable.includes('Moeda') && before.spawnInWater, JSON.stringify(before))
  let calls = 0
  const provider = { id: 'fixture', isAvailable: async () => true, initialize: async () => {}, generateStructured: async <T>() => { calls++; return { updates: [], additions: [] } as T } }
  const healed = await editThreeScene(provider, doc, '', new AbortController().signal, { mode: 'repair' })
  const after = auditScene(healed, inspect(healed))
  assert.equal(calls, 0)
  assert.equal(after.total, 0, JSON.stringify(after))
  assert.ok(healed.nodes.filter((node) => node.id.startsWith('tree~')).length === 0, 'decorative copies in the sea were removed')
})

test('the built-in examples pass the scene audit without problems', async () => {
  const { createIslandScene, createOrbitalScene, createPavilionScene } = await import('../../src/three/scenePreset.ts')
  const { auditScene, describeAudit } = await import('../../src/three/sceneLayout.ts')
  for (const make of [createPavilionScene, createOrbitalScene, createIslandScene]) {
    const doc = make()
    assert.deepEqual(describeAudit(auditScene(doc, inspectSceneGeometry(doc))), [], doc.name)
  }
})
