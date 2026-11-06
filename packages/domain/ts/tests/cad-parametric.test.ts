import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { CAD_DESIGNS, CadDesignError, compileCadDesign, newCadDesign, readCadDesign } from '../src/cad-parametric.ts'

test('parametric sources compile exactly to the programs verified by the native kernel', () => {
  const fixtures = JSON.parse(readFileSync(new URL('../../../../tests/fixtures/cad-parametric.json', import.meta.url), 'utf8'))
  assert.equal(fixtures.length, 15)
  for (const { id, ...expected } of fixtures) assert.deepEqual(compileCadDesign(expected.document), expected, id)
})

test('changing stock dimensions moves holes while preserving the edge distance and bore dimensions', () => {
  const doc = newCadDesign('plate')
  const small = compileCadDesign(doc)
  const large = compileCadDesign({ ...doc, parameters: { ...doc.parameters, width: 200, depth: 100 } })
  const cut = large.spec.steps[1]
  assert.equal(cut.position.x, -88)
  assert.equal(cut.position.y, -38)
  assert.equal(cut.pattern?.kind, 'linear')
  assert.equal(cut.pattern?.kind === 'linear' && cut.pattern.offset.x, 176)
  assert.equal(cut.shape === 'hole' && cut.diameter, doc.parameters.holeDiameter)
  assert.equal(small.spec.steps[1].position.x, -28, 'compilation must not mutate earlier programs')
})

test('incompatible measures fail before any geometry is submitted', () => {
  const cases = [
    ['plate', { edgeOffset: 2 }], ['plate', { width: 20 }], ['plate', { depth: 20 }],
    ['bracket', { depth: 8 }], ['bracket', { height: 8 }],
    ['flange', { boreDiameter: 60 }], ['flange', { diameter: 65 }],
    ['flange', { holeCount: 12, holeDiameter: 20, boreDiameter: 10, diameter: 110 }],
    ['enclosure', { wall: 30 }], ['enclosure', { height: 3 }], ['spacer', { boreDiameter: 23 }],
  ] as const
  for (const [kind, patch] of cases) {
    const doc = newCadDesign(kind)
    assert.throws(() => compileCadDesign({ ...doc, parameters: { ...doc.parameters, ...patch } }), CadDesignError, `${kind} ${JSON.stringify(patch)}`)
  }
})

test('imports are strict, bounded, data-only and cannot introduce unknown fields', () => {
  const doc = newCadDesign('plate')
  const bad = [null, [], {}, { ...doc, kind: '__proto__' }, { ...doc, kind: 'constructor' }, { ...doc, format: '1' },
    { ...doc, partId: '../file' }, { ...doc, code: 'anything' }, { ...doc, parameters: [] },
    ...[null, '80', '', NaN, Infinity, -1, 0, 1001].map((width) => ({ ...doc, parameters: { ...doc.parameters, width } })),
    { ...doc, parameters: { ...doc.parameters, unknown: 1 } },
  ]
  for (const input of bad) assert.throws(() => readCadDesign(input), CadDesignError)
  const flange = newCadDesign('flange')
  assert.throws(() => compileCadDesign({ ...flange, parameters: { ...flange.parameters, holeCount: 3.5 } }), CadDesignError)
})

test('exporting and reimporting source retains every parameter and the resulting geometry', () => {
  for (const kind of Object.keys(CAD_DESIGNS) as (keyof typeof CAD_DESIGNS)[]) {
    const first = compileCadDesign(newCadDesign(kind))
    assert.deepEqual(compileCadDesign(JSON.parse(JSON.stringify(first.document))), first)
    assert.ok(first.expectedVolumeMm3 > 0)
  }
})
