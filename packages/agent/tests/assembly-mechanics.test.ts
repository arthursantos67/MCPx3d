import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { MockLLMProvider } from '../src/mock-provider.ts'
import { generateCadAssembly, CadAssemblyPausedError } from '../src/generate-cad-assembly.ts'
import { ProviderRequestError } from '../src/provider.ts'
import { reducesInterference } from '../src/assembly-repair.ts'
import type { CadAssemblySpec } from '../../domain/ts/src/cad-assembly.ts'
import type { CadAssemblyIssue } from '../../domain/ts/src/cad-assembly-diagnostics.ts'

const stage = JSON.parse(readFileSync(new URL('../../../examples/cad/functional_linear_stage.json', import.meta.url), 'utf8')) as CadAssemblySpec
const plan = { decision: 'create', partId: stage.partId, question: '', assumptions: [], mechanics: stage.mechanics,
  components: stage.components.map((component) => ({ ...component, action: 'build', description: 'Build matching interfaces with the specified feature IDs',
    motion: component.motion ? { ...component.motion, pitch: 0 } : { kind: 'fixed', axis: 'z', minimum: 0, maximum: 0, value: 0, pitch: 0, group: '', factor: 1 } })) }
const programs = stage.components.map((component) => ({ decision: 'create', question: '', assumptions: [], spec: {
  schemaVersion: '3.0', units: 'mm', partId: component.id, steps: component.steps,
} }))

test('mechanical generation carries the contract and mating feature IDs into every builder', async () => {
  const provider = new MockLLMProvider([plan, ...programs])
  let checks = 0
  const outcome = await generateCadAssembly(provider, 'Create a supported lead screw actuator', async () => null, async (spec) => {
    checks++; assert.deepEqual(spec.mechanics, stage.mechanics); return null
  }, undefined, undefined, 0, { requireMechanics: true })
  assert.equal(outcome.kind, 'create')
  assert.equal(checks, 1)
  assert.equal(provider.calls[0].options?.maxTokens, 4500)
  for (const call of provider.calls.slice(1)) {
    assert.match(call.messages[1].content, /Mechanical connections/)
    assert.match(call.messages[1].content, /Complete component placement plan/)
  }
})

test('external mechanical plans without bindings are rejected before constructing any component', async () => {
  const provider = new MockLLMProvider([{ ...plan, mechanics: null }])
  Object.assign(provider, { generationPolicy: { retryInvalidStructuredOutput: false } })
  let builds = 0
  await assert.rejects(generateCadAssembly(provider, 'Actuator', async () => { builds++; return null }, async () => null,
    undefined, undefined, 0, { requireMechanics: true }), /plano.*inválido.*mechanics/)
  assert.equal(provider.calls.length, 1)
  assert.equal(builds, 0)
})

test('editing cannot silently downgrade a mechanical assembly to a geometric concept', async () => {
  const provider = new MockLLMProvider(Array(2).fill({ ...plan, mechanics: null }))
  await assert.rejects(generateCadAssembly(provider, 'Change the wheel', async () => null, async () => null, stage), /descartar.*vínculos/)
  assert.equal(provider.calls.length, 2)
})

test('mechanical failure preserves the complete external draft without extra inference', async () => {
  const provider = new MockLLMProvider([plan, ...programs])
  Object.assign(provider, { generationPolicy: { retryInvalidStructuredOutput: false } })
  const issue: CadAssemblyIssue = { message: 'CAD mechanical component screw: missing axial retention', collisions: [],
    mechanicalIssues: [{ connectionId: '', components: ['screw'], pose: 'current', message: 'Missing axial retention' }] }
  await assert.rejects(generateCadAssembly(provider, 'Actuator', async () => null, async () => issue,
    undefined, undefined, 0, { requireMechanics: true }), (error: unknown) => {
    assert.ok(error instanceof CadAssemblyPausedError)
    assert.deepEqual(error.spec.mechanics, stage.mechanics)
    assert.equal(error.spec.components.length, stage.components.length)
    return true
  })
  assert.equal(provider.calls.length, stage.components.length + 1)
})

test('geometric repairs cannot introduce a mechanical defect while reducing overlap', () => {
  const bounds = { x: [0, 10], y: [0, 10], z: [0, 10] } as const
  const before: CadAssemblyIssue = { message: 'Collision', collisions: [{ components: ['screw', 'base'], pose: 'current', message: 'Collision',
    overlapVolumeMm3: 100, componentVolumesMm3: [1000, 1000], componentBoundsMm: [bounds, bounds], overlapBoundsMm: bounds }] }
  const after: CadAssemblyIssue = { message: 'Lost mounting face', collisions: [],
    mechanicalIssues: [{ connectionId: 'mount', components: ['base', 'support'], pose: 'current', message: 'Lost mounting face' }] }
  assert.equal(reducesInterference(before, after), false)
  assert.equal(reducesInterference(after, after), false)
  assert.equal(reducesInterference(after, null), true)
})

test('autonomous assembly planning resolves a question before building the same verified contract', async () => {
  const provider = new MockLLMProvider([{ decision: 'clarify', question: 'Autoriza aumentar o carro?', assumptions: [], components: [], mechanics: null }, plan, ...programs])
  Object.assign(provider, { generationPolicy: { retryInvalidStructuredOutput: false, maxCadRepairAttempts: 1 } })
  const result = await generateCadAssembly(provider, 'Crie um atuador utilizável sem perguntas', async () => null, async () => null,
    undefined, undefined, 0, { requireMechanics: true, noQuestions: true })
  assert.equal(result.kind, 'create')
  assert.equal(provider.calls.length, programs.length + 2)
})

