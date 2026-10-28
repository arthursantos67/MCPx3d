import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three'
import { createEmptyScene, createNode, validateScene } from '../../src/three/sceneDocument.ts'
import { craftItem, gameplayStatus, itemCount, resourceHit } from '../../src/three/sceneGameplay.ts'
import { advanceRuntime, checkOutcome, createRuntime, damageEnemy, triggerInteraction } from '../../src/three/sceneRuntime.ts'
import { restoreRuntime, snapshotRuntime } from '../../src/three/sceneProgress.ts'
import { buildStaticCollider, emptyInput, stepPlayer, type PlayerState } from '../../src/three/scenePlayer.ts'
import { createClimateWorld, createSyntheticWorld } from '../../src/three/world/worldExamples.ts'
import { composeWorldScene } from '../../src/three/world/worldScene.ts'
import { createPlantInteraction, filterPlants } from '../../src/three/world/worldPlantInteraction.ts'
import { buildMacro, waterHeightAt, waterMesh } from '../../src/three/world/worldMacro.ts'
import { buildWorldMacro, runWorldJob } from '../../src/three/world/worldJobs.ts'
import { createHeightSource } from '../../src/three/world/worldTerrain.ts'
import { expandSceneRecipe } from '../../src/three/sceneGeneration.ts'
import { fitLocationScene } from '../../src/three/world/worldGeneration.ts'
import { buildScene, createResources } from '../../src/three/sceneBuild.ts'
import { createLocationLod } from '../../src/three/world/locationLod.ts'
import { generateTile, type TileData } from '../../src/three/world/terrainTile.ts'
import { reviewSceneDirection } from '../../src/three/sceneDirection.ts'
import { findWorldSpawn } from '../../src/three/world/worldSpawn.ts'
import { regionAt } from '../../src/three/world/worldRegions.ts'
import { createTerrainCollider } from '../../src/three/world/terrainCollider.ts'

test('Aurora has a complete harvest, craft, combat and beacon campaign; progress survives a reload', () => {
  const { scene, omitted } = composeWorldScene(createClimateWorld())
  assert.deepEqual(omitted, [])
  assert.ok(scene.nodes.length < 2000)
  const runtime = createRuntime(scene), before = JSON.stringify(scene)
  checkOutcome(runtime)
  assert.equal(gameplayStatus(runtime.rules, runtime.gameplay, runtime.defeated).target, 'lirio/mara')
  triggerInteraction(runtime, 'lirio/mara')
  for (const id of ['lirio/arvore0', 'lirio/arvore1', 'lirio/rocha0']) {
    const resource = runtime.byId.get(id)!.resource!
    for (let n = 0; n < resource.health; n++) resourceHit(runtime.gameplay, runtime.items, id, resource)
    assert.equal(resourceHit(runtime.gameplay, runtime.items, id, resource), null)
  }
  checkOutcome(runtime)
  assert.equal(runtime.gameplay.completed.size, 1)
  assert.equal(itemCount(runtime.items, 'Bandagem'), 1)
  checkOutcome(runtime)
  assert.equal(itemCount(runtime.items, 'Bandagem'), 1, 'reward is granted once')
  const recipe = runtime.rules!.recipes.find(r => r.id === 'sinal')!
  const inventory = [...runtime.items]
  assert.equal(craftItem(runtime.gameplay, runtime.items, recipe), false)
  assert.deepEqual([...runtime.items], inventory, 'a failed recipe consumes nothing')
  triggerInteraction(runtime, 'lirio/mara')
  const bush = runtime.byId.get('lirio/fibra0')!
  resourceHit(runtime.gameplay, runtime.items, bush.id, bush.resource!, 2)
  assert.equal(craftItem(runtime.gameplay, runtime.items, recipe), true)
  assert.equal(itemCount(runtime.items, 'Madeira'), 0)
  checkOutcome(runtime)
  assert.equal(runtime.gameplay.completed.size, 2)
  const restored = createRuntime(scene)
  restoreRuntime(restored, JSON.parse(JSON.stringify(snapshotRuntime(runtime))))
  assert.equal(itemCount(restored.items, 'Sinal de resgate'), 1)
  assert.ok(restored.hidden.has('lirio/arvore0'))
  assert.equal(resourceHit(restored.gameplay, restored.items, 'lirio/arvore0', runtime.byId.get('lirio/arvore0')!.resource!), null)
  damageEnemy(restored, 'ruinas/lobo1', 100)
  damageEnemy(restored, 'ruinas/lobo2', 100)
  triggerInteraction(restored, 'ruinas/nucleo')
  checkOutcome(restored)
  assert.equal(restored.gameplay.completed.size, 3)
  restored.gameplay.visited.add('posto/acionador')
  assert.ok(restored.hidden.has('posto/sinal'))
  triggerInteraction(restored, 'posto/acionador')
  checkOutcome(restored)
  assert.equal(restored.outcome, 'won')
  assert.ok(!restored.hidden.has('posto/sinal'))
  const final = createRuntime(scene)
  restoreRuntime(final, JSON.parse(JSON.stringify(snapshotRuntime(restored))))
  assert.ok(!final.hidden.has('posto/sinal'), 'the activated beacon stays lit after reload')
  assert.equal(JSON.stringify(scene), before, 'play never mutates the document')
})

