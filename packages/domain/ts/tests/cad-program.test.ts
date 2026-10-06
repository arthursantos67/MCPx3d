import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Ajv2020 } from 'ajv/dist/2020.js'
import schema from '../../schemas/cad-program.v3.schema.json' with { type: 'json' }
import { validateCadProgram, type CadProgramSpec } from '../src/cad-program.ts'

const spec: CadProgramSpec = {
  schemaVersion: '3.0', units: 'mm', partId: 'custom_mount', steps: [
    { id: 'profile', op: 'base', shape: 'polygon_prism', position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 },
      points: [{ x: -20, y: -10 }, { x: 20, y: -10 }, { x: 20, y: 10 }, { x: -20, y: 10 }], height: 8 },
    { id: 'hole', op: 'cut', shape: 'cylinder', position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, diameter: 5, height: 20 },
  ],
}

test('shared schema and domain accept a custom extruded profile', () => {
  assert.equal(new Ajv2020().compile(schema)(spec), true)
  assert.doesNotThrow(() => validateCadProgram(spec))
})

test('program rejects duplicate IDs, empty profiles and bad dimensions', () => {
  assert.throws(() => validateCadProgram({ ...spec, steps: [spec.steps[0], { ...spec.steps[1], id: 'profile' }] }), /unique/)
  assert.throws(() => validateCadProgram({ ...spec, steps: [{ ...spec.steps[0], points: [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }] } as CadProgramSpec['steps'][number]] }), /enclose/)
  assert.throws(() => validateCadProgram({ ...spec, steps: [{ ...spec.steps[0], height: -1 } as CadProgramSpec['steps'][number]] }), /dimensions/)
})

test('patterns repeat any cut or union while keeping the base unique', () => {
  const patterned: CadProgramSpec = { ...spec, steps: [spec.steps[0], {
    ...spec.steps[1], pattern: { kind: 'circular', count: 4, axis: 'z', center: { x: 0, y: 0, z: 0 } },
  }] }
  assert.equal(new Ajv2020().compile(schema)(patterned), true)
  assert.doesNotThrow(() => validateCadProgram(patterned))
  assert.throws(() => validateCadProgram({ ...spec, steps: [{ ...spec.steps[0], pattern: { kind: 'circular', count: 4 } }] }), /base pattern/)
  assert.throws(() => validateCadProgram({ ...spec, steps: [spec.steps[0], {
    ...spec.steps[1], pattern: { kind: 'linear', count: 4, offset: { x: 0, y: 0, z: 0 } },
  }] }), /linear pattern/)
})

test('runtime CAD validation enforces the shared strict structure for imported JSON', () => {
  const malformed = [
    { ...spec, partId: 123 },
    { ...spec, unexpected: true },
    { ...spec, steps: [{ ...spec.steps[0], diameter: 10 }] },
    { ...spec, steps: [{ ...spec.steps[0], position: { x: 0, y: 0 } }] },
    { ...spec, steps: [{ ...spec.steps[0], position: { x: 0, y: 0, z: 0, extra: 1 } }] },
    { ...spec, steps: [{ ...spec.steps[0], points: [{ x: 0, y: 0 }, { x: 20, y: 0, extra: 1 }, { x: 0, y: 20 }] }] },
  ]
  for (const raw of malformed) assert.throws(() => validateCadProgram(raw as unknown as CadProgramSpec))
})
