import assert from 'node:assert/strict'
import { test } from 'node:test'
import { generateCadProgram } from '../src/generate-cad-program.ts'
import { MockLLMProvider } from '../src/mock-provider.ts'
import { ProviderRequestError } from '../src/provider.ts'
import type { CadProgramSpec } from '../../domain/ts/src/cad-program.ts'

class NativeMock extends MockLLMProvider {
  readonly generationPolicy = { retryInvalidStructuredOutput: false, maxCadRepairAttempts: 1 }
}
const zero = { x: 0, y: 0, z: 0 }
const spec: CadProgramSpec = { schemaVersion: '3.0', units: 'mm', partId: 'support', steps: [
  { id: 'body', op: 'base', shape: 'box', position: zero, rotation: zero, width: 40, depth: 30, height: 20 },
  { id: 'bore', op: 'cut', shape: 'cylinder', position: zero, rotation: zero, diameter: 5, height: 22 },
  { id: 'threaded_hole', op: 'cut', shape: 'thread', position: { ...zero, x: 10 }, rotation: zero,
    diameter: 5, height: 10, pitch: 0.8, starts: 1, handedness: 'right', profile: 'metric', clearance: 0.1 },
  { id: 'finish', op: 'modify', shape: 'chamfer', position: zero, rotation: zero, selector: 'top', distance: 0.5 },
] }
const patch = { decision: 'edit', partId: spec.partId, replaceSteps: [], insertSteps: [], removeStepIds: [], question: '', assumptions: [] }

test('native edits retain omitted steps and apply only identified changes, without an extra model call', async () => {
  const source = structuredClone(spec)
  const replacement = { ...spec.steps[1], diameter: 6 }
  const relief = { ...spec.steps[1], id: 'relief', diameter: 8, height: 2 }
  const provider = new NativeMock([{ ...patch, replaceSteps: [replacement], insertSteps: [{ afterStepId: 'bore', step: relief }] }])
  const checked: CadProgramSpec[] = []
  const result = await generateCadProgram(provider, 'Corrija o encaixe', spec, async (candidate) => { checked.push(candidate); return null })
  assert.equal(result.kind, 'create')
  if (result.kind === 'create') {
    assert.deepEqual(result.spec.steps.map((step) => step.id), ['body', 'bore', 'relief', 'threaded_hole', 'finish'])
    assert.deepEqual(result.spec.steps[0], spec.steps[0])
    assert.deepEqual(result.spec.steps[3], spec.steps[2])
    assert.deepEqual(result.spec.steps[4], spec.steps[3])
    assert.deepEqual(result.spec.steps[1], replacement)
    assert.equal(checked.at(-1)?.steps.length, 5)
  }
  assert.deepEqual(spec, source)
  assert.equal(provider.calls.length, 1)
  assert.match(JSON.stringify(provider.calls[0].schema), /replaceSteps/)
  assert.match(provider.calls[0].messages[0].content, /Unmentioned steps are retained automatically/)
})

test('insertions retain declared order and can refer to a preceding insertion', async () => {
  const a = { ...spec.steps[1], id: 'a' }, b = { ...spec.steps[1], id: 'b' }, c = { ...spec.steps[1], id: 'c' }
  const provider = new NativeMock([{ ...patch, insertSteps: [
    { afterStepId: 'bore', step: a }, { afterStepId: 'bore', step: b }, { afterStepId: 'a', step: c },
  ] }])
  const result = await generateCadProgram(provider, 'Acrescente recursos', spec)
  assert.ok(result.kind === 'create')
  assert.deepEqual(result.spec.steps.map((step) => step.id), ['body', 'bore', 'a', 'c', 'b', 'threaded_hole', 'finish'])
})

test('unauthorized explicit removals and smooth replacements for threads remain rejected', async () => {
  for (const changes of [
    { removeStepIds: ['finish'] }, { removeStepIds: ['threaded_hole'] },
    { replaceSteps: [{ ...spec.steps[1], id: 'threaded_hole' }] },
  ]) {
    const provider = new NativeMock([{ ...patch, ...changes }])
    await assert.rejects(generateCadProgram(provider, 'Corrija o encaixe', spec), ProviderRequestError)
    assert.equal(provider.calls.length, 1)
  }
})

