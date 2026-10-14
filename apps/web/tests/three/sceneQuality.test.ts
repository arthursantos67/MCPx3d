import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createEmptyScene, createNode, validateScene } from '../../src/three/sceneDocument.ts'
import { buildNodeGeometry } from '../../src/three/sceneGeometry.ts'
import { inspectSceneGeometry } from '../../src/three/sceneInspection.ts'
import { applySceneEdit, editThreeScene, generateThreeScene, SceneSpatialError } from '../../src/three/sceneGeneration.ts'
import { insertionPosition } from '../../src/three/scenePlacement.ts'
import { createOrbitalScene } from '../../src/three/scenePreset.ts'
import type { AgentMessage, LLMProvider } from '../../../../packages/agent/src/provider.ts'

function overlapping() {
  const a = { ...createNode('box'), id: 'a' }, b = { ...createNode('box'), id: 'b', position: [0.25, 0.5, 0] as [number, number, number] }
  return validateScene({ ...createEmptyScene(), nodes: [a, b] })
}
function fake(replies: unknown[], onCall: (messages: unknown) => void = () => {}): LLMProvider {
  return { id: 'fixture', isAvailable: async () => true, initialize: async () => {}, generateStructured: async <T>(messages: readonly AgentMessage[]) => { onCall(messages); if (!replies.length) throw new Error('Unexpected model call'); return replies.shift() as T } }
}

test('procedural geometry produces finite normalized surfaces beyond primitives', () => {
  for (const kind of ['roundedBox', 'extrude', 'lathe', 'tube', 'torusKnot', 'mesh', 'cone'] as const) {
    const node = createNode(kind), geometry = buildNodeGeometry(node)
    assert.ok(geometry.getAttribute('position').count > 3)
    assert.ok([...geometry.getAttribute('position').array].every(Number.isFinite))
    const bounds = geometry.boundingBox!
    assert.ok(bounds.min.x >= -0.50001 && bounds.max.x <= 0.50001)
    assert.ok(bounds.min.y >= -0.50001 && bounds.max.y <= 0.50001)
    geometry.dispose()
  }
  const scene = createOrbitalScene()
  assert.ok(scene.nodes.some((node) => node.kind === 'lathe'))
  assert.ok(scene.nodes.some((node) => node.kind === 'extrude'))
  assert.ok(scene.nodes.some((node) => node.material.texture === 'solar'))
  const inspection = inspectSceneGeometry(scene)
  assert.equal(inspection.complete, true)
  assert.equal(inspection.intersections.length, 0)
})

test('invalid profiles, geometry indices and rendering budgets are rejected', () => {
  const node = createNode('extrude'), doc = createEmptyScene()
  assert.throws(() => validateScene({ ...doc, nodes: [{ ...node, geometry: { ...node.geometry, profile: [[-1, -1], [1, 1], [-1, 1], [1, -1]] } }] }), /croisa|cruza/)
  assert.throws(() => validateScene({ ...doc, nodes: [{ ...node, geometry: { ...node.geometry, holes: [[[5, 5], [6, 5], [5, 6]]] } }] }), /fora do perfil/)
  const mesh = createNode('mesh')
  assert.throws(() => validateScene({ ...doc, nodes: [{ ...mesh, geometry: { ...mesh.geometry, indices: [0, 1, 99] } }] }), /vértice inexistente/)
  assert.throws(() => validateScene({ ...doc, nodes: Array.from({ length: 100 }, (_, i) => ({ ...createNode('sphere'), id: `n${i}`, geometry: { ...node.geometry, segments: 128 } })) }), /2 milhões/)
})

test('surface diagnostics distinguish intersections, containment, contact and a torus hole', () => {
  const doc = overlapping()
  assert.equal(inspectSceneGeometry(doc).intersections.length, 1)
  const contained = structuredClone(doc)
  contained.nodes[1].position = [...contained.nodes[0].position]
  contained.nodes[1].dimensions = [0.2, 0.2, 0.2]
  assert.equal(inspectSceneGeometry(contained).intersections[0].kind, 'containment')
  const contact = structuredClone(doc)
  contact.nodes[1].position = [1, 0.5, 0]
  assert.equal(inspectSceneGeometry(contact).intersections.length, 0)
  const torus = createNode('torus'), center = createNode('box')
  center.dimensions = [0.1, 0.1, 0.1]
  assert.equal(inspectSceneGeometry(validateScene({ ...createEmptyScene(), nodes: [torus, center] })).intersections.length, 0)
})

