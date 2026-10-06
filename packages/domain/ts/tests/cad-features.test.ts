import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Ajv2020 } from 'ajv/dist/2020.js'
import features from '../../fixtures/cad-program/features.json' with { type: 'json' }
import drive from '../../../../examples/cad/threaded_drive.json' with { type: 'json' }
import schema from '../../schemas/cad-program.v3.schema.json' with { type: 'json' }
import assemblySchema from '../../schemas/cad-assembly.v4.schema.json' with { type: 'json' }
import { validateCadProgram, type CadProgramSpec } from '../src/cad-program.ts'
import { validateCadAssembly, type CadAssemblySpec } from '../src/cad-assembly.ts'

const validate = new Ajv2020().compile(schema)
for (const raw of features) test(`schema and TS accept ${raw.partId}`, () => {
  assert.equal(validate(raw), true, JSON.stringify(validate.errors))
  assert.doesNotThrow(() => validateCadProgram(raw as CadProgramSpec))
})

test('advanced parameters are bounded and finishing cannot carry placement', () => {
  for (const [id, patch] of [['tube', { innerDiameter: 20 }], ['torus', { minorRadius: 10 }], ['slot', { width: 20 }],
    ['counterbore', { headDiameter: 5 }], ['thread_metric_right', { clearance: 0.1 }], ['thread_metric_right', { starts: 5 }],
    ['shell', { selector: 'all' }], ['fillet', { position: { x: 1, y: 0, z: 0 } }]] as const) {
    const raw = structuredClone(features.find((item) => item.partId === id)!)
    Object.assign(raw.steps.at(-1)!, patch)
    assert.throws(() => validateCadProgram(raw as CadProgramSpec))
  }
})

test('coupled motion accepts explicit mixed units and rejects ambiguous legacy groups', () => {
  assert.equal(new Ajv2020().compile(assemblySchema)(drive), true)
  assert.doesNotThrow(() => validateCadAssembly(drive as CadAssemblySpec))
  const raw = structuredClone(drive) as unknown as CadAssemblySpec
  const missing = { ...raw, components: raw.components.map((component, i) => i === 2 ? {
    ...component, motion: { ...component.motion!, factor: undefined },
  } : component) }
  assert.throws(() => validateCadAssembly(missing), /share range and value/)
  const zeroFactor = { ...raw, components: raw.components.map((component, i) => i === 1 ? {
    ...component, motion: { ...component.motion!, factor: 0 },
  } : component) }
  assert.throws(() => validateCadAssembly(zeroFactor), /motion factor/)
})

test('assembly JSON rejects missing coordinates, coerced identifiers and unexpected fields before reaching the API', () => {
  for (const patch of [{ position: {} }, { id: 123 }, { position: { x: 0, y: 0, z: 0, extra: 1 } }, { unknownFeature: true }]) {
    const raw = { ...drive, components: drive.components.map((part, i) => i ? part : { ...part, ...patch }) }
    assert.throws(() => validateCadAssembly(raw as unknown as CadAssemblySpec))
  }
})