test('the agent recipe preserves real harvest and quest data, and rejects missing recipe dependencies', () => {
  const recipe = { name: 'Oficina', background: '#dddddd', exposure: 1, lightIntensity: 1, duration: 20,
    nodes: [{ ...createNode('box'), id: 'ore', name: 'Minério', color: '#775544', metalness: 0, roughness: 0.8, resource: { item: 'Minério', amount: 2, health: 3 }, repeat: { mode: 'linear', count: 1, offset: [0, 0, 0], radius: 0, axis: 'y' } }],
    environment: { objective: { type: 'quests', title: '', timeLimit: 0 }, gameplay: { naturalResources: false, startingItems: [],
      recipes: [{ id: 'bar', name: 'Barra', inputs: [{ item: 'Minério', amount: 2 }], output: { item: 'Barra', amount: 1 }, healing: 0 }],
      quests: [{ id: 'forge', title: 'Forje uma barra', giverId: null, rewards: [], steps: [{ kind: 'craft', target: 'Barra', count: 1, label: 'Use o minério para forjar' }] }] } } }
  const doc = expandSceneRecipe(recipe)
  assert.deepEqual(doc.nodes[0].resource, { item: 'Minério', amount: 2, health: 3 })
  assert.equal(doc.environment.gameplay?.quests[0].steps[0].target, 'Barra')
  doc.nodes.push({ ...createNode('box'), id: 'gate', position: [4, 1, 0], interaction: { trigger: 'key', key: '1', radius: 3, action: 'message', targetId: null, message: 'Passagem liberada', requires: 'Barra' } })
  const issues = reviewSceneDirection(doc, 'Jogo de sobrevivência com coleta e fabricação')
  assert.ok(!issues.some(issue => /Progresso bloqueado|use environment.objective.type="survive"/.test(issue)), issues.join('\n'))
  const runtime = createRuntime(doc)
  resourceHit(runtime.gameplay, runtime.items, 'ore', doc.nodes[0].resource!, 3)
  assert.ok(craftItem(runtime.gameplay, runtime.items, runtime.rules!.recipes[0]))
  checkOutcome(runtime)
  assert.equal(runtime.outcome, 'won')
  recipe.environment.gameplay.recipes[0].inputs[0].item = 'Inexistente'
  assert.throws(() => expandSceneRecipe(recipe), /ingredientes inacessíveis/)
})

test('location budgets preserve playable entities and retry instead of deleting a mission target', () => {
  const doc = composeWorldScene(createClimateWorld()).scene, world = createClimateWorld()
  assert.throws(() => fitLocationScene(doc, { ...world.budgets, nodesPerLocation: 1 }, 32), /jogabilidade excedem/)
})

test('distant location proxies never bake harvestable objects that could reappear after extraction', () => {
  const doc = validateScene({ ...createEmptyScene(), nodes: [
    { ...createNode('group'), id: 'local:camp' },
    { ...createNode('box'), id: 'camp/wall', parentId: 'local:camp' },
    { ...createNode('box'), id: 'camp/ore', parentId: 'local:camp', position: [5, 0, 0], resource: { item: 'Pedra', amount: 2, health: 1 } },
  ] })
  const resources = createResources(), built = buildScene(doc, resources, { instancing: true, helpers: false }), lod = createLocationLod(built)
  while (lod.buildNext()) { /* finish the sliced proxy */ }
  const proxy = lod.object.children[0] as THREE.Mesh
  proxy.geometry.computeBoundingBox()
  assert.ok(proxy.geometry.boundingBox!.max.x < 1, 'the ore at x=5 is absent from the static proxy')
  lod.dispose(); built.dispose(); resources.dispose()
})

