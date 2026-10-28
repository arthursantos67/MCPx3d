import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createClimateWorld, upgradeAurora } from '../../src/three/world/worldExamples.ts'
import { composeWorldScene } from '../../src/three/world/worldScene.ts'
import { adventureLocation, campaignGameplay } from '../../src/three/world/worldAdventure.ts'
import { advanceRuntime, checkOutcome, createRuntime, reachGoal } from '../../src/three/sceneRuntime.ts'
import { addItem, craftItem, itemCount, resourceHit } from '../../src/three/sceneGameplay.ts'
import { bindSlot, createLoadout, heldItem, heldWeapon, LEGACY_WEAPON, restoreLoadout, selectSlot, spendItem } from '../../src/three/sceneLoadout.ts'
import { restoreRuntime, snapshotRuntime } from '../../src/three/sceneProgress.ts'
import { constructionScene, placementSupport } from '../../src/three/sceneConstruction.ts'
import { directionBrief, reviewSceneDirection, sceneIntent, themeBrief } from '../../src/three/sceneDirection.ts'
import { createEmptyScene, validateScene } from '../../src/three/sceneDocument.ts'
import { buildWorldMacro } from '../../src/three/world/worldJobs.ts'
import { waterHeightAt, waterMesh } from '../../src/three/world/worldMacro.ts'
import { createHeightSource } from '../../src/three/world/worldTerrain.ts'

test('five persistent slots wrap both directions, reserve hands and require owned items', () => {
  const loadout = createLoadout('sword'), items = new Map([['Machado', 1]])
  assert.equal(loadout.slots.length, 5); assert.equal(heldItem(loadout, items), LEGACY_WEAPON)
  assert.equal(bindSlot(loadout, 0, 'Machado', items), false)
  assert.equal(bindSlot(loadout, 5, 'Machado', items), false)
  assert.equal(bindSlot(loadout, 2, 'Fantasma', items), false)
  assert.ok(bindSlot(loadout, 2, 'Machado', items))
  selectSlot(loadout, -1); assert.equal(loadout.selected, 4)
  selectSlot(loadout, 5); assert.equal(loadout.selected, 0); assert.equal(heldItem(loadout, items), null)
  restoreLoadout(loadout, { slots: ['Machado', 'Fantasma', 'Machado'], selected: 2 }, items, 'none')
  assert.deepEqual(loadout.slots, [null, null, 'Machado', null, null])
  items.clear(); assert.equal(heldItem(loadout, items), null)
})

test('Aurora starts unarmed, has useful open recipes and stays open after discoveries and combat', () => {
  const world = createClimateWorld(), { scene, omitted } = composeWorldScene(world), runtime = createRuntime(scene)
  assert.deepEqual(omitted, []); assert.ok(scene.nodes.length <= 2000)
  assert.equal(runtime.legacyWeapon, 'none'); assert.equal(runtime.rules!.playStyle, 'sandbox'); assert.deepEqual(runtime.rules!.quests, [])
  assert.ok(world.locations.length >= 6)
  assert.ok(world.locations.some(location => Math.hypot(location.position[0] + 160, location.position[1] + 384) > 300))
  const axe = runtime.rules!.recipes.find(recipe => recipe.id === 'machado')!
  assert.equal(craftItem(runtime.gameplay, runtime.items, axe), false)
  assert.deepEqual([...runtime.items], [])
  for (const id of ['lirio/arvore0', 'lirio/rocha0', 'lirio/fibra0']) { const resource = runtime.byId.get(id)!.resource!; resourceHit(runtime.gameplay, runtime.items, id, resource, resource.health) }
  assert.ok(craftItem(runtime.gameplay, runtime.items, axe))
  assert.equal(itemCount(runtime.items, axe.output.item), 1)
  assert.ok(bindSlot(runtime.loadout, 1, axe.output.item, runtime.items)); selectSlot(runtime.loadout, 1)
  assert.equal(heldWeapon(runtime.loadout, runtime.items, runtime.rules, runtime.legacyWeapon), 'axe')
  selectSlot(runtime.loadout, 0); assert.equal(heldWeapon(runtime.loadout, runtime.items, runtime.rules, runtime.legacyWeapon), 'none')
  for (const id of runtime.enemies) runtime.defeated.add(id)
  advanceRuntime(runtime, 10000); checkOutcome(runtime)
  assert.equal(reachGoal(runtime), null); assert.equal(runtime.outcome, 'playing')
  assert.doesNotThrow(() => validateScene(scene))
})

test('building support rejects water, missing ground and slopes; every supported kit has geometry', () => {
  const dry = () => null
  assert.equal(placementSupport([0, 0, 0], 1, () => 2, dry).valid, true)
  assert.equal(placementSupport([0, 0, 0], 1, () => 2, () => 2.5).valid, false)
  assert.equal(placementSupport([0, 0, 0], 1, x => x, dry).valid, false)
  assert.equal(placementSupport([0, 0, 0], 1, () => null, dry).valid, false)
  for (const kind of ['campfire', 'tent', 'chest', 'fence', 'torch'] as const) assert.ok(constructionScene(kind).nodes.some(node => node.kind !== 'group'))
})

