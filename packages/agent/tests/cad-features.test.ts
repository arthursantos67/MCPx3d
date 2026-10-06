import assert from 'node:assert/strict'
import { test } from 'node:test'
import features from '../../domain/fixtures/cad-program/features.json' with { type: 'json' }
import drive from '../../../examples/cad/threaded_drive.json' with { type: 'json' }
import { generateCadProgram } from '../src/generate-cad-program.ts'
import { generateCadAssembly } from '../src/generate-cad-assembly.ts'
import { MockLLMProvider } from '../src/mock-provider.ts'
import type { CadProgramSpec } from '../../domain/ts/src/cad-program.ts'

const response = (spec: unknown) => ({ decision: 'create', spec, question: '', assumptions: [] })
for (const spec of features) test(`agent preserves ${spec.partId} as a structured CAD feature`, async () => {
  const provider = new MockLLMProvider([response(spec)])
  const result = await generateCadProgram(provider, `Create ${spec.partId}`)
  assert.equal(result.kind, 'create')
  if (result.kind === 'create') assert.deepEqual(result.spec, spec)
  assert.equal(provider.calls.length, 1)
  assert.match(provider.calls[0].messages[0].content, /real helicoidal/)
})

test('a geometric repair cannot replace a threaded cut with a smooth bore', async () => {
  const component = drive.components[2]
  const spec = { schemaVersion: '3.0', units: 'mm', partId: component.id, steps: component.steps } as CadProgramSpec
  const smooth = { ...spec, steps: [spec.steps[0], { id: 'nut_thread', op: 'cut', shape: 'cylinder',
    position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, diameter: 12, height: 10 }] }
  const provider = new MockLLMProvider([response(smooth), response(smooth)])
  await assert.rejects(generateCadProgram(provider, 'Repair placement while preserving the requested thread', spec), /real thread/)
})

test('missing thread enum is repaired as an enum field while preserving dimensions', async () => {
  const spec = structuredClone(features.find((item) => item.partId === 'thread_metric_left')!)
  const incomplete = { ...spec, steps: spec.steps.map((step) => {
    const copy: Record<string, unknown> = { ...step }
    delete copy.handedness
    return copy
  }) }
  const provider = new MockLLMProvider([response(incomplete), response(incomplete), { step1_handedness: 'left' }])
  const result = await generateCadProgram(provider, 'Left-handed metric thread')
  assert.equal(result.kind, 'create')
  if (result.kind === 'create') assert.deepEqual(result.spec, spec)
  assert.match(JSON.stringify(provider.calls[2].schema), /"enum":\["right","left"\]/)
})

test('normalizes a Lite-model pattern and placement leak on a finishing operation', async () => {
  const spec = {
    schemaVersion: '3.0', units: 'mm', partId: 'end_support_left', steps: [
      { id: 'body', op: 'base', shape: 'box', position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, width: 40, depth: 30, height: 20 },
      { id: 'chamfer', op: 'union', shape: 'chamfer', position: { x: 12, y: 0, z: 5 }, rotation: { x: 0, y: 0, z: 15 },
        distance: 1, selector: 'top', pattern: { kind: 'linear', count: 4, offset: { x: 10, y: 0, z: 0 } } },
    ],
  }
  const provider = new MockLLMProvider([response(spec)])
  const result = await generateCadProgram(provider, 'Create a support with a 1 mm top chamfer')
  assert.equal(result.kind, 'create')
  if (result.kind === 'create') {
    assert.deepEqual(result.spec.steps[1], {
      id: 'chamfer', op: 'modify', shape: 'chamfer', position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 }, distance: 1, selector: 'top',
    })
  }
  assert.equal(provider.calls.length, 1)
})

test('assembly planner preserves scaled rotation and translation in a shared group', async () => {
  const plan = { decision: 'create', partId: drive.partId, question: '', assumptions: [], components: drive.components.map((component) => ({
    id: component.id, action: 'build', description: `Build ${component.id}`, position: component.position,
    motion: component.motion ? { ...component.motion, pitch: 0 } : { kind: 'fixed', axis: 'z', minimum: 0, maximum: 0, value: 0, pitch: 0, group: '', factor: 1 },
  })) }
  const provider = new MockLLMProvider([plan, ...drive.components.map((component) => response({
    schemaVersion: '3.0', units: 'mm', partId: component.id, steps: component.steps,
  }))])
  const result = await generateCadAssembly(provider, 'Lead screw driving a nonrotating nut', async () => null, async () => null)
  assert.equal(result.kind, 'create')
  if (result.kind === 'create') assert.deepEqual(result.spec, drive)
  assert.match(provider.calls[0].messages[0].content, /shaft factor = -360/)
})
