import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createEmptyScene, createNode, parseScene, validateScene, type NodeKind, type ThreeSceneDocument, type Vector3Tuple } from '../../src/three/sceneDocument.ts'
import { defaultGeometry, terrainHeights, terrainHeightAt, terrainStyles } from '../../src/three/sceneGeometrySpec.ts'
import { buildNodeGeometry, geometryKey } from '../../src/three/sceneGeometry.ts'
import { createResources } from '../../src/three/sceneBuild.ts'
import { conformTerrainPaths } from '../../src/three/sceneGrounding.ts'
import { inferSceneAction, reviewSceneDirection } from '../../src/three/sceneDirection.ts'
import { applySceneEdit, expandSceneRecipe, generateThreeScene, type SceneGenerationReport } from '../../src/three/sceneGeneration.ts'
import { SanitizeLog } from '../../src/three/sceneRecipeSanitize.ts'
import { createValleyScene } from '../../src/three/sceneShowcase.ts'
import { auditScene, prepareScene } from '../../src/three/sceneLayout.ts'
import { inspectSceneGeometry } from '../../src/three/sceneInspection.ts'
import type { LLMProvider } from '../../../../packages/agent/src/provider.ts'

const single = { mode: 'linear', count: 1, offset: [0, 0, 0], radius: 0, axis: 'y' }
const template = (id: string, kind: NodeKind, position: Vector3Tuple = [0, 0.5, 0], color = '#ffffff') => ({ ...createNode(kind), id, position, color, metalness: 0, roughness: 0.7, repeat: single })
const recipe = (nodes: unknown[]) => ({ name: 'Cena', background: '#e0e5ea', exposure: 1, lightIntensity: 1, duration: 12, nodes })
const provider = (replies: unknown[], onCall: (messages: unknown) => void = () => {}): LLMProvider => ({
  id: 'fixture', initialize: async () => {}, isAvailable: async () => true,
  generateStructured: async <T>(messages: unknown) => { onCall(messages); const reply = replies.shift(); if (reply instanceof Error) throw reply; return reply as T },
})

test('terrain styles, biomes and pads are deterministic, use physical slopes and survive project round trips', () => {
  const node = { ...createNode('terrain'), dimensions: [80, 18, 100] as Vector3Tuple, geometry: { ...defaultGeometry('terrain'), segments: 32, biome: 'alpine' as const } }
  const fields = terrainStyles.map((terrainStyle) => terrainHeights({ ...node.geometry, terrainStyle }))
  for (let i = 1; i < fields.length; i++) assert.notDeepEqual(fields[0], fields[i])
  const a = buildNodeGeometry(node), b = buildNodeGeometry(node)
  assert.deepEqual(a.getAttribute('color').array, b.getAttribute('color').array)
  assert.ok(new Set(a.getAttribute('color').array).size > 100)
  const wide = { ...node, dimensions: [800, 18, 800] as Vector3Tuple }
  assert.notEqual(geometryKey(node), geometryKey(wide))
  const c = buildNodeGeometry(wide)
  assert.notDeepEqual(a.getAttribute('color').array, c.getAttribute('color').array)
  const resources = createResources()
  assert.equal(resources.material(node, false).vertexColors, true)
  assert.equal(resources.material({ ...node, geometry: { ...node.geometry, biome: 'none' } }, false).vertexColors, false)
  resources.dispose(); a.dispose(); b.dispose(); c.dispose()
  const geometry = { ...node.geometry, terrainStyle: 'ridged' as const, pads: [[0, 0, 0.2, 0.2, 0.12]] }
  assert.ok(Math.abs(terrainHeightAt(geometry, 0, 0) - 0.12) < 1e-6)
  const scene = validateScene({ ...createEmptyScene(), nodes: [{ ...node, geometry }] })
  assert.deepEqual(parseScene(JSON.stringify(scene)), scene)
})

test('roads follow final building pads, remain attached after terrain edits and cannot collide with template IDs', () => {
  const scene = expandSceneRecipe({ ...recipe([
    { ...template('ground', 'terrain', [0, 0, 0]), dimensions: [40, 8, 40] },
    { ...template('road-1', 'group', [1, 0, 1]), prefab: { type: 'house', size: 1, seed: 1 }, repeat: { ...single, onto: 'ground' } },
  ]), roads: [{ name: 'Trilha', points: [[-10, 4], [10, 4]], width: 2, texture: 'sand', onto: 'ground' }] })
  assert.equal(new Set(scene.nodes.map((node) => node.id)).size, scene.nodes.length)
  const road = scene.nodes.find((node) => node.role === 'path')!, ground = scene.nodes.find((node) => node.id === 'ground')!
  for (let i = 0; i < road.geometry.vertices.length; i += 3) {
    const [x, y, z] = road.geometry.vertices.slice(i, i + 3)
    assert.ok(Math.abs(y - (terrainHeightAt(ground.geometry, x / 40, z / 40) * 8 + 0.06)) < 1e-5)
  }
  const changed = { ...scene, nodes: scene.nodes.map((node) => node.id === 'ground' ? { ...node, geometry: { ...node.geometry, seed: 91, pads: [] } } : node) }
  const projected = conformTerrainPaths(changed)
  assert.notDeepEqual(projected.nodes.find((node) => node.id === road.id)!.geometry.vertices, road.geometry.vertices)
  assert.equal(conformTerrainPaths(projected), projected)
  assert.deepEqual(projected.nodes.find((node) => node.id === 'road-1'), scene.nodes.find((node) => node.id === 'road-1'))
  const onlyPaths = { ...changed, nodes: changed.nodes.filter((node) => node.kind === 'terrain' || node.role === 'path') }
  assert.deepEqual(prepareScene(onlyPaths).document.nodes.find((node) => node.role === 'path')!.geometry.vertices,
    conformTerrainPaths(onlyPaths).nodes.find((node) => node.role === 'path')!.geometry.vertices)
})

