import assert from 'node:assert/strict'
import { test } from 'node:test'
import { classifyCadDesign } from '../src/classify-cad-design.ts'
import { MockLLMProvider } from '../src/mock-provider.ts'

test('chooses assembly for a machine without a hard-coded product catalog', async () => {
  const provider = new MockLLMProvider([{ kind: 'assembly', reason: 'distinct fixed and rotating bodies' }])
  assert.equal(await classifyCadDesign(provider, 'Crie um equipamento com carcaça e eixo rotativo'), 'assembly')
  assert.match(provider.calls[0].messages[0].content, /not by a fixed list/)
  assert.ok(JSON.stringify(provider.calls[0].schema).length < 400)
})

test('chooses one part for a connected solid', async () => {
  const provider = new MockLLMProvider([{ kind: 'part', reason: 'one solid' }])
  assert.equal(await classifyCadDesign(provider, 'Crie um suporte com quatro furos'), 'part')
})

test('reuses the CAD representation decision for the same request and provider', async () => {
  const provider = new MockLLMProvider([{ kind: 'assembly', reason: 'moving bodies' }])
  assert.equal(await classifyCadDesign(provider, 'Crie um motor'), 'assembly')
  assert.equal(await classifyCadDesign(provider, 'Crie um motor'), 'assembly')
  assert.equal(provider.calls.length, 1)
})
