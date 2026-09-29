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

test('a disconnected union is repaired at the named step and checked again', async () => {
  const floating = { ...spec, steps: [spec.steps[0],
    { id: 'boss', op: 'union', shape: 'cylinder', position: { x: 100, y: 0, z: 8 }, rotation: { x: 0, y: 0, z: 0 }, diameter: 30, height: 10 }] }
  const fixed = { ...floating, steps: [spec.steps[0], { ...floating.steps[1], position: { x: 0, y: 0, z: 8 } }] }
  const provider = new MockLLMProvider([
    { decision: 'create', spec: floating, question: '', assumptions: ['boss centered'] },
    { position: { x: 0, y: 0, z: 8 }, rotation: { x: 0, y: 0, z: 0 } },
  ])
  const issue = 'CAD step boss (union) leaves 2 separate solids; every union must overlap the part and no cut may split it'
  const checked: unknown[] = []
  const check = async (candidate: unknown) => { checked.push(candidate); return checked.length === 1 ? issue : null }

  const result = await generateCadProgram(provider, 'Base com ressalto', undefined, check)

  assert.equal(result.kind, 'create')
  if (result.kind === 'create') {
    assert.deepEqual(result.spec, fixed)
  }
  assert.equal(checked.length, 2)
  assert.equal(provider.calls.length, 2)
  const correction = provider.calls[1].messages.at(-1)?.content ?? ''
  assert.match(correction, /Failed step: boss/)
  assert.ok(correction.includes(issue))
})

test('repairs a self-intersecting base profile without changing the other steps', async () => {
  const zero = { x: 0, y: 0, z: 0 }
  const crossed = [{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 6 }, { x: 0, y: 6 }, { x: 4, y: -2 }]
  const outline = [{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 6 }, { x: 0, y: 6 }]
  const invalid = { ...spec, steps: [
    { id: 'c_frame', op: 'base', shape: 'polygon_prism', position: zero, rotation: zero, points: crossed, height: 8 },
    { id: 'hole', op: 'cut', shape: 'cylinder', position: { x: 3, y: 3, z: 0 }, rotation: zero, diameter: 2, height: 20 },
  ] }
  const provider = new MockLLMProvider([
    { decision: 'create', spec: invalid, question: '', assumptions: [] },
    { points: outline },
  ])
  const issue = 'CAD step c_frame (base) polygon_prism profile self-intersects between edges 1 and 4'
  const result = await generateCadProgram(provider, 'Perfil com furo', undefined, async (candidate) =>
    candidate.steps[0].shape === 'polygon_prism' && candidate.steps[0].points.length === 5 ? issue : null)
  assert.equal(result.kind, 'create')
  if (result.kind === 'create') {
    assert.deepEqual(result.spec.steps[0], { ...invalid.steps[0], points: outline })
    assert.deepEqual(result.spec.steps[1], invalid.steps[1])
  }
  assert.equal(provider.calls.length, 2)
  assert.match(provider.calls[1].messages[0].content, /Edges must not cross/)
})

test('removes a duplicate closing point from an invalid base profile without another model call', async () => {
  const zero = { x: 0, y: 0, z: 0 }
  const outline = [{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 6 }, { x: 0, y: 6 }]
  const invalid = { ...spec, steps: [{
    id: 'outline', op: 'base', shape: 'polygon_prism', position: zero, rotation: zero,
    points: [...outline, outline[0]], height: 8,
  }] }
  const provider = new MockLLMProvider([{ decision: 'create', spec: invalid, question: '', assumptions: [] }])
  const result = await generateCadProgram(provider, 'Perfil quadrado', undefined, async (candidate) =>
    candidate.steps[0].shape === 'polygon_prism' && candidate.steps[0].points.length === 5
      ? 'CAD step outline (base) produces an invalid or empty solid' : null)
  assert.equal(result.kind, 'create')
  if (result.kind === 'create' && result.spec.steps[0].shape === 'polygon_prism') {
    assert.deepEqual(result.spec.steps[0].points, outline)
  }
  assert.equal(provider.calls.length, 1)
})

