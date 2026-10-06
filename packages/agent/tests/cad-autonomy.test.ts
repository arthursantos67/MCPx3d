import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CadAutonomyError } from '../src/cad-autonomy.ts'
import { generateCadProgram } from '../src/generate-cad-program.ts'
import { MockLLMProvider } from '../src/mock-provider.ts'
import { ProviderRequestError } from '../src/provider.ts'

const zero = { x: 0, y: 0, z: 0 }
const spec = { schemaVersion: '3.0', units: 'mm', partId: 'guide', steps: [
  { id: 'shaft', op: 'base', shape: 'cylinder', position: zero, rotation: { ...zero, y: 90 }, diameter: 8, height: 216 },
] } as const
const created = { decision: 'create', question: '', assumptions: ['Guia ampliada para 216 mm, mantendo os suportes.'], spec }
const clarify = (question: string) => ({ decision: 'clarify', question, spec: null, assumptions: [] })
const subscription = (responses: ConstructorParameters<typeof MockLLMProvider>[0]) => {
  const provider = new MockLLMProvider(responses)
  Object.assign(provider, { generationPolicy: { retryInvalidStructuredOutput: false, maxCadRepairAttempts: 1 } })
  return provider
}

for (const question of [
  'Posso aumentar a guia para Ø8×216 ou alterar os suportes já validados?',
  'Autoriza aumentar a altura do carro e reposicionar os furos da flange para fora da cavidade?',
  'Autoriza mover os journals para X=±102?',
]) test(`autonomous generation resolves an internal decision: ${question}`, async () => {
  const provider = subscription([clarify(question), created])
  let checks = 0
  const result = await generateCadProgram(provider, 'Crie uma montagem utilizável', undefined,
    async () => { checks++; return null }, { noQuestions: true })
  assert.equal(result.kind, 'create')
  assert.equal(checks, 1)
  assert.equal(provider.calls.length, 2)
  const properties = provider.calls[0].schema.properties as Record<string, { enum?: string[]; const?: string }>
  assert.deepEqual(properties.decision.enum, ['create'])
  assert.equal(properties.question.const, '')
  assert.match(JSON.stringify(provider.calls[1].messages), /Do not ask the user to choose or authorize anything/)
})

test('repeated questions stop with a technical failure and resume from the pending decision', async () => {
  const question = clarify('Posso alterar a guia?')
  const provider = subscription([question, question, question, created])
  await assert.rejects(generateCadProgram(provider, 'Guia', undefined, undefined, { noQuestions: true }), (error: unknown) => {
    assert.ok(error instanceof CadAutonomyError)
    assert.doesNotMatch(error.message, /Posso|Autoriza|\?/)
    return true
  })
  assert.equal(provider.calls.length, 3)
  assert.equal((await generateCadProgram(provider, 'Guia', undefined, undefined, { noQuestions: true })).kind, 'create')
  assert.equal(provider.calls.length, 4)
})

test('quota during an automatic decision preserves its context without another initial generation', async () => {
  const provider = subscription([clarify('Aumentar a altura?'), () => { throw new ProviderRequestError('status 429') }, created])
  await assert.rejects(generateCadProgram(provider, 'Guia', undefined, undefined, { noQuestions: true }), ProviderRequestError)
  assert.equal((await generateCadProgram(provider, 'Guia', undefined, undefined, { noQuestions: true })).kind, 'create')
  assert.equal(provider.calls.length, 3)
  assert.equal(provider.calls[1].messages.at(-1)?.content, provider.calls[2].messages.at(-1)?.content)
})

test('automatic editing retains the incremental contract and validates the final program', async () => {
  const previous = { ...spec, steps: [{ ...spec.steps[0], height: 208 }] }
  const provider = subscription([clarify('Autoriza alongar a guia?'), { decision: 'edit', partId: 'guide', replaceSteps: spec.steps,
    insertSteps: [], removeStepIds: [], question: '', assumptions: ['Comprimento ajustado para obter 12 mm de engate.'] }])
  const result = await generateCadProgram(provider, 'Ajuste o engate sem perguntas', previous,
    async (candidate) => candidate.steps[0].shape === 'cylinder' && candidate.steps[0].height === 216 ? null : 'Engate insuficiente', { noQuestions: true })
  assert.equal(result.kind, 'create')
  const properties = provider.calls[0].schema.properties as Record<string, { enum?: string[] }>
  assert.deepEqual(properties.decision.enum, ['edit'])
})
