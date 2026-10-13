import assert from 'node:assert/strict'
import { test } from 'node:test'
import { lowerSuccessBound, evaluateCadRequirements, summarizeCadBenchmark } from '../../scripts/cad-benchmark-metrics.mjs'

test('two successes cannot support a 99 percent reliability claim', () => {
  const report = summarizeCadBenchmark([{ status: 'validated', durationMs: 10, draftZipBytes: 100 }, { status: 'validated', durationMs: 20, draftZipBytes: 100 }], 2)
  assert.equal(report.observedSuccessRate, 1)
  assert.ok(report.lowerBound < .3)
  assert.equal(report.sampleSupportsTarget, false)
  assert.equal(report.medianDurationMs, 10)
  assert.equal(report.p95DurationMs, 20)
})

test('exact lower bounds handle zero, partial and perfect samples without rounding to 99 percent', () => {
  assert.equal(lowerSuccessBound(0, 0), 0)
  assert.equal(lowerSuccessBound(0, 100), 0)
  assert.ok(Math.abs(lowerSuccessBound(1, 2) - (1 - Math.sqrt(.95))) < 1e-12)
  assert.ok(lowerSuccessBound(99, 100) < .96)
  assert.ok(lowerSuccessBound(298, 298) < .99)
  assert.ok(lowerSuccessBound(299, 299) >= .99)
  assert.throws(() => lowerSuccessBound(2, 1))
})

test('valid geometry with wrong requested teeth or blind termination is a fidelity failure', () => {
  const spec = { steps: [{ shape: 'spur_gear', module: 2, teeth: 20 },
    { shape: 'hole', diameter: 5, height: 6, termination: 'through', pattern: { count: 4 } }] }
  const issues = evaluateCadRequirements(spec, { features: [{ shape: 'spur_gear', module: 2, teeth: 24 },
    { shape: 'hole', diameter: 5, height: 6, termination: 'blind', count: 4 }] })
  assert.equal(issues.length, 2)
  const summary = summarizeCadBenchmark([{ status: 'validated', requirementIssues: issues, durationMs: 12 }], 2)
  assert.equal(summary.geometricSuccesses, 1)
  assert.equal(summary.successes, 0)
  assert.equal(summary.unattempted, 1)
})

test('linear and circular instance counts and fixed threaded fastening are explicit requirements', () => {
  const spec = { components: [{ steps: [{ shape: 'thread', diameter: 4, termination: 'blind', pattern: { count: 2 } }] },
    { steps: [{ shape: 'hole', diameter: 4.5, termination: 'through', pattern: { count: 2 } }] }],
    mechanics: { connections: [{ fastening: 'threaded' }] } }
  assert.deepEqual(evaluateCadRequirements(spec, { components: 2, fastening: 'threaded', features: [
    { shape: 'thread', diameter: 4, termination: 'blind', count: 2 }, { shape: 'hole', diameter: 4.5, termination: 'through', count: 2 }] }), [])
})

test('schema defaults count as their effective dimensions but missing blind intent remains a failure', () => {
  const spec = { steps: [{ shape: 'spur_gear', module: 2, teeth: 24 }, { shape: 'hole', diameter: 5 }] }
  assert.deepEqual(evaluateCadRequirements(spec, { features: [{ shape: 'spur_gear', pressureAngle: 20, backlash: 0 }] }), [])
  assert.equal(evaluateCadRequirements(spec, { features: [{ shape: 'hole', termination: 'blind' }] }).length, 1)
})

test('feature fidelity includes local coordinates, paths and the intended component', () => {
  const path = [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 20 }]
  const spec = { components: [{ id: 'guide', steps: [{ shape: 'sweep', diameter: 6, path }] },
    { id: 'support', steps: [{ shape: 'hole', diameter: 6, position: { x: 10, y: 0, z: 5 } }] }] }
  assert.deepEqual(evaluateCadRequirements(spec, { features: [{ componentId: 'guide', shape: 'sweep', path }] }), [])
  assert.equal(evaluateCadRequirements(spec, { features: [{ componentId: 'support', shape: 'sweep', path }] }).length, 1)
  assert.equal(evaluateCadRequirements(spec, { features: [{ shape: 'hole', position: { x: 0 } }] }).length, 1)
})

test('measured dimensions, volume and mechanical status cannot pass on recipe fields alone', () => {
  const spec = { partId: 'tube', steps: [{ shape: 'tube', diameter: 30, innerDiameter: 24, height: 60 }] }
  const requirements = { boundsMm: [30, 30, 60], toleranceMm: .001, volumeMm3: { min: 15000, max: 16000 } }
  assert.equal(evaluateCadRequirements(spec, requirements).length, 2)
  assert.deepEqual(evaluateCadRequirements(spec, requirements, { boundsMm: [30.00001, 30, 60], volumeMm3: 15268.14 }), [])
  assert.equal(evaluateCadRequirements(spec, { mechanicalStatus: 'verified' }, { mechanicalStatus: 'unverified' }).length, 1)
  assert.throws(() => evaluateCadRequirements(spec, { toleranceMm: -1 }))
  assert.throws(() => summarizeCadBenchmark([{ status: 'validated' }], 0))
})

test('equivalent Euler frames satisfy a requested hole axis but reversed entry directions fail', () => {
  const spec = { steps: [{ shape: 'hole', rotation: { x: 0, y: 90, z: 0 } }] }
  assert.deepEqual(evaluateCadRequirements(spec, { features: [{ shape: 'hole', axisDirection: { x: 1, y: 0, z: 0 } }] }), [])
  assert.equal(evaluateCadRequirements(spec, { features: [{ shape: 'hole', axisDirection: { x: -1, y: 0, z: 0 } }] }).length, 1)
})

test('a validated recipe with a failed export does not count as delivered success', () => {
  const summary = summarizeCadBenchmark([{ status: 'validated', durationMs: 10, exportError: 'ZIP size limit' }], 1)
  assert.equal(summary.geometricSuccesses, 1)
  assert.equal(summary.successes, 0)
  assert.equal(summary.exportSuccesses, 0)
})

test('unattempted or empty exports do not establish delivery reliability', () => {
  for (const draftZipBytes of [undefined, 0]) {
    const summary = summarizeCadBenchmark([{ status: 'validated', durationMs: 10, draftZipBytes }], 1)
    assert.equal(summary.geometricSuccesses, 1)
    assert.equal(summary.successes, 0)
    assert.equal(summary.exportSuccesses, 0)
  }
})