test('an autonomous mechanical failure triggers one selective replan and then stops without asking permission', async () => {
  const rebuilt = { ...plan, components: plan.components.map((item) => ({ ...item, action: 'keep' })) }
  const provider = new MockLLMProvider([plan, ...programs, rebuilt])
  Object.assign(provider, { generationPolicy: { retryInvalidStructuredOutput: false, maxCadRepairAttempts: 1 } })
  const issue: CadAssemblyIssue = { message: 'CAD mechanical component screw: invalid drive', collisions: [],
    mechanicalIssues: [{ connectionId: '', components: ['screw'], pose: 'current', message: 'Invalid drive' }] }
  const result = await generateCadAssembly(provider, 'Corrija automaticamente', async () => null, async () => issue,
    undefined, undefined, 0, { requireMechanics: true, noQuestions: true }).catch((error: unknown) => error)
  assert.ok(result instanceof Error)
  assert.match(result.message, /falha/)
  assert.equal(provider.calls.length, programs.length + 2)
})

test('an undersized guide is corrected before accepting it, preserving both completed supports', async () => {
  const zero = { x: 0, y: 0, z: 0 }
  const supports = [-1, 1].map((sign) => ({ id: sign < 0 ? 'left' : 'right', position: { ...zero, x: sign * 102 }, steps: [
    { id: 'body', op: 'base', shape: 'box', position: zero, rotation: zero, width: 12, depth: 20, height: 20 },
    { id: 'bore', op: 'cut', shape: 'hole', position: { ...zero, x: 6 }, rotation: { ...zero, y: 90 },
      diameter: 8.4, height: 12, holeType: 'plain', headDiameter: 0, headDepth: 0 },
  ] }))
  const shaft = { id: 'shaft', op: 'base', shape: 'cylinder', position: zero, rotation: { ...zero, y: 90 }, diameter: 8, height: 208 }
  const fixed = { kind: 'fixed', axis: 'z', minimum: 0, maximum: 0, value: 0, pitch: 0, group: '', factor: 1 }
  const mechanics = { grounded: 'left', connections: supports.map((item) => ({ id: item.id + '_fix', kind: 'fixed', first: 'guide', second: item.id,
    firstFeature: 'shaft', secondFeature: 'bore', minEngagement: 12, maxClearance: .3, fastening: 'bonded', fastenerDiameter: 0 })) }
  const component = (id: string, steps: unknown[]) => ({ decision: 'create', question: '', assumptions: [], spec: { schemaVersion: '3.0', units: 'mm', partId: id, steps } })
  const provider = new MockLLMProvider([
    { decision: 'create', partId: 'mounted_guide', question: '', assumptions: [], mechanics,
      components: [...supports, { id: 'guide', position: zero }].map((item) => ({ ...item, action: 'build', description: 'Infer compatible fitting dimensions', motion: fixed })) },
    ...supports.map((item) => component(item.id, item.steps)), component('guide', [shaft]),
    { decision: 'edit', partId: 'guide', question: '', assumptions: ['Guia ampliada para 216 mm para obter engate de 12 mm em ambos os suportes.'],
      replaceSteps: [{ ...shaft, height: 216 }], insertSteps: [], removeStepIds: [] },
  ])
  Object.assign(provider, { generationPolicy: { retryInvalidStructuredOutput: false, maxCadRepairAttempts: 1 } })
  const checked: string[] = []
  const result = await generateCadAssembly(provider, 'Monte uma guia com dois suportes sem perguntas', async (candidate) => {
    checked.push(candidate.partId); return null
  }, async (candidate) => {
    assert.equal(candidate.components[2].steps[0].shape === 'cylinder' && candidate.components[2].steps[0].height, 216)
    return null
  }, undefined, undefined, 0, { requireMechanics: true, noQuestions: true })
  assert.equal(result.kind, 'create')
  assert.deepEqual(checked, ['left', 'right', 'guide'])
  assert.equal(provider.calls.length, 4)
  if (result.kind === 'create') assert.match(result.assumptions.join(' '), /dimensionados matematicamente/)
})

test('quota during autonomous replanning exposes the completed draft and preserves its limit information', async () => {
  const provider = new MockLLMProvider([plan, ...programs, () => {
    throw new ProviderRequestError('status 429', { limit: { kind: 'quota' } })
  }])
  Object.assign(provider, { generationPolicy: { retryInvalidStructuredOutput: false, maxCadRepairAttempts: 1 } })
  const issue: CadAssemblyIssue = { message: 'Invalid support', collisions: [],
    mechanicalIssues: [{ connectionId: '', components: ['screw'], pose: 'current', message: 'Invalid support' }] }
  await assert.rejects(generateCadAssembly(provider, 'Resolva sem perguntas', async () => null, async () => issue,
    undefined, undefined, 0, { requireMechanics: true, noQuestions: true }), (error: unknown) => {
    assert.ok(error instanceof CadAssemblyPausedError)
    assert.equal(error.spec.components.length, stage.components.length)
    assert.equal(error.limit?.kind, 'quota')
    return true
  })
  assert.equal(provider.calls.length, programs.length + 2)
})