test('diagnostics respect hierarchy/visibility, declared contacts and sampled movement', () => {
  const doc = overlapping()
  doc.nodes[0].overlapWith = ['b']
  assert.equal(inspectSceneGeometry(doc).intersections.length, 0)
  assert.equal(inspectSceneGeometry(doc).skippedContacts, 1)
  doc.nodes[0].overlapWith = []
  const group = { ...createNode('group'), id: 'group', visible: false }
  doc.nodes[1].parentId = group.id; doc.nodes.push(group)
  assert.equal(inspectSceneGeometry(doc).intersections.length, 0)
  group.visible = true; group.position[0] = 3
  assert.equal(inspectSceneGeometry(doc).intersections.length, 0)
  const moving = overlapping()
  moving.nodes[1].position = [0, 2.5, 0]
  moving.nodes[0].animation = { kind: 'float', axis: 'y', amplitude: 2, duration: 4, phase: 0 }
  moving.timeline.duration = 4
  assert.deepEqual(inspectSceneGeometry(moving).intersections[0].times, [1])
  assert.equal(inspectSceneGeometry(overlapping(), { maxPairs: 0 }).complete, false)
})

test('insertion places wide objects beside existing geometry in the parent frame', () => {
  const doc = overlapping()
  doc.nodes = [doc.nodes[0]]; doc.nodes[0].dimensions = [10, 2, 2]
  const next = createNode('box'); next.dimensions = [6, 1, 1]
  assert.equal(insertionPosition(doc, next)[0], 8.25)
})

test('contextual patches preserve untouched IDs, geometry, animation and add details under existing groups', () => {
  const group = createNode('group'), node = createNode('box', group.id), untouched = createNode('tube')
  const doc = validateScene({ ...createEmptyScene(), nodes: [group, node, untouched] })
  const detail = createNode('roundedBox', group.id)
  const result = applySceneEdit(doc, { updates: [{ id: node.id, changes: { kind: 'lathe', position: [4, 0.5, 0], material: { clearcoat: 0.7 } } }], additions: [{ ...detail, color: '#abcdef', metalness: 0.5, roughness: 0.2,
    repeat: { mode: 'linear', count: 1, offset: [0, 0, 0], radius: 0, axis: 'y' } }] })
  assert.equal(result.nodes.length, 4)
  assert.deepEqual(result.nodes.find((item) => item.id === untouched.id), untouched)
  assert.equal(result.nodes.find((item) => item.id === node.id)!.geometry.profile.length, 7)
  assert.equal(result.nodes.at(-1)!.parentId, group.id)
  assert.throws(() => applySceneEdit(doc, { updates: [{ id: 'missing', changes: { visible: false } }], additions: [] }), /ID inexistente/)
  assert.throws(() => applySceneEdit(doc, { updates: [], additions: [], deleteIds: [node.id] }), /exclusões/)
})

test('repair operates on the existing scene and accepts only verified improvement', async () => {
  const doc = overlapping()
  let calls = 0
  const result = await editThreeScene(fake([{ updates: [{ id: 'b', changes: { position: [2, 0.5, 0] } }], additions: [] }], (messages) => { calls++; assert.ok(JSON.stringify(messages).includes('CENA E DIAGNÓSTICO')) }), doc, '', new AbortController().signal, { mode: 'repair' })
  assert.equal(calls, 1)
  assert.deepEqual(result.nodes.map((node) => node.id), ['a', 'b'])
  assert.equal(inspectSceneGeometry(result).intersections.length, 0)
  assert.deepEqual(doc.nodes[1].position, [0.25, 0.5, 0])
  await assert.rejects(editThreeScene(fake([{ updates: [{ id: 'b', changes: { visible: false } }], additions: [] }]), doc, '', new AbortController().signal, { mode: 'repair' }), /ocultar/)
  await assert.rejects(editThreeScene(fake([{ updates: [], additions: [] }, { updates: [], additions: [] }]), doc, '', new AbortController().signal, { mode: 'repair' }), /não reduziu/)
})

test('generation repairs overlaps before applying and never accepts an overlapping second candidate', async () => {
  const node = createNode('box')
  const source = { name: 'Two boxes', background: '#112233', exposure: 1, lightIntensity: 1, duration: 20, nodes: [{ ...node, id: 'piece', color: '#abcdef', metalness: 0, roughness: 0.5, repeat: { mode: 'linear', count: 2, offset: [0.2, 0, 0], radius: 0, axis: 'y' } }] }
  const fixed = structuredClone(source); fixed.nodes[0].repeat.offset = [2, 0, 0]
  const doc = await generateThreeScene(fake([source, fixed]), 'Duas peças separadas', new AbortController().signal)
  assert.equal(inspectSceneGeometry(doc).intersections.length, 0)
  await assert.rejects(generateThreeScene(fake([source, source]), 'Duas peças', new AbortController().signal), SceneSpatialError)
})
