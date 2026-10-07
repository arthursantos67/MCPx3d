import assert from 'node:assert/strict'
import { test } from 'node:test'
import { requestedCadComponentCount } from '../src/cad-component-count.ts'
import { classifyCadDesign } from '../src/classify-cad-design.ts'
import { generateCadAssembly } from '../src/generate-cad-assembly.ts'
import { MockLLMProvider } from '../src/mock-provider.ts'

test('a requested count refers to physical components rather than holes, dimensions or allowed ranges', () => {
  for (const request of ['Volante de 8 peças', 'Conjunto com oito componentes', 'Build eight bodies']) {
    assert.equal(requestedCadComponentCount(request), 8)
  }
  for (const request of ['Placa com 8 furos', 'Fuso de 8 mm', 'Construa 2–8 components', 'Uma peça com quatro rasgos']) {
    assert.equal(requestedCadComponentCount(request), undefined)
  }
})

test('a model cannot classify eight explicitly requested pieces as one fused solid', async () => {
  const provider = new MockLLMProvider([{ kind: 'part', reason: 'Um volante' }])
  assert.equal(await classifyCadDesign(provider, 'Crie um volante de oito peças'), 'assembly')
})

test('autonomous planning corrects a wrong component count before generating any body', async () => {
  const zero = { x: 0, y: 0, z: 0 }
  const components = ['one', 'two', 'three'].map((id, index) => ({ id, action: 'build', description: 'Connected block', position: { ...zero, x: index * 50 },
    motion: { kind: 'fixed', axis: 'z', minimum: 0, maximum: 0, value: 0, pitch: 0, group: '', factor: 1 } }))
  const plan = { decision: 'create', partId: 'three_parts', question: '', assumptions: [], components }
  const provider = Object.assign(new MockLLMProvider([
    { ...plan, components: components.slice(0, 2) }, plan,
    ...components.map((component) => ({ decision: 'create', question: '', assumptions: [], spec: {
      schemaVersion: '3.0', units: 'mm', partId: component.id, steps: [
        { id: 'body', op: 'base', shape: 'box', position: zero, rotation: zero, width: 20, depth: 20, height: 10 },
      ],
    } })),
  ]), { generationPolicy: { retryInvalidStructuredOutput: false, maxCadRepairAttempts: 1 } })
  const result = await generateCadAssembly(provider, 'Construa três peças separadas', async () => null, async () => null,
    undefined, undefined, 0, { noQuestions: true, maxRepairAttempts: 3 })
  assert.equal(result.kind, 'create')
  assert.equal(provider.calls.length, 5)
  assert.match(provider.calls[1].messages.map((message) => message.content).join('\n'), /exatamente 3 corpos físicos/)
})
