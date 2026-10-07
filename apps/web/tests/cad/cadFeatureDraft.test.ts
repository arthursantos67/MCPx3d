import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createCadFeature } from '../../src/cad/cadFeatureDraft.ts'
import type { CadProgramStep } from '../../../../packages/domain/ts/src/cad-program.ts'

test('a new recessed hole starts at the top stock face instead of hiding the head seat inside it', () => {
  const stock: CadProgramStep = { id: 'body', op: 'base', shape: 'box', width: 80, depth: 50, height: 10,
    position: { x: 12, y: 8, z: 10 }, rotation: { x: 0, y: 0, z: 0 } }
  const hole = createCadFeature('hole', 'mount', 'union', [stock])
  assert.ok(hole.shape === 'hole')
  assert.equal(hole.op, 'cut')
  assert.deepEqual(hole.position, { x: 12, y: 8, z: 15 })
  assert.equal(hole.height, 10.5)
  assert.equal(hole.headDiameter, 9.5)
  assert.equal(hole.headDepth, 5.3)
})

test('a default hole keeps a thin or narrow stock intact without silently choosing smaller hardware', () => {
  const stock: CadProgramStep = { id: 'body', op: 'base', shape: 'box', width: 80, depth: 50, height: 2,
    position: { x: 0, y: 0, z: 1 }, rotation: { x: 0, y: 0, z: 0 } }
  for (const existing of [[stock], [{ ...stock, height: 10, width: 8 }], []]) {
    const hole = createCadFeature('hole', 'mount', 'cut', existing)
    assert.ok(hole.shape === 'hole')
    assert.equal(hole.holeType, 'plain')
    assert.equal(hole.diameter, 5.5)
    assert.equal(hole.headDiameter, 0)
    assert.equal(hole.headDepth, 0)
  }
})
