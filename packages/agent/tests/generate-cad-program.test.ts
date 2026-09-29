import assert from 'node:assert/strict'
import { test } from 'node:test'
import { generateCadProgram } from '../src/generate-cad-program.ts'
import { MockLLMProvider } from '../src/mock-provider.ts'
import { OpenAICompatibleProvider } from '../src/openai-compatible-provider.ts'

const spec = { schemaVersion: '3.0', units: 'mm', partId: 'mount', steps: [
  { id: 'body', op: 'base', shape: 'box', position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, width: 80, depth: 50, height: 10 },
] }

test('creates a construction program from the provider', async () => {
  const provider = new MockLLMProvider([{ decision: 'create', spec, question: '', assumptions: [] }])
  const result = await generateCadProgram(provider, 'Crie um suporte')
  assert.equal(result.kind, 'create')
  assert.equal(provider.calls.length, 1)
  assert.match(provider.calls[0].messages[0].content, /ordered primitives/)
  assert.ok(JSON.stringify(provider.calls[0].schema).length < 2500)
  assert.doesNotMatch(JSON.stringify(provider.calls[0].schema), /\$ref|\$defs|oneOf/)
  assert.match(JSON.stringify(provider.calls[0].schema), /"required":\["id","op","shape","position","rotation","height"\]/)
})

test('rejects malformed programs and changed part IDs', async () => {
  const duplicate = { ...spec, steps: [spec.steps[0], { ...spec.steps[0], op: 'union' }] }
  await assert.rejects(generateCadProgram(new MockLLMProvider(Array(2).fill({ decision: 'create', spec: duplicate, question: '', assumptions: [] })), 'Crie'), /unique/)
  await assert.rejects(generateCadProgram(new MockLLMProvider(Array(2).fill({ decision: 'create', spec: { ...spec, partId: 'other' }, question: '', assumptions: [] })), 'Edite', spec as never), /Part ID/)
})

test('an edit cannot silently remove an existing construction step', async () => {
  const previous = { ...spec, steps: [...spec.steps, { ...spec.steps[0], id: 'rib', op: 'union', position: { x: 0, y: 0, z: 4 } }] }
  await assert.rejects(generateCadProgram(new MockLLMProvider(Array(2).fill({ decision: 'create', spec, question: '', assumptions: [] })), 'Altere a largura', previous as never), /unexpectedly removed/)
})

test('normalizes dimensions unrelated to a primitive without changing the requested dimensions', async () => {
  const withIrrelevantFields = { ...spec, steps: [{ ...spec.steps[0], shape: 'sphere', diameter: 20, width: null, depth: null, height: null }] }
  const provider = new MockLLMProvider([{ decision: 'create', spec: withIrrelevantFields, question: null, assumptions: null }])
  const result = await generateCadProgram(provider, 'Crie uma esfera')
  assert.equal(result.kind, 'create')
  if (result.kind === 'create') assert.deepEqual(result.spec.steps[0], {
    id: 'body', op: 'base', shape: 'sphere', position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, diameter: 20,
  })
  assert.equal(provider.calls.length, 1)
})

test('repairs an incomplete program once using a field-level diagnostic', async () => {
  const incomplete = { ...spec, steps: [{ ...spec.steps[0], height: null }] }
  const provider = new MockLLMProvider([
    { decision: 'create', spec: incomplete, question: '', assumptions: [] },
    { decision: 'create', spec, question: '', assumptions: [] },
  ])
  const result = await generateCadProgram(provider, 'Crie um bloco')
  assert.equal(result.kind, 'create')
  assert.equal(provider.calls.length, 2)
  assert.match(provider.calls[1].messages.at(-1)?.content ?? '', /etapa 1 \(box\) precisa de height/)
})

test('a second invalid response reports the missing field', async () => {
  const incomplete = { ...spec, steps: [{ ...spec.steps[0], height: null }] }
  const provider = new MockLLMProvider([
    { decision: 'create', spec: incomplete, question: '', assumptions: [] },
    { decision: 'create', spec: incomplete, question: '', assumptions: [] },
  ])
  await assert.rejects(generateCadProgram(provider, 'Crie um bloco'), /etapa 1 \(box\) precisa de height/)
})

