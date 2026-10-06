import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { CadAssemblySpec } from '../../domain/ts/src/cad-assembly.ts'
import type { CadCollision } from '../../domain/ts/src/cad-assembly-diagnostics.ts'
import { threadedFitStrategy } from '../src/assembly-thread-fits.ts'
import { rotate, direction, axialRotation } from '../src/cad-spatial.ts'
import { generateCadAssembly } from '../src/generate-cad-assembly.ts'
import { MockLLMProvider } from '../src/mock-provider.ts'

const zero = { x: 0, y: 0, z: 0 }, rotation = { ...zero, y: 90 }
const spec: CadAssemblySpec = { schemaVersion: '4.0', units: 'mm', partId: 'generic', components: [
  { id: 'male', position: { ...zero, z: 20 }, motion: { kind: 'rotary', axis: 'x', minimum: -1, maximum: 1, value: 0.25, group: 'drive', factor: -120 }, steps: [
    { id: 'journal', op: 'base', shape: 'cylinder', diameter: 10, height: 60, position: zero, rotation },
    { id: 'helix', op: 'union', shape: 'thread', diameter: 12, pitch: 3, height: 48, profile: 'trapezoidal', handedness: 'right', starts: 1, clearance: 0, position: zero, rotation },
  ] },
  { id: 'female', position: { x: 2.3, y: 0, z: 20 }, motion: { kind: 'slider', axis: 'x', minimum: -1, maximum: 1, value: 0.25, group: 'drive', factor: 1 }, steps: [
    { id: 'body', op: 'base', shape: 'cylinder', diameter: 22, height: 18, position: zero, rotation },
    { id: 'internal_helix', op: 'cut', shape: 'thread', diameter: 12, pitch: 3, height: 18, profile: 'trapezoidal', handedness: 'right', starts: 1, clearance: 0.2, position: { ...zero, x: 9 }, rotation },
  ] },
  { id: 'support', position: { x: 200, y: 0, z: 0 }, steps: [
    { id: 'block', op: 'base', shape: 'box', width: 10, depth: 10, height: 10, position: zero, rotation: zero },
  ] },
] }
const collision: CadCollision = { components: ['male', 'female'], pose: 'current', message: 'CAD components male and female intersect at posição atual by 831 mm³',
  overlapVolumeMm3: 831, componentVolumesMm3: [30000, 5000], overlapBoundsMm: { x: [-6, 8], y: [-6, 6], z: [14, 26] },
  componentBoundsMm: [{ x: [-30, 30], y: [-6, 6], z: [14, 26] }, { x: [-6.45, 11.55], y: [-11, 11], z: [9, 31] }] }
const check = async () => null

test('repairs complementary threads without changing their specifications, journals, motion or unrelated bodies', async () => {
  const source = structuredClone(spec), parts: string[] = []
  let checks = 0
  const fixed = await threadedFitStrategy.propose(spec, '', async (part) => { parts.push(part.partId); return null },
    async () => { checks++; return null }, collision)
  assert.ok(fixed)
  assert.deepEqual(spec, source)
  assert.equal(fixed.components[0].steps[0], spec.components[0].steps[0])
  assert.equal(fixed.components[0].steps[2], spec.components[0].steps[1])
  assert.equal(fixed.components[0].steps[1].shape, 'tube')
  assert.equal(fixed.components[2], spec.components[2])
  assert.deepEqual(parts, ['male', 'female'])
  assert.equal(checks, 1)
  const thread = fixed.components[1].steps[1]
  assert.ok(thread.shape === 'thread')
  assert.equal(thread.id, 'internal_helix')
  for (const value of Object.values(thread.position)) assert.ok(Math.abs(value) < 1e-10)
  assert.equal(thread.height, 20)
  assert.equal(thread.clearance, 0.2)
  assert.equal(thread.pitch, 3)
  assert.deepEqual(direction(thread.rotation), direction(rotation))
  const expected = axialRotation(rotation, 360 * 2.3 / 3)
  const actualFrame = rotate({ x: 1, y: 0, z: 0 }, thread.rotation), expectedFrame = rotate({ x: 1, y: 0, z: 0 }, expected)
  for (const key of ['x', 'y', 'z'] as const) assert.ok(Math.abs(actualFrame[key] - expectedFrame[key]) < 1e-10)
  assert.equal(await threadedFitStrategy.propose(fixed, '', check, check, collision), null)
})

