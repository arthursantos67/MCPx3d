import assert from 'node:assert/strict'
import { test } from 'node:test'
import { directionBrief, reviewSceneDirection, sceneIntent, themeBrief } from '../../src/three/sceneDirection.ts'
import { repairScenePlan, validateScenePlan } from '../../src/three/scenePlanning.ts'
import { createNode } from '../../src/three/sceneDocument.ts'
import { expandSceneRecipe, generateThreeScene } from '../../src/three/sceneGeneration.ts'
import { terrainBiomes } from '../../src/three/sceneGeometrySpec.ts'
import { buildNodeGeometry } from '../../src/three/sceneGeometry.ts'

test('outer space, planetary surfaces and natural biomes are recognised as worlds with the right topology', () => {
  const space = sceneIntent('Uma cena no espaço sideral com planetas, um cinturão de asteroides e naves')
  assert.equal(space.topology, 'space')
  assert.equal(space.world, true)
  assert.equal(space.landscape, false)
  assert.equal(sceneIntent('Uma estação espacial orbitando um planeta gigante').topology, 'space')
  assert.equal(sceneIntent('Explore os corredores e laboratórios da estação espacial').topology, 'interior')
  const moon = sceneIntent('Uma base lunar na superfície da lua com crateras')
  assert.equal(moon.topology, 'landscape')
  assert.equal(moon.planetSurface, true)
  for (const request of ['Uma floresta densa ao amanhecer', 'Uma praia tropical com palmeiras', 'Uma vila na neve', 'Um pântano com neblina', 'O fundo do mar com corais'])
    assert.equal(sceneIntent(request).world, true, request)
  assert.equal(sceneIntent('Uma cidade à noite com arranha-céus').world, true)
})

test('theme briefs point the builder to the matching biome, prefabs and atmosphere', () => {
  assert.match(themeBrief('Uma floresta encantada'), /biome="forest"/)
  assert.match(themeBrief('Um deserto com oásis'), /cactus/)
  assert.match(themeBrief('O fundo do oceano'), /coral, seaweed/)
  assert.match(directionBrief('Uma cena no espaço com planetas'), /ESPAÇO SIDERAL/)
  assert.match(directionBrief('Uma cena no espaço com planetas'), /sky="space"/)
  assert.equal(themeBrief('Um cubo vermelho'), '')
})

test('every biome builds coloured terrain without NaN', () => {
  for (const biome of terrainBiomes) {
    const node = { ...createNode('terrain'), dimensions: [40, 4, 40] as [number, number, number] }
    node.geometry = { ...node.geometry, segments: 16, biome }
    const geometry = buildNodeGeometry(node)
    const colors = geometry.getAttribute('color')
    if (biome === 'none') assert.equal(colors, undefined)
    else assert.ok(Array.from(colors.array as Float32Array).every(Number.isFinite), biome)
    geometry.dispose()
  }
})

test('space review asks for a starfield, free flight and light, without demanding terrain', () => {
  const request = 'Uma cena no espaço sideral com planetas e asteroides'
  const planet = expandSceneRecipe({ name: 'Espaço', background: '#000000', exposure: 1, lightIntensity: 1, duration: 12, nodes: [
    { ...createNode('group'), id: 'planet', color: '#888888', metalness: 0, roughness: 1, repeat: { mode: 'linear', count: 1, offset: [0, 0, 0], radius: 0, axis: 'y' },
      prefab: { type: 'planet', size: 4, seed: 1, primary: null, secondary: null, text: '', lit: false, interactive: false } },
    { ...createNode('group'), id: 'rocks', color: '#888888', metalness: 0, roughness: 1, position: [40, 0, 0],
      repeat: { mode: 'scatter', count: 12, offset: [30, 20, 30], radius: 0, axis: 'y', columns: 1, jitter: 0.5, seed: 3, onto: null },
      prefab: { type: 'asteroid', size: 1, seed: 2, primary: null, secondary: null, text: '', lit: false, interactive: false } },
  ] })
  const issues = reviewSceneDirection(planet, request)
  assert.ok(issues.some((issue) => issue.includes('sky="space"')))
  assert.ok(issues.some((issue) => issue.includes('flutuar')))
  assert.ok(!issues.some((issue) => issue.includes('não tem relevo')))
  const fixed = { ...planet, environment: { ...planet.environment, sky: 'space' as const, player: { spawn: null, yaw: 0, speed: 4.5, jumpHeight: 1.1, mode: 'fly' as const, allowFly: true } },
    nodes: [...planet.nodes, { ...createNode('light'), id: 'sun', light: { type: 'point' as const, color: '#ffffff', intensity: 800, distance: 0, angle: 35, penumbra: 0.4, castShadow: false } }] }
  assert.deepEqual(reviewSceneDirection(fixed, request), [])
})

