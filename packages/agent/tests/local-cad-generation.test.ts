import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MockLLMProvider } from '../src/mock-provider.ts'
import { ProviderRequestError } from '../src/provider.ts'
import { generateCadProgram } from '../src/generate-cad-program.ts'
import { CadAssemblyPausedError, generateCadAssembly, type CadAssemblyProgress } from '../src/generate-cad-assembly.ts'
import type { CadAssemblySpec } from '../../domain/ts/src/cad-assembly.ts'
import type { CadAssemblyIssue, CadCollision } from '../../domain/ts/src/cad-assembly-diagnostics.ts'
import { LocalCliProvider } from '../src/local-cli-provider.ts'
import { generateModelPlan } from '../src/generate-model-plan.ts'
import { generateScene } from '../src/generate-scene.ts'
import type { ModelSpec } from '../../domain/ts/src/model-spec.ts'

const zero = { x: 0, y: 0, z: 0 }
const spec = { schemaVersion: '3.0', units: 'mm', partId: 'support', steps: [{
  id: 'body', op: 'base', shape: 'box', position: zero, rotation: zero, width: 50, depth: 30, height: 20,
}] }
const response = { decision: 'create', spec, question: '', assumptions: [] }
const policy = { retryInvalidStructuredOutput: false, maxCadRepairAttempts: 1, maxSceneRepairAttempts: 1 }
class SubscriptionMock extends MockLLMProvider { readonly generationPolicy = policy }

test('subscription format errors do not trigger another model request; external providers retain their repair', async () => {
  const invalid = { ...response, spec: { ...spec, steps: [{ ...spec.steps[0], width: -5 }] } }
  const local = new SubscriptionMock([invalid, response])
  await assert.rejects(generateCadProgram(local, 'Crie um suporte'), ProviderRequestError)
  assert.equal(local.calls.length, 1)
  const external = new MockLLMProvider([invalid, response])
  assert.equal((await generateCadProgram(external, 'Crie um suporte')).kind, 'create')
  assert.equal(external.calls.length, 2)
})

test('subscription geometry corrections are bounded and the next action resumes the saved candidate', async () => {
  const fixed = { ...response, spec: { ...spec, steps: [{ ...spec.steps[0], height: 10 }] } }
  const local = new SubscriptionMock([response, response, fixed])
  const inspect = async (candidate: typeof spec) => candidate.steps[0].height === 10 ? null : 'CAD step body failed: a deterministic engine rejection'
  await assert.rejects(generateCadProgram(local, 'Crie um suporte', undefined, inspect as never), ProviderRequestError)
  assert.equal(local.calls.length, 2)
  assert.equal((await generateCadProgram(local, 'Crie um suporte', undefined, inspect as never)).kind, 'create')
  assert.equal(local.calls.length, 3)
  assert.match(local.calls[2].messages[1].content, /Current CAD program/)
})

test('subscription clarification and invalid assembly planning consume one request each', async () => {
  const clarify = { decision: 'clarify', spec: null, question: 'Quais requisitos devem ser priorizados?', assumptions: [] }
  const local = new SubscriptionMock([clarify])
  assert.equal((await generateCadProgram(local, 'Pedido com conflito')).kind, 'clarify')
  assert.equal(local.calls.length, 1)
  const invalidPlan = new SubscriptionMock([{ decision: 'create', components: [] }])
  await assert.rejects(generateCadAssembly(invalidPlan, 'Crie dois suportes', async () => null), ProviderRequestError)
  assert.equal(invalidPlan.calls.length, 1)
})