test('mismatched thread parameters, repeated holes, or incompatible motion never trigger a speculative repair', async () => {
  const invalid = [
    { diameter: 14 }, { pitch: 2 }, { profile: 'metric' }, { handedness: 'left' }, { starts: 2 },
    { pattern: { kind: 'linear', count: 2, offset: { x: 0, y: 30, z: 0 } } },
  ]
  for (const change of invalid) {
    const input = structuredClone({ ...spec, components: spec.components.map((component, i) => i !== 1 ? component : {
      ...component, steps: [component.steps[0], { ...component.steps[1], ...change }],
    }) }) as CadAssemblySpec
    assert.equal(await threadedFitStrategy.propose(input, '', check, check, collision), null)
  }
  for (const motion of [{ ...spec.components[0].motion!, factor: 120 }, { ...spec.components[0].motion!, group: 'other' }]) {
    const input = { ...spec, components: spec.components.map((component, i) => i ? component : { ...component, motion }) }
    assert.equal(await threadedFitStrategy.propose(input, '', check, check, collision), null)
  }
  assert.equal(await threadedFitStrategy.propose(spec, '', check, check), null)
})

test('invalid solids and assembly regressions reject the proposed fit before accepting any changes', async () => {
  let assemblies = 0
  assert.equal(await threadedFitStrategy.propose(spec, '', async () => 'Invalid solid', async () => { assemblies++; return null }, collision), null)
  assert.equal(assemblies, 0)
  assert.equal(await threadedFitStrategy.propose(spec, '', check, async () => 'Worse collision', collision), null)
})

test('unsafe core geometry and incomplete engagement are left for an explicit repair', async () => {
  const inputs: CadAssemblySpec[] = [10, 14].map((height) => ({ ...spec, components: spec.components.map((part, i) => i ? part : {
    ...part, steps: part.steps.map((step) => step.shape === 'thread' ? { ...step, height } : step),
  }) }))
  inputs.push(...[12, 14].map((diameter) => ({ ...spec, components: spec.components.map((part, i) => i ? part : {
    ...part, steps: part.steps.map((step) => step.shape === 'cylinder' ? { ...step, diameter } : step),
  }) })))
  inputs.push({ ...spec, components: spec.components.map((part, i) => i ? part : {
    ...part, steps: [...part.steps, { ...part.steps[0], id: 'core_after_thread', op: 'union' } as typeof part.steps[number]],
  }) })
  inputs.push({ ...spec, components: spec.components.map((part, i) => i ? part : {
    ...part, steps: [part.steps[0], { id: 'cross_piece', op: 'union', shape: 'box', width: 5, depth: 20, height: 20,
      position: zero, rotation: zero }, part.steps[1]],
  }) })
  for (const input of inputs) {
    let checks = 0
    assert.equal(await threadedFitStrategy.propose(input, '', async () => { checks++; return null }, check, collision), null)
    assert.equal(checks, 0)
  }
})

test('a correctly sized male core is preserved while only the internal thread is repaired', async () => {
  const input: CadAssemblySpec = { ...spec, components: spec.components.map((part, i) => i ? part : {
    ...part, steps: part.steps.map((step) => step.shape === 'cylinder' ? { ...step, diameter: 8.5 } : step),
  }) }
  const parts: string[] = []
  const fixed = await threadedFitStrategy.propose(input, '', async (part) => { parts.push(part.partId); return null }, check, collision)
  assert.ok(fixed)
  assert.equal(fixed.components[0], input.components[0])
  assert.deepEqual(parts, ['female'])
})

