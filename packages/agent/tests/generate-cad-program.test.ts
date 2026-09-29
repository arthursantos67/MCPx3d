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
    {},
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
    { step2_height: 10 },
  ])

  const result = await generateCadProgram(provider, 'Crie um ressalto cilíndrico de diâmetro 30 e altura 10 mm')

  assert.equal(result.kind, 'create')
  if (result.kind === 'create') {
    const boss = result.spec.steps[1]
    assert.equal(boss.shape, 'cylinder')
    if (boss.shape === 'cylinder') assert.equal(boss.height, 10)
  }
  assert.equal(provider.calls.length, 3)
  assert.match(provider.calls[2].messages.at(-1)?.content ?? '', /step2_height: height of the cylinder step 2 \(boss\)/)
  assert.deepEqual(provider.calls[2].schema, {
    type: 'object', additionalProperties: false, required: ['step2_height'], properties: { step2_height: { type: 'number' } },
  })
})

test('a dimension repair outside CAD limits is rejected', async () => {
  const incomplete = { ...spec, steps: [spec.steps[0], {
    id: 'boss', op: 'union', shape: 'cylinder', position: { x: 0, y: 0, z: 8 },
    rotation: { x: 0, y: 0, z: 0 }, diameter: 30,
  }] }
  const provider = new MockLLMProvider([
    { decision: 'create', spec: incomplete, question: '', assumptions: [] },
    { decision: 'create', spec: incomplete, question: '', assumptions: [] },
    { step2_height: -5 },
  ])
  await assert.rejects(generateCadProgram(provider, 'Crie um ressalto cilíndrico'), /etapa 2 \(cylinder\) precisa de height/)
})

test('repairs missing dimensions of several shapes in one focused request', async () => {
  const incomplete = { ...spec, steps: [
    { id: 'hub', op: 'base', shape: 'cylinder', position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, diameter: 55, height: 45 },
    { id: 'keyway', op: 'cut', shape: 'box', position: { x: 0, y: 13, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, height: 50 },
    { id: 'taper', op: 'union', shape: 'cone', position: { x: 0, y: 0, z: 25 }, rotation: { x: 0, y: 0, z: 0 }, bottomDiameter: 55, height: 10 },
  ] }
  const provider = new MockLLMProvider([
    { decision: 'create', spec: incomplete, question: '', assumptions: [] },
    { decision: 'create', spec: incomplete, question: '', assumptions: [] },
    { step2_width: 8, step2_depth: 6, step3_topDiameter: 0 },
  ])

  const result = await generateCadProgram(provider, 'Cubo de 55 mm com rasgo de chaveta de 8 mm e ponta cônica')

  assert.equal(result.kind, 'create')
  if (result.kind === 'create') {
    assert.deepEqual(result.spec.steps[1], { ...incomplete.steps[1], width: 8, depth: 6 })
    assert.deepEqual(result.spec.steps[2], { ...incomplete.steps[2], topDiameter: 0 })
  }
  assert.deepEqual((provider.calls[2].schema as { required: string[] }).required, ['step2_width', 'step2_depth', 'step3_topDiameter'])
})

test('repairs a missing profile outline and rejects a non-array outline', async () => {
  const incomplete = { ...spec, steps: [
    { id: 'profile', op: 'base', shape: 'polygon_prism', position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, height: 10 },
  ] }
  const outline = [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 8 }, { x: 8, y: 8 }, { x: 8, y: 30 }, { x: 0, y: 30 }]
  const respond = (points: unknown) => new MockLLMProvider([
    { decision: 'create', spec: incomplete, question: '', assumptions: [] },
    { decision: 'create', spec: incomplete, question: '', assumptions: [] },
    { step1_points: points },
  ])

  const result = await generateCadProgram(respond(outline), 'Perfil em L de 40 por 30 mm')
  assert.equal(result.kind, 'create')
  if (result.kind === 'create') assert.deepEqual(result.spec.steps[0], { ...incomplete.steps[0], points: outline })

  await assert.rejects(generateCadProgram(respond('L'), 'Perfil em L'), /etapa 1 \(polygon_prism\) precisa de points/)
})

