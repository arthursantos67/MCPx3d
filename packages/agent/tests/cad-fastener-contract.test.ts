import assert from 'node:assert/strict'
import { test } from 'node:test'
import mount from '../../../examples/cad/threaded_blind_mount.json' with { type: 'json' }
import failed from '../../../tests/fixtures/cad/m4-contract-regression.json' with { type: 'json' }
import prompts from '../../../tests/golden/cad-benchmark-prompts.json' with { type: 'json' }
import type { CadAssemblySpec } from '../../domain/ts/src/cad-assembly.ts'
import { prepareFastenerContract } from '../src/cad-fastener-contract.ts'

function tightContract(): CadAssemblySpec {
  const spec = mount as CadAssemblySpec
  return { ...spec, mechanics: { ...spec.mechanics!, connections: spec.mechanics!.connections.map((joint) => ({ ...joint, maxClearance: .1 })) } }
}

test('inferred screw-passage bounds reconcile with existing bores without changing any geometry', () => {
  const previous = tightContract()
  const result = prepareFastenerContract(previous, 'Monte a placa sobre a base com M4 e passagens de 4,5 mm')
  assert.equal(result.spec.mechanics!.connections[0].maxClearance, .25)
  assert.deepEqual(result.spec.components, previous.components)
  assert.equal(result.spec.mechanics!.connections[0].minEngagement, previous.mechanics!.connections[0].minEngagement)
  assert.equal(result.assumptions.length, 1)
  assert.equal(previous.mechanics!.connections[0].maxClearance, .1)
})

test('explicit clearance/tolerance limits and excessively large bores remain authoritative', () => {
  const previous = tightContract()
  for (const request of ['Folga máxima 0,1 mm', 'Use clearance=0.1 mm', 'Tolerância de 0,1 mm', 'Folgas limitadas a 0,1 mm']) {
    assert.equal(prepareFastenerContract(previous, request).spec, previous)
  }
  const joint = previous.mechanics!.connections[0]
  const oversize = { ...previous, components: previous.components.map((component) => component.id !== joint.first ? component : {
    ...component, steps: component.steps.map((step) => step.id === joint.firstFeature && step.shape === 'hole' ? { ...step, diameter: 6 } : step),
  }) }
  assert.equal(prepareFastenerContract(oversize, 'Use M4').spec, oversize)
})

test('an already compatible contract does not change or invent a new assumption', () => {
  const spec = mount as CadAssemblySpec
  assert.deepEqual(prepareFastenerContract(spec, 'Monte as peças'), { spec, assumptions: [] })
})

test('an explicitly dimensioned screw passage and a smaller thread clearance coexist', () => {
  const spec = tightContract()
  const result = prepareFastenerContract(spec, 'Use furos passantes de 4,5 mm para M4 e roscas M4 com folga radial de 0,1 mm')
  assert.equal(result.spec.mechanics!.connections[0].maxClearance, .25)
  assert.deepEqual(result.spec.components, spec.components)
  assert.equal(prepareFastenerContract(spec, 'Use furos de 4,5 mm com folga máxima de 0,1 mm').spec, spec)
  assert.equal(prepareFastenerContract(spec, 'Use holes of 4.5 mm with maximum radial clearance 0.1 mm').spec, spec)
  assert.equal(prepareFastenerContract(spec, 'Use furos de 4,5 mm com limite de folga 0,1 mm').spec, spec)
})

test('the rejected real-provider candidate is repaired without modifying geometry or engagement', () => {
  const previous = failed as CadAssemblySpec
  const request = prompts.find((item) => item.id === 'blind-threaded-base-mount')!.request
  const { spec, assumptions } = prepareFastenerContract(previous, request)
  assert.equal(spec.mechanics!.connections[0].maxClearance, .25)
  assert.deepEqual(spec.components, previous.components)
  assert.equal(spec.mechanics!.connections[0].minEngagement, 6)
  assert.equal(assumptions.length, 1)
})
