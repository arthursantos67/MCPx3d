import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createEmptyScene, createNode, validateScene } from '../../src/three/sceneDocument.ts'
import { createEnchantedForestScene, createMarketTownScene, createWastelandSurvivalScene } from '../../src/three/sceneExperiences.ts'
import { createIslandScene } from '../../src/three/scenePreset.ts'
import { createValleyScene } from '../../src/three/sceneShowcase.ts'
import { DEFAULT_WORLD_BUDGETS, MAX_WORLD_LOCATIONS, parseProject, sceneToWorld, validateWorld, worldAsScene, type ThreeWorldDocument } from '../../src/three/world/worldDocument.ts'

const examples = () => [createValleyScene(), createMarketTownScene(), createEnchantedForestScene(), createWastelandSurvivalScene(), createIslandScene()]

function world(): ThreeWorldDocument {
  const base = createEmptyScene()
  return validateWorld({ version: '2.0', name: 'Arquipélago', seed: 1234,
    terrain: { kind: 'climate', size: [4096, 4096], heightRange: [-60, 900], seaLevel: 0, ruggedness: 0.6, erosion: 0.5 },
    regions: [{ id: 'costa', name: 'Costa Leste', site: [1200, 0], biome: 'beach', danger: 1, ambience: 'beach', music: 'calm' },
      { id: 'serra', name: 'Serra Cinzenta', site: [-800, -900], weight: 1.5, biome: 'alpine', danger: 3, weather: 'snow', premise: 'Picos onde o vento não para.' }],
    locations: [{ id: 'vila', name: 'Vila dos Pescadores', kind: 'village', regionId: 'costa', position: [1500, 120], footprint: 60, brief: 'Casas de palafita e um pequeno cais.', scene: null },
      { id: 'forte', name: 'Forte', kind: 'castle', regionId: 'serra', position: [-900, -1000], yaw: 30, footprint: 90, scene: { ...base, name: 'Forte', nodes: [{ ...createNode('box'), id: 'muro' }] } }],
    routes: [{ id: 'estrada', kind: 'road', from: 'vila', to: 'forte', width: 5 }],
    environment: base.environment })
}

test('a 2.0 world validates, fills defaults and round trips through JSON', () => {
  const doc = world()
  assert.equal(doc.version, '2.0')
  assert.deepEqual(doc.budgets, DEFAULT_WORLD_BUDGETS)
  assert.equal(doc.regions[0].weight, 1)
  assert.equal(doc.regions[0].weather, 'none')
  assert.equal(doc.locations[1].scene?.version, '1.4')
  assert.deepEqual(validateWorld(JSON.parse(JSON.stringify(doc))), doc)
  const project = parseProject(JSON.stringify(doc))
  assert.equal(project.kind, 'world')
  assert.deepEqual(project.document, doc)
})

test('every example scene migrates to a world and converts back unchanged', () => {
  for (const scene of examples()) {
    const migrated = validateWorld(JSON.parse(JSON.stringify(sceneToWorld(scene))))
    assert.equal(migrated.terrain.kind, 'none', scene.name)
    assert.equal(migrated.locations.length, 1)
    assert.deepEqual(worldAsScene(migrated), validateScene(JSON.parse(JSON.stringify(scene))), scene.name)
  }
})

test('1.x projects keep opening as scenes; a 1.x document given to the world validator is migrated', () => {
  const scene = createIslandScene()
  const project = parseProject(JSON.stringify(scene))
  assert.equal(project.kind, 'scene')
  assert.deepEqual(project.document, validateScene(scene))
  const legacy = { ...createEmptyScene(), version: '1.2', nodes: [{ ...createNode('box'), id: 'a' }] }
  const migrated = validateWorld(legacy)
  assert.equal(migrated.locations[0].scene?.version, '1.4')
  assert.equal(worldAsScene(migrated)?.nodes[0].id, 'a')
})

test('real worlds are not playable as a single 1.x scene', () => {
  assert.equal(worldAsScene(world()), null)
  const moved = sceneToWorld(createEmptyScene())
  moved.locations[0].position = [10, 0]
  assert.equal(worldAsScene(moved), null)
})

test('the validator rejects broken references, duplicates, out-of-bounds data and oversized lists', () => {
  const doc = world()
  const variants: [string, (value: ThreeWorldDocument) => unknown][] = [
    ['versão', (value) => ({ ...value, version: '3.0' })],
    ['região inexistente', (value) => ({ ...value, locations: [{ ...value.locations[0], regionId: 'nada' }] })],
    ['local duplicado', (value) => ({ ...value, locations: [value.locations[0], value.locations[0]] })],
    ['fora dos limites', (value) => ({ ...value, locations: [{ ...value.locations[0], position: [2049, 0] }] })],
    ['rota inválida', (value) => ({ ...value, routes: [{ ...value.routes[0], to: 'vila' }] })],
    ['bioma', (value) => ({ ...value, regions: [{ ...value.regions[0], biome: 'lava-cósmica' }] })],
    ['semente', (value) => ({ ...value, seed: 1.5 })],
    ['altitude', (value) => ({ ...value, terrain: { ...value.terrain, heightRange: [10, 10] } })],
    ['orçamento', (value) => ({ ...value, budgets: { ...value.budgets, shadowLightsPerRegion: 9 } })],
    ['ID', (value) => ({ ...value, regions: [{ ...value.regions[0], id: 'a b' }] })],
    ['cena do local', (value) => ({ ...value, locations: [{ ...value.locations[1], scene: { ...value.locations[1].scene, version: '0.9' } }] })],
    ['muitos locais', (value) => ({ ...value, routes: [], locations: Array.from({ length: MAX_WORLD_LOCATIONS + 1 }, (_, index) => ({ ...value.locations[0], id: `l${index}` })) })],
    ['código', (value) => ({ ...value, environment: { ...value.environment, background: 'javascript:alert(1)' } })],
  ]
  for (const [label, mutate] of variants) assert.throws(() => validateWorld(JSON.parse(JSON.stringify(mutate(structuredClone(doc))))), Error, label)
})
