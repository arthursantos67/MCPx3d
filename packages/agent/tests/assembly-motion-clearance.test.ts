import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { CadAssemblySpec } from '../../domain/ts/src/cad-assembly.ts'
import type { CadCollision } from '../../domain/ts/src/cad-assembly-diagnostics.ts'
import { motionClearanceStrategy } from '../src/assembly-motion-clearance.ts'
import { generateCadAssembly } from '../src/generate-cad-assembly.ts'
import { MockLLMProvider } from '../src/mock-provider.ts'

const zero = { x: 0, y: 0, z: 0 }, rotation = { ...zero, y: 90 }
const spec: CadAssemblySpec = { schemaVersion: '4.0', units: 'mm', partId: 'wheel_drive', components: [
  { id: 'base', position: { ...zero, z: 6 }, steps: [
    { id: 'plate', op: 'base', shape: 'box', width: 240, depth: 100, height: 12, position: zero, rotation: zero },
    { id: 'mount', op: 'cut', shape: 'cylinder', diameter: 6, height: 14, position: { ...zero, y: 32 }, rotation: zero },
  ] },
  { id: 'screw', position: { ...zero, z: 30 }, motion: { kind: 'rotary', axis: 'x', minimum: -35, maximum: 35, value: 0, group: 'drive', factor: -120 }, steps: [
    { id: 'wheel', op: 'base', shape: 'cylinder', diameter: 44, height: 8, position: { ...zero, x: -116 }, rotation },
    { id: 'shaft', op: 'union', shape: 'cylinder', diameter: 8.5, height: 240, position: zero, rotation },
    { id: 'helix', op: 'union', shape: 'thread', diameter: 12, height: 18, pitch: 3, profile: 'trapezoidal', handedness: 'right', clearance: 0, position: zero, rotation },
    { id: 'flat', op: 'cut', shape: 'box', width: 16, depth: 26, height: 6, position: { x: -116, y: 0, z: -20 }, rotation: zero },
  ] },
] }
const collision: CadCollision = { components: ['base', 'screw'], pose: 'minimum',
  message: 'CAD components base and screw intersect at curso mínimo by 481.79 mm³',
  overlapVolumeMm3: 481.79, componentVolumesMm3: [282651.67, 30598.51],
  overlapBoundsMm: { x: [-120, -112], y: [-12.65, 12.65], z: [8, 12] },
  componentBoundsMm: [{ x: [-120, 120], y: [-50, 50], z: [0, 12] }, { x: [-124, 124], y: [-22, 22], z: [8, 52] }] }
const check = async () => null

test('clears a stationary body for a rotating composite even when the current pose is clear', async () => {
  const before = structuredClone(spec)
  const checked: string[] = []
  const repaired = await motionClearanceStrategy.propose(spec, '', async (part) => { checked.push(part.partId); return null }, check, collision)
  assert.ok(repaired)
  assert.deepEqual(spec, before)
  assert.equal(repaired.components[1], spec.components[1])
  assert.deepEqual(repaired.components[0].steps.slice(0, -1), spec.components[0].steps)
  assert.deepEqual(repaired.components[0].position, spec.components[0].position)
  const tool = repaired.components[0].steps.at(-1)!
  assert.ok(tool.shape === 'cylinder')
  assert.equal(tool.diameter, 44.4)
  assert.equal(tool.height, 8.4)
  assert.deepEqual(tool.position, { x: -116, y: 0, z: 24 })
  assert.deepEqual(checked, ['base'])
})

test('the coordinator repairs travel collisions without inference for every provider policy', async () => {
  for (const native of [false, true]) {
    const provider = new MockLLMProvider([])
    if (native) Object.assign(provider, { generationPolicy: { retryInvalidStructuredOutput: false, maxCadRepairAttempts: 1 } })
    const result = await generateCadAssembly(provider, 'Corrija as interferências', check,
      async (candidate) => candidate.components[0].steps.length > spec.components[0].steps.length ? null : { message: collision.message, collisions: [collision] },
      spec, undefined, 0, { repairOnly: true })
    assert.equal(result.kind, 'create')
    assert.equal(provider.calls.length, 0)
  }
})

test('rejects threaded hosts, orbiting or patterned tools, excessive removals, invalid solids and regressions', async () => {
  const threadedHost: CadAssemblySpec = { ...spec, components: spec.components.map((part, i) => i ? part : {
    ...part, steps: [...part.steps, { ...spec.components[1].steps[2], id: 'internal', op: 'cut' } as typeof part.steps[number]],
  }) }
  const orbit: CadAssemblySpec = { ...spec, components: spec.components.map((part, i) => !i ? part : {
    ...part, steps: part.steps.map((step) => ({ ...step, position: { ...step.position, y: 4 } })),
  }) }
  const repeated: CadAssemblySpec = { ...spec, components: spec.components.map((part, i) => !i ? part : {
    ...part, steps: part.steps.map((step) => ({ ...step, pattern: { kind: 'linear', count: 2, offset: { ...zero, y: 20 } } })),
  }) }
  for (const input of [threadedHost, orbit, repeated]) assert.equal(await motionClearanceStrategy.propose(input, '', check, check, collision), null)
  assert.equal(await motionClearanceStrategy.propose(spec, '', check, check, { ...collision, componentVolumesMm3: [100, 30000] }), null)
  assert.equal(await motionClearanceStrategy.propose(spec, '', async () => 'Disconnected', check, collision), null)
  assert.equal(await motionClearanceStrategy.propose(spec, '', check, async () => 'Worse', collision), null)
  assert.equal(await motionClearanceStrategy.propose(spec, '', check, check), null)
})
