import assert from 'node:assert/strict'
import { test } from 'node:test'
import features from '../../domain/fixtures/cad-program/features.json' with { type: 'json' }
import type { CadProgramSpec } from '../../domain/ts/src/cad-program.ts'
import { explicitCadProgramIssue } from '../src/cad-explicit-requirements.ts'
import { generateCadProgram } from '../src/generate-cad-program.ts'
import { MockLLMProvider } from '../src/mock-provider.ts'

const bend = features.find((item) => item.partId === 'pipe_bend')! as CadProgramSpec
const tube = features.find((item) => item.partId === 'tube')! as CadProgramSpec

test('literal requested operations and field values are checked without guessing prose dimensions', () => {
  assert.equal(explicitCadProgramIssue(bend, 'Use pipe_bend com bendRadius=24 e diameter=12.'), null)
  assert.match(explicitCadProgramIssue(tube, 'Use pipe_bend.') ?? '', /explicitly requested pipe_bend/)
  assert.match(explicitCadProgramIssue(bend, 'Use pipe_bend com bendRadius=30.') ?? '', /explicit fields/)
  assert.equal(explicitCadProgramIssue(bend, 'Use pipe_bend com bendRadius=24,0.'), null)
  assert.equal(explicitCadProgramIssue(bend, 'Não use tube; use pipe_bend.'), null)
  assert.equal(explicitCadProgramIssue(bend, 'Use uma curva de tubo de 90 graus.'), null)
})

test('a wrong literal feature is repaired before invoking the native checker', async () => {
  const incorrect = { ...tube, partId: bend.partId, steps: tube.steps.map((step) => ({ ...step, id: bend.steps[0].id })) }
  const response = (spec: CadProgramSpec) => ({ decision: 'create', spec, assumptions: [], question: '' })
  const provider = new MockLLMProvider([response(incorrect), response(bend)])
  let nativeChecks = 0
  const result = await generateCadProgram(provider, 'Use pipe_bend.', undefined, async () => { nativeChecks++; return null }, { maxRepairAttempts: 1 })
  assert.equal(result.kind, 'create')
  assert.equal(provider.calls.length, 2)
  assert.equal(nativeChecks, 1)
})

test('assembly components are checked against their own contracts rather than every operation in the overall request', async () => {
  const provider = new MockLLMProvider([{ decision: 'create', spec: tube, assumptions: [], question: '' }])
  const result = await generateCadProgram(provider, 'Use pipe_bend in another component.', undefined, async () => null, { assemblyComponent: true })
  assert.equal(result.kind, 'create')
  assert.equal(provider.calls.length, 1)
})