test('disjoint unions on different axes are moved to verified overlap when model repairs repeat the error', async () => {
  const zero = { x: 0, y: 0, z: 0 }
  const handleBar = { id: 'handle_bar', op: 'union', shape: 'box', position: { x: 67.5, y: 120, z: 0 },
    rotation: zero, width: 8, depth: 100, height: 8 }
  const upright = { id: 'upright', op: 'union', shape: 'box', position: { x: 67.5, y: 0, z: 120 },
    rotation: zero, width: 8, depth: 8, height: 100 }
  const disconnected = { ...spec, steps: [
    { id: 'body', op: 'base', shape: 'box', position: { x: 65, y: 0, z: 0 }, rotation: zero,
      width: 130, depth: 60, height: 10 },
    handleBar, upright,
  ] }
  const response = { decision: 'create', spec: disconnected, question: '', assumptions: [] }
  const provider = new MockLLMProvider([
    response, { position: handleBar.position, rotation: zero }, response,
    { position: handleBar.position, rotation: zero }, response,
  ])
  const handleIssue = 'CAD step handle_bar (union) leaves 2 separate solids; current solid bounds: x=[0.00, 130.00], y=[-30.00, 30.00], z=[-5.00, 5.00]; tool bounds: x=[63.50, 71.50], y=[70.00, 170.00], z=[-4.00, 4.00]; bounding boxes do not overlap'
  const uprightIssue = 'CAD step upright (union) leaves 2 separate solids; current solid bounds: x=[0.00, 130.00], y=[-30.00, 125.00], z=[-5.00, 5.00]; tool bounds: x=[63.50, 71.50], y=[-4.00, 4.00], z=[70.00, 170.00]; bounding boxes do not overlap'
  const result = await generateCadProgram(provider, 'Prensa com duas barras conectadas', undefined, async (candidate) => {
    if (candidate.steps[1].position.y > 75) return handleIssue
    if (candidate.steps[2].position.z > 54) return uprightIssue
    return null
  })
  assert.equal(result.kind, 'create')
  if (result.kind === 'create') {
    assert.equal(result.spec.steps[1].position.y, 75)
    assert.equal(result.spec.steps[2].position.z, 54)
    assert.equal(result.assumptions.length, 2)
  }
  assert.equal(provider.calls.length, 5)
})

test('automatic overlap repair does not override an explicit requested coordinate', async () => {
  const disconnected = { ...spec, steps: [spec.steps[0], {
    id: 'handle_bar', op: 'union', shape: 'box', position: { x: 0, y: 120, z: 0 },
    rotation: { x: 0, y: 0, z: 0 }, width: 8, depth: 100, height: 8,
  }] }
  const response = { decision: 'create', spec: disconnected, question: '', assumptions: [] }
  const provider = new MockLLMProvider([
    response, { position: disconnected.steps[1].position, rotation: { x: 0, y: 0, z: 0 } }, response,
    { position: disconnected.steps[1].position, rotation: { x: 0, y: 0, z: 0 } }, response,
  ])
  const issue = 'CAD step handle_bar (union) leaves 2 separate solids; current solid bounds: x=[-40.00, 40.00], y=[-25.00, 25.00], z=[-5.00, 5.00]; tool bounds: x=[-4.00, 4.00], y=[70.00, 170.00], z=[-4.00, 4.00]; bounding boxes do not overlap'
  await assert.rejects(generateCadProgram(provider, 'Barra em y=120 mm', undefined, async () => issue), /CAD step handle_bar/)
  assert.equal(provider.calls.length, 5)
})

test('a disconnected ball follows the nearest real material rather than the global bounding box', async () => {
  const zero = { x: 0, y: 0, z: 0 }
  const ball = { id: 'handle_ball_left', op: 'union', shape: 'sphere',
    position: { x: 35, y: -50, z: 75 }, rotation: zero, diameter: 14 }
  const disconnected = { ...spec, steps: [
    { id: 'base', op: 'base', shape: 'box', position: { x: 35, y: 25, z: -25 },
      rotation: zero, width: 130, depth: 120, height: 10 },
    { id: 'upright', op: 'union', shape: 'box', position: { x: 35, y: 25, z: 50 },
      rotation: zero, width: 10, depth: 10, height: 150 },
    { id: 'handle_bar', op: 'union', shape: 'box', position: { x: 35, y: 50, z: 75 },
      rotation: zero, width: 8, depth: 70, height: 8 },
    ball,
  ] }
  const response = { decision: 'create', spec: disconnected, question: '', assumptions: [] }
  const provider = new MockLLMProvider([
    response, { position: ball.position, rotation: zero }, response,
    { position: ball.position, rotation: zero }, response,
  ])
  const issue = 'CAD step handle_ball_left (union) leaves 2 separate solids; current solid bounds: x=[-30.00, 100.00], y=[-35.00, 85.00], z=[-30.00, 125.00]; tool bounds: x=[28.00, 42.00], y=[-57.00, -43.00], z=[68.00, 82.00]; bounding boxes do not overlap; nearest solid point: x=35.00, y=15.00, z=75.00; nearest tool point: x=35.00, y=-43.00, z=75.00'
  const result = await generateCadProgram(provider, 'Prensa manual com manopla esférica', undefined, async (candidate) =>
    candidate.steps[3].position.y < 9 ? issue : null)
  assert.equal(result.kind, 'create')
  if (result.kind === 'create') {
    assert.equal(result.spec.steps[3].position.y, 9)
    assert.deepEqual(result.spec.steps.slice(0, 3), disconnected.steps.slice(0, 3))
    assert.match(result.assumptions.at(-1) ?? '', /handle_ball_left/)
  }
})

