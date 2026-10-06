import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { type CadAssemblySpec, validateCadAssembly } from '../src/cad-assembly.ts'

const example = JSON.parse(readFileSync(new URL('../../../../examples/cad/functional_linear_stage.json', import.meta.url), 'utf8')) as CadAssemblySpec

test('mechanical assembly accepts referenced features and a connected ground graph', () => {
  validateCadAssembly(example)
  const legacy = { ...example, mechanics: undefined }
  validateCadAssembly(legacy)
})

for (const failure of ['ground', 'feature', 'graph', 'id', 'fastener', 'clearance', 'one_feature', 'unknown_field']) test(`mechanical contract rejects ${failure}`, () => {
  const raw = structuredClone(example) as unknown as { mechanics: { grounded: string; connections: Record<string, unknown>[] } }
  if (failure === 'ground') raw.mechanics.grounded = 'screw'
  if (failure === 'feature') raw.mechanics.connections[0].firstFeature = 'missing'
  if (failure === 'graph') raw.mechanics.connections = [raw.mechanics.connections[0]]
  if (failure === 'id') raw.mechanics.connections[1].id = raw.mechanics.connections[0].id
  if (failure === 'fastener') raw.mechanics.connections[0].fastenerDiameter = 0
  if (failure === 'clearance') raw.mechanics.connections[0].maxClearance = 24
  if (failure === 'one_feature') raw.mechanics.connections[0].firstFeature = ''
  if (failure === 'unknown_field') raw.mechanics.connections[0].trustMe = true
  assert.throws(() => validateCadAssembly(raw as unknown as CadAssemblySpec))
})