test('a large closed basin stays curved instead of becoming an artificial drainage plateau', () => {
  const macro = buildMacro({ seed: 1, size: [1024, 1024], range: [0, 50], seaLevel: null, erosion: 0, rivers: false,
    climate: { temperature: 18, humidity: 0.6, wind: 0 }, base: (x, z) => 10 + (x * x + z * z) / 64000 })
  const k = Math.floor(macro.points[1] / 2) * macro.points[0] + Math.floor(macro.points[0] / 2)
  assert.ok(macro.filled[k] > 13, 'the hydrology spill level is much higher than the basin bottom')
  assert.ok(Math.abs(macro.delta[k]) < 0.01, 'the terrain is not filled to the spill level')
})

test('the synthetic world starts on dry walkable ground after lakes exist and walking stays on its terrain', async () => {
  const world = createSyntheticWorld(), source = createHeightSource(world), macro = buildWorldMacro(world), mesh = waterMesh(macro)
  assert.equal(world.environment.player!.spawn, null, 'spawn is selected after hydrology')
  const spawn = await findWorldSpawn(world, source, (x, z) => {
    const level = waterHeightAt(mesh.levels, macro, x, z)
    return regionAt(world, macro, x, z).dry && (level === null || source.heightAt(x, z) > level + 0.5)
  })
  const water = waterHeightAt(mesh.levels, macro, spawn.x, spawn.z)
  assert.ok(water === null || water < spawn.y)
  const origin: [number, number] = [-2048, -2048], cx = Math.floor((spawn.x + 2048) / 64), cz = Math.floor((spawn.z + 2048) / 64), tiles: TileData[] = []
  for (let z = cz - 2; z <= cz + 2; z++) for (let x = cx - 2; x <= cx + 2; x++) tiles.push(generateTile(source, origin, 0, x, z))
  const state: PlayerState = { position: spawn.clone(), velocity: new THREE.Vector3(), yaw: 0, pitch: 0, onGround: false, fly: false }
  const collider = { bvh: createTerrainCollider(() => tiles, origin), boxes: [], floor: -110, waterAt: (x: number, z: number) => waterHeightAt(mesh.levels, macro, x, z) ?? 0 }
  for (let n = 0; n < 90; n++) stepPlayer(state, { ...emptyInput(), forward: n < 45 }, collider, { speed: 8, jumpHeight: 1.1 }, 1 / 60)
  assert.equal(state.swimming, false)
  assert.ok(state.position.distanceTo(spawn) > 2)
  assert.ok(Math.abs(state.position.y - source.heightAt(state.position.x, state.position.z)) < 0.35)
})

test('quest targets and ingredients are validated; quest time limits still apply', () => {
  const doc = composeWorldScene(createClimateWorld()).scene
  const broken = structuredClone(doc)
  broken.environment.gameplay!.quests[0].giverId = 'missing'
  assert.throws(() => validateScene(broken), /diálogo inexistente/)
  broken.environment.gameplay!.quests[0].giverId = 'lirio/mara'
  broken.environment.gameplay!.recipes[0].inputs.push({ item: 'mádeira', amount: 2 })
  assert.throws(() => validateScene(broken), /distintos/)
  doc.environment.objective!.timeLimit = 1
  const runtime = createRuntime(doc)
  advanceRuntime(runtime, 2); checkOutcome(runtime)
  assert.equal(runtime.outcome, 'lost')
})

test('harvested streamed plants stop colliding and stay removed when their cell reloads', () => {
  const interaction = createPlantInteraction([0, 0]), plants = { tree: new Float32Array([0, 0, 2, 0, 1]) }
  interaction.setCell(0, 0, plants)
  const ray = new THREE.Ray(new THREE.Vector3(0, 1.2, 0), new THREE.Vector3(0, 0, 1))
  const target = interaction.raycast(ray)!
  assert.equal(target.resource.item, 'Madeira')
  assert.equal(interaction.obstacles(0, 0).length, 1)
  interaction.removed.add(target.id)
  assert.equal(interaction.obstacles(0, 0).length, 0)
  interaction.setCell(0, 0, null); interaction.setCell(0, 0, plants)
  assert.equal(interaction.raycast(ray), null)
  assert.equal(filterPlants(plants, interaction.removed).tree!.length, 0)
})

