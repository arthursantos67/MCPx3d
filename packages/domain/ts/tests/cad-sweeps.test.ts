import assert from 'node:assert/strict'
import { test } from 'node:test'
import features from '../../fixtures/cad-program/features.json' with { type: 'json' }
import { validateCadProgram, type CadProgramSpec } from '../src/cad-program.ts'

test('swept profiles reject invalid walls, touching coils and malformed open paths', () => {
  for (const [id, patch] of [
    ['pipe_bend', { bendRadius: 6 }], ['pipe_bend', { innerDiameter: 12 }], ['pipe_bend', { bendAngle: 360 }],
    ['helical_spring', { pitch: 2 }], ['helical_spring', { turns: 33 }], ['helical_spring', { meanDiameter: 2 }],
    ['sweep', { innerDiameter: 6 }], ['sweep', { path: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }] }],
    ['sweep', { path: [{ x: 0, y: 0, z: 0 }] }], ['sweep', { path: [{ x: 0, y: 0, z: 0 }, { x: 0, z: 20 }] }],
  ] as const) {
    const spec = structuredClone(features.find((item) => item.partId === id)!)
    Object.assign(spec.steps[0], patch)
    assert.throws(() => validateCadProgram(spec as CadProgramSpec))
  }
})

test('spring turns and sweep segment budgets count every patterned instance', () => {
  for (const [id, count, limit] of [['helical_spring', 32, /64 spring turns/], ['sweep', 64, /128 sweep segments/]] as const) {
    const spec = structuredClone(features.find((item) => item.partId === id)!)
    const repeated = { ...spec.steps[0], id: 'repeated', op: 'union', pattern: { kind: 'linear', count, offset: { x: 10, y: 0, z: 0 } } }
    assert.throws(() => validateCadProgram({ ...spec, steps: [...spec.steps, repeated] } as CadProgramSpec), limit)
  }
})

test('a local edge region is optional, strict and ordered in component coordinates', () => {
  const spec = structuredClone(features.find((item) => item.partId === 'chamfer')!)
  const region = { min: { x: 19, y: 14, z: -1 }, max: { x: 21, y: 16, z: 1 } }
  const local = { ...spec, steps: spec.steps.map((step) => step.shape === 'chamfer' ? { ...step, selectionBox: region } : step) } as CadProgramSpec
  assert.doesNotThrow(() => validateCadProgram(local))
  const inverted = { ...local, steps: local.steps.map((step) => step.shape === 'chamfer' ? { ...step, selectionBox: { min: region.max, max: region.min } } : step) }
  assert.throws(() => validateCadProgram(inverted), /selectionBox/)
})