test('conversational edits remove complete groups, clean references and preserve partial player settings and behaviors', () => {
  const group = { ...createNode('group'), id: 'building' }, child = { ...createNode('box', 'building'), id: 'wall' }
  const button = { ...createNode('box'), id: 'button', overlapWith: ['wall'], interaction: { trigger: 'click' as const, key: '', radius: 3, action: 'toggleVisibility' as const, targetId: 'building', message: '' } }
  const scene = validateScene({ ...createEmptyScene(), nodes: [group, child, button], environment: { ...createEmptyScene().environment,
    player: { spawn: [4, 0, 8], yaw: 45, speed: 5, jumpHeight: 1.4, mode: 'walk', health: 180, allowFly: false, camera: 'third' } } })
  const next = applySceneEdit(scene, { updates: [{ id: 'button', changes: { behavior: { type: 'hazard', speed: 0, range: 2, damage: 10 } } }], additions: [], removals: ['building'], environment: { exposure: 1.6, player: { speed: 7 } } }, new SanitizeLog())
  assert.deepEqual(next.nodes.map((node) => node.id), ['button'])
  assert.deepEqual(next.nodes[0].overlapWith, [])
  assert.equal(next.nodes[0].interaction, undefined)
  assert.equal(next.nodes[0].behavior?.damage, 10)
  assert.equal(next.environment.exposure, 1.6)
  assert.deepEqual(next.environment.player, { ...scene.environment.player, speed: 7 })
  assert.throws(() => applySceneEdit(scene, { updates: [], additions: [], removals: ['missing'] }), /ID inexistente/)
  assert.equal(scene.nodes.length, 3)
  const mechanism = validateScene({ ...createEmptyScene(), nodes: [group,
    { ...child, animation: { ...child.animation, kind: 'spin' } },
    { ...button, interaction: { ...button.interaction, action: 'toggleAnimation', targetId: group.id } },
  ] })
  const withoutMotion = applySceneEdit(mechanism, { updates: [], additions: [], removals: [child.id] })
  assert.equal(withoutMotion.nodes.length, 2)
  assert.equal(withoutMotion.nodes.find((node) => node.id === button.id)!.interaction, undefined)
})

test('scene requests choose creation, editing and repair without requiring technical configuration', () => {
  assert.equal(inferSceneAction('Uma vila nas montanhas', false), 'create')
  assert.equal(inferSceneAction('Adicione árvores à cena', false), 'edit')
  assert.equal(inferSceneAction('Mais flores', true), 'edit')
  assert.equal(inferSceneAction('Crie outra cena do zero', true), 'create')
  assert.equal(inferSceneAction('Corrija as sobreposições da cena', true), 'repair')
  assert.deepEqual(reviewSceneDirection({ ...createEmptyScene(), nodes: [createNode('box')] }, 'Uma caixa de madeira'), [])
})

test('generation refines visual shortcomings once and preserves the first candidate if refinement fails', async () => {
  const poor = recipe([template('block', 'box')])
  const rich = recipe((['box', 'sphere', 'cylinder', 'cone'] as const).map((kind, index) => ({ ...template(`part-${index}`, kind, [0, 1, index * 4], ['#987654', '#abcdef', '#667788', '#cc8855'][index]), repeat: { ...single, count: 4, offset: [4, 0, 0] } })))
  let calls = 0
  const generated = await generateThreeScene(provider([poor, rich], (messages) => { calls++; assert.ok(JSON.stringify(messages).includes('DIREÇÃO DE PRODUÇÃO')) }), 'Uma cidade de brinquedo', new AbortController().signal)
  assert.equal(calls, 2)
  assert.equal(generated.nodes.length, 16)
  assert.deepEqual(reviewSceneDirection(generated, 'Uma cidade de brinquedo'), [])
  let report: SceneGenerationReport | undefined
  const fallback = await generateThreeScene(provider([poor, new Error('quota')]), 'Uma cidade neon à noite', new AbortController().signal, () => {}, () => {}, (value) => { report = value })
  assert.equal(fallback.nodes.length, 1)
  assert.ok(report!.warnings.some((warning) => warning.includes('quota')))
  assert.ok(report!.warnings.some((warning) => warning.includes('Revisão de qualidade')))
})

test('the default reference level is detailed, audited, playable and independent across openings', () => {
  const scene = createValleyScene(), inspection = inspectSceneGeometry(scene)
  assert.ok(scene.nodes.length > 800)
  assert.equal(inspection.complete, true)
  assert.equal(auditScene(scene, inspection).total, 0)
  assert.equal(scene.nodes.filter((node) => node.interaction?.action === 'collect').length, 7)
  assert.ok(scene.nodes.some((node) => node.behavior?.type === 'goal'))
  assert.deepEqual(reviewSceneDirection(scene, 'Vila em um vale para explorar e coletar cristais'), [])
  const original: ThreeSceneDocument = structuredClone(scene)
  scene.nodes[0].position[0] += 100
  assert.deepEqual(createValleyScene(), original)
})