test('an endpoint thread collision produces the same local phase as a current-pose collision', async () => {
  const current = await threadedFitStrategy.propose(spec, '', check, check, collision)
  const minimum = await threadedFitStrategy.propose(spec, '', check, check, { ...collision, pose: 'minimum' })
  assert.ok(current && minimum)
  const a = current.components[1].steps[1], b = minimum.components[1].steps[1]
  assert.deepEqual(a.position, b.position)
  const frameA = rotate({ x: 1, y: 0, z: 0 }, a.rotation), frameB = rotate({ x: 1, y: 0, z: 0 }, b.rotation)
  for (const key of ['x', 'y', 'z'] as const) assert.ok(Math.abs(frameA[key] - frameB[key]) < 1e-10)
  assert.deepEqual(minimum.components[0].motion, spec.components[0].motion)
  assert.deepEqual(minimum.components[1].motion, spec.components[1].motion)
})

test('a threaded receiver never receives a generic rectangular relief when a helical fit is incompatible', async () => {
  const input: CadAssemblySpec = { ...spec, components: spec.components.map((part, i) => ({ ...part, motion: undefined,
    steps: part.steps.map((step) => i === 1 && step.shape === 'thread' ? { ...step, pitch: 2 } : step),
  })) }
  const issue: CadCollision = { ...collision, overlapVolumeMm3: 50, overlapBoundsMm: { x: [-0.2, 0.2], y: [-5, 5], z: [15, 25] },
    message: 'CAD components male and female intersect at posição atual by 50 mm³; component volumes: male=30000, female=5000 mm³; overlap fractions: male=0.0017, female=0.01; overlap bounds: x=[-0.2, 0.2], y=[-5, 5], z=[15, 25]' }
  const provider = new MockLLMProvider([{ decision: 'clarify', spec: null, question: 'Confirme o passo do par roscado', assumptions: [] }])
  const checked: string[] = []
  const outcome = await generateCadAssembly(provider, 'Corrija as interferências', async (part) => { checked.push(part.partId); return null },
    async (candidate) => JSON.stringify(candidate.components) === JSON.stringify(input.components) ? { message: issue.message, collisions: [issue] } : null,
    input, undefined, 0, { repairOnly: true })
  assert.equal(outcome.kind, 'clarify')
  assert.deepEqual(checked, ['female'])
  assert.equal(provider.calls.length, 1)
})

test('the coordinator fixes a threaded pair in repair mode without requesting any model response', async () => {
  const provider = new MockLLMProvider([])
  const outcome = await generateCadAssembly(provider, 'Corrija as interferências', check,
    async (candidate) => candidate.components[0].steps.some((step) => step.shape === 'tube') ? null : { message: collision.message, collisions: [collision] },
    spec, undefined, 0, { repairOnly: true })
  assert.ok(outcome.kind === 'create')
  assert.equal(provider.calls.length, 0)
})

test('axial phase rotation preserves arbitrary thread axes and rotates the complete local frame', () => {
  for (const orientation of [zero, rotation, { x: -90, y: 0, z: 0 }, { x: 17, y: 38, z: 29 }, { x: 0, y: -90, z: 0 }]) {
    for (const phase of [0, 30, 90, 180, -270]) {
      const rolled = axialRotation(orientation, phase)
      const actualAxis = direction(rolled), desiredAxis = direction(orientation)
      for (const key of ['x', 'y', 'z'] as const) assert.ok(Math.abs(actualAxis[key] - desiredAxis[key]) < 1e-10)
      const expected = rotate(rotate({ x: 1, y: 0, z: 0 }, { ...zero, z: phase }), orientation)
      const actual = rotate({ x: 1, y: 0, z: 0 }, rolled)
      for (const key of ['x', 'y', 'z'] as const) assert.ok(Math.abs(actual[key] - expected[key]) < 1e-10)
    }
  }
})