test('equipment, structures and chest contents survive reload with bounded validated data', () => {
  const scene = composeWorldScene(createClimateWorld()).scene, runtime = createRuntime(scene)
  addItem(runtime.items, 'Kit de baú', 1); addItem(runtime.items, 'Machado de pedra', 1)
  bindSlot(runtime.loadout, 2, 'Machado de pedra', runtime.items); selectSlot(runtime.loadout, 2)
  assert.ok(spendItem(runtime.items, 'Kit de baú')); assert.equal(spendItem(runtime.items, 'Kit de baú'), false)
  runtime.placements.push({ id: 'chest', kind: 'chest', item: 'Kit de baú', position: [3, 10, 4], yaw: 1, storage: [['Madeira', 4], ['Minério de cobre', 2]] })
  const saved = snapshotRuntime(runtime), next = createRuntime(scene)
  saved.placements!.push({ id: 'bad', kind: 'tent', item: 'Kit de baú', position: [NaN, 0, 0], yaw: 0 })
  saved.placements![0].storage!.push(['Inexistente', 4], ['Pedra', -4])
  restoreRuntime(next, saved)
  assert.equal(heldWeapon(next.loadout, next.items, next.rules, next.legacyWeapon), 'axe')
  assert.equal(next.placements.length, 1); assert.deepEqual(next.placements[0].storage, [['Madeira', 4], ['Minério de cobre', 2]])
})

test('only the bundled old campaign migrates, retaining edited nodes and material IDs', () => {
  const world = createClimateWorld()
  assert.equal(upgradeAurora(world), null)
  world.environment.gameplay = campaignGameplay(); world.environment.player!.weapon = 'sword'
  world.locations = world.locations.slice(0, 3).map((location, index) => ({ ...location, scene: adventureLocation((['camp', 'ruins', 'beacon'] as const)[index]) }))
  world.locations[0].scene!.nodes.find(node => node.id === 'arvore0')!.position[0] = 19
  world.locations[0].scene!.nodes.find(node => node.id === 'mara')!.name = 'Mara editada'
  const migrated = upgradeAurora(world)!
  assert.equal(migrated.environment.gameplay!.playStyle, 'sandbox'); assert.equal(migrated.environment.player!.weapon, 'none')
  assert.equal(migrated.locations[0].scene!.nodes.find(node => node.id === 'arvore0')!.position[0], 19)
  assert.equal(migrated.locations[0].scene!.nodes.find(node => node.id === 'mara')!.name, 'Mara editada')
  assert.equal(migrated.locations.length, 6)
  world.seed++; assert.equal(upgradeAurora(world), null)
})

test('the agent distinguishes free survival, timed hordes and puzzle interfaces', () => {
  assert.equal(sceneIntent('Sobrevivência como The Forest, coletar recursos e fabricar ferramentas').sandbox, true)
  assert.equal(sceneIntent('Sobrevivência como The Forest').survival, false)
  assert.equal(sceneIntent('Sobreviva por 120 segundos a ondas de inimigos').survival, true)
  assert.equal(sceneIntent('Sobreviva por 120 segundos a ondas de inimigos').sandbox, false)
  assert.equal(sceneIntent('Puzzle com crafting para fabricar uma chave').sandbox, false)
  assert.equal(sceneIntent('RPG de missões com fabricação de itens').sandbox, false)
  assert.doesNotMatch(themeBrief('Sobrevivência e exploração livre'), /objective survive/)
  assert.match(directionBrief('Um puzzle de alavancas'), /hud="minimal"/)
  assert.ok(reviewSceneDirection(createEmptyScene(), 'Sobrevivência livre com crafting').some(issue => issue.includes('saídas com utilidade real')))
  const broken = composeWorldScene(createClimateWorld()).scene
  broken.environment.gameplay!.recipes[0].inputs.push({ item: 'Fantasma', amount: 1 })
  assert.throws(() => validateScene(broken), /ingredientes inacessíveis/)
})

test('shore clipping and swimming queries agree; steep artificial water bridges are omitted', () => {
  const grid = { points: [2, 2] as [number, number], cell: 8, origin: [0, 0] as [number, number] }
  const mesh = waterMesh({ ...grid, water: new Float32Array([2, 2, 2, 2]) }, x => x / 2)
  assert.ok(mesh.indices.length)
  assert.equal(waterHeightAt(mesh.levels, grid, 1, 1, mesh.triangles, mesh.depths), 2)
  assert.equal(waterHeightAt(mesh.levels, grid, 7, 1, mesh.triangles, mesh.depths), null)
  const cliff = waterMesh({ ...grid, water: new Float32Array([2, 80, 2, 80]) }, () => 0)
  assert.equal(cliff.indices.length, 0)
  assert.equal(waterHeightAt(cliff.levels, grid, 1, 1, cliff.triangles, cliff.depths), null)
})

test('rivers stay close to their final eroded bed, including terrain changed by settlement pads', () => {
  const world = createClimateWorld(), macro = buildWorldMacro(world, { sites: world.locations.map(l => ({ x: l.position[0], z: l.position[1], radius: l.footprint })), roads: [] }), source = createHeightSource(world, macro)
  let checked = 0
  for (let k = 0; k < macro.water.length; k++) if (Number.isFinite(macro.water[k]) && !macro.lake?.[k]) {
    const bed = source.heightAt(macro.origin[0] + (k % macro.points[0]) * macro.cell, macro.origin[1] + Math.floor(k / macro.points[0]) * macro.cell)
    assert.ok(macro.water[k] <= bed + 2.51); checked++
  }
  assert.ok(checked > 0)
})
