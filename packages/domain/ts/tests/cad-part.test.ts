import assert from 'node:assert/strict'
import { test } from 'node:test'

import { Ajv2020 } from 'ajv/dist/2020.js'

import { type CadPartSpec, CadPartValidationError, validateCadPartDomainRules } from '../src/cad-part.ts'
import { FIXTURES_DIR, SCHEMAS_DIR, loadJson } from './support.ts'

const part = loadJson<CadPartSpec>(FIXTURES_DIR, 'cad-part', 'valid-plate.json')

test('accepts the CAD plate example', () => {
  const ajv = new Ajv2020()
  const schema = loadJson(SCHEMAS_DIR, 'cad-part.v2.schema.json')
  assert.equal(ajv.compile(schema as object)(part), true)
  assert.doesNotThrow(() => validateCadPartDomainRules(part))
})

test('rejects a hole that crosses an edge', () => {
  const invalid = { ...part, features: [{ ...part.features[0], x: 45 }] } as CadPartSpec
  assert.throws(() => validateCadPartDomainRules(invalid), CadPartValidationError)
})

test('rejects nonfinite dimensions and coordinates', () => {
  assert.throws(() => validateCadPartDomainRules({ ...part, base: { ...part.base, width: NaN } }), CadPartValidationError)
  assert.throws(() => validateCadPartDomainRules({ ...part, features: [{ ...part.features[0], y: Infinity }] }), CadPartValidationError)
})

test('accepts mounting plate and rejects overlapping holes', () => {
  const mounting = loadJson<CadPartSpec>(FIXTURES_DIR, 'cad-part', 'valid-mounting-plate.json')
  const schema = loadJson(SCHEMAS_DIR, 'cad-part.v2.1.schema.json')
  assert.equal(new Ajv2020().compile(schema as object)(mounting), true)
  assert.doesNotThrow(() => validateCadPartDomainRules(mounting))
  const invalid: CadPartSpec = {
    ...mounting,
    features: [mounting.features[0], { ...mounting.features[1], x: -40 }, ...mounting.features.slice(2)],
  }
  assert.throws(() => validateCadPartDomainRules(invalid), CadPartValidationError)
})

test('accepts an L bracket and rejects wall or hole collisions', () => {
  const bracket = loadJson<CadPartSpec>(FIXTURES_DIR, 'cad-part', 'valid-l-bracket.json')
  const schema = loadJson(SCHEMAS_DIR, 'cad-part.v2.2.schema.json')
  assert.equal(new Ajv2020().compile(schema as object)(bracket), true)
  assert.doesNotThrow(() => validateCadPartDomainRules(bracket))
  assert.throws(() => validateCadPartDomainRules({ ...bracket, features: [
    { ...bracket.features[0], y: 30 }, ...bracket.features.slice(1),
  ] }), CadPartValidationError)
  assert.throws(() => validateCadPartDomainRules({ ...bracket, upright: {
    ...bracket.upright!, holes: [{ ...bracket.upright!.holes[0], z: 10 }, ...bracket.upright!.holes.slice(1)],
  } }), CadPartValidationError)
})

test('accepts rounded plates and circular flanges and rejects holes outside their curves', () => {
  const schema = loadJson(SCHEMAS_DIR, 'cad-part.v2.3.schema.json')
  for (const name of ['valid-rounded-plate.json', 'valid-round-flange.json']) {
    const curved = loadJson<CadPartSpec>(FIXTURES_DIR, 'cad-part', name)
    assert.equal(new Ajv2020().compile(schema as object)(curved), true)
    assert.doesNotThrow(() => validateCadPartDomainRules(curved))
    assert.throws(() => validateCadPartDomainRules({ ...curved, features: [
      { ...curved.features[0], x: curved.base.width / 2 - 5, y: curved.base.depth / 2 - 5 },
      ...curved.features.slice(1),
    ] }), CadPartValidationError)
    if (curved.base.kind === 'extruded_disc') {
      assert.throws(() => validateCadPartDomainRules({ ...curved, base: { ...curved.base, depth: curved.base.depth + 1 } }), CadPartValidationError)
    }
  }
})

test('composite bosses fuse inside the profile and avoid partial hole cuts', () => {
  const composite = loadJson<CadPartSpec>(FIXTURES_DIR, 'cad-part', 'valid-composite-part.json')
  const schema = loadJson(SCHEMAS_DIR, 'cad-part.v2.4.schema.json')
  assert.equal(new Ajv2020().compile(schema as object)(composite), true)
  assert.doesNotThrow(() => validateCadPartDomainRules(composite))
  assert.throws(() => validateCadPartDomainRules({ ...composite, features: [
    { ...composite.features[0], x: 18 }, ...composite.features.slice(1),
  ] }), CadPartValidationError)
  assert.throws(() => validateCadPartDomainRules({ ...composite, bosses: [
    { ...composite.bosses![0], x: 50 },
  ] }), CadPartValidationError)
})
