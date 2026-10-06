import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readAssemblyIssue } from '../src/cad-assembly-diagnostics.ts'

const bounds = { x: [-50, 50], y: [-50, 50], z: [57, 60] }
const collision = { components: ['housing', 'cover'], pose: 'current', message: 'Interference',
  overlapVolumeMm3: 13910.97, componentVolumesMm3: [609338.93, 60796.1],
  overlapBoundsMm: bounds, componentBoundsMm: [bounds, bounds] }
const report = { schemaVersion: '1.0', check: 'assembly_interference', collisions: [collision] }

test('accepts a versioned collision report and keeps the legacy message', () => {
  assert.deepEqual(readAssemblyIssue('Legacy message', [report]), { message: 'Legacy message', collisions: [collision] })
})

test('malformed or incomplete diagnostics cannot authorize partial repairs', () => {
  const invalid = [undefined, {}, [], [{ ...report, schemaVersion: '2.0' }], [{ ...report, collisions: [] }],
    [{ ...report, collisions: [collision, collision] }],
    ...[{ overlapVolumeMm3: '13910.97' }, { overlapVolumeMm3: Infinity }, { pose: ['current'] },
      { components: ['cover', 'cover'] }, { componentVolumesMm3: [1000, NaN] },
      { overlapBoundsMm: { ...bounds, z: [60, 57] } }].map((update) => [{ ...report, collisions: [{ ...collision, ...update }] }]),
  ]
  for (const details of invalid) assert.equal(readAssemblyIssue('Invalid', details), null)
})

test('reads mechanical diagnostics alone and alongside collisions', () => {
  const issue = { connectionId: 'bearing', components: ['screw', 'support'], pose: 'minimum', message: 'Missing bearing engagement' }
  assert.deepEqual(readAssemblyIssue('Mechanical failure', [{ schemaVersion: '1.0', check: 'assembly_mechanics', issues: [issue] }]),
    { message: 'Mechanical failure', collisions: [], mechanicalIssues: [issue] })
  assert.deepEqual(readAssemblyIssue('Combined failure', [{ ...report, mechanicalIssues: [issue] }]),
    { message: 'Combined failure', collisions: [collision], mechanicalIssues: [issue] })
  assert.equal(readAssemblyIssue('Invalid', [{ ...report, mechanicalIssues: [{ ...issue, components: [] }] }]), null)
})
