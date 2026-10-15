import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { CadComponent } from '../src/cad-assembly.ts'
import { validateCadDraft, type CadDraftSnapshot } from '../src/cad-draft.ts'
import type { CadProgramSpec } from '../src/cad-program.ts'

const zero = { x: 0, y: 0, z: 0 }
const base = { id: 'profile', op: 'base', shape: 'polygon_prism', position: zero, rotation: zero,
  points: [{ x: -20, y: -10 }, { x: 20, y: -10 }, { x: 20, y: 10 }, { x: -20, y: 10 }], height: 8 } as CadProgramSpec['steps'][number]
const hole = (index: number) => ({ id: `hole_${index}`, op: 'cut', shape: 'cylinder', position: zero, rotation: zero,
  diameter: 2, height: 20 }) as CadProgramSpec['steps'][number]
const component = (id: string, stepCount = 2, motion?: CadComponent['motion']): CadComponent => ({
  id, position: zero, steps: [base, ...Array.from({ length: stepCount - 1 }, (_, index) => hole(index))], ...(motion ? { motion } : {}),
})
const draft = (components: CadComponent[], extra: Partial<CadDraftSnapshot> = {}): CadDraftSnapshot => ({
  spec: { schemaVersion: '4.0', units: 'mm', partId: 'draft_part', components }, request: 'Montagem', ...extra,
})

test('draft validation accepts a partial assembly with a valid moving component', () => {
  assert.doesNotThrow(() => validateCadDraft(draft([component('body'), component('slide', 2, { kind: 'slider', axis: 'x', minimum: 0, maximum: 10, value: 5 })],
    { pendingComponentId: 'cover', plannedComponentIds: ['body', 'slide', 'cover'], issue: 'Falha anterior' })))
})

test('draft validation mirrors the API limits', () => {
  assert.throws(() => validateCadDraft(draft([0, 1, 2, 3, 4].map((index) => component(`part_${index}`, 26)))), /128/)
  assert.doesNotThrow(() => validateCadDraft(draft([0, 1, 2, 3].map((index) => component(`part_${index}`, 32)))))
  assert.throws(() => validateCadDraft(draft([component('body')], { request: 'x'.repeat(50_001) })), /inválido/)
  assert.throws(() => validateCadDraft(draft([component('body')], { issue: 'x'.repeat(120_001) })), /Diagnóstico/)
  assert.throws(() => validateCadDraft(draft([component('body')], { pendingComponentId: 'tampa nova' })), /pendente/)
  assert.throws(() => validateCadDraft(draft([component('body')], { pendingComponentId: '' })), /pendente/)
})

test('draft validation rejects invalid component motion', () => {
  const invalid: CadComponent['motion'][] = [
    { kind: 'slider', axis: 'x', minimum: 10, maximum: 0, value: 5 },
    { kind: 'slider', axis: 'x', minimum: 0, maximum: 10, value: 11 },
    { kind: 'screw', axis: 'z', minimum: 0, maximum: 10, value: 0 },
    { kind: 'slider', axis: 'x', minimum: 0, maximum: 10, value: 0, pitch: 2 },
    { kind: 'rotary', axis: 'z', minimum: 0, maximum: 90, value: 0, factor: 2 },
    { kind: 'slider', axis: 'w' as 'x', minimum: 0, maximum: 10, value: 0 },
  ]
  for (const motion of invalid) {
    assert.throws(() => validateCadDraft(draft([component('body'), component('moving', 2, motion)])), /movimento/i)
  }
})
