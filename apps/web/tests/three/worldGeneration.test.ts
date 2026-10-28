import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ProviderRequestError, type LLMProvider } from '../../../../packages/agent/src/provider.ts'
import { createEmptyScene, createNode, validateScene, type ThreeSceneDocument } from '../../src/three/sceneDocument.ts'
import { buildWorldMacro } from '../../src/three/world/worldJobs.ts'
import { createHeightSource } from '../../src/three/world/worldTerrain.ts'
import { applyWorldEdit, continueWorld, detailRequest, fitLocationScene, generateWorld, MAX_DETAILED, placeLocations, retryDelay, sanitizeAtlas, type WorldGenerationDeps } from '../../src/three/world/worldGeneration.ts'
import { composeWorldScene } from '../../src/three/world/worldScene.ts'
import type { ThreeWorldDocument } from '../../src/three/world/worldDocument.ts'

const atlas = {
  name: 'Ilhas de Teste', premise: 'Um arquipélago de pescadores e montanhas.',
  terrain: { ruggedness: 0.6, sea: true, erosion: 0.5, temperature: 18, humidity: 0.6 },
  regions: [
    { id: 'Costa Leste', name: 'Costa Leste', area: 'east', biome: 'beach', danger: 0, ambience: 'beach', music: 'calm' },
    { id: 'serra', name: 'Serra', area: 'north', biome: 'alpine', danger: 3 },
    { id: 'serra', name: 'Serra Repetida', area: 'north', biome: 'taiga', danger: 2 },
  ],
  locations: [
    { id: 'vila', name: 'Vila dos Pescadores', kind: 'village', region: 'Costa Leste', terrain: 'any', size: 'medium', brief: 'Casas de madeira e redes.', detail: true },
    { id: 'forte', name: 'Forte da Serra', kind: 'castle', region: 'serra', terrain: 'hill', size: 'large', brief: 'Muralhas.', detail: true },
    { id: 'ruina', name: 'Ruína', kind: 'ruin', region: 'nowhere', terrain: 'any', size: 'small', brief: 'Pedras antigas.', detail: false },
  ],
  routes: [{ from: 'vila', to: 'forte' }, { from: 'forte', to: 'vila' }, { from: 'vila', to: 'nada' }],
}

function scene(nodes = 3, shadows = 0): ThreeSceneDocument {
  const ground = { ...createNode('terrain'), id: 'chao', name: 'Chão' }
  const parts = Array.from({ length: nodes }, (_, i) => ({ ...createNode('box'), id: `caixa-${i}`, name: `Caixa ${i}`, position: [i * 2, 0.5, 0] as [number, number, number] }))
  const lights = Array.from({ length: shadows }, (_, i) => ({ ...createNode('light'), id: `luz-${i}`, name: `Luz ${i}`, light: { ...createNode('light').light!, castShadow: true } }))
  return validateScene({ ...createEmptyScene(), nodes: [ground, ...parts, ...lights] })
}

test('the atlas sanitizer caps, deduplicates, resolves references and applies budgets', () => {
  const { world, intents, notes } = sanitizeAtlas(atlas, 'arquipélago', 42)
  assert.equal(world.version, '2.0')
  assert.equal(world.terrain.kind, 'climate')
  assert.deepEqual(world.regions.map((region) => region.id), ['costa-leste', 'serra', 'serra-2'])
  assert.ok(world.regions.every((region) => Math.abs(region.site[0]) <= 2048 && Math.abs(region.site[1]) <= 2048))
  assert.equal(world.locations.find((location) => location.id === 'ruina')!.regionId, 'costa-leste')
  assert.equal(world.routes.length, 1, 'duplicate and dangling routes are dropped')
  assert.ok(intents.filter((intent) => intent.detail).length <= MAX_DETAILED)
  assert.deepEqual(world.generation!.pending, ['vila', 'forte'])
  assert.ok(notes.some((note) => note.includes('região desconhecida')))
  assert.deepEqual(sanitizeAtlas(atlas, 'arquipélago', 42).world, world, 'deterministic')
  assert.doesNotThrow(() => sanitizeAtlas({ regions: 'x', locations: [{}], routes: null }, 'qualquer coisa', 1))
})

test('world generation carries genre choices through local detail without inventing mandatory missions', () => {
  const { world } = sanitizeAtlas({ ...atlas, playStyle: 'directed' }, 'Sobrevivência livre como The Forest com crafting', 42)
  assert.equal(world.environment.gameplay!.playStyle, 'sandbox')
  world.locations[0].scene = scene(3)
  assert.equal(composeWorldScene(world).scene.environment.gameplay!.quests.length, 0)
  const request = detailRequest(world, world.locations[0], 200, 0)
  assert.match(request, /Pedido original: Sobrevivência livre/)
  assert.match(request, /quests=\[\]/)
  assert.doesNotMatch(request, /precisa de ao menos uma missão/)
  const puzzle = sanitizeAtlas({ ...atlas, playStyle: 'directed', hud: 'minimal' }, 'Um puzzle de alavancas', 43).world
  puzzle.locations[0].scene = scene(3)
  puzzle.locations[0].scene.environment.objective = { type: 'reachGoal', title: 'Saída', timeLimit: 0 }
  const composed = composeWorldScene(puzzle).scene
  assert.equal(composed.environment.gameplay!.hud, 'minimal')
  assert.equal(composed.environment.gameplay!.quests.length, 0)
  assert.equal(composed.environment.objective!.type, 'reachGoal')
})