test('deep water supports a swimmer, diving submerges the head, shallow water allows walking and the bank allows exit', () => {
  const floor = new THREE.BoxGeometry(40, 1, 40)
  const { bvh } = buildStaticCollider([{ geometry: floor, matrix: new THREE.Matrix4().makeTranslation(0, -3.5, 0) }])
  const collider = { bvh, boxes: [], floor: -3, waterAt: (x: number) => x < 2 ? 0 : null }
  const state: PlayerState = { position: new THREE.Vector3(0, -2, 0), velocity: new THREE.Vector3(), yaw: 0, pitch: 0, onGround: false, fly: false }
  const settings = { speed: 5.5, jumpHeight: 1 }
  for (let n = 0; n < 240; n++) stepPlayer(state, emptyInput(), collider, settings, 1 / 60)
  assert.equal(state.swimming, true)
  assert.ok(Math.abs(state.position.y + 1.2) < 0.04, `floats at ${state.position.y}`)
  for (let n = 0; n < 180; n++) stepPlayer(state, { ...emptyInput(), down: true }, collider, settings, 1 / 60)
  assert.equal(state.submerged, true)
  for (let n = 0; n < 180; n++) stepPlayer(state, { ...emptyInput(), right: true }, collider, settings, 1 / 60)
  assert.ok(state.position.x > 2)
  assert.equal(state.swimming, false)
  state.position.set(0, -0.2, 0); state.velocity.set(0, 0, 0)
  stepPlayer(state, emptyInput(), collider, settings, 1 / 60)
  assert.equal(state.swimming, false)
  bvh?.geometry.dispose(); floor.dispose()
})

test('water queries use the rendered triangles and never invent an inland surface', () => {
  const grid = { points: [2, 2] as [number, number], cell: 8, origin: [0, 0] as [number, number] }
  const mesh = waterMesh({ ...grid, water: new Float32Array([10, 12, 6, 8]) })
  assert.equal(waterHeightAt(mesh.levels, grid, 6, 2), 10.5)
  assert.equal(waterHeightAt(mesh.levels, grid, 2, 6), 7.5)
  assert.equal(waterHeightAt(mesh.levels, grid, 20, 2), null)
  mesh.levels[0] = NaN
  assert.equal(waterHeightAt(mesh.levels, grid, 2, 2), null)
})

test('Aurora settlements have flat support and their connecting roads are dry and walkable', () => {
  const world = createClimateWorld(), layout = { sites: world.locations.map(l => ({ x: l.position[0], z: l.position[1], radius: l.footprint })), roads: world.routes.map(r => ({ from: world.locations.findIndex(l => l.id === r.from), to: world.locations.findIndex(l => l.id === r.to), width: r.width })) }
  const macro = buildWorldMacro(world, layout), source = createHeightSource(world, macro), mesh = waterMesh(macro)
  runWorldJob({ type: 'install', world, fields: macro })
  const tileJob = { type: 'tile' as const, world, origin: [-2048, -2048] as [number, number], level: 0, ix: 29, iz: 26 }
  const tile = runWorldJob(tileJob).result as { heights: Float32Array }
  assert.deepEqual(tile.heights, generateTile(source, tileJob.origin, 0, tileJob.ix, tileJob.iz).heights, 'the worker uses the exact settlement support')
  world.locations.forEach((location, i) => {
    const [x, z] = location.position, level = macro.siteLevels[i]
    for (const [dx, dz] of [[0, 0], [5, 5], [-12, 8]]) {
      assert.ok(Math.abs(source.heightAt(x + dx, z + dz) - level) < 0.001)
      const water = waterHeightAt(mesh.levels, macro, x + dx, z + dz)
      assert.ok(water === null || water < level, 'settlement stays above water')
    }
  })
  assert.equal(macro.roads.length, 2)
  for (const road of macro.roads) for (let i = 1; i < road.length; i++) {
    const a = road[i - 1], b = road[i], distance = Math.hypot(b[0] - a[0], b[1] - a[1])
    let previous = source.heightAt(a[0], a[1])
    for (let d = 1; d <= distance; d++) {
      const x = a[0] + (b[0] - a[0]) * d / distance, z = a[1] + (b[1] - a[1]) * d / distance, height = source.heightAt(x, z)
      assert.ok(Math.abs(height - previous) < 0.55, `road grade ${Math.abs(height - previous)} at ${x},${z}`)
      const water = waterHeightAt(mesh.levels, macro, x, z)
      assert.ok(water === null || water < height + 0.3, 'road is not submerged')
      previous = height
    }
  }
})
