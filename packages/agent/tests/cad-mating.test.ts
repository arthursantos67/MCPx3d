import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mechanicalFitIssue, matingContext, repairMechanicalFitLocally } from '../src/cad-mating.ts'
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

test('two supports determine the minimum inferred guide length without moving either support', async () => {
  const original = structuredClone(supports)
  let checks = 0
  const result = await repairMechanicalFitLocally(guide(208), supports, joints, 'Monte uma guia com dois suportes', async (spec) => {
    checks++
    return mechanicalFitIssue({ ...guide(208), steps: spec.steps }, supports, joints)
  })
  assert.ok(result)
  assert.deepEqual(supports, original)
  assert.equal(result.spec.steps[0].shape === 'cylinder' && result.spec.steps[0].height, 216)
  assert.equal(checks, 1)
})

test('fit repair accounts for travel and retains the centered local origin', async () => {
  const moving: CadComponent = { ...guide(216), motion: { kind: 'slider', axis: 'x', minimum: -4, maximum: 4, value: 0 } }
  const result = await repairMechanicalFitLocally(moving, supports, joints, 'Monte uma guia móvel', async (spec) => mechanicalFitIssue({ ...moving, steps: spec.steps }, supports, joints))
  assert.ok(result)
  assert.equal(result.spec.steps[0].shape === 'cylinder' && result.spec.steps[0].height, 224)
  assert.deepEqual(result.spec.steps[0].position, zero)
})

test('global datum offsets are removed rather than duplicated in the receiving component', async () => {
  const target: CadComponent = { ...guide(216), position: { ...zero, y: 20 } }
  const targets = JSON.parse(matingContext(target, supports, joints))
  assert.equal(targets[0].targetLocalCenterAtCurrentPose.y, -20)
  const result = await repairMechanicalFitLocally(target, supports, joints, 'Alinhe a guia', async (spec) => mechanicalFitIssue({ ...target, steps: spec.steps }, supports, joints))
  assert.ok(result)
  assert.equal(result.spec.steps[0].position.y, -20)
})

test('local fit proposals cannot override explicit dimensions or pass without native verification', async () => {
  assert.equal(await repairMechanicalFitLocally(guide(208), supports, joints, 'Guia de 208 mm', async () => null), null)
  assert.equal(await repairMechanicalFitLocally({ ...guide(216), position: { ...zero, y: 1 } }, supports, joints, 'Y=1', async () => null), null)
  assert.equal(await repairMechanicalFitLocally(guide(208), supports, joints, 'Monte uma guia', async () => 'CAD step shaft failed'), null)
})