test('a clearance cut that isolates the spindle can be removed during full-program repair', async () => {
  const zero = { x: 0, y: 0, z: 0 }
  const frame = { id: 'top_beam', op: 'base', shape: 'box', position: { x: 0, y: 0, z: 160 },
    rotation: zero, width: 100, depth: 60, height: 20 }
  const guide = { id: 'guide_clearance', op: 'cut', shape: 'cylinder', position: { x: 0, y: 0, z: 160 },
    rotation: zero, diameter: 20, height: 30 }
  const spindle = { id: 'spindle', op: 'union', shape: 'cylinder', position: { x: 0, y: 0, z: 135 },
    rotation: zero, diameter: 18, height: 120 }
  const isolated = { ...spec, steps: [frame, guide, spindle] }
  const connected = { ...spec, steps: [frame, spindle] }
  const issue = 'CAD step spindle (union) leaves 2 separate solids; current solid bounds: x=[-50, 50], y=[-30, 30], z=[150, 170]; tool bounds: x=[-9, 9], y=[-9, 9], z=[75, 195]; bounding boxes overlap, but the solids may be separated by an opening or earlier cut'
  const check = async (candidate: typeof isolated) => candidate.steps.some((step) => step.id === 'guide_clearance') ? issue : null
  const provider = new MockLLMProvider([
    { decision: 'create', spec: isolated, question: '', assumptions: [] },
    { position: spindle.position, rotation: spindle.rotation },
    { decision: 'create', spec: connected, question: '', assumptions: [] },
  ])

  const result = await generateCadProgram(provider, 'Prensa manual monobloco com fuso unido à travessa', undefined, check as never)
  assert.equal(result.kind, 'create')
  if (result.kind === 'create') assert.deepEqual(result.spec, connected)
  assert.equal(provider.calls.length, 3)
  assert.match(provider.calls[2].messages.at(-1)?.content ?? '', /remove or revise that step/)
})

test('an invalid unsaved press draft can be rebuilt on the next generation request', async () => {
  const zero = { x: 0, y: 0, z: 0 }
  const frame = { id: 'top_beam', op: 'base', shape: 'box', position: { x: 0, y: 0, z: 160 },
    rotation: zero, width: 100, depth: 60, height: 20 }
  const guide = { id: 'guide_clearance', op: 'cut', shape: 'cylinder', position: { x: 0, y: 0, z: 160 },
    rotation: zero, diameter: 20, height: 30 }
  const spindle = { id: 'spindle', op: 'union', shape: 'cylinder', position: { x: 0, y: 0, z: 135 },
    rotation: zero, diameter: 18, height: 120 }
  const isolated = { ...spec, steps: [frame, guide, spindle] }
  const connected = { ...spec, steps: [frame, spindle] }
  const issue = 'CAD step spindle (union) leaves 2 separate solids'
  const provider = new MockLLMProvider([{ decision: 'create', spec: connected, question: '', assumptions: [] }])
  const result = await generateCadProgram(provider, 'Prensa manual monobloco', isolated as never,
    async (candidate) => candidate.steps.some((step) => step.id === 'guide_clearance') ? issue : null)
  assert.equal(result.kind, 'create')
  if (result.kind === 'create') assert.deepEqual(result.spec, connected)
  assert.match(provider.calls[0].messages.at(-1)?.content ?? '', /existing CAD draft failed validation/)
})

test('automatic topology repair cannot hide a failure by deleting an existing union', async () => {
  const previous = { ...spec, steps: [...spec.steps, {
    id: 'support', op: 'union', shape: 'box', position: { x: 0, y: 0, z: 8 },
    rotation: { x: 0, y: 0, z: 0 }, width: 20, depth: 20, height: 10,
  }] }
  const response = { decision: 'create', spec, question: '', assumptions: [] }
  const provider = new MockLLMProvider([response, response])
  await assert.rejects(
    generateCadProgram(provider, 'Suporte monobloco', previous as never, async () => 'CAD step support (union) leaves 2 separate solids'),
    /unexpectedly removed an existing step/,
  )
  assert.equal(provider.calls.length, 2)
})