test('component clarification preserves completed bodies and resumes only the pending inferred fit', async () => {
  const zero = { x: 0, y: 0, z: 0 }
  const fixed = { kind: 'fixed', axis: 'z', minimum: 0, maximum: 0, value: 0, pitch: 0, group: '', factor: 1 }
  const plan = { decision: 'create', partId: 'fit_resume', question: '', assumptions: ['Infer mounting dimensions'],
    components: ['support', 'screw_handwheel'].map((id, index) => ({ id, action: 'build', position: { ...zero, x: index * 100 },
      description: index ? 'Infer journals Ø10×14 centered at X=±105' : 'Support with bore centered at X=±102', motion: fixed })) }
  const question = 'Autoriza aumentar os bores para 17 mm ou mover os journals para X=±102?'
  const body = (id: string) => ({ ...response, spec: { ...spec, partId: id } })
  const provider = new SubscriptionMock([plan, body('support'), { decision: 'clarify', question, spec: null, assumptions: [] },
    () => { throw new ProviderRequestError('status 429') }, body('screw_handwheel')])
  const checked: string[] = []
  const inspect = async (candidate: { partId: string }) => { checked.push(candidate.partId); return null }
  const request = 'Crie um conjunto com suporte e fuso; escolha dimensões compatíveis'
  const first = await generateCadAssembly(provider, request, inspect, async () => null)
  assert.equal(first.kind, 'clarify')
  assert.equal(provider.calls.length, 3)
  assert.match(provider.calls[2].messages[0].content, /inferred design proposals, not additional user mandates/)
  assert.match(provider.calls[2].messages[0].content, /a journal may protrude beyond an open through bore without collision/)
  await assert.rejects(generateCadAssembly(provider, request, inspect, async () => null), ProviderRequestError)
  assert.equal(provider.calls.length, 4)
  const progress: CadAssemblyProgress[] = []
  const resumed = await generateCadAssembly(provider, request, inspect, async () => null, undefined, (event) => progress.push(event))
  assert.equal(resumed.kind, 'create')
  assert.equal(provider.calls.length, 5)
  assert.deepEqual(checked, ['support', 'screw_handwheel'])
  assert.equal(progress[0].completed, 1)
  assert.equal(progress[0].resumed, true)
  assert.match(provider.calls[3].messages[1].content, /Earlier component clarification/)
  assert.match(provider.calls[3].messages[1].content, /Previously validated components.*support/)
  assert.equal(provider.calls[4].messages[1].content, provider.calls[3].messages[1].content)
})

test('truncated subscription component resumes the same plan without rebuilding completed bodies', async () => {
  const components = ['support_left', 'support_right'].map((id, index) => ({
    id, action: 'build', description: 'Support block', position: { ...zero, x: index * 100 },
    motion: { kind: 'fixed', axis: 'z', minimum: 0, maximum: 0, value: 0, pitch: 0, group: '', factor: 1 },
  }))
  const plan = { decision: 'create', partId: 'supports', question: '', assumptions: [], components }
  const values = [JSON.stringify(plan), JSON.stringify({ ...response, spec: { ...spec, partId: components[0].id } }),
    '{"decision":"create","spec":{"steps":[', JSON.stringify({ ...response, spec: { ...spec, partId: components[1].id } })]
  let calls = 0
  const local = new LocalCliProvider({ apiBaseUrl: 'http://localhost', client: 'codex', model: 'test' }, async () => {
    calls++
    const content = values.shift()
    assert.ok(content)
    return new Response(JSON.stringify({ content, finishReason: 'stop' }))
  })
  const checked: string[] = []
  const inspect = async (candidate: { partId: string }) => { checked.push(candidate.partId); return null }
  await assert.rejects(generateCadAssembly(local, 'Crie dois suportes', inspect, async () => null), ProviderRequestError)
  assert.equal(calls, 3)
  assert.equal(local.getState().phase, 'ready')
  assert.equal((await generateCadAssembly(local, 'Crie dois suportes', inspect, async () => null)).kind, 'create')
  assert.equal(calls, 4)
  assert.equal(checked.filter((id) => id === components[0].id).length, 1)
})

test('an unavailable geometry check preserves the subscription candidate and resumes without inference', async () => {
  const local = new SubscriptionMock([response])
  let offline = true
  const inspect = async () => { if (offline) throw new Error('Engine unavailable'); return null }
  await assert.rejects(generateCadProgram(local, 'Crie um suporte', undefined, inspect), ProviderRequestError)
  offline = false
  assert.equal((await generateCadProgram(local, 'Crie um suporte', undefined, inspect)).kind, 'create')
  assert.equal(local.calls.length, 1)
})

const components = ['left', 'right'].map((id, index) => ({
  id, action: 'build', description: 'Support block', position: { ...zero, x: index * 100 },
  motion: { kind: 'fixed', axis: 'z', minimum: 0, maximum: 0, value: 0, pitch: 0, group: '', factor: 1 },
}))
const plan = { decision: 'create', partId: 'supports', question: '', assumptions: [], components }