test('locations are placed on dry ground by their terrain rule, spaced and deterministic', () => {
  const { world, intents } = sanitizeAtlas(atlas, 'arquipélago', 42)
  const small = { ...world, terrain: { ...world.terrain, size: [2048, 2048] as [number, number] }, regions: world.regions.map((region) => ({ ...region, site: [region.site[0] / 2, region.site[1] / 2] as [number, number] })) }
  const macro = buildWorldMacro(small), heights = createHeightSource(small, macro), notes: string[] = []
  const placed = placeLocations(small, intents, { heightAt: heights.heightAt, macro }, notes)
  for (const location of placed.locations) {
    assert.ok(heights.heightAt(...location.position) > 2, `${location.id} above the sea`)
    assert.ok(location.elevation !== undefined)
  }
  for (const a of placed.locations) for (const b of placed.locations) if (a !== b) assert.ok(Math.hypot(a.position[0] - b.position[0], a.position[1] - b.position[1]) >= 150)
  assert.deepEqual(placeLocations(small, intents, { heightAt: heights.heightAt, macro }), placed)
})

test('location scenes lose their own terrain and fit the node and shadow-light budgets', () => {
  const notes: string[] = [], budgets = { vegetationDensity: 120, nodesPerLocation: 5, shadowLightsPerRegion: 1 }
  const fitted = fitLocationScene(scene(8, 3), budgets, 40, notes)
  assert.ok(!fitted.nodes.some((node) => node.kind === 'terrain'))
  assert.ok(fitted.nodes.length <= 5)
  assert.ok(fitted.nodes.filter((node) => node.light?.castShadow).length <= 1)
  assert.equal(notes.length, 3)
  assert.deepEqual(fitLocationScene(scene(8, 3), budgets, 40), fitted, 'deterministic')
})

test('retries: user cancellation stops, rate limits wait for the provider, other failures back off', () => {
  assert.equal(retryDelay(new DOMException('x', 'AbortError'), 0), null)
  assert.equal(retryDelay(new ProviderRequestError('limite', { limit: { kind: 'rate', retryAt: 100_000 } }), 0, 40_000), 60_000)
  assert.equal(retryDelay(new ProviderRequestError('O provedor de IA não respondeu dentro do tempo limite.'), 2), 8_000)
  assert.equal(retryDelay(new Error('rede'), 10), 60_000)
})

/** Scripted provider: answers from a queue; a thrown entry simulates a timed-out or failed request. */
function provider(answers: (unknown | Error)[]): LLMProvider & { calls: number } {
  const queue = [...answers], scripted = { id: 'scripted', calls: 0, async generateStructured<T>(): Promise<T> { scripted.calls++; const next = queue.shift(); if (next instanceof Error) throw next; return next as T } }
  return scripted as unknown as LLMProvider & { calls: number }
}
function deps(llm: LLMProvider, details: (ThreeSceneDocument | Error)[], saved: ThreeWorldDocument[], waits: number[]): WorldGenerationDeps {
  const queue = [...details]
  return {
    provider: llm, checkpoint: (world) => saved.push(world), wait: async (ms) => { waits.push(ms) },
    async place(world, intents, only) { const small = { ...world, terrain: { ...world.terrain, size: [1024, 1024] as [number, number] } }, macro = buildWorldMacro(small), notes: string[] = []
      return { world: placeLocations(world, intents, { heightAt: createHeightSource(small, macro).heightAt, macro }, notes, only ? new Set(only) : undefined), notes } },
    async detail() { const next = queue.shift(); if (next instanceof Error) throw next; return next! },
  }
}

test('generation has no deadline: timed-out requests are sent again and every finished step is a checkpoint', async () => {
  const timeout = new ProviderRequestError('O provedor de IA não respondeu dentro do tempo limite.')
  const llm = provider([timeout, atlas]), saved: ThreeWorldDocument[] = [], waits: number[] = []
  const world = await generateWorld('arquipélago', 7, deps(llm, [timeout, scene(4), scene(5)], saved, waits), new AbortController().signal)
  assert.equal(llm.calls, 2, 'the atlas was requested again after the timeout')
  assert.deepEqual(waits, [2_000, 2_000])
  assert.ok(world.locations.find((location) => location.id === 'vila')!.scene)
  assert.ok(world.locations.find((location) => location.id === 'forte')!.scene)
  assert.equal(world.locations.find((location) => location.id === 'ruina')!.scene, null)
  assert.deepEqual(world.generation!.pending, [])
  assert.equal(saved.length, 3, 'placement and each detailed location were saved')
})

