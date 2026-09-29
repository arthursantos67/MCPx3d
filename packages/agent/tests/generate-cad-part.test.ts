import assert from 'node:assert/strict'
import { test } from 'node:test'

import { CadPartGenerationError, generateCadPart } from '../src/generate-cad-part.ts'
import { MockLLMProvider } from '../src/mock-provider.ts'
import bracket from '../../domain/fixtures/cad-part/valid-l-bracket.json' with { type: 'json' }
import roundedPlate from '../../domain/fixtures/cad-part/valid-rounded-plate.json' with { type: 'json' }
import flange from '../../domain/fixtures/cad-part/valid-round-flange.json' with { type: 'json' }
import composite from '../../domain/fixtures/cad-part/valid-composite-part.json' with { type: 'json' }

const spec = {
  schemaVersion: '2.1', units: 'mm', partId: 'custom_plate',
  base: { kind: 'extruded_rectangle', width: 120, depth: 80, thickness: 10 },
  features: [
    { kind: 'through_hole', id: 'hole_1', x: -40, y: -25, diameter: 8 },
    { kind: 'through_hole', id: 'hole_2', x: 40, y: -25, diameter: 8 },
    { kind: 'through_hole', id: 'hole_3', x: -40, y: 25, diameter: 8 },
    { kind: 'through_hole', id: 'hole_4', x: 40, y: 25, diameter: 8 },
  ],
  cornerChamfer: 4,
}

test('creates a complete four-hole CAD proposal with stated assumptions', async () => {
  const provider = new MockLLMProvider([{
    decision: 'create', spec, question: '',
    assumptions: ['Width 120 mm, depth 80 mm, thickness 10 mm were inferred.'],
  }])
  const outcome = await generateCadPart(provider, 'Crie uma placa com quatro furos')
  assert.deepEqual(outcome, {
    kind: 'create', spec, assumptions: ['Width 120 mm, depth 80 mm, thickness 10 mm were inferred.'],
  })
  assert.equal(provider.calls.length, 1)
  assert.match(provider.calls[0].messages[0].content, /Respect every explicitly requested size/)
})

test('unsupported geometry asks for clarification instead of pretending to create it', async () => {
  const provider = new MockLLMProvider([{
    decision: 'clarify', spec: null, assumptions: [], question: 'Do you want a plain through-hole instead of a threaded hole?',
  }])
  assert.deepEqual(await generateCadPart(provider, 'Crie uma placa com furos roscados'), {
    kind: 'clarify', question: 'Do you want a plain through-hole instead of a threaded hole?',
  })
})

test('rejects malformed, colliding and unsupported CAD proposals', async () => {
  const malformed = new MockLLMProvider([{ decision: 'create', spec: { ...spec, script: 'run()' }, question: '', assumptions: [] }])
  await assert.rejects(generateCadPart(malformed, 'Crie a placa'), CadPartGenerationError)
  const colliding = new MockLLMProvider([{ decision: 'create', spec: {
    ...spec, features: [spec.features[0], { ...spec.features[1], x: -40 }],
  }, question: '', assumptions: [] }])
  await assert.rejects(generateCadPart(colliding, 'Crie a placa'), CadPartGenerationError)
  const wrongCount = new MockLLMProvider([{ decision: 'create', spec, question: '', assumptions: [] }])
  await assert.rejects(generateCadPart(wrongCount, 'Crie uma placa com três furos'), /specified 3/)
})

test('creates a fused L bracket with base and upright holes from a typed proposal', async () => {
  const provider = new MockLLMProvider([{
    decision: 'create', spec: bracket, question: '', assumptions: [],
  }])
  const outcome = await generateCadPart(provider, 'Crie um suporte em L com 4 furos', 'bracket')
  assert.equal(outcome.kind, 'create')
  if (outcome.kind === 'create') {
    assert.equal(outcome.spec.schemaVersion, '2.2')
    assert.equal(outcome.spec.upright?.holes.length, 2)
  }
  assert.match(provider.calls[0].messages[0].content, /single fused L-shaped/)
  const grouped = new MockLLMProvider([{ decision: 'create', spec: bracket, question: '', assumptions: [] }])
  assert.equal((await generateCadPart(grouped, 'Crie um suporte em L com 2 furos na base e 2 na parede', 'bracket')).kind, 'create')
  const withDiameters = new MockLLMProvider([{ decision: 'create', spec: bracket, question: '', assumptions: [] }])
  assert.equal((await generateCadPart(withDiameters, 'Crie um suporte em L com dois furos Ø8 na base e dois furos Ø10 na parede', 'bracket')).kind, 'create')
  const wrongWall = new MockLLMProvider([{ decision: 'create', spec: bracket, question: '', assumptions: [] }])
  await assert.rejects(generateCadPart(wrongWall, 'Crie um suporte em L com dois furos Ø8 na base e três furos Ø10 na parede', 'bracket'), /upright holes/)
  const wrongFace = new MockLLMProvider([{ decision: 'create', spec: bracket, question: '', assumptions: [] }])
  await assert.rejects(generateCadPart(wrongFace, 'Crie um suporte em L com 3 furos na base e 1 na parede', 'bracket'), /base holes/)
  const wrongShape = new MockLLMProvider([{ decision: 'create', spec, question: '', assumptions: [] }])
  await assert.rejects(generateCadPart(wrongShape, 'Crie um suporte em L', 'bracket'), CadPartGenerationError)
})

test('creates rounded plates and circular flanges with curved outlines', async () => {
  for (const [shape, proposal, request] of [
    ['rounded_plate', roundedPlate, 'Crie uma placa com cantos arredondados e 2 furos'],
    ['flange', flange, 'Crie um flange circular com 3 furos'],
  ] as const) {
    const provider = new MockLLMProvider([{ decision: 'create', spec: proposal, question: '', assumptions: [] }])
    const outcome = await generateCadPart(provider, request, shape)
    assert.equal(outcome.kind, 'create')
    assert.match(provider.calls[0].messages[0].content, /schemaVersion 2.3/)
  }
  const wrongShape = new MockLLMProvider([{ decision: 'create', spec: roundedPlate, question: '', assumptions: [] }])
  await assert.rejects(generateCadPart(wrongShape, 'Crie um flange circular', 'flange'), CadPartGenerationError)
  const centerAndMounts = new MockLLMProvider([{ decision: 'create', spec: flange, question: '', assumptions: [] }])
  assert.equal((await generateCadPart(centerAndMounts, 'Crie um flange com furo central e dois furos de fixação', 'flange')).kind, 'create')
})

test('creates a fused composite with a raised boss and a through bore', async () => {
  const provider = new MockLLMProvider([{ decision: 'create', spec: composite, question: '', assumptions: [] }])
  const result = await generateCadPart(provider, 'Crie uma peça composta com furo central e quatro furos de fixação', 'composite')
  assert.equal(result.kind, 'create')
  if (result.kind === 'create') assert.equal(result.spec.bosses?.length, 1)
  assert.match(provider.calls[0].messages[0].content, /schemaVersion 2.4/)
})