test('native correction preserves an independent pending collision and resumes on its component with one call', async () => {
  const ids = ['left', 'right', 'other_left', 'other_right']
  const fullPlan = { ...plan, components: ids.map((id, i) => ({ ...components[0], id, position: { ...zero, x: i * 100 } })) }
  const fixed = { ...response, spec: { ...spec, steps: [{ ...spec.steps[0], height: 10 }] } }
  const provider = new SubscriptionMock([fullPlan, ...ids.map((partId) => ({ ...response, spec: { ...spec, partId } })),
    { ...fixed, spec: { ...fixed.spec, partId: 'right' } }, { ...fixed, spec: { ...fixed.spec, partId: 'other_right' } }])
  const bounds = { x: [0, 10], y: [0, 10], z: [0, 10] } as const
  const inspect = async (candidate: CadAssemblySpec): Promise<CadAssemblyIssue | null> => {
    const collisions: CadCollision[] = []
    for (const [first, second] of [[0, 1], [2, 3]]) {
      const body = candidate.components[second].steps[0]
      if (body.shape === 'box' && body.height === 10) continue
      collisions.push({ components: [ids[first], ids[second]], pose: 'current',
        message: `CAD components ${ids[first]} and ${ids[second]} intersect at posição atual by 100 mm³`,
        overlapVolumeMm3: 100, componentVolumesMm3: [1000, 1000], overlapBoundsMm: bounds, componentBoundsMm: [bounds, bounds] })
    }
    return collisions.length ? { message: collisions[0].message, collisions } : null
  }
  const activities: CadAssemblyProgress['activity'][] = []
  let draft: CadAssemblySpec | undefined
  await assert.rejects(generateCadAssembly(provider, 'Quatro suportes independentes', async () => null, inspect, undefined,
    (progress) => { if (progress.activity) activities.push(progress.activity) }), (error: unknown) => {
    assert.ok(error instanceof CadAssemblyPausedError)
    draft = error.spec
    assert.match(error.message, /other_left and other_right/)
    return true
  })
  assert.equal(provider.calls.length, 6)
  assert.equal(draft?.components[1].steps[0].shape === 'box' && draft.components[1].steps[0].height, 10)
  assert.match(JSON.stringify(provider.calls[5].messages), /Edit ONLY component right/)
  assert.ok(activities.includes('checking-component'))
  assert.ok(activities.includes('checking-assembly'))
  const ai = activities.indexOf('generating-correction')
  assert.ok(ai > 0)
  assert.equal(activities[ai - 1], 'checking-component')
  const complete = await generateCadAssembly(provider, 'Quatro suportes independentes', async () => null, inspect)
  assert.equal(complete.kind, 'create')
  assert.equal(provider.calls.length, 7)
  assert.match(JSON.stringify(provider.calls[6].messages), /Edit ONLY component other_right/)
  assert.ok(complete.kind === 'create' && complete.spec.components[1].steps[0].shape === 'box' && complete.spec.components[1].steps[0].height === 10)
})

test('an unavailable or cancelled assembly inspection preserves completed subscription components', async () => {
  for (const failure of [new Error('Engine unavailable'), new DOMException('Cancelled', 'AbortError')]) {
    const local = new SubscriptionMock([plan, response, response])
    let interrupted = true
    const inspect = async () => { if (interrupted) throw failure; return null }
    await assert.rejects(generateCadAssembly(local, 'Crie dois suportes', async () => null, inspect))
    interrupted = false
    assert.equal((await generateCadAssembly(local, 'Crie dois suportes', async () => null, inspect)).kind, 'create')
    assert.equal(local.calls.length, 3)
  }
})

test('a native correction without assembly progress preserves the previous draft and makes no second correction call', async () => {
  const bodies = components.map(({ id }) => ({ ...response, spec: { ...spec, partId: id } }))
  const changed = { ...bodies[1], spec: { ...bodies[1].spec, steps: [{ ...spec.steps[0], height: 12 }] } }
  const local = new SubscriptionMock([plan, ...bodies, changed])
  const bounds = { x: [0, 10], y: [0, 10], z: [0, 10] } as const
  const collision: CadCollision = { components: ['left', 'right'], pose: 'current',
    message: 'CAD components left and right intersect at posição atual by 100 mm³', overlapVolumeMm3: 100,
    componentVolumesMm3: [1000, 1000], overlapBoundsMm: bounds, componentBoundsMm: [bounds, bounds] }
  await assert.rejects(generateCadAssembly(local, 'Dois suportes', async () => null,
    async () => ({ message: collision.message, collisions: [collision] })), (error: unknown) => {
    assert.ok(error instanceof CadAssemblyPausedError)
    assert.match(error.message, /não demonstrou redução/)
    const body = error.spec.components[1].steps[0]
    assert.ok(body.shape === 'box' && body.height === 20)
    return true
  })
  assert.equal(local.calls.length, 4)
})