test('an authorized removal is applied explicitly and does not remove other features', async () => {
  const provider = new NativeMock([{ ...patch, removeStepIds: ['bore'] }])
  const result = await generateCadProgram(provider, 'Remova o furo bore', spec)
  assert.ok(result.kind === 'create')
  assert.deepEqual(result.spec.steps.map((step) => step.id), ['body', 'threaded_hole', 'finish'])
})

test('instructions not to remove features do not authorize deleting a thread', async () => {
  for (const request of ['Corrija o encaixe, não remova a rosca.', 'Repair without removing threads.', 'Do not remove any existing feature.']) {
    const provider = new NativeMock([{ ...patch, removeStepIds: ['threaded_hole'] }])
    await assert.rejects(generateCadProgram(provider, request, spec), ProviderRequestError)
    assert.equal(provider.calls.length, 1)
  }
})

test('invalid, duplicate, conflicting, excessive and unknown edit references stop before checking proposed geometry', async () => {
  const invalid = [
    { replaceSteps: [{ ...spec.steps[1], id: 'renamed' }] },
    { replaceSteps: [spec.steps[1], spec.steps[1]] },
    { replaceSteps: [spec.steps[1]], removeStepIds: ['bore'] },
    { removeStepIds: ['unknown'] }, { removeStepIds: ['bore', 'bore'] },
    { insertSteps: [{ afterStepId: 'unknown', step: { ...spec.steps[1], id: 'new' } }] },
    { insertSteps: [{ afterStepId: 'body', step: spec.steps[1] }] },
    { insertSteps: [{ afterStepId: 'body', step: { ...spec.steps[1], id: 'new', diameter: -1 } }] },
    { replaceSteps: Array(33).fill(spec.steps[1]) }, { commands: ['execute'] }, { partId: 'other' },
  ]
  for (const fields of invalid) {
    const provider = new NativeMock([{ ...patch, ...fields }])
    let checks = 0
    await assert.rejects(generateCadProgram(provider, 'Corrija o encaixe', spec, async () => { checks++; return null }), ProviderRequestError)
    assert.equal(checks, 1)
    assert.equal(provider.calls.length, 1)
  }
})

test('native edit clarification uses the edit envelope without another request', async () => {
  const provider = new NativeMock([{ ...patch, decision: 'clarify', question: 'Qual encaixe deve mudar?' }])
  assert.deepEqual(await generateCadProgram(provider, 'Altere o encaixe conflitante', spec), { kind: 'clarify', question: 'Qual encaixe deve mudar?' })
  assert.equal(provider.calls.length, 1)
})

test('a native topology correction can explicitly remove an obstructing cut and keeps other steps', async () => {
  const provider = new NativeMock([{ ...patch, removeStepIds: ['bore'] }])
  const result = await generateCadProgram(provider, 'Corrija o sólido desconectado', spec,
    async (candidate) => candidate.steps.some((step) => step.id === 'bore') ? 'CAD step bore (cut) leaves 2 separate solids' : null)
  assert.ok(result.kind === 'create')
  assert.deepEqual(result.spec.steps.map((step) => step.id), ['body', 'threaded_hole', 'finish'])
  assert.equal(provider.calls.length, 1)
})

test('HTTP edits retain their complete-program contract and preservation checks', async () => {
  const response = { decision: 'create', spec: { ...spec, steps: [spec.steps[0]] }, question: '', assumptions: [] }
  const provider = new MockLLMProvider([response, response])
  await assert.rejects(generateCadProgram(provider, 'Corrija o encaixe', spec), /unexpectedly removed/)
  assert.equal(provider.calls.length, 2)
  assert.doesNotMatch(JSON.stringify(provider.calls[0].schema), /replaceSteps/)
})
