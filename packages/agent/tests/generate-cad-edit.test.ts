import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { CadPartSpec } from '../../domain/ts/src/cad-part.ts'
import { generateCadEdit, CadEditGenerationError } from '../src/generate-cad-edit.ts'
import { MockLLMProvider } from '../src/mock-provider.ts'
import bracket from '../../domain/fixtures/cad-part/valid-l-bracket.json' with { type: 'json' }
import roundedPlate from '../../domain/fixtures/cad-part/valid-rounded-plate.json' with { type: 'json' }
import flange from '../../domain/fixtures/cad-part/valid-round-flange.json' with { type: 'json' }
import composite from '../../domain/fixtures/cad-part/valid-composite-part.json' with { type: 'json' }

const spec: CadPartSpec = {
  schemaVersion: '2.0', units: 'mm', partId: 'plate_1',
  base: { kind: 'extruded_rectangle', width: 100, depth: 80, thickness: 10 },
  features: [{ kind: 'through_hole', x: 10, y: 5, diameter: 12 }],
}

test('generates only a typed edit from a CAD request', async () => {
  const provider = new MockLLMProvider([{
    decision: 'edit', question: '', operations: [
      { op: 'set_parameter', parameter: 'width', value: 120 },
      { op: 'set_parameter', parameter: 'hole_diameter', value: 16 },
    ],
  }])
  const outcome = await generateCadEdit(provider, 'set width to 120 and hole diameter to 16 mm', spec)
  assert.deepEqual(outcome, { kind: 'edit', plan: { schemaVersion: '1.0', operations: [
    { op: 'set_parameter', parameter: 'width', value: 120 },
    { op: 'set_parameter', parameter: 'hole_diameter', value: 16 },
  ] } })
  assert.equal(provider.calls.length, 1)
})

test('asks for clarification without producing an edit', async () => {
  const provider = new MockLLMProvider([{ decision: 'clarify', operations: [], question: 'Which dimension should change?' }])
  assert.deepEqual(await generateCadEdit(provider, 'make it larger', spec), {
    kind: 'clarify', question: 'Which dimension should change?',
  })
})

test('rejects unsafe, malformed and geometrically impossible edits', async () => {
  const unsafe = new MockLLMProvider([{ decision: 'edit', question: '', operations: [{ op: 'run_code', parameter: 'width', value: 120 }] }])
  await assert.rejects(generateCadEdit(unsafe, 'change width', spec), CadEditGenerationError)
  const invalid = new MockLLMProvider([{ decision: 'edit', question: '', operations: [{ op: 'set_parameter', parameter: 'hole_diameter', value: 100 }] }])
  await assert.rejects(generateCadEdit(invalid, 'set hole to 100 mm', spec), CadEditGenerationError)
})

test('edits identified holes and chamfers in a mounting plate', async () => {
  const mounting: CadPartSpec = {
    ...spec, schemaVersion: '2.1', cornerChamfer: 4,
    features: [
      { ...spec.features[0], id: 'hole_1' },
      { kind: 'through_hole', id: 'hole_2', x: -20, y: -20, diameter: 8 },
    ],
  }
  const provider = new MockLLMProvider([{
    decision: 'edit', question: '', operations: [
      { op: 'set_corner_chamfer', value: 5 },
      { op: 'upsert_hole', holeId: 'hole_2', x: -25, y: -20, diameter: 8 },
    ],
  }])
  const outcome = await generateCadEdit(provider, 'move hole_2 to x -25 and set chamfers to 5 mm', mounting)
  assert.equal(outcome.kind, 'edit')
  if (outcome.kind === 'edit') assert.equal(outcome.plan.schemaVersion, '2.0')

  const invalid = new MockLLMProvider([{
    decision: 'edit', question: '', operations: [{ op: 'remove_hole', holeId: 'hole_1' }],
  }])
  await assert.rejects(generateCadEdit(invalid, 'remove hole_1', mounting), CadEditGenerationError)
})

test('edits the fused L bracket through typed wall operations', async () => {
  const provider = new MockLLMProvider([{
    decision: 'edit', question: '', operations: [
      { op: 'set_upright_parameter', parameter: 'height', value: 90 },
      { op: 'upsert_upright_hole', holeId: 'wall_hole_1', x: -40, z: 55, diameter: 10 },
    ],
  }])
  const outcome = await generateCadEdit(provider, 'Aumente a altura para 90 e mova wall_hole_1 para Z 55', bracket as CadPartSpec)
  assert.equal(outcome.kind, 'edit')
  if (outcome.kind === 'edit') assert.equal(outcome.plan.schemaVersion, '3.0')

  const invalid = new MockLLMProvider([{ decision: 'edit', question: '', operations: [
    { op: 'upsert_upright_hole', holeId: 'wall_hole_1', x: -40, z: 10, diameter: 10 },
  ] }])
  await assert.rejects(generateCadEdit(invalid, 'Mova o furo da parede para Z 10', bracket as CadPartSpec), CadEditGenerationError)
})

test('edits corner radius and circular flange diameter with typed commands', async () => {
  const radiusProvider = new MockLLMProvider([{ decision: 'edit', question: '', operations: [
    { op: 'set_corner_radius', value: 16 },
  ] }])
  const radiusEdit = await generateCadEdit(radiusProvider, 'Aumente o raio dos cantos para 16 mm', roundedPlate as CadPartSpec)
  assert.equal(radiusEdit.kind, 'edit')
  if (radiusEdit.kind === 'edit') assert.equal(radiusEdit.plan.schemaVersion, '4.0')
  const diameterProvider = new MockLLMProvider([{ decision: 'edit', question: '', operations: [
    { op: 'set_disc_diameter', value: 120 },
  ] }])
  assert.equal((await generateCadEdit(diameterProvider, 'Aumente o diâmetro externo para 120 mm', flange as CadPartSpec)).kind, 'edit')
  const invalid = new MockLLMProvider([{ decision: 'edit', question: '', operations: [
    { op: 'set_corner_radius', value: 50 },
  ] }])
  await assert.rejects(generateCadEdit(invalid, 'Coloque raio 50 mm', roundedPlate as CadPartSpec), CadEditGenerationError)
})

test('edits fused bosses and rejects a partial bore cut', async () => {
  const provider = new MockLLMProvider([{ decision: 'edit', question: '', operations: [
    { op: 'upsert_boss', bossId: 'boss_1', x: 0, y: 0, diameter: 44, height: 25 },
  ] }])
  const outcome = await generateCadEdit(provider, 'Aumente o ressalto para diâmetro 44 e altura 25 mm', composite as CadPartSpec)
  assert.equal(outcome.kind, 'edit')
  if (outcome.kind === 'edit') assert.equal(outcome.plan.schemaVersion, '5.0')
  const invalid = new MockLLMProvider([{ decision: 'edit', question: '', operations: [
    { op: 'upsert_hole', holeId: 'hole_1', x: 18, y: 0, diameter: 10 },
  ] }])
  await assert.rejects(generateCadEdit(invalid, 'Mova o furo central para X 18', composite as CadPartSpec), CadEditGenerationError)
})