test('a stopped generation continues from its checkpoint without redoing finished locations', async () => {
  const saved: ThreeWorldDocument[] = [], waits: number[] = [], controller = new AbortController()
  const detail = deps(provider([atlas]), [scene(4)], saved, waits)
  const first = detail.detail
  let calls = 0
  detail.detail = async (request, signal) => { if (++calls === 2) { controller.abort(); throw new DOMException('Cancelado', 'AbortError') } return first(request, signal) }
  await assert.rejects(generateWorld('arquipélago', 7, detail, controller.signal))
  const checkpoint = saved.at(-1)!
  assert.deepEqual(checkpoint.generation!.pending, ['forte'])
  let resumed = 0
  const again = deps(provider([]), [scene(6)], saved, waits)
  const inner = again.detail
  again.detail = async (request, signal) => { resumed++; return inner(request, signal) }
  const finished = await continueWorld(checkpoint, again, new AbortController().signal)
  assert.equal(resumed, 1, 'only the pending location was requested')
  assert.deepEqual(finished.locations.find((location) => location.id === 'vila')!.scene, checkpoint.locations.find((location) => location.id === 'vila')!.scene)
  assert.ok(finished.locations.find((location) => location.id === 'forte')!.scene)
})

test('a local edit changes only what it names', () => {
  const { world } = sanitizeAtlas(atlas, 'arquipélago', 42)
  const detailed = { ...world, locations: world.locations.map((location) => location.id === 'forte' ? { ...location, scene: scene(2) } : location) }
  const { world: edited, intents, changed } = applyWorldEdit(detailed, {
    summary: 'Uma vila de pescadores na costa leste',
    addLocations: [{ id: 'pescadores', name: 'Vila Nova', kind: 'village', region: 'costa-leste', terrain: 'coast', size: 'small', brief: 'Palafitas.', detail: true }],
    addRoutes: [{ from: 'pescadores', to: 'vila', kind: 'path' }],
  })
  assert.deepEqual(changed.sort(), ['pescadores', 'rota-pescadores-vila'].sort())
  assert.deepEqual(intents.map((intent) => intent.id), ['pescadores'])
  for (const location of detailed.locations) assert.deepEqual(edited.locations.find((item) => item.id === location.id), location, `${location.id} untouched`)
  assert.deepEqual(edited.regions, detailed.regions)
  assert.ok(edited.generation!.pending.includes('pescadores'))
  const removed = applyWorldEdit(edited, { summary: 'remover a ruína', removeLocations: ['ruina'] }).world
  assert.ok(!removed.locations.some((location) => location.id === 'ruina'))
  const rebuilt = applyWorldEdit(detailed, { summary: 'refazer o forte', updateLocations: [{ id: 'forte', brief: 'Forte em ruínas.', rebuild: true }] }).world
  assert.equal(rebuilt.locations.find((location) => location.id === 'forte')!.scene, null)
  assert.ok(rebuilt.generation!.pending.includes('forte'))
})

test('detailed locations compose into the world scene with prefixed IDs, their references and placement', async () => {
  const { composeWorldScene, locationOfNode } = await import('../../src/three/world/worldScene.ts')
  const { world } = sanitizeAtlas(atlas, 'arquipélago', 42)
  const door = { ...createNode('box'), id: 'porta', name: 'Porta' }, lever = { ...createNode('box'), id: 'alavanca', name: 'Alavanca', overlapWith: ['porta'],
    interaction: { trigger: 'click' as const, key: '', radius: 3, action: 'toggleVisibility' as const, targetId: 'porta', message: '' } }
  const located = { ...world, locations: world.locations.map((location, index) => index === 0 ? { ...location, position: [300, -200] as [number, number], elevation: 12, yaw: 30, scene: validateScene({ ...createEmptyScene(), nodes: [door, lever] }) } : location) }
  const { scene, omitted } = composeWorldScene(located)
  assert.deepEqual(omitted, [])
  const group = scene.nodes.find((node) => node.id === 'local:vila')!
  assert.deepEqual([group.position, group.rotation[1]], [[300, 12, -200], 30])
  const composedLever = scene.nodes.find((node) => node.id === 'vila/alavanca')!
  assert.equal(composedLever.parentId, 'local:vila')
  assert.equal(composedLever.interaction!.targetId, 'vila/porta')
  assert.deepEqual(composedLever.overlapWith, ['vila/porta'])
  assert.equal(locationOfNode('vila/alavanca'), 'vila')
  assert.equal(locationOfNode('local:vila'), 'vila')
  assert.equal(locationOfNode('sem-local'), null)
})
