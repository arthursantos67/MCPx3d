import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { CadDraftSnapshot } from '../../domain/ts/src/cad-draft.ts'
import type { CadProgramSpec } from '../../domain/ts/src/cad-program.ts'
import { generateCadAssembly } from '../src/generate-cad-assembly.ts'
import { CadDraftGenerationError } from '../src/cad-draft-generation.ts'
import { MockLLMProvider } from '../src/mock-provider.ts'
import { ProviderRequestError } from '../src/provider.ts'

const zero = { x: 0, y: 0, z: 0 }
const body = { id: 'body', op: 'base', shape: 'box', position: zero, rotation: zero, width: 20, depth: 20, height: 10 }
const components = ['pending', 'ready', 'also_ready'].map((id, index) => ({ id, action: 'build', description: 'Connected rectangular body',
  position: { ...zero, x: index * 50 }, motion: { kind: 'fixed', axis: 'z', minimum: 0, maximum: 0, value: 0, pitch: 0, group: '', factor: 1 } }))
const plan = { decision: 'create', partId: 'partial', components, question: '', assumptions: [], mechanics: null }
const creation = (id: string) => ({ decision: 'create', question: '', assumptions: [], spec: { schemaVersion: '3.0', units: 'mm', partId: id, steps: [body] } })
const policy = { retryInvalidStructuredOutput: false, maxCadRepairAttempts: 1 }

test('a geometric failure conserves its recipe, builds the other components, and resumes only the failed body', async () => {
  const provider = Object.assign(new MockLLMProvider([plan, ...components.map((item) => creation(item.id)), {
    decision: 'edit', partId: 'pending', replaceSteps: [{ ...body, height: 5 }], insertSteps: [], removeStepIds: [], question: '', assumptions: [],
  }]), { generationPolicy: policy })
  const snapshots: CadDraftSnapshot[] = []
  const checked: string[] = []
  const inspect = async (spec: CadProgramSpec) => {
    checked.push(spec.partId)
    return spec.partId === 'pending' && spec.steps[0].shape === 'box' && spec.steps[0].height === 10 ? 'CAD step body (base) produces an invalid or empty solid' : null
  }
  const options = { noQuestions: true, maxRepairAttempts: 0, allowUnverifiedDrafts: true, onDraft: (draft: CadDraftSnapshot) => snapshots.push(draft) }
  await assert.rejects(generateCadAssembly(provider, 'Monte três peças', inspect, async () => null, undefined, undefined, 0, options),
    (error: unknown) => {
      assert.ok(error instanceof CadDraftGenerationError)
      assert.equal(error.draft.spec.schemaVersion === '4.0' && error.draft.spec.components.length, 3)
      return true
    })
  assert.equal(provider.calls.length, 4)
  assert.deepEqual(checked, ['pending', 'ready', 'also_ready'])
  const result = await generateCadAssembly(provider, 'Monte três peças', inspect, async () => null, undefined, undefined, 0, options)
  assert.equal(result.kind, 'create')
  assert.equal(provider.calls.length, 5)
  assert.equal(checked.filter((id) => id === 'ready').length, 1)
  assert.equal(checked.filter((id) => id === 'also_ready').length, 1)
  assert.equal(snapshots.at(-1)?.spec.schemaVersion, '4.0')
})

test('quota stops continuation immediately while preserving the completed and rejected recipes', async () => {
  const provider = Object.assign(new MockLLMProvider([plan, creation('pending'), () => { throw new ProviderRequestError('status 429') }]), { generationPolicy: policy })
  const snapshots: CadDraftSnapshot[] = []
  await assert.rejects(generateCadAssembly(provider, 'Monte três peças', async () => 'CAD step body failed', async () => null,
    undefined, undefined, 0, { maxRepairAttempts: 0, allowUnverifiedDrafts: true, onDraft: (draft) => snapshots.push(draft) }), /status 429/)
  assert.equal(provider.calls.length, 3)
  const snapshot = snapshots.at(-1)
  assert.equal(snapshot?.spec.schemaVersion === '4.0' && snapshot.spec.components.length, 1)
})

test('unverified mechanical planning can produce a complete draft but cannot return an approved creation', async () => {
  const mechanics = { grounded: 'pending', connections: ['ready', 'also_ready'].map((second) => ({ id: `${second}_mount`,
    kind: 'fixed', first: 'pending', second, firstFeature: '', secondFeature: '', minEngagement: 1, maxClearance: .1,
    fastening: 'bonded', fastenerDiameter: 0 })) }
  const provider = Object.assign(new MockLLMProvider([plan, ...components.map((item) => creation(item.id)),
    { ...plan, mechanics, components: components.map((item) => ({ ...item, action: 'keep' })) }]), { generationPolicy: policy })
  const checked: string[] = []
  const inspect = async (spec: CadProgramSpec) => { checked.push(spec.partId); return null }
  const options = { maxRepairAttempts: 0, noQuestions: true, allowUnverifiedDrafts: true, requireMechanics: true }
  await assert.rejects(generateCadAssembly(provider, 'Monte três peças', inspect, async () => null, undefined, undefined, 0, options),
  (error: unknown) => error instanceof CadDraftGenerationError && /não declarou vínculos/.test(error.message))
  assert.equal(provider.calls.length, 4)
  const result = await generateCadAssembly(provider, 'Monte três peças', inspect, async () => null, undefined, undefined, 0, options)
  assert.equal(result.kind, 'create')
  assert.equal(provider.calls.length, 5)
  assert.deepEqual(checked, ['pending', 'ready', 'also_ready'])
})