test('invalid planned placement and motion stop before any component construction request', async () => {
  const invalidComponents = [
    { ...components[1], position: { ...zero, x: 10_001 } },
    { ...components[1], motion: { ...components[1].motion, kind: 'slider', group: 'stage', minimum: -10, maximum: 10, factor: 0 } },
    { ...components[1], motion: { ...components[1].motion, kind: 'screw', minimum: -10, maximum: 10, pitch: 1001 } },
    { ...components[1], motion: { ...components[1].motion, kind: 'slider', group: 'stage', minimum: -100, maximum: 100, factor: 101 } },
  ]
  for (const component of invalidComponents) {
    const local = new SubscriptionMock([{ ...plan, components: [components[0], component] }, response])
    await assert.rejects(generateCadAssembly(local, 'Crie dois suportes', async () => null), ProviderRequestError)
    assert.equal(local.calls.length, 1)
  }
  for (const invalid of [{ ...plan, partId: undefined }, { ...plan, partId: 123 },
    { ...plan, components: [{ ...components[0], id: undefined }, components[1]] }]) {
    const local = new SubscriptionMock([invalid, response])
    await assert.rejects(generateCadAssembly(local, 'Crie dois suportes', async () => null), ProviderRequestError)
    assert.equal(local.calls.length, 1)
  }
})

test('ambiguous linked groups are rejected before spending any component inference', async () => {
  for (const motions of [
    [{ kind: 'slider', minimum: -2, maximum: -1, value: -1, factor: 1 }, { kind: 'rotary', minimum: 1, maximum: 2, value: 1, factor: -120 }],
    [{ kind: 'slider', minimum: -2, maximum: 2, value: 0, factor: 1 }, { kind: 'rotary', minimum: -2, maximum: 2, value: 0, factor: undefined }],
  ]) {
    const raw = { ...plan, components: [components[0], ...motions.map((motion, i) => ({ ...components[1], id: `moving_${i}`,
      motion: { ...components[1].motion, axis: 'x', group: 'drive', ...motion } }))] }
    const provider = new SubscriptionMock([raw])
    await assert.rejects(generateCadAssembly(provider, 'Construa um mecanismo', async () => null), ProviderRequestError)
    assert.equal(provider.calls.length, 1)
  }
})

const modelSpec: ModelSpec = { schemaVersion: '1.0', projectId: 'prj_test', revision: 0, units: 'mm', scene: { displayScale: 1 }, objects: [] }
const scenePlan = { intent: 'create_model', operations: [{ op: 'create_object', name: 'Cube', kind: 'box', dimensions: { width: 10, height: 10, depth: 10 } }] }

test('native X3D schema errors consume one call; HTTP providers keep their format repair', async () => {
  const invalid = { ...scenePlan, operations: [{ ...scenePlan.operations[0], dimensions: { width: -10, height: 10, depth: 10 } }] }
  const local = new SubscriptionMock([invalid, scenePlan])
  await assert.rejects(generateModelPlan({ provider: local, request: 'Crie um cubo', modelSpec }), ProviderRequestError)
  assert.equal(local.calls.length, 1)
  const external = new MockLLMProvider([invalid, scenePlan])
  assert.equal((await generateModelPlan({ provider: external, request: 'Crie um cubo', modelSpec })).operations.length, 1)
  assert.equal(external.calls.length, 2)
})

test('native X3D stops after one apply correction and preserves the current revision', async () => {
  const local = new SubscriptionMock([scenePlan, scenePlan, scenePlan])
  const revisions: number[] = []
  await assert.rejects(generateScene({ provider: local, request: 'Crie um cubo', modelSpec,
    describeRepairableApplyError: () => 'Invalid scene geometry',
    applyPlan: async (_plan, current) => { revisions.push(current.revision); throw new Error('Invalid scene geometry') },
  }), ProviderRequestError)
  assert.equal(local.calls.length, 2)
  assert.deepEqual(revisions, [0, 0])
  assert.equal(modelSpec.revision, 0)
})