test('a cut that splits an unrelated solid is repaired without dropping the cut', async () => {
  const zero = { x: 0, y: 0, z: 0 }
  const severed = { ...spec, steps: [spec.steps[0], {
    id: 'cross_slot', op: 'cut', shape: 'box', position: zero, rotation: zero,
    width: 4, depth: 60, height: 20,
  }] }
  const connected = { ...severed, steps: [severed.steps[0], { ...severed.steps[1], depth: 40 }] }
  const provider = new MockLLMProvider([
    { decision: 'create', spec: severed, question: '', assumptions: [] },
    { position: zero, rotation: zero, width: 4, depth: 40, height: 20 },
  ])
  const issue = 'CAD step cross_slot (cut) leaves 2 separate solids; current solid bounds: x=[-40, 40], y=[-25, 25], z=[-5, 5]; tool bounds: x=[-2, 2], y=[-30, 30], z=[-10, 10]; the cut disconnects the remaining material; preserve a material bridge'
  let checks = 0
  const result = await generateCadProgram(provider, 'Faça uma abertura parcial no bloco', undefined, async () => {
    checks++
    return checks === 1 ? issue : null
  })
  assert.equal(result.kind, 'create')
  if (result.kind === 'create') assert.deepEqual(result.spec, connected)
  assert.equal(checks, 2)
  assert.match(provider.calls[1].messages[0].content, /leaving a continuous material bridge/)
})

test('repairs a no-op transverse bore by changing only its placement', async () => {
  const zero = { x: 0, y: 0, z: 0 }
  const bad = { ...spec, steps: [
    { id: 'base', op: 'base', shape: 'box', position: zero, rotation: zero, width: 160, depth: 110, height: 12 },
    { id: 'pedestal', op: 'union', shape: 'box', position: { x: 0, y: 0, z: 15 }, rotation: zero, width: 80, depth: 55, height: 18 },
    { id: 'left_wall', op: 'union', shape: 'box', position: { x: 0, y: -24, z: 61 }, rotation: zero, width: 55, depth: 12, height: 75 },
    { id: 'right_wall', op: 'union', shape: 'box', position: { x: 0, y: 24, z: 61 }, rotation: zero, width: 55, depth: 12, height: 75 },
    { id: 'transverse_bore', op: 'cut', shape: 'cylinder', position: { x: 0, y: 0, z: 150 },
      rotation: { x: 90, y: 0, z: 0 }, diameter: 24, height: 70 },
  ] }
  const fixed = { ...bad, steps: [...bad.steps.slice(0, -1), { ...bad.steps.at(-1)!, position: { x: 0, y: 0, z: 79 } }] }
  const provider = new MockLLMProvider([
    { decision: 'create', spec: bad, question: '', assumptions: [] },
    { position: { x: 0, y: 0, z: 79 }, rotation: { x: 90, y: 0, z: 0 }, height: 70 },
  ])
  const issue = 'CAD step transverse_bore instance 1 does not change the solid; current solid bounds: x=[-80, 80], y=[-55, 55], z=[-6, 98.5]; tool bounds: x=[-12, 12], y=[-35, 35], z=[138, 162]'
  const checked: unknown[] = []
  const result = await generateCadProgram(provider, 'Furo transversal 55 mm acima do pedestal', undefined, async (candidate) => {
    checked.push(candidate)
    return checked.length === 1 ? issue : null
  })
  assert.equal(result.kind, 'create')
  if (result.kind === 'create') assert.deepEqual(result.spec, fixed)
  assert.equal(provider.calls.length, 2)
  assert.equal(checked.length, 2)
  assert.ok(provider.calls[1].messages.at(-1)?.content.includes(issue))
})

test('a persistent geometry failure rejects the invalid program after two corrections', async () => {
  const provider = new MockLLMProvider(Array(3).fill({ decision: 'create', spec, question: '', assumptions: [] }))
  let checks = 0
  await assert.rejects(generateCadProgram(provider, 'Bloco', undefined, async () => { checks += 1; return `problem ${checks}` }), /problem 3/)

  assert.equal(checks, 3)
  assert.equal(provider.calls.length, 3)
})

test('a failed geometry correction does not return an invalid program', async () => {
  const provider = new MockLLMProvider([
    { decision: 'create', spec, question: '', assumptions: [] },
    'not json{{{', 'not json{{{',
  ])
  await assert.rejects(
    generateCadProgram(provider, 'Bloco', undefined, async () => 'CAD step body (base) produces an invalid or empty solid'),
    /A geração automática não conseguiu validar a peça/,
  )
})
