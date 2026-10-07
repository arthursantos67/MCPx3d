import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { CadProgramSpec } from '../../domain/ts/src/cad-program.ts'
import { generateCadProgram } from '../src/generate-cad-program.ts'
import { MockLLMProvider } from '../src/mock-provider.ts'
import { ProviderRequestError } from '../src/provider.ts'
import { repairFinishWithProvider } from '../src/cad-finish-repair.ts'

const zero = { x: 0, y: 0, z: 0 }
const draft: CadProgramSpec = { schemaVersion: '3.0', units: 'mm', partId: 'fuso_volante', steps: [
  { id: 'shaft', op: 'base', shape: 'cylinder', position: zero, rotation: { ...zero, y: 90 }, diameter: 9, height: 32 },
  { id: 'wheel', op: 'union', shape: 'cylinder', position: { ...zero, x: 17 }, rotation: { ...zero, y: 90 }, diameter: 40, height: 6 },
  { id: 'thread', op: 'union', shape: 'thread', position: zero, rotation: { ...zero, y: 90 }, diameter: 12, pitch: 2, height: 32, profile: 'metric', handedness: 'right', clearance: 0, starts: 1 },
  { id: 'shaftAndWheelChamfers', op: 'modify', shape: 'chamfer', position: zero, rotation: zero, selector: 'circular', distance: 1 },
] }
const failure = 'CAD step shaftAndWheelChamfers (chamfer) cannot apply selector circular at requested size; choose suitable edges/faces or reduce an unspecified size'
const creation = { decision: 'create', spec: draft, question: '', assumptions: [] }
const subscription = (responses: ConstructorParameters<typeof MockLLMProvider>[0]) => Object.assign(new MockLLMProvider(responses), {
  generationPolicy: { retryInvalidStructuredOutput: false, maxCadRepairAttempts: 1, maxSceneRepairAttempts: 1 },
})
const finish = (spec: CadProgramSpec) => {
  const step = spec.steps.find((step) => step.id === 'shaftAndWheelChamfers')!
  assert.equal(step.shape, 'chamfer')
  if (step.shape !== 'chamfer') throw new Error('Missing chamfer')
  return step
}

test('an inferred finish is reduced and validated locally without another model request', async () => {
  const provider = subscription([creation])
  const checked: number[] = []
  const result = await generateCadProgram(provider, 'Crie um fuso roscado com volante e chanfros', undefined, async (spec) => {
    checked.push(finish(spec).distance)
    return finish(spec).distance <= 0.25 ? null : failure
  }, { noQuestions: true })
  assert.equal(result.kind, 'create')
  if (result.kind !== 'create') return
  assert.deepEqual(checked, [1, 0.5, 0.25])
  assert.equal(provider.calls.length, 1)
  assert.deepEqual(result.spec.steps.slice(0, -1), draft.steps.slice(0, -1))
  assert.match(result.assumptions.join(' '), /1 para 0.25 mm/)
})

test('an inferred planner dimension is adjustable while the original assembly request remains authoritative', async () => {
  const provider = subscription([creation])
  const result = await generateCadProgram(provider,
    'Build ONLY component fuso_volante. Overall request: Crie um atuador com volante. Component construction: Aplique chanfro de 1 mm.',
    undefined, async (spec) => finish(spec).distance <= 0.5 ? null : failure, { assemblyComponent: true, noQuestions: true })
  assert.equal(result.kind, 'create')
  assert.equal(provider.calls.length, 1)
})

test('a subscription can move an explicitly sized finish before threading in its one repair call', async () => {
  const provider = subscription([creation, { selector: 'circular', size: 1, beforeStepId: 'thread' }])
  const result = await generateCadProgram(provider, 'Crie um fuso e aplique chanfro de 1 mm no eixo e volante', undefined,
    async (spec) => spec.steps.indexOf(finish(spec)) < spec.steps.findIndex((step) => step.id === 'thread') ? null : failure,
    { noQuestions: true })
  assert.equal(result.kind, 'create')
  if (result.kind !== 'create') return
  assert.equal(provider.calls.length, 2)
  assert.deepEqual(result.spec.steps.map((step) => step.id), ['shaft', 'wheel', 'shaftAndWheelChamfers', 'thread'])
  assert.deepEqual(result.spec.steps.find((step) => step.id === 'thread'), draft.steps[2])
  assert.equal(finish(result.spec).distance, 1)
  assert.deepEqual((provider.calls[1].schema.properties as Record<string, unknown>).size, { const: 1 })
  assert.match(provider.calls[1].messages[1].content, /Failed candidates/)
})

