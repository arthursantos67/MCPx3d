import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { CadProgramSpec } from '../../domain/ts/src/cad-program.ts'
import { socketScrewRecess } from '../../domain/ts/src/cad-fasteners.ts'
import { prepareCadDesign, cadStockDesignIssue } from '../src/cad-design-preparation.ts'

const zero = { x: 0, y: 0, z: 0 }
const spec: CadProgramSpec = { schemaVersion: '3.0', units: 'mm', partId: 'carriage', steps: [
  { id: 'stock', op: 'base', shape: 'box', position: zero, rotation: zero, width: 50, depth: 80, height: 34 },
  { id: 'cavity', op: 'cut', shape: 'hole', position: { ...zero, x: 25, z: -10 }, rotation: { ...zero, y: 90 },
    diameter: 22.4, height: 50, holeType: 'plain', headDiameter: 0, headDepth: 0 },
  { id: 'mount', op: 'cut', shape: 'hole', position: { ...zero, y: 30 }, rotation: zero, height: 34, ...socketScrewRecess(5) },
] }

test('inferred stock conserves cavity walls and exposes the screw-head seat on the resized face', () => {
  const prepared = prepareCadDesign(spec, 'Carro para um mecanismo com fuso')
  const base = prepared.spec.steps[0]
  assert.ok(base.shape === 'box')
  assert.equal(base.height, 45)
  assert.equal(prepared.spec.steps[1].position.z, -10)
  assert.equal(prepared.spec.steps[2].position.z, 22.5)
  assert.equal(spec.steps[0].shape === 'box' && spec.steps[0].height, 34)
  assert.equal(prepared.assumptions.length, 2)
})

test('explicit stock dimensions and intentional open channels are preserved', () => {
  for (const request of ['Bloco 50×80×34', 'Bloco com altura: 34', 'Faça uma cavidade aberta']) {
    const prepared = prepareCadDesign(spec, request)
    assert.equal(prepared.spec.steps[0].shape === 'box' && prepared.spec.steps[0].height, 34)
  }
})

test('stock growth must not bury a threaded mounting hole on the original face', () => {
  const threaded: CadProgramSpec = { ...spec, steps: [...spec.steps, { id: 'thread_mount', op: 'cut', shape: 'thread',
    position: { ...zero, y: -30, z: 15 }, rotation: zero, diameter: 5, pitch: .8, height: 5,
    profile: 'metric', handedness: 'right', clearance: .15, starts: 1 }] }
  const prepared = prepareCadDesign(threaded, 'Carro com furos roscados no topo')
  assert.deepEqual(prepared.spec.steps[0], spec.steps[0])
  assert.deepEqual(prepared.spec.steps[3], threaded.steps[3])
})

test('socket-head presets contain real head height with explicit design clearance', () => {
  for (const [nominal, headDiameter, headDepth] of [[3, 6.5, 3.3], [5, 9.5, 5.3], [8, 14, 8.3]]) {
    const preset = socketScrewRecess(nominal)
    assert.equal(preset.headDiameter, headDiameter)
    assert.equal(preset.headDepth, headDepth)
    assert.ok(preset.headDiameter > preset.diameter)
  }
})

test('planar patterns expose every head entrance without changing the pattern', () => {
  const hole = spec.steps[2]
  const patterned: CadProgramSpec = { ...spec, steps: [spec.steps[0], { ...hole,
    pattern: { kind: 'linear', count: 2, offset: { x: 20, y: 0, z: 0 } } }] }
  const prepared = prepareCadDesign(patterned, 'Placa com furos de montagem')
  assert.equal(prepared.spec.steps[1].position.z, 17)
  assert.deepEqual(prepared.spec.steps[1].pattern, patterned.steps[1].pattern)
  assert.equal(cadStockDesignIssue(prepared.spec), null)
})

test('a buried entrance and a recess without a supporting seat are design errors even in a connected solid', () => {
  assert.match(cadStockDesignIssue(spec)!, /entrance is buried/)
  assert.ok(spec.steps[0].shape === 'box')
  const thin: CadProgramSpec = { ...spec, steps: [{ ...spec.steps[0], height: 4 }, { ...spec.steps[2], position: { ...zero, z: 2 } }] }
  assert.match(cadStockDesignIssue(thin)!, /no head-supporting seat/)
  const floating: CadProgramSpec = { ...spec, steps: [spec.steps[0], { ...spec.steps[2], position: { ...zero, z: 30 } }] }
  assert.match(cadStockDesignIssue(floating)!, /entirely outside/)
})
