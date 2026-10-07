import assert from 'node:assert/strict'
import { test } from 'node:test'
import { generateCadAssembly } from '../src/generate-cad-assembly.ts'
import { MockLLMProvider } from '../src/mock-provider.ts'
import { ProviderRequestError } from '../src/provider.ts'
import { cadMechanismGuidance } from '../src/cad-mechanism-guidance.ts'

const zero = { x: 0, y: 0, z: 0 }
const plan = { decision: 'create', partId: 'reviewed_assembly', mechanics: null, question: '', assumptions: [],
  components: ['base', 'support', 'shaft'].map((id, index) => ({ id, action: 'build', description: 'Inferred dimensions',
    position: { ...zero, x: index * 50 }, motion: { kind: 'fixed', axis: 'z', minimum: 0, maximum: 0, value: 0, pitch: 0, group: '', factor: 1 } })) }
const body = (id: string) => ({ decision: 'create', question: '', assumptions: [], spec: {
  schemaVersion: '3.0', units: 'mm', partId: id, steps: [{ id: 'stock', op: 'base', shape: 'box', position: zero, rotation: zero,
    width: 20, depth: 20, height: 10 }],
} })

test('plan review corrects inferred interface descriptions before any body is generated', async () => {
  const reviewed = { ...plan, assumptions: ['Calculated cavity walls before machining'],
    components: plan.components.map((item) => ({ ...item, description: 'Cavity axis at Z=-10 requires stock height 45' })) }
  const provider = new MockLLMProvider([plan, reviewed, ...plan.components.map((item) => body(item.id))])
  const phases: string[] = []
  const result = await generateCadAssembly(provider, 'Make three parts', async () => null, async () => null,
    undefined, (event) => phases.push(event.phase), 0, { reviewPlan: true, noQuestions: true })
  assert.equal(result.kind, 'create')
  assert.equal(provider.calls.length, 5)
  assert.match(provider.calls[2].messages[1].content, /stock height 45/)
  assert.ok(phases.indexOf('reviewing-plan') < phases.indexOf('building'))
  if (result.kind === 'create') assert.equal(result.spec.mechanics, undefined)
})

test('quota during review resumes the review without repeating the initial plan', async () => {
  const provider = new MockLLMProvider([plan, () => { throw new ProviderRequestError('review quota') }, plan,
    ...plan.components.map((item) => body(item.id))])
  const generate = () => generateCadAssembly(provider, 'Make three parts', async () => null, async () => null,
    undefined, undefined, 0, { reviewPlan: true, noQuestions: true })
  await assert.rejects(generate(), /review quota/)
  const result = await generate()
  assert.equal(result.kind, 'create')
  assert.equal(provider.calls.length, 6)
  assert.match(provider.calls[2].messages[2].content, /BEFORE any body/)
})

test('a review cannot replace a requested component or turn a concept into verification', async () => {
  const changed = { ...plan, components: plan.components.map((item, i) => i === 2 ? { ...item, id: 'other' } : item) }
  const provider = new MockLLMProvider([plan, changed])
  let checked = 0
  await assert.rejects(generateCadAssembly(provider, 'Make three parts', async () => { checked++; return null }, async () => null,
    undefined, undefined, 0, { reviewPlan: true }), /identidade/)
  assert.equal(checked, 0)
  assert.equal(provider.calls.length, 2)
})

test('worked mechanical guidance is scoped to screw drives and preserves thread roots and local coordinates', () => {
  assert.equal(cadMechanismGuidance('A mounting plate'), '')
  const guidance = cadMechanismGuidance('Atuador linear com fuso e volante')
  assert.match(guidance, /Ø8.99 core/)
  assert.match(guidance, /not a Ø12 cylinder/)
  assert.match(guidance, /local Z=-12/)
  assert.match(guidance, /adapt decomposition/)
})

test('reviewing a recovered mechanics plan applies updated placement without rebuilding kept geometry', async () => {
  const mechanics = { grounded: 'base', connections: ['support', 'shaft'].map((id) => ({ id: `${id}_fix`, kind: 'fixed',
    first: 'base', second: id, firstFeature: '', secondFeature: '', fastening: 'bonded', fastenerDiameter: 0,
    minEngagement: 1, maxClearance: 0 })) }
  const mechanicalPlan = { ...plan, mechanics, components: plan.components.map((item) => ({ ...item, action: 'keep' })) }
  const reviewed = { ...mechanicalPlan, components: mechanicalPlan.components.map((item) => item.id === 'support'
    ? { ...item, position: { ...zero, x: 60 } } : item) }
  const provider = new MockLLMProvider([plan, plan, ...plan.components.map((item) => body(item.id)), mechanicalPlan, reviewed])
  const generate = () => generateCadAssembly(provider, 'Make three connected parts', async () => null, async () => null,
    undefined, undefined, 0, { reviewPlan: true, requireMechanics: true, allowUnverifiedDrafts: true })
  await assert.rejects(generate(), /vínculos|plano mecânico|mechanics|conexões/i)
  const result = await generate()
  assert.ok(result.kind === 'create')
  assert.equal(result.spec.components.find((item) => item.id === 'support')?.position.x, 60)
  assert.equal(provider.calls.length, 7)
})