test('repairs only a missing cylinder height after a full-program retry repeats the omission', async () => {
  const incomplete = { ...spec, steps: [spec.steps[0], {
    id: 'boss', op: 'union', shape: 'cylinder', position: { x: 0, y: 0, z: 8 },
    rotation: { x: 0, y: 0, z: 0 }, diameter: 30,
  }] }
  const provider = new MockLLMProvider([
    { decision: 'create', spec: incomplete, question: '', assumptions: [] },
    { decision: 'create', spec: incomplete, question: '', assumptions: [] },
    { height: 10 },
  ])

  const result = await generateCadProgram(provider, 'Crie um ressalto cilíndrico de diâmetro 30 e altura 10 mm')

  assert.equal(result.kind, 'create')
  if (result.kind === 'create') {
    const boss = result.spec.steps[1]
    assert.equal(boss.shape, 'cylinder')
    if (boss.shape === 'cylinder') assert.equal(boss.height, 10)
  }
  assert.equal(provider.calls.length, 3)
  assert.match(provider.calls[2].messages.at(-1)?.content ?? '', /cylinder step 2 \(boss\)/)
  assert.deepEqual(provider.calls[2].schema, {
    type: 'object', additionalProperties: false, required: ['height'], properties: { height: { type: 'number' } },
  })
})

test('a cylinder height repair outside CAD limits is rejected', async () => {
  const incomplete = { ...spec, steps: [spec.steps[0], {
    id: 'boss', op: 'union', shape: 'cylinder', position: { x: 0, y: 0, z: 8 },
    rotation: { x: 0, y: 0, z: 0 }, diameter: 30,
  }] }
  const provider = new MockLLMProvider([
    { decision: 'create', spec: incomplete, question: '', assumptions: [] },
    { decision: 'create', spec: incomplete, question: '', assumptions: [] },
    { height: -5 },
  ])
  await assert.rejects(generateCadProgram(provider, 'Crie um ressalto cilíndrico'), /etapa 2 \(cylinder\) precisa de height/)
})

test('a broad mechanical request is modeled with reusable patterns after a provider deflection', async () => {
  const patterned = { schemaVersion: '3.0', units: 'mm', partId: 'toothed_wheel', steps: [
    { id: 'body', op: 'base', shape: 'cylinder', position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, diameter: 60, height: 10 },
    { id: 'teeth', op: 'union', shape: 'box', position: { x: 30.8, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, width: 6, depth: 5, height: 10,
      pattern: { kind: 'circular', count: 20, axis: 'z', center: { x: 0, y: 0, z: 0 } } },
    { id: 'bore', op: 'cut', shape: 'cylinder', position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, diameter: 10, height: 20 },
  ] }
  const provider = new MockLLMProvider([
    { decision: 'clarify', spec: null, question: 'Please specify a simple mechanical part instead.', assumptions: [] },
    { decision: 'create', spec: patterned, question: '', assumptions: ['20 repeated teeth and 10 mm thickness assumed.'] },
  ])

  const result = await generateCadProgram(provider, 'faça uma engrenagem')

  assert.equal(result.kind, 'create')
  if (result.kind === 'create') assert.equal(result.spec.steps[1].pattern?.kind, 'circular')
  assert.equal(provider.calls.length, 2)
  assert.match(provider.calls[1].messages.at(-1)?.content ?? '', /Do not redirect/)
})

test('Gemini receives the compact construction schema and still returns a validated program', async () => {
  let sentSchema = ''
  const provider = new OpenAICompatibleProvider(
    { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/', apiKey: 'test-key', model: 'gemini-3.5-flash-lite' },
    async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { response_format: { json_schema: { schema: unknown } } }
      sentSchema = JSON.stringify(body.response_format.json_schema.schema)
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ decision: 'create', spec, question: '', assumptions: [] }) } }] }), { status: 200 })
    },
  )
  await provider.initialize()
  const result = await generateCadProgram(provider, 'Crie um suporte')
  assert.equal(result.kind, 'create')
  assert.ok(sentSchema.length < 2500)
  assert.doesNotMatch(sentSchema, /\$ref|\$defs|oneOf|anyOf/)
})