test('resuming a repeated failed finish sends the previous failure and does not regenerate the shaft', async () => {
  const updated = { ...finish(draft), selector: 'positive_x' }
  const provider = subscription([creation, { selector: 'circular', size: 1, beforeStepId: '' }, {
    decision: 'edit', partId: draft.partId, replaceSteps: [updated], insertSteps: [], removeStepIds: [], question: '', assumptions: [],
  }])
  const checked: string[] = []
  const inspect = async (spec: CadProgramSpec) => {
    checked.push(finish(spec).selector)
    return finish(spec).selector === 'positive_x' ? null : failure
  }
  await assert.rejects(generateCadProgram(provider, 'Fuso com chanfro de 1 mm', undefined, inspect, { noQuestions: true }), /rascunho foi conservado/)
  const result = await generateCadProgram(provider, 'Fuso com chanfro de 1 mm', undefined, inspect, { noQuestions: true })
  assert.equal(result.kind, 'create')
  assert.equal(provider.calls.length, 3)
  assert.deepEqual(checked, ['circular', 'positive_x'])
  assert.match(provider.calls[2].messages[1].content, /Do not repeat failed selector\/size\/order combinations/)
  assert.match(provider.calls[2].messages[1].content, /"selector":"circular"/)
})

test('a quota during the focused finish repair resumes only that pending decision', async () => {
  const provider = subscription([creation, () => { throw new ProviderRequestError('status 429') }, { selector: 'positive_x', size: 1, beforeStepId: '' }])
  const inspect = async (spec: CadProgramSpec) => finish(spec).selector === 'positive_x' ? null : failure
  await assert.rejects(generateCadProgram(provider, 'Chanfro de 1 mm', undefined, inspect), /status 429/)
  assert.equal(provider.calls.length, 2)
  const result = await generateCadProgram(provider, 'Chanfro de 1 mm', undefined, inspect)
  assert.equal(result.kind, 'create')
  assert.equal(provider.calls.length, 3)
  assert.deepEqual(provider.calls[2].schema, provider.calls[1].schema)
})

test('failed local candidates are not rechecked after cancellation, and the real thread is retained', async () => {
  const provider = subscription([creation])
  const sizes: number[] = []
  let cancelled = false
  const inspect = async (spec: CadProgramSpec) => {
    const size = finish(spec).distance
    sizes.push(size)
    if (size === 0.25 && !cancelled) { cancelled = true; throw new DOMException('Cancelled', 'AbortError') }
    return size <= 0.25 ? null : failure
  }
  await assert.rejects(generateCadProgram(provider, 'Fuso com volante e chanfros', undefined, inspect), { name: 'AbortError' })
  const result = await generateCadProgram(provider, 'Fuso com volante e chanfros', undefined, inspect)
  assert.equal(result.kind, 'create')
  assert.deepEqual(sizes, [1, 0.5, 0.25, 0.25])
  assert.equal(provider.calls.length, 1)
})

test('a focused repair cannot remove a finish, change explicit size, or move it before the base', async () => {
  for (const patch of [
    { selector: 'positive_x', size: 0.5, beforeStepId: '' },
    { selector: 'positive_x', size: 1, beforeStepId: 'shaft' },
    { selector: 'positive_x', size: 1, beforeStepId: '', removeStepIds: ['shaftAndWheelChamfers'] },
    { decision: 'clarify', question: 'Autoriza remover o chanfro?' },
  ]) {
    const provider = subscription([creation, patch])
    let checks = 0
    await assert.rejects(generateCadProgram(provider, 'Chanfro de 1 mm', undefined, async () => { checks++; return failure }, { noQuestions: true }), /Última falha/)
    assert.equal(checks, 1)
    assert.equal(provider.calls.length, 2)
  }
})

test('fillets receive the same bounded local repair without changing their feature type', async () => {
  const rounded: CadProgramSpec = { ...draft, steps: [...draft.steps.slice(0, -1), {
    id: 'shaftAndWheelChamfers', op: 'modify', shape: 'fillet', position: zero, rotation: zero, selector: 'circular', radius: 1,
  }] }
  const provider = subscription([{ ...creation, spec: rounded }])
  const result = await generateCadProgram(provider, 'Arredonde as arestas do fuso', undefined, async (spec) => {
    const last = spec.steps.at(-1)!
    return last.shape === 'fillet' && last.radius <= 0.5 ? null : failure.replace('(chamfer)', '(fillet)')
  })
  assert.equal(result.kind, 'create')
  if (result.kind === 'create') assert.equal(result.spec.steps.at(-1)?.shape, 'fillet')
  assert.equal(provider.calls.length, 1)
})

test('a focused repair cannot revert to a finish combination already rejected by the engine', async () => {
  const current: CadProgramSpec = { ...draft, steps: [...draft.steps.slice(0, -1), { ...finish(draft), selector: 'positive_x' }] }
  const provider = subscription([{ selector: 'circular', size: 1, beforeStepId: '' }])
  const result = await repairFinishWithProvider(provider, current, 'Chanfro de 1 mm', failure, [{ spec: draft, issue: failure }])
  assert.equal(result, null)
})
