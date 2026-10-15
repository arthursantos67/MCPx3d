import assert from 'node:assert/strict'
import { test } from 'node:test'
import { commitScene, createEmptyScene, createNode, duplicateSubtree, MAX_SCENE_NODES, parseScene, redoScene,
  subtreeIds, undoScene, validateScene, type SceneHistory } from '../../src/three/sceneDocument.ts'
import { createPavilionScene } from '../../src/three/scenePreset.ts'

test('pavilion round trips through the portable document and contains organized detail', () => {
  const doc = createPavilionScene()
  assert.deepEqual(parseScene(JSON.stringify(doc)), doc)
  assert.ok(doc.nodes.length > 80)
  assert.ok(doc.nodes.some((node) => node.kind === 'group' && doc.nodes.some((child) => child.parentId === node.id)))
})

test('rejects ambiguous IDs, missing/non-group parents and cyclic hierarchies', () => {
  const doc = createEmptyScene(), a = createNode('group'), b = createNode('group', a.id)
  assert.throws(() => validateScene({ ...doc, nodes: [a, a] }), /duplicados/)
  assert.throws(() => validateScene({ ...doc, nodes: [b] }), /grupo existente/)
  assert.throws(() => validateScene({ ...doc, nodes: [{ ...a, kind: 'box' }, b] }), /grupo existente/)
  assert.throws(() => validateScene({ ...doc, nodes: [{ ...a, parentId: b.id }, b] }), /ciclos/)
})

test('rejects non-finite, out-of-range and untyped rendering data', () => {
  const node = createNode('box'), doc = { ...createEmptyScene(), nodes: [node] }
  for (const invalid of [NaN, Infinity, -Infinity, 10001, '0']) {
    assert.throws(() => validateScene({ ...doc, nodes: [{ ...node, position: [invalid, 0, 0] }] }), /Posição/)
  }
  assert.throws(() => validateScene({ ...doc, nodes: [{ ...node, scale: [0, 1, 1] }] }), /Escala/)
  assert.throws(() => validateScene({ ...doc, nodes: [{ ...node, visible: 'false' }] }), /Visibilidade/)
  assert.throws(() => validateScene({ ...doc, nodes: [{ ...node, material: { ...node.material, color: 'red' } }] }), /Cor/)
  assert.throws(() => validateScene({ ...doc, version: '2.0' }), /Versão/)
  assert.throws(() => validateScene({ ...doc, nodes: [{ ...node, kind: '__proto__' }] }), /Tipo/)
})

test('bounds hierarchy depth, node count and imported bytes', () => {
  const nodes = [createNode('group')]
  for (let i = 1; i < 12; i++) nodes.push(createNode('group', nodes[i - 1].id))
  const doc = { ...createEmptyScene(), nodes }
  assert.equal(validateScene(doc).nodes.length, 12)
  assert.throws(() => validateScene({ ...doc, nodes: [...nodes, createNode('box', nodes.at(-1)!.id)] }), /12 níveis/)
  assert.throws(() => validateScene({ ...doc, nodes: Array.from({ length: MAX_SCENE_NODES + 1 }, () => createNode('box')) }), /2000 nós/)
  assert.throws(() => parseScene(' '.repeat(32 * 1024 * 1024 + 1)), /32 MB/)
  assert.throws(() => parseScene('{"version":'), SyntaxError)
})

test('duplicates a complete subtree with independent IDs and correct parent references', () => {
  const root = createNode('group'), child = createNode('group', root.id), leaf = createNode('torus', child.id), other = createNode('box')
  const doc = { ...createEmptyScene(), nodes: [root, child, leaf, other] }
  const result = duplicateSubtree(doc, root.id)
  assert.equal(result.document.nodes.length, 7)
  assert.deepEqual(result.document.nodes.slice(0, 4), doc.nodes)
  const copies = result.document.nodes.slice(4)
  assert.equal(copies[0].id, result.selectedId)
  assert.equal(copies[0].parentId, null)
  assert.equal(copies[1].parentId, copies[0].id)
  assert.equal(copies[2].parentId, copies[1].id)
  assert.equal(copies[0].position[0], root.position[0] + 1.25)
  copies[2].material.color = '#000000'
  assert.notEqual(leaf.material.color, copies[2].material.color)
  const removed = result.document.nodes.filter((node) => !subtreeIds(result.document.nodes, root.id).has(node.id))
  assert.equal(validateScene({ ...doc, nodes: removed }).nodes.length, 4)
})

test('history preserves valid states, bounds memory and invalidates redo on a new branch', () => {
  const doc = createEmptyScene()
  let history: SceneHistory = { past: [], present: doc, future: [] }
  assert.equal(undoScene(history), history)
  assert.equal(redoScene(history), history)
  assert.equal(commitScene(history, structuredClone(doc)), history)
  for (let i = 0; i < 60; i++) history = commitScene(history, { ...doc, name: `Cena ${i}` })
  assert.equal(history.past.length, 50)
  const previous = history
  history = undoScene(history)
  assert.equal(history.present.name, 'Cena 58')
  assert.deepEqual(redoScene(history), previous)
  assert.throws(() => commitScene(history, { ...doc, name: '' }), /Nome/)
  history = commitScene(history, { ...doc, name: 'Novo caminho' })
  assert.equal(history.future.length, 0)
})
