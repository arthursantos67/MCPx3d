import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mechanicalFitIssue } from '../src/cad-mating.ts'
import type { CadComponent } from '../../domain/ts/src/cad-assembly.ts'
import type { CadMechanicalConnection } from '../../domain/ts/src/cad-mechanics.ts'

const zero = { x: 0, y: 0, z: 0 }
const supports: CadComponent[] = [-1, 1].map((sign) => ({ id: sign < 0 ? 'left' : 'right', position: { ...zero, x: sign * 102 }, steps: [
  { id: 'body', op: 'base', shape: 'box', position: zero, rotation: zero, width: 12, depth: 20, height: 20 },
  { id: 'bore', op: 'cut', shape: 'hole', position: { ...zero, x: 6 }, rotation: { ...zero, y: 90 },
    diameter: 8.4, height: 12, holeType: 'plain', headDiameter: 0, headDepth: 0 },
] }))
const guide = (height: number): CadComponent => ({ id: 'guide', position: zero, steps: [
  { id: 'shaft', op: 'base', shape: 'cylinder', position: zero, rotation: { ...zero, y: 90 }, diameter: 8, height },
] })
const joints: CadMechanicalConnection[] = supports.map((item) => ({ id: item.id + '_fix', kind: 'fixed', first: 'guide', second: item.id,
  firstFeature: 'shaft', secondFeature: 'bore', minEngagement: 12, maxClearance: .3, fastening: 'bonded', fastenerDiameter: 0 }))

test('the reported guide is rejected at 8 mm engagement; 216 mm reaches both 12 mm bores', () => {
  assert.match(mechanicalFitIssue(guide(208), supports, joints)!, /insufficient axial engagement 8.000 mm; need 12.000 mm/)
  assert.equal(mechanicalFitIssue(guide(216), supports, joints), null)
})

test('mating inspection checks global axes rather than accepting matching lengths', () => {
  assert.match(mechanicalFitIssue({ ...guide(216), position: { ...zero, y: 1 } }, supports, joints)!, /not coaxial/)
})

test('mating inspection includes travel extrema before accepting a component', () => {
  const moving = { ...guide(216), motion: { kind: 'slider', axis: 'x', minimum: -4, maximum: 4, value: 0 } } as CadComponent
  assert.match(mechanicalFitIssue(moving, supports, [joints[1]])!, /at minimum: insufficient axial engagement/)
})
