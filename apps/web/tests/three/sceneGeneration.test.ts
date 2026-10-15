import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createNode, createEmptyScene, parseScene } from '../../src/three/sceneDocument.ts'
import { sampleNodeTransform } from '../../src/three/sceneAnimation.ts'
import { expandSceneRecipe, generateThreeScene } from '../../src/three/sceneGeneration.ts'
import type { LLMProvider } from '../../../../packages/agent/src/provider.ts'

function template(id = 'detail') {
  const node = createNode('box')
  return { ...node, id, color: node.material.color, metalness: 0.2, roughness: 0.5,
    repeat: { mode: 'linear', count: 40, offset: [1.2, 0, 0], radius: 0, axis: 'y' } }
}
function recipe() { return { name: 'Cena procedural', background: '#142331', exposure: 1, lightIntensity: 2, duration: 12, nodes: [template()] } }
function provider(generate: LLMProvider['generateStructured'], cancel = async () => {}): LLMProvider {
  return { id: 'fixture', isAvailable: async () => true, initialize: async () => {}, generateStructured: generate, cancel }
}

test('compact linear and radial recipes expand deterministically and preserve animation', () => {
  const source = recipe()
  source.nodes[0].animation = { kind: 'float', axis: 'y', duration: 4, amplitude: 1, phase: 0 }
  const doc = expandSceneRecipe(source)
  assert.equal(doc.nodes.length, 40)
  assert.equal(doc.nodes[39].position[0], 46.8)
  assert.equal(doc.nodes[39].animation.kind, 'float')
  source.nodes[0].repeat = { mode: 'radial', count: 4, offset: [0, 0, 0], radius: 2, axis: 'y' }
  const radial = expandSceneRecipe(source)
  assert.equal(radial.nodes[0].position[2], 2)
  assert.ok(Math.abs(radial.nodes[1].position[0] - 2) < 1e-9)
  assert.equal(new Set(radial.nodes.map((node) => node.id)).size, 4)
})

test('procedural expansion rejects overflow, invalid arithmetic and ID collisions, and repeats groups', () => {
  const source = recipe()
  assert.throws(() => expandSceneRecipe({ ...source, nodes: Array.from({ length: 6 }, (_, i) => ({ ...template(`part-${i}`), repeat: { ...template().repeat, count: 400 } })) }), /2000/)
  assert.equal(expandSceneRecipe({ ...source, nodes: [{ ...template(), kind: 'group' }] }).nodes.length, 40)
  assert.throws(() => expandSceneRecipe({ ...source, nodes: [{ ...template(), position: ['1', 0, 0] }] }), /Posição/)
  assert.throws(() => expandSceneRecipe({ ...source, nodes: [{ ...template(), repeat: { ...template().repeat, offset: [Infinity, 0, 0] } }] }), /Offset/)
  assert.throws(() => expandSceneRecipe({ ...source, nodes: [template('detail'), template('detail~2')] }), /duplicados/)
})

test('legacy documents receive static defaults, invalid animation data is rejected', () => {
  const node = createNode('box')
  const { animation: _animation, ...legacy } = node
  const { timeline: _timeline, ...doc } = createEmptyScene()
  assert.equal(parseScene(JSON.stringify({ ...doc, nodes: [legacy] })).nodes[0].animation.kind, 'none')
  assert.throws(() => parseScene(JSON.stringify({ ...doc, nodes: [{ ...node, animation: { ...node.animation, duration: 0 } }] })), /Período/)
})

test('animation uses absolute time without changing the editable base pose', () => {
  const node = createNode('box')
  const original = structuredClone(node)
  node.animation = { kind: 'spin', axis: 'y', duration: 4, amplitude: 2, phase: 0 }
  assert.equal(sampleNodeTransform(node, 1).rotation[1], 90)
  assert.deepEqual(sampleNodeTransform(node, 1), sampleNodeTransform(node, 5))
  node.animation.kind = 'float'
  assert.equal(sampleNodeTransform(node, 1).position[1], 2.5)
  node.animation.kind = 'orbit'
  assert.ok(Math.abs(sampleNodeTransform(node, 1).position[0] - 2) < 1e-9)
  assert.deepEqual(node.position, original.position)
  assert.deepEqual(node.rotation, original.rotation)
})

test('generation performs at most one contract repair and never retries provider failures', async () => {
  let calls = 0
  const phases: string[] = []
  const fake = provider(async <T>() => (++calls === 1 ? { ...recipe(), nodes: [] } : recipe()) as T)
  const doc = await generateThreeScene(fake, 'Uma cena animada', new AbortController().signal, (phase) => phases.push(phase))
  assert.equal(calls, 2)
  assert.equal(doc.nodes.length, 40)
  assert.ok(phases.some((phase) => phase.includes('Corrigindo')))
  calls = 0
  await assert.rejects(generateThreeScene(provider(async () => { calls++; throw new Error('quota') }), 'Cena', new AbortController().signal), /quota/)
  assert.equal(calls, 1)
  calls = 0
  await assert.rejects(generateThreeScene(provider(async <T>() => { calls++; return { nodes: [] } as T }), 'Cena', new AbortController().signal), /templates/)
  assert.equal(calls, 2)
})

test('cancellation stops waiting and discards a late provider result', async () => {
  let finish: (value: unknown) => void = () => {}, cancelled = false
  const fake = provider(<T>() => new Promise<T>((resolve) => { finish = resolve as (value: unknown) => void }), async () => { cancelled = true })
  const controller = new AbortController()
  const pending = generateThreeScene(fake, 'Cena', controller.signal)
  controller.abort(new Error('Cancelado pelo usuário'))
  await assert.rejects(pending, /Cancelado/)
  finish(recipe())
  assert.equal(cancelled, true)
  const alreadyAborted = new AbortController()
  alreadyAborted.abort(new Error('Prazo excedido'))
  await assert.rejects(generateThreeScene(fake, 'Cena', alreadyAborted.signal), /Prazo/)
})

test('reports observable stages, attempt numbers and expanded object counts in order', async () => {
  const events: import('../../src/three/sceneGeneration.ts').SceneGenerationEvent[] = []
  const fake = provider(async <T>() => recipe() as T)
  await generateThreeScene(fake, 'Cena', new AbortController().signal, () => {}, (event) => events.push(event))
  assert.deepEqual(events.map((event) => event.stage), ['prepare', 'waiting', 'validation', 'expansion', 'inspection', 'application'])
  assert.ok(events.every((event) => event.attempt === 1))
  assert.equal(events.find((event) => event.stage === 'expansion')!.templates, 1)
  assert.equal(events.at(-1)!.objects, 40)
})

test('reports a rejected recipe before the second provider call', async () => {
  const events: import('../../src/three/sceneGeneration.ts').SceneGenerationEvent[] = []
  let calls = 0
  const fake = provider(async <T>() => (++calls === 1 ? { ...recipe(), nodes: [] } : recipe()) as T)
  await generateThreeScene(fake, 'Cena', new AbortController().signal, () => {}, (event) => events.push(event))
  assert.deepEqual(events.filter((event) => event.stage === 'waiting').map((event) => event.attempt), [1, 2])
  const rejection = events.findIndex((event) => event.detail.includes('precisa de correção'))
  const repair = events.findIndex((event) => event.stage === 'waiting' && event.attempt === 2)
  assert.ok(rejection >= 0 && rejection < repair)
})
