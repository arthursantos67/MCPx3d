import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createEmptyScene, createNode, type ThreeSceneDocument } from '../../src/three/sceneDocument.ts'
import { betterSceneCandidate, lostSceneContent } from '../../src/three/sceneCandidateQuality.ts'
import { generateThreeScene, type SceneGenerationReport } from '../../src/three/sceneGeneration.ts'
import { inspectSceneGeometry } from '../../src/three/sceneInspection.ts'
import { auditScene } from '../../src/three/sceneLayout.ts'
import type { LLMProvider } from '../../../../packages/agent/src/provider.ts'

test('a cleaner refinement cannot erase a character and its dialogue to win selection', async () => {
  const nodes = [
    { ...createNode('box'), id: 'a', dimensions: [40, 1, 40] },
    { ...createNode('box'), id: 'b', dimensions: [40, 1, 40], position: [5, 0.5, 0] },
    { ...createNode('sphere'), id: 'guide', name: 'Guia', collidable: false, position: [0, 2, 0],
      behavior: { type: 'npc', speed: 0, range: 2, damage: 0 },
      interaction: { action: 'dialogue', trigger: 'click', radius: 3, key: '', targetId: null, message: 'O portão está ao norte.' } },
  ].map(node => ({ ...node, color: '#abcdef', metalness: 0, roughness: 0.5, repeat: { mode: 'linear', count: 1, offset: [0, 0, 0], axis: 'y', radius: 0 } }))
  const source = { name: 'Encontro', duration: 12, background: '#112233', exposure: 1, lightIntensity: 1, nodes }
  const emptied = { ...source, nodes: [{ ...nodes[0] }, { ...nodes[1], position: [45, 0.5, 0] }] }
  const replies = [source, emptied]
  const provider: LLMProvider = { id: 'fixture', isAvailable: async () => true, initialize: async () => {}, generateStructured: async <T>() => replies.shift() as T }
  let report: SceneGenerationReport | undefined
  const result = await generateThreeScene(provider, 'Duas peças', new AbortController().signal, () => {}, () => {}, value => { report = value })
  assert.ok(result.nodes.some(node => node.id === 'guide' && node.interaction?.action === 'dialogue'))
  assert.ok(report?.warnings.some(warning => warning.includes('conteúdo funcional')))
  assert.equal(replies.length, 0, 'both recipes were actually compared')
})

test('reachable content outranks a lower collision count and partial inspection cannot claim success', () => {
  const scene = { ...createEmptyScene(), nodes: [createNode('box')] }
  const inspection = inspectSceneGeometry(scene), audit = auditScene(scene, inspection)
  const safe = { inspection: { ...inspection, intersections: [{ a: 'wall', b: 'trim', nameA: 'Wall', nameB: 'Trim', kind: 'surface' as const, times: [0] }] }, audit, direction: [] }
  const stranded = { inspection, audit: { ...audit, unreachable: ['Relíquia'] }, direction: [] }
  assert.equal(betterSceneCandidate(stranded, safe), false)
  assert.equal(betterSceneCandidate(safe, stranded), true)
  assert.equal(betterSceneCandidate({ ...safe, inspection: { ...inspection, complete: false } }, safe), false)
})

test('renamed and rebuilt content is retained, but hiding it or deleting a key is content loss', () => {
  const character = { ...createNode('group'), id: 'guide', interaction: { action: 'dialogue' as const, trigger: 'click' as const, radius: 3, key: '', targetId: null, message: 'Olá' } }
  const key = { ...createNode('sphere'), id: 'key', interaction: { action: 'collect' as const, trigger: 'proximity' as const, radius: 1, key: '', targetId: null, message: '', item: 'Chave azul' } }
  const before: ThreeSceneDocument = { ...createEmptyScene(), nodes: [character, key] }
  assert.deepEqual(lostSceneContent(before, { ...before, nodes: [{ ...character, id: 'new-guide' }, { ...key, id: 'new-key' }] }), [])
  assert.ok(lostSceneContent(before, { ...before, nodes: [{ ...character, visible: false }, key] }).length > 0)
  assert.ok(lostSceneContent(before, { ...before, nodes: [character] }).some(item => item.includes('Chave azul')))
  const reveal = { ...createNode('box'), id: 'lever', interaction: { action: 'toggleVisibility' as const, trigger: 'click' as const, radius: 3, key: '', targetId: 'guide', message: '' } }
  assert.deepEqual(lostSceneContent({ ...before, nodes: [...before.nodes, reveal] }, { ...before, nodes: [{ ...character, visible: false }, key, reveal] }), [])
})
