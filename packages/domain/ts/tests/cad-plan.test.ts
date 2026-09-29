import assert from 'node:assert/strict'
import { test } from 'node:test'

import { Ajv2020 } from 'ajv/dist/2020.js'

import { validateCadEditPlan, type CadEditPlan } from '../src/cad-plan.ts'
import { FIXTURES_DIR, SCHEMAS_DIR, loadJson } from './support.ts'

test('shared CAD plan fixtures enforce the command set', () => {
  const schema = loadJson(SCHEMAS_DIR, 'cad-plan.v1.schema.json')
  const validate = new Ajv2020().compile(schema as object)
  const valid = loadJson<CadEditPlan>(FIXTURES_DIR, 'cad-plan', 'valid-edit.json')
  const invalid = loadJson(FIXTURES_DIR, 'cad-plan', 'invalid-op.json')
  assert.equal(validate(valid), true)
  assert.doesNotThrow(() => validateCadEditPlan(valid))
  assert.equal(validate(invalid), false)
})

test('duplicate CAD parameters cannot share one revision', () => {
  assert.throws(() => validateCadEditPlan({ schemaVersion: '1.0', operations: [
    { op: 'set_parameter', parameter: 'width', value: 120 },
    { op: 'set_parameter', parameter: 'width', value: 140 },
  ] }))
})

test('mounting edit plan has closed operations and unique hole targets', () => {
  const schema = loadJson(SCHEMAS_DIR, 'cad-plan.v2.schema.json')
  const plan = loadJson<CadEditPlan>(FIXTURES_DIR, 'cad-plan', 'valid-mounting-edit.json')
  assert.equal(new Ajv2020().compile(schema as object)(plan), true)
  assert.doesNotThrow(() => validateCadEditPlan(plan))
  assert.throws(() => validateCadEditPlan({ schemaVersion: '2.0', operations: [
    { op: 'upsert_hole', holeId: 'hole_2', x: 0, y: 0, diameter: 8 },
    { op: 'remove_hole', holeId: 'hole_2' },
  ] }))
})

test('bracket edit plan validates wall operations and unique targets', () => {
  const schema = loadJson(SCHEMAS_DIR, 'cad-plan.v3.schema.json')
  const plan = loadJson<CadEditPlan>(FIXTURES_DIR, 'cad-plan', 'valid-bracket-edit.json')
  assert.equal(new Ajv2020().compile(schema as object)(plan), true)
  assert.doesNotThrow(() => validateCadEditPlan(plan))
  assert.throws(() => validateCadEditPlan({ schemaVersion: '3.0', operations: [
    { op: 'upsert_upright_hole', holeId: 'wall_hole_1', x: 0, z: 30, diameter: 8 },
    { op: 'remove_upright_hole', holeId: 'wall_hole_1' },
  ] }))
  assert.throws(() => validateCadEditPlan({ schemaVersion: '2.0', operations: plan.operations }))
})

test('curved edit plan validates diameter and radius operations', () => {
  const schema = loadJson(SCHEMAS_DIR, 'cad-plan.v4.schema.json')
  const plan = loadJson<CadEditPlan>(FIXTURES_DIR, 'cad-plan', 'valid-curved-edit.json')
  assert.equal(new Ajv2020().compile(schema as object)(plan), true)
  assert.doesNotThrow(() => validateCadEditPlan(plan))
  assert.throws(() => validateCadEditPlan({ schemaVersion: '3.0', operations: plan.operations }))
  assert.throws(() => validateCadEditPlan({ schemaVersion: '4.0', operations: [
    { op: 'set_corner_radius', value: 10 }, { op: 'set_corner_radius', value: 12 },
  ] }))
})

test('composite edit plan validates boss operations', () => {
  const schema = loadJson(SCHEMAS_DIR, 'cad-plan.v5.schema.json')
  const plan = loadJson<CadEditPlan>(FIXTURES_DIR, 'cad-plan', 'valid-composite-edit.json')
  assert.equal(new Ajv2020().compile(schema as object)(plan), true)
  assert.doesNotThrow(() => validateCadEditPlan(plan))
  assert.throws(() => validateCadEditPlan({ schemaVersion: '4.0', operations: plan.operations }))
  assert.throws(() => validateCadEditPlan({ schemaVersion: '5.0', operations: [
    { op: 'upsert_boss', bossId: 'boss_1', x: 0, y: 0, diameter: 40, height: 20 },
    { op: 'remove_boss', bossId: 'boss_1' },
  ] }))
})
