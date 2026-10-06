import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { CadAssemblySpec } from '../../domain/ts/src/cad-assembly.ts'
import type { CadCollision } from '../../domain/ts/src/cad-assembly-diagnostics.ts'
import { cylindricalFitStrategy } from '../src/assembly-fits.ts'

const zero = { x: 0, y: 0, z: 0 }
const bounds = { x: [-120, -100], y: [-45, 45], z: [0, 50] } as const
const spec: CadAssemblySpec = { schemaVersion: '4.0', units: 'mm', partId: 'stage', components: [
  { id: 'support_left', position: { x: -110, y: 0, z: 25 }, steps: [
    { id: 'body', op: 'base', shape: 'box', width: 20, depth: 90, height: 50, position: zero, rotation: zero },
    { id: 'bore', op: 'cut', shape: 'cylinder', diameter: 6, height: 8,
      position: { x: 0, y: 29, z: 20 }, rotation: { ...zero, y: 90 } },
  ] },
  { id: 'guide_shaft_1', position: { x: 0, y: 30, z: 45 }, steps: [
    { id: 'shaft', op: 'base', shape: 'cylinder', diameter: 8, height: 220, position: zero, rotation: { ...zero, y: 90 } },
  ] },
] }
const collision: CadCollision = { components: ['support_left', 'guide_shaft_1'], pose: 'current', message: 'Collision',
  overlapVolumeMm3: 325.72, componentVolumesMm3: [83049.84, 11058.41],
  overlapBoundsMm: { x: [-109.1, -100], y: [26, 34], z: [41, 49] },
  componentBoundsMm: [bounds, { x: [-110, 110], y: [26, 34], z: [41, 49] }] }

test('derives a bore from the actual shaft line, preserving placement and unrelated geometry', async () => {
  const input = structuredClone(spec)
  const checked: string[] = []
  const result = await cylindricalFitStrategy.propose(input, '', async (part) => { checked.push(part.partId); return null },
    async () => null, collision)
  assert.ok(result)
  assert.deepEqual(input, spec)
  assert.deepEqual(result.components[1], spec.components[1])
  assert.deepEqual(result.components[0].position, spec.components[0].position)
  assert.deepEqual(result.components[0].steps[0], spec.components[0].steps[0])
  const bore = result.components[0].steps[1]
  assert.equal(bore.id, 'bore')
  assert.equal(bore.shape, 'cylinder')
  if (bore.shape !== 'cylinder') return
  assert.equal(bore.height, 22)
  assert.equal(bore.diameter, 8.4)
  assert.deepEqual(bore.position, { x: 0, y: 30, z: 20 })
  assert.deepEqual(checked, ['support_left'])
})

test('requires geometry verification of both the repaired part and assembly', async () => {
  let assemblies = 0
  const failedPart = await cylindricalFitStrategy.propose(spec, '', async () => 'Disconnected',
    async () => { assemblies++; return null }, collision)
  assert.equal(failedPart, null)
  assert.equal(assemblies, 0)
  assert.equal(await cylindricalFitStrategy.propose(spec, '', async () => null, async () => 'Worse collision', collision), null)
})

test('does not erase a mating thread, create a bore for an orbiting shaft, or repair unstructured errors', async () => {
  const thread: CadAssemblySpec = { ...spec, components: spec.components.map((component, i) => i ? component : {
    ...component, steps: [component.steps[0], { id: 'thread', op: 'cut', shape: 'thread', diameter: 8, pitch: 1,
      height: 22, profile: 'metric', handedness: 'right', clearance: 0.1,
      position: { x: 0, y: 30, z: 20 }, rotation: { ...zero, y: 90 } }],
  }) }
  const orbit: CadAssemblySpec = { ...spec, components: spec.components.map((component, i) => !i ? component : {
    ...component, motion: { kind: 'rotary', axis: 'x', minimum: 0, maximum: 90, value: 0 },
    steps: component.steps.map((step) => ({ ...step, position: { ...step.position, y: 4 } })),
  }) }
  const check = async () => null
  const repeatedThread: CadAssemblySpec = { ...thread, components: thread.components.map((component, i) => i ? component : {
    ...component, steps: component.steps.map((step) => step.shape === 'thread' ? {
      ...step, pattern: { kind: 'linear', count: 2, offset: { x: 0, y: 20, z: 0 } },
    } : step),
  }) }
  for (const candidate of [thread, repeatedThread, orbit]) assert.equal(await cylindricalFitStrategy.propose(candidate, '', check, check, collision), null)
  assert.equal(await cylindricalFitStrategy.propose(spec, '', check, check), null)
})

test('does not drill a large arbitrary cavity through a small host', async () => {
  const larger = { ...spec, components: spec.components.map((component, i) => !i ? component : {
    ...component, steps: component.steps.map((step) => step.shape === 'cylinder' ? { ...step, diameter: 80 } : step),
  }) }
  const check = async () => null
  assert.equal(await cylindricalFitStrategy.propose(larger, '', check, check, collision), null)
})

test('a cylinder retains its fit envelope after subtractive features and coaxial conical ends', async () => {
  const shaft = spec.components[1].steps[0]
  const input = structuredClone({ ...spec, components: spec.components.map((component) => ({ ...component, steps: [...component.steps] })) })
  input.components[1].steps.push({ id: 'end', op: 'union', shape: 'cone', bottomDiameter: 7, topDiameter: 8,
    height: 0.5, position: { x: 109.9, y: 0, z: 0 }, rotation: shaft.rotation },
  { id: 'groove', op: 'cut', shape: 'box', width: 2, depth: 20, height: 20,
    position: { x: 100, y: 0, z: 0 }, rotation: zero })
  const result = await cylindricalFitStrategy.propose(input, '', async () => null, async () => null, collision)
  assert.ok(result)
  assert.deepEqual(result.components[1], input.components[1])
  const end = input.components[1].steps[1]
  for (const changed of [{ ...end, position: { x: 109.9, y: 5, z: 0 } },
    { ...end, topDiameter: 20 }, { ...end, rotation: zero },
    { ...end, pattern: { kind: 'linear', count: 2, offset: { x: 0, y: 5, z: 0 } } }]) {
    input.components[1].steps[1] = changed as typeof end
    assert.equal(await cylindricalFitStrategy.propose(input, '', async () => null, async () => null, collision), null)
  }
})

test('a collision at a travel extremity uses that pose rather than the current slider displacement', async () => {
  const input: CadAssemblySpec = { ...spec, components: spec.components.map((part, i) => i ? part : {
    ...part, motion: { kind: 'slider', axis: 'x', minimum: -2, maximum: 2, value: 1, group: 'slide', factor: -2 },
  }) }
  const atMinimum: CadCollision = { ...collision, pose: 'minimum', componentBoundsMm: [
    { ...bounds, x: [-116, -96] }, collision.componentBoundsMm[1],
  ] }
  const repaired = await cylindricalFitStrategy.propose(input, '', async () => null, async () => null, atMinimum)
  assert.ok(repaired)
  const bore = repaired.components[0].steps[1]
  assert.ok(bore.shape === 'cylinder')
  assert.deepEqual(bore.position, { x: 0, y: 30, z: 20 })
  assert.equal(bore.height, 22)
  assert.deepEqual(repaired.components[0].motion, input.components[0].motion)
})