test('the planner repair keeps a usable plan instead of discarding it for small mistakes', () => {
  const { plan, notes } = repairScenePlan({
    title: 'Vale', identity: 'Vale com três áreas', extent: [400, 20], palette: ['#123456', 'azul'],
    terrain: { style: 'canyon', biome: 'forest', relief: 60 }, spawnZoneId: 'Arena',
    zones: [
      { id: 'Arena', name: 'Arena', role: 'challenge', center: [100, 0], radius: 50, landmark: 'Coliseu', activities: ['Lutar'] },
      { id: 'vila', name: 'Vila', role: 'settlement', center: [0, 0], radius: 12, landmark: 'Praça', activities: [] },
      { id: 'mirante', name: 'Mirante', role: 'landmark', center: [-40, 10], radius: 8, landmark: 'Torre', activities: [] },
    ],
    routes: [{ from: 'vila', to: 'vila', width: 3 }, { from: 'vila', to: 'nowhere', width: 3 }],
    buildings: [{ zoneId: 'vila', style: 'cottage', floors: 1, width: 9, depth: 9, count: 20, furnished: false }],
    objective: { type: 'reachGoal', title: 'Chegue ao mirante', zoneId: 'mirante' },
  }, 'Um vale com floresta e casas')
  assert.deepEqual(validateScenePlan(plan), plan)
  assert.notEqual(plan.zones.find((zone) => zone.id === plan.spawnZoneId)!.role, 'challenge')
  assert.ok(plan.buildings.reduce((sum, item) => sum + item.count, 0) <= 12)
  assert.ok(notes.length > 0)
  assert.equal(plan.terrain.biome, 'forest')
  assert.equal(plan.terrain.relief, 20)
})

test('the generation chain delivers a playable space scene even when the builder forgets the starfield and flight', async () => {
  const prefab = (type: string, extra = {}) => ({ type, size: 1, seed: 1, primary: null, secondary: null, text: '', lit: false, interactive: false, ...extra })
  const node = (id: string, position: number[], extra: Record<string, unknown>) => ({ ...createNode('group'), id, position, color: '#cccccc', metalness: 0, roughness: 0.5,
    repeat: { mode: 'linear', count: 1, offset: [0, 0, 0], radius: 0, axis: 'y', columns: 1, jitter: 0, seed: 1, onto: null }, ...extra })
  const recipe = { name: 'Órbita', background: '#000000', exposure: 1, lightIntensity: 1, duration: 20, environment: { sky: 'day' }, nodes: [
    node('planet', [0, 0, -60], { prefab: prefab('planet', { size: 4 }) }),
    node('station', [40, 10, -20], { prefab: prefab('spaceStation', { lit: true }) }),
    node('ship', [-10, 4, 0], { prefab: prefab('spaceship', { lit: true }) }),
    node('belt', [0, 0, 40], { prefab: prefab('asteroid'), repeat: { mode: 'scatter', count: 20, offset: [60, 20, 20], radius: 0, axis: 'y', columns: 1, jitter: 0.6, seed: 4, onto: null } }),
    { ...createNode('light'), id: 'sun', position: [200, 80, -200], color: '#ffffff', metalness: 0, roughness: 1, light: { type: 'point', color: '#fff4dd', intensity: 900, distance: 0, angle: 35, penumbra: 0.4, castShadow: false },
      repeat: { mode: 'linear', count: 1, offset: [0, 0, 0], radius: 0, axis: 'y', columns: 1, jitter: 0, seed: 1, onto: null } },
  ] }
  let calls = 0
  const provider = { generateStructured: async <T,>() => { calls++; return structuredClone(recipe) as T } } as unknown as import('../../../../packages/agent/src/provider.ts').LLMProvider
  const scene = await generateThreeScene(provider, 'Uma cena no espaço sideral com um planeta, uma estação espacial, uma nave e um cinturão de asteroides', new AbortController().signal)
  assert.equal(scene.environment.sky, 'space')
  assert.equal(scene.environment.player?.mode, 'fly')
  assert.ok(scene.nodes.filter((item) => item.asset?.type === 'asteroid').length >= 10)
  assert.ok(!scene.nodes.some((item) => item.kind === 'terrain'))
  assert.ok(calls <= 3)
})

test('briefs for new settings name the catalogue characters and props, up to five themes', () => {
  assert.match(themeBrief('Uma masmorra com criptas'), /skeleton/)
  assert.match(themeBrief('Uma enseada pirata'), /dock.*lighthouse/)
  assert.match(themeBrief('Uma base lunar na superfície da lua'), /astronaut/)
  assert.match(themeBrief('Uma feira medieval'), /marketStall/)
  assert.ok(themeBrief('Floresta, deserto, neve, vulcão, oceano e caverna').split('\n').length === 5)
  assert.match(directionBrief('Crie um cemitério assombrado com zumbis'), /ASSOMBRADO\/CEMITÉRIO/)
})
