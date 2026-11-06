import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createResolutionBudget } from '../../src/three/sceneResolutionBudget.ts'

test('sustained slow frames reduce resolution gradually and never below sixty percent', () => {
  const budget = createResolutionBudget(), changes: number[] = []
  for (let i=0;i<600;i++) { const next = budget.sample(40); if (next !== null) changes.push(next) }
  assert.ok(changes.length <= 3, 'avoid a sequence of repeated render-target allocations')
  assert.equal(changes.at(-1), 0.6)
  assert.ok(changes.every(value=>value>=0.6 && value<1))
})
test('a single stall does not lower quality and stable headroom recovers slowly', () => {
  const budget = createResolutionBudget()
  budget.sample(220)
  for (let i=0;i<130;i++) assert.equal(budget.sample(16.67), null)
  let reduced: number | null = null
  for (let i=0;i<100 && reduced === null;i++) reduced = budget.sample(40)
  assert.ok(reduced !== null && reduced < 1 && reduced >= 0.6)
  const recovered: number[] = []
  for (let i=0;i<3600;i++) { const next = budget.sample(16.67); if (next !== null) recovered.push(next) }
  assert.equal(recovered.at(-1), 1)
  assert.ok(recovered.length > 1, 'restoration uses sustained headroom instead of oscillating')
})
test('tab suspension and menu gaps clear measurements rather than degrading the next session', () => {
  const budget = createResolutionBudget()
  for (let i=0;i<40;i++) budget.sample(40)
  for (const gap of [NaN, Infinity, 0, -1, 2000]) assert.equal(budget.sample(gap), null)
  for (let i=0;i<120;i++) assert.equal(budget.sample(16.67), null)
  budget.reset()
  for (let i=0;i<40;i++) assert.equal(budget.sample(40), null)
})
