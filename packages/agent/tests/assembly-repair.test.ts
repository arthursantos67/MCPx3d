import assert from 'node:assert/strict'
import { test } from 'node:test'
import { repairAssemblyLocally, reducesInterference, type AssemblyRepairStrategy } from '../src/assembly-repair.ts'
import type { CadAssemblySpec } from '../../domain/ts/src/cad-assembly.ts'
import type { CadAssemblyIssue, CadCollision } from '../../domain/ts/src/cad-assembly-diagnostics.ts'

const bounds = { x: [0, 10], y: [0, 10], z: [0, 10] } as const
const collision = (first: string, second: string, volume: number, pose: CadCollision['pose'] = 'current'): CadCollision => ({
  components: [first, second], pose, message: `${first}/${second}/${pose}`, overlapVolumeMm3: volume,
  componentVolumesMm3: [1000, 1000], overlapBoundsMm: bounds, componentBoundsMm: [bounds, bounds],
})
const issue = (...collisions: CadCollision[]): CadAssemblyIssue => ({ message: collisions[0].message, collisions })
const spec: CadAssemblySpec = { schemaVersion: '4.0', units: 'mm', partId: 'generic', components: ['a', 'b', 'c'].map((id) => ({
  id, position: { x: 0, y: 0, z: 0 }, steps: [{ id: 'base', op: 'base', shape: 'box',
    position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, width: 10, depth: 10, height: 10 }],
})) }
const advance: AssemblyRepairStrategy = { assumption: 'Accepted placement change',
  propose: async (current, _message, _part, assess) => {
    const candidate = { ...current, components: current.components.map((item, i) => i ? item : {
      ...item, position: { ...item.position, x: item.position.x + 1 },
    }) }
    return await assess(candidate) ? null : candidate
  },
}

test('interference progress requires no new pair, no worsened pose, and a measurable reduction', () => {
  const before = issue(collision('a', 'b', 100), collision('b', 'c', 200, 'maximum'))
  assert.equal(reducesInterference(before, issue(collision('b', 'a', 90), collision('b', 'c', 200, 'maximum'))), true)
  assert.equal(reducesInterference(before, issue(collision('b', 'c', 200, 'maximum'))), true)
  assert.equal(reducesInterference(before, issue(collision('a', 'b', 50), collision('b', 'c', 201, 'maximum'))), false)
  assert.equal(reducesInterference(before, issue(collision('a', 'b', 50), collision('a', 'c', 1))), false)
  assert.equal(reducesInterference(before, issue(collision('a', 'b', 50, 'quarter'))), false)
  assert.equal(reducesInterference(before, before), false)
  assert.equal(reducesInterference(before, 'Unknown geometry failure'), false)
  assert.equal(reducesInterference('Legacy first collision', issue(collision('a', 'b', 10))), false)
  assert.equal(reducesInterference(before, null), true)
})

test('keeps partial repairs, then checks the next candidate against the accepted assembly', async () => {
  const visited: number[] = []
  const result = await repairAssemblyLocally(spec, issue(collision('a', 'b', 100), collision('b', 'c', 100)),
    [advance], async () => null, async (candidate) => {
      const x = candidate.components[0].position.x
      visited.push(x)
      return x === 1 ? issue(collision('b', 'c', 100)) : null
    })
  assert.deepEqual(visited, [1, 2])
  assert.equal(result.spec.components[0].position.x, 2)
  assert.equal(result.issue, null)
  assert.equal(result.spec.components[1], spec.components[1])
})

test('validation budget and step budget retain the best verified partial result', async () => {
  for (const limits of [{ steps: 10, validations: 2 }, { steps: 2, validations: 10 }]) {
    let checks = 0
    const result = await repairAssemblyLocally(spec, issue(collision('a', 'b', 100)), [advance], async () => null,
      async () => issue(collision('a', 'b', 100 - ++checks)), undefined, limits)
    assert.equal(checks, 2)
    assert.equal(result.spec.components[0].position.x, 2)
    assert.ok(result.issue)
  }
})

test('cycles are stopped without discarding the last accepted spec', async () => {
  const oscillate: AssemblyRepairStrategy = { ...advance, propose: async (current, _message, _part, assess) => {
    const candidate = current.components[0].position.x ? spec : { ...spec, components: spec.components.map((item, i) =>
      i ? item : { ...item, position: { ...item.position, x: 1 } }) }
    return await assess(candidate) ? null : candidate
  } }
  let checks = 0
  const result = await repairAssemblyLocally(spec, issue(collision('a', 'b', 100)), [oscillate], async () => null,
    async () => issue(collision('a', 'b', 100 - ++checks)))
  assert.equal(checks, 1)
  assert.equal(result.spec.components[0].position.x, 1)
})

test('strategies cannot bypass candidate validation or alter geometry after a successful check', async () => {
  const unchecked = { ...spec, partId: 'unchecked' }
  for (const propose of [async () => unchecked,
    async (_current: CadAssemblySpec, _message: string, _part: unknown, assess: (candidate: CadAssemblySpec) => Promise<string | null>) => {
      await assess({ ...spec, partId: 'checked' })
      return unchecked
    }]) {
    const result = await repairAssemblyLocally(spec, issue(collision('a', 'b', 100)),
      [{ assumption: 'Should not be accepted', propose }], async () => null, async () => null)
    assert.equal(result.spec, spec)
    assert.ok(result.issue)
    assert.deepEqual(result.assumptions, [])
  }
})

test('network and cancellation failures propagate instead of becoming geometry proposals', async () => {
  const failure = new Error('Network unavailable')
  await assert.rejects(repairAssemblyLocally(spec, issue(collision('a', 'b', 100)), [advance], async () => null,
    async () => { throw failure }), (error) => error === failure)
  const partStrategy: AssemblyRepairStrategy = { ...advance, propose: async (current, _message, checkPart) => {
    await checkPart({ schemaVersion: '3.0', units: 'mm', partId: 'a', steps: current.components[0].steps })
    return null
  } }
  const cancelled = new DOMException('Cancelled', 'AbortError')
  await assert.rejects(repairAssemblyLocally(spec, issue(collision('a', 'b', 100)), [partStrategy],
    async () => { throw cancelled }, async () => null), (error) => error === cancelled)
})

test('accepted progress is available for checkpointing before a later network failure', async () => {
  let checkpoint = spec
  let checks = 0
  await assert.rejects(repairAssemblyLocally(spec, issue(collision('a', 'b', 100)), [advance], async () => null,
    async () => {
      if (++checks > 1) throw new Error('Disconnected')
      return issue(collision('a', 'b', 50))
    }, undefined, undefined, (progress) => { checkpoint = progress.spec }), /Disconnected/)
  assert.equal(checkpoint.components[0].position.x, 1)
})
