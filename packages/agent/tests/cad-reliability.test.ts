import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { CadProgramSpec } from '../../domain/ts/src/cad-program.ts'
import { generateCadProgram } from '../src/generate-cad-program.ts'
import { MockLLMProvider } from '../src/mock-provider.ts'
import { ProviderRequestError } from '../src/provider.ts'

const zero = { x: 0, y: 0, z: 0 }
const spec: CadProgramSpec = { schemaVersion: '3.0', units: 'mm', partId: 'bracket', steps: [
  { id: 'body', op: 'base', shape: 'box', position: zero, rotation: zero, width: 40, depth: 20, height: 10 },
] }
const create = { decision: 'create', spec, question: '', assumptions: [] }
const native = (responses: ConstructorParameters<typeof MockLLMProvider>[0]) => Object.assign(new MockLLMProvider(responses), {
  generationPolicy: { retryInvalidStructuredOutput: false, maxCadRepairAttempts: 1 },
})
const edit = (width: number) => ({ decision: 'edit', partId: spec.partId, replaceSteps: [{ ...spec.steps[0], width }],
  insertSteps: [], removeStepIds: [], question: '', assumptions: [] })

test('an explicit autonomous budget continues after an unchanged rejection and remembers failed geometry', async () => {
  const provider = native([create, edit(40), edit(30), edit(20)])
  const drafts: CadProgramSpec[] = []
  let checks = 0
  const result = await generateCadProgram(provider, 'Crie um suporte', undefined, async (spec) => {
    checks++
    return spec.steps[0].shape === 'box' && spec.steps[0].width === 20 ? null : 'CAD step body (base) produces an invalid or empty solid'
  }, { noQuestions: true, maxRepairAttempts: 3, onDraft: (spec) => drafts.push(spec) })
  assert.equal(result.kind, 'create')
  assert.equal(provider.calls.length, 4)
  assert.equal(checks, 3)
  assert.match(provider.calls[2].messages[1].content, /Previously rejected candidates/)
  assert.ok(drafts.length >= 3)
})

test('a stubborn provider exhausts a bounded budget without accepting geometry or rebuilding rejected candidates', async () => {
  const provider = native([create, edit(40), edit(40), edit(40)])
  let checks = 0
  await assert.rejects(generateCadProgram(provider, 'Crie um suporte', undefined,
    async () => { checks++; return 'CAD step body (base) produces an invalid or empty solid' },
    { maxRepairAttempts: 3, noQuestions: true }), /3 correções permitidas/)
  assert.equal(provider.calls.length, 4)
  assert.equal(checks, 1)
})

test('quota interrupts an expanded budget immediately and exposes the current draft', async () => {
  const provider = native([create, () => { throw new ProviderRequestError('status 429') }])
  const drafts: CadProgramSpec[] = []
  await assert.rejects(generateCadProgram(provider, 'Crie um suporte', undefined, async () => 'CAD step body failed',
    { maxRepairAttempts: 3, onDraft: (spec) => drafts.push(spec) }), /status 429/)
  assert.equal(provider.calls.length, 2)
  assert.deepEqual(drafts[0], spec)
})

test('the autonomous path repairs one valid JSON response with incomplete fields before building geometry', async () => {
  const malformed = { ...create, spec: { ...spec, steps: [{ ...spec.steps[0], height: null }] } }
  const provider = native([malformed, create])
  const result = await generateCadProgram(provider, 'Crie um suporte', undefined, async () => null, { maxRepairAttempts: 3, noQuestions: true })
  assert.equal(result.kind, 'create')
  assert.equal(provider.calls.length, 2)
})

test('case and surrounding whitespace in enumerated feature values do not consume a model correction', async () => {
  const thread = { id: 'body', op: 'base', shape: 'thread', position: zero, rotation: zero, diameter: 12, pitch: 2, height: 8,
    profile: 'metric', handedness: 'right', clearance: 0, starts: 1 }
  const loft = { id: 'body', op: 'base', shape: 'loft', position: zero, rotation: zero,
    sections: [{ kind: 'circle', z: 0, diameter: 20 }, { kind: 'circle', z: 8, diameter: 12 }], ruled: false }
  for (const [raw, expected] of [
    [{ ...spec.steps[0], shape: ' Box ', op: 'BASE' }, spec.steps[0]],
    [{ ...thread, shape: ' Thread ', op: 'BASE', profile: ' METRIC ', handedness: ' RIGHT ', starts: null }, thread],
    [{ ...loft, shape: ' Loft ', op: 'BASE', ruled: undefined }, loft],
  ]) {
    const provider = native([{ ...create, spec: { ...spec, steps: [raw] } }])
    const result = await generateCadProgram(provider, 'Crie um suporte', undefined, async () => null)
    assert.equal(result.kind, 'create')
    assert.equal(provider.calls.length, 1)
    if (result.kind === 'create') assert.deepEqual(result.spec, { ...spec, steps: [expected] })
  }
})