test('normalizes incomplete vectors, numeric strings and pattern kinds without another request', async () => {
  const loose = { ...spec, steps: [spec.steps[0],
    { id: 'slots', op: 'cut', shape: 'box', position: { x: -30, y: 0 }, rotation: { x: 0, y: 0, z: 0 }, width: '4', depth: 20, height: 20,
      pattern: { kind: 'Linear', count: '4', offset: { x: 20 }, axis: 'z', sweepAngle: null } },
    { id: 'bolts', op: 'cut', shape: 'cylinder', position: { x: 30, y: 15, z: 0 }, rotation: { x: 0, y: 0 }, diameter: 5, height: 20,
      pattern: { kind: 'polar', count: 2, axis: 'Z' } },
  ] }
  const provider = new MockLLMProvider([{ decision: 'create', spec: loose, question: '', assumptions: [] }])

  const result = await generateCadProgram(provider, 'Placa com quatro rasgos e dois furos')

  assert.equal(result.kind, 'create')
  if (result.kind === 'create') {
    assert.deepEqual(result.spec.steps[1], {
      id: 'slots', op: 'cut', shape: 'box', position: { x: -30, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, width: 4, depth: 20, height: 20,
      pattern: { kind: 'linear', count: 4, offset: { x: 20, y: 0, z: 0 } },
    })
    assert.deepEqual(result.spec.steps[2].rotation, { x: 0, y: 0, z: 0 })
    assert.deepEqual(result.spec.steps[2].pattern, { kind: 'circular', count: 2, axis: 'z' })
  }
  assert.equal(provider.calls.length, 1)
})

test('a single-instance pattern is treated as no repetition, including on the base step', async () => {
  const placeholders = { ...spec, steps: [
    { ...spec.steps[0], pattern: { kind: 'circular', count: 0, axis: 'z' } },
    { id: 'keyway', op: 'cut', shape: 'box', position: { x: 0, y: 20, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, width: 8, depth: 6, height: 20,
      pattern: { kind: 'linear', count: 1, offset: { x: 0, y: 0, z: 0 } } },
  ] }
  const provider = new MockLLMProvider([{ decision: 'create', spec: placeholders, question: '', assumptions: [] }])

  const result = await generateCadProgram(provider, 'Bloco com rasgo de chaveta')

  assert.equal(result.kind, 'create')
  if (result.kind === 'create') {
    assert.equal('pattern' in result.spec.steps[0], false)
    assert.equal('pattern' in result.spec.steps[1], false)
  }
  assert.equal(provider.calls.length, 1)
  assert.match(provider.calls[0].messages[0].content, /Omit pattern entirely for a primitive that is not repeated/)

  const fractional = { ...spec, steps: [spec.steps[0], { ...placeholders.steps[1], pattern: { kind: 'linear', count: 1.5, offset: { x: 10, y: 0, z: 0 } } }] }
  await assert.rejects(generateCadProgram(new MockLLMProvider(Array(2).fill({ decision: 'create', spec: fractional, question: '', assumptions: [] })), 'Rasgos'),
    /etapa 2 \(box\) padrão linear: \/count must be integer/)
})

test('reports the failing pattern branch instead of the other branch of the union', async () => {
  const tooMany = { ...spec, steps: [spec.steps[0],
    { id: 'slots', op: 'cut', shape: 'box', position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, width: 1, depth: 20, height: 20,
      pattern: { kind: 'linear', count: 100, offset: { x: 1, y: 0, z: 0 } } },
  ] }
  const provider = new MockLLMProvider(Array(2).fill({ decision: 'create', spec: tooMany, question: '', assumptions: [] }))

  await assert.rejects(generateCadProgram(provider, 'Cem rasgos'), (error: Error) => {
    assert.match(error.message, /etapa 2 \(box\) padrão linear: \/count must be <= 64/)
    assert.doesNotMatch(error.message, /additional properties/)
    return true
  })
  assert.match(provider.calls[1].messages.at(-1)?.content ?? '', /padrão linear: \/count must be <= 64/)
})

test('reports the failing field of the step shape instead of another shape of the union', async () => {
  const tiny = { ...spec, steps: [spec.steps[0],
    { id: 'pin', op: 'union', shape: 'cylinder', position: { x: 0, y: 0, z: 8 }, rotation: { x: 0, y: 0, z: 0 }, diameter: 0.01, height: 5 },
  ] }
  const provider = new MockLLMProvider(Array(2).fill({ decision: 'create', spec: tiny, question: '', assumptions: [] }))

  await assert.rejects(generateCadProgram(provider, 'Pino'), (error: Error) => {
    assert.match(error.message, /etapa 2 \(cylinder\): \/diameter must be >= 0\.1/)
    assert.doesNotMatch(error.message, /width/)
    return true
  })
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

test('a geometry failure is sent back once with the exact issue and the corrected program is returned', async () => {
  const floating = { ...spec, steps: [spec.steps[0],
    { id: 'boss', op: 'union', shape: 'cylinder', position: { x: 100, y: 0, z: 8 }, rotation: { x: 0, y: 0, z: 0 }, diameter: 30, height: 10 }] }
  const fixed = { ...floating, steps: [spec.steps[0], { ...floating.steps[1], position: { x: 0, y: 0, z: 8 } }] }
  const provider = new MockLLMProvider([
    { decision: 'create', spec: floating, question: '', assumptions: ['boss centered'] },
    { decision: 'create', spec: fixed, question: '', assumptions: ['boss centered'] },
  ])
  const issue = 'CAD step boss (union) leaves 2 separate solids; every union must overlap the part and no cut may split it'
  const checked: unknown[] = []
  const check = async (candidate: unknown) => { checked.push(candidate); return checked.length === 1 ? issue : null }

  const result = await generateCadProgram(provider, 'Base com ressalto', undefined, check)

  assert.equal(result.kind, 'create')
  if (result.kind === 'create') {
    assert.deepEqual(result.spec, fixed)
    assert.equal(result.geometryIssue, undefined)
  }
  assert.equal(checked.length, 2)
  assert.equal(provider.calls.length, 2)
  const correction = provider.calls[1].messages.at(-1)?.content ?? ''
  assert.match(correction, /Current CAD program:/)
  assert.ok(correction.includes(issue))
})

test('a persistent geometry failure returns the last program with the issue after two corrections', async () => {
  const provider = new MockLLMProvider(Array(3).fill({ decision: 'create', spec, question: '', assumptions: [] }))
  let checks = 0
  const result = await generateCadProgram(provider, 'Bloco', undefined, async () => { checks += 1; return `problem ${checks}` })

  assert.equal(result.kind, 'create')
  if (result.kind === 'create') assert.equal(result.geometryIssue, 'problem 3')
  assert.equal(checks, 3)
  assert.equal(provider.calls.length, 3)
})

test('a failed geometry correction keeps the previous program and reports its issue', async () => {
  const provider = new MockLLMProvider([
    { decision: 'create', spec, question: '', assumptions: [] },
    'not json{{{', 'not json{{{',
  ])
  const result = await generateCadProgram(provider, 'Bloco', undefined, async () => 'CAD step body (base) produces an invalid or empty solid')

  assert.equal(result.kind, 'create')
  if (result.kind === 'create') {
    assert.deepEqual(result.spec, spec)
    assert.equal(result.geometryIssue, 'CAD step body (base) produces an invalid or empty solid')
  }
})
