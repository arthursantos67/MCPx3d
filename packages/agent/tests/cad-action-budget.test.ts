import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CadActionBudget, CadActionBudgetError } from '../src/cad-action-budget.ts'
import { cadIdentity } from '../src/cad-identity.ts'

test('the shared action budget refuses excess calls before work is started', () => {
  let now = 100
  const budget = new CadActionBudget({ aiCalls: 2, cadChecks: 1, durationMs: 50 }, () => now)
  budget.spend('ai'); budget.spend('cad'); budget.spend('ai')
  assert.throws(() => budget.spend('ai'), CadActionBudgetError)
  assert.throws(() => budget.spend('cad'), CadActionBudgetError)
  assert.deepEqual(budget.stats(), { aiCalls: 2, cadChecks: 1, aiCallLimit: 2, cadCheckLimit: 1 })
  now = 150
  assert.throws(() => budget.checkTime(), /prazo de/)
})

test('candidate identity ignores object field order and keeps construction order', () => {
  assert.equal(cadIdentity({ steps: [{ id: 'a', width: 20 }], extra: undefined }), cadIdentity({ steps: [{ width: 20, id: 'a' }] }))
  assert.notEqual(cadIdentity({ steps: ['a', 'b'] }), cadIdentity({ steps: ['b', 'a'] }))
})
