import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three'
import { createEmptyScene, createNode, parseScene, removeSubtree, validateScene, type SceneNode } from '../../src/three/sceneDocument.ts'
import { sampleNodeTransform } from '../../src/three/sceneAnimation.ts'
import { buildNodeGeometry } from '../../src/three/sceneGeometry.ts'
import { terrainHeightAt } from '../../src/three/sceneGeometrySpec.ts'
import { inspectSceneGeometry } from '../../src/three/sceneInspection.ts'
import { applySceneEdit, expandSceneRecipe } from '../../src/three/sceneGeneration.ts'
import { createIslandScene } from '../../src/three/scenePreset.ts'
import { advanceRuntime, createRuntime, pressInteractionKey, runtimePose, triggerInteraction, updateProximity } from '../../src/three/sceneRuntime.ts'
import { buildStaticCollider, emptyInput, stepPlayer, type PlayerState } from '../../src/three/scenePlayer.ts'
import { editorShortcut, playerKey } from '../../src/three/sceneKeyboard.ts'

const single = { mode: 'linear', count: 1, offset: [0, 0, 0], radius: 0, axis: 'y', columns: 1, jitter: 0, seed: 1, onto: null }
function template(node: SceneNode, repeat: Record<string, unknown> = single) {
  return { ...node, color: node.material.color, metalness: 0, roughness: 0.5, repeat }
}
function door() {
  const hinge = { ...createNode('group'), id: 'hinge', animation: { kind: 'keyframes' as const, axis: 'y' as const, duration: 2, amplitude: 0, phase: 0, start: 'trigger' as const, easing: 'linear' as const,
    keys: [{ at: 0, move: [0, 0, 0] as [number, number, number], turn: [0, 0, 0] as [number, number, number], scale: [1, 1, 1] as [number, number, number] }, { at: 1, move: [0, 0, 0] as [number, number, number], turn: [0, -90, 0] as [number, number, number], scale: [1, 1, 1] as [number, number, number] }] } }
  const panel = { ...createNode('box', hinge.id), id: 'panel', interaction: { trigger: 'click' as const, key: '', radius: 3, action: 'toggleAnimation' as const, targetId: hinge.id, message: '' } }
  return validateScene({ ...createEmptyScene(), nodes: [hinge, panel] })
}

test('1.1 documents migrate to 1.2 with studio defaults and new contracts are validated', () => {
  const legacy = { ...createEmptyScene(), version: '1.1', environment: { background: '#ffffff', exposure: 1, lightIntensity: 1, grid: true, wireframe: false } }
  const migrated = parseScene(JSON.stringify(legacy))
  assert.equal(migrated.version, '1.2')
  assert.equal(migrated.environment.sky, 'studio')
  assert.equal(migrated.environment.player!.spawn, null)
  const light = createNode('light')
  assert.equal(validateScene({ ...createEmptyScene(), nodes: [light] }).nodes[0].light!.type, 'point')
  assert.throws(() => validateScene({ ...createEmptyScene(), nodes: [{ ...light, light: { ...light.light!, intensity: 5000 } }] }), /Intensidade/)
  assert.throws(() => validateScene({ ...createEmptyScene(), nodes: Array.from({ length: 33 }, () => createNode('light')) }), /32 luzes/)
  const box = createNode('box')
  assert.throws(() => validateScene({ ...createEmptyScene(), nodes: [{ ...box, interaction: { trigger: 'key', key: 'w', radius: 2, action: 'message', targetId: null, message: '' } }] }), /Tecla/)
  assert.throws(() => validateScene({ ...createEmptyScene(), nodes: [{ ...box, interaction: { trigger: 'click', key: '', radius: 2, action: 'toggleAnimation', targetId: null, message: '' } }] }), /animação inexistente/)
  assert.throws(() => validateScene({ ...createEmptyScene(), nodes: [{ ...box, interaction: { trigger: 'click', key: '', radius: 2, action: 'message', targetId: 'missing', message: '' } }] }), /alvo inexistente/)
  const doc = door()
  assert.equal(removeSubtree(doc, 'hinge').nodes.length, 0)
  const target = { ...createNode('box'), id: 'target' }, trigger = { ...createNode('box'), id: 'switch', interaction: { trigger: 'key' as const, key: '1', radius: 2, action: 'toggleVisibility' as const, targetId: 'target', message: '' } }
  assert.equal(removeSubtree(validateScene({ ...createEmptyScene(), nodes: [target, trigger] }), 'target').nodes[0].interaction, undefined)
})

test('new primitives produce finite normalized geometry and terrain heights follow the triangulated surface', () => {
  for (const kind of ['plane', 'capsule', 'polyhedron', 'terrain', 'text'] as const) {
    const node = createNode(kind)
    if (kind === 'polyhedron') node.geometry = { ...node.geometry, variant: 'dodecahedron', detail: 1, bevel: 0.15 }
    const geometry = buildNodeGeometry(node), bounds = geometry.boundingBox!
    assert.ok([...geometry.getAttribute('position').array].every(Number.isFinite), kind)
    assert.ok(bounds.max.x <= 0.50001 && bounds.min.x >= -0.50001, kind)
    geometry.dispose()
  }
  const terrain = createNode('terrain'), geometry = buildNodeGeometry(terrain), position = geometry.getAttribute('position')
  for (const index of [0, 77, 1500, position.count - 1]) assert.ok(Math.abs(terrainHeightAt(terrain.geometry, position.getX(index), position.getZ(index)) - position.getY(index)) < 1e-5)
  geometry.dispose()
})

test('pulse, swing, bounce and keyframes sample absolute poses; triggered motion rests until played', () => {
  const node = createNode('box')
  node.animation = { kind: 'pulse', axis: 'y', duration: 4, amplitude: 0.5, phase: 0, start: 'auto', easing: 'smooth', keys: [] }
  assert.ok(Math.abs(sampleNodeTransform(node, 1).scale[0] - 1.5) < 1e-9)
  node.animation.kind = 'swing'; node.animation.amplitude = 30
  assert.ok(Math.abs(sampleNodeTransform(node, 1).rotation[1] - 30) < 1e-9)
  node.animation.kind = 'bounce'; node.animation.amplitude = 2
  assert.ok(sampleNodeTransform(node, 3).position[1] > node.position[1])
  const doc = door(), hinge = doc.nodes[0]
  assert.deepEqual(sampleNodeTransform(hinge, 1).rotation, [0, 0, 0])
  assert.deepEqual(sampleNodeTransform(hinge, 1, 0.5).rotation, [0, -45, 0])
  assert.deepEqual(sampleNodeTransform(hinge, 1, 1).rotation, [0, -90, 0])
})

test('runtime opens and closes doors, collects items, toggles hidden groups by key and re-arms proximity', () => {
  const doc = door(), runtime = createRuntime(doc)
  assert.deepEqual(runtimePose(runtime, doc.nodes[0]).rotation, [0, 0, 0])
  triggerInteraction(runtime, 'panel')
  advanceRuntime(runtime, 1)
  assert.deepEqual(runtimePose(runtime, doc.nodes[0]).rotation, [0, -45, 0])
  advanceRuntime(runtime, 5)
  assert.deepEqual(runtimePose(runtime, doc.nodes[0]).rotation, [0, -90, 0])
  triggerInteraction(runtime, 'panel')
  advanceRuntime(runtime, 5)
  assert.deepEqual(runtimePose(runtime, doc.nodes[0]).rotation, [0, 0, 0])
  assert.deepEqual(doc.nodes[0].rotation, [0, 0, 0])

  const gem = { ...createNode('polyhedron'), id: 'gem', name: 'Cristal', interaction: { trigger: 'proximity' as const, key: '', radius: 1, action: 'collect' as const, targetId: null, message: '' } }
  const lamps = { ...createNode('group'), id: 'lamps', interaction: { trigger: 'key' as const, key: '1', radius: 3, action: 'toggleVisibility' as const, targetId: null, message: 'Luzes' } }
  const game = createRuntime(validateScene({ ...createEmptyScene(), nodes: [gem, lamps] }))
  const positions = new Map([['gem', [0, 0, 0] as [number, number, number]]])
  assert.deepEqual(updateProximity(game, [5, 0, 0], positions), [])
  assert.deepEqual(updateProximity(game, [0.5, 0, 0], positions), ['Cristal coletado · 1/1'])
  assert.equal(game.hidden.has('gem'), true)
  assert.deepEqual(updateProximity(game, [5, 0, 0], positions), [])
  assert.deepEqual(updateProximity(game, [0.5, 0, 0], positions), [])
  assert.deepEqual(pressInteractionKey(game, '1'), ['Luzes'])
  assert.equal(game.hidden.has('lamps'), true)
  pressInteractionKey(game, '1')
  assert.equal(game.hidden.has('lamps'), false)
})

test('player capsule lands on baked colliders, is blocked by walls and moving boxes, and can fly', () => {
  const floor = new THREE.BoxGeometry(20, 1, 20), wall = new THREE.BoxGeometry(1, 4, 20)
  const { bvh, omitted } = buildStaticCollider([{ geometry: floor, matrix: new THREE.Matrix4().makeTranslation(0, -0.5, 0) }, { geometry: wall, matrix: new THREE.Matrix4().makeTranslation(3, 2, 0) }])
  assert.equal(omitted, 0)
  const state: PlayerState = { position: new THREE.Vector3(0, 3, 0), velocity: new THREE.Vector3(), yaw: 0, pitch: 0, onGround: false, fly: false }
  const collider = { bvh, boxes: [], floor: -50 }
  for (let i = 0; i < 120; i++) stepPlayer(state, emptyInput(), collider, { speed: 4, jumpHeight: 1 }, 1 / 60)
  assert.ok(Math.abs(state.position.y) < 0.05 && state.onGround)
  const right = { ...emptyInput(), right: true }
  for (let i = 0; i < 180; i++) stepPlayer(state, right, collider, { speed: 4, jumpHeight: 1 }, 1 / 60)
  assert.ok(state.position.x < 2.5 - 0.3 + 0.02, `blocked by wall at ${state.position.x}`)
  const back = { ...emptyInput(), back: true }
  const box = { center: new THREE.Vector3(0, 1, 2), axes: [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)] as [THREE.Vector3, THREE.Vector3, THREE.Vector3], half: new THREE.Vector3(5, 1, 0.5) }
  state.position.set(0, 0, 0)
  for (let i = 0; i < 120; i++) stepPlayer(state, back, { ...collider, boxes: [box] }, { speed: 4, jumpHeight: 1 }, 1 / 60)
  assert.ok(state.position.z < 1.5 - 0.3 + 0.02, `blocked by box at ${state.position.z}`)
  state.fly = true
  for (let i = 0; i < 60; i++) stepPlayer(state, { ...emptyInput(), up: true }, collider, { speed: 4, jumpHeight: 1 }, 1 / 60)
  assert.ok(state.position.y > 3)
  floor.dispose(); wall.dispose(); bvh!.geometry.dispose()
})

test('grid, scatter and onto recipes expand deterministically on terrain with declared contacts', () => {
  const terrain = { ...createNode('terrain'), id: 'ground', position: [0, 1, 0] as [number, number, number], dimensions: [40, 4, 40] as [number, number, number] }
  const tree = { ...createNode('cylinder'), id: 'tree', dimensions: [0.4, 3, 0.4] as [number, number, number] }
  const tile = { ...createNode('box'), id: 'tile', position: [25, 0.5, 0] as [number, number, number], dimensions: [0.9, 0.1, 0.9] as [number, number, number] }
  const recipe = { name: 'Bosque', background: '#112233', exposure: 1, lightIntensity: 1, duration: 10,
    environment: { sky: 'day', sunElevation: 40, sunAzimuth: 20, fog: 0.01, bloom: 0.5, ambientOcclusion: false, toneMapping: 'agx', player: { spawn: null, yaw: 0, speed: 5, jumpHeight: 1, mode: 'walk' } },
    nodes: [template(terrain), template(tree, { ...single, mode: 'scatter', count: 60, offset: [30, 0, 30], seed: 7, jitter: 0.5, onto: 'ground' }),
      template(tile, { ...single, mode: 'grid', count: 12, columns: 4, offset: [1, 0, 1] })] }
  const doc = expandSceneRecipe(recipe)
  assert.deepEqual(expandSceneRecipe(recipe), doc)
  assert.equal(doc.environment.sky, 'day')
  const trees = doc.nodes.filter((node) => node.id.startsWith('tree'))
  assert.ok(trees.length > 30)
  for (const item of trees) {
    const surface = 1 + terrainHeightAt(terrain.geometry, item.position[0] / 40, item.position[2] / 40) * 4
    assert.ok(Math.abs(item.position[1] - (surface + 3 * item.scale[1] * 0.46)) < 1e-9)
    assert.ok(item.overlapWith.includes('ground'))
  }
  for (let i = 0; i < trees.length; i++) for (let j = i + 1; j < trees.length; j++) assert.ok(Math.hypot(trees[i].position[0] - trees[j].position[0], trees[i].position[2] - trees[j].position[2]) > 0.4)
  const tiles = doc.nodes.filter((node) => node.id.startsWith('tile'))
  assert.deepEqual(tiles[5].position.map((value) => Math.round(value * 1000) / 1000), [26, 0.5, 1])
  assert.equal(inspectSceneGeometry(doc).intersections.length, 0)
  assert.throws(() => expandSceneRecipe({ ...recipe, nodes: [template(tree, { ...single, onto: 'missing' })] }), /onto/)
})

test('edits patch the environment and remove interactions without touching other nodes', () => {
  const doc = door()
  const result = applySceneEdit(doc, { updates: [{ id: 'panel', changes: { interaction: null } }], additions: [], environment: { sky: 'night', bloom: 1 } })
  assert.equal(result.nodes[1].interaction, undefined)
  assert.equal(result.environment.sky, 'night')
  assert.deepEqual(result.nodes[0], doc.nodes[0])
  assert.throws(() => applySceneEdit(doc, { updates: [], additions: [], environment: { sky: 'mars' } }), /Céu/)
})

test('editor and play keyboard maps follow 3D editor and FPS conventions', () => {
  const key = (code: string, value: string, extra: Partial<KeyboardEvent> = {}) => ({ code, key: value, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...extra })
  assert.deepEqual(editorShortcut(key('KeyW', 'w')), { command: 'translate' })
  assert.deepEqual(editorShortcut(key('KeyZ', 'z', { ctrlKey: true })), { command: 'undo' })
  assert.deepEqual(editorShortcut(key('KeyZ', 'Z', { ctrlKey: true, shiftKey: true })), { command: 'redo' })
  assert.deepEqual(editorShortcut(key('ArrowRight', 'ArrowRight', { shiftKey: true })), { command: 'nudge', axis: 0, amount: 1 })
  assert.deepEqual(editorShortcut(key('Digit7', '7')), { command: 'view', view: 'top' })
  assert.equal(editorShortcut(key('KeyW', 'w', { altKey: true })), null)
  assert.equal(playerKey('KeyW'), 'forward')
  assert.equal(playerKey('ArrowLeft'), 'turnLeft')
  assert.equal(playerKey('KeyE'), null)
})

test('the playable island is detailed, interactive and free of unexpected intersections in every sampled pose', () => {
  const doc = createIslandScene()
  assert.deepEqual(parseScene(JSON.stringify(doc)), doc)
  assert.ok(doc.nodes.length > 250)
  assert.ok(doc.nodes.some((node) => node.kind === 'terrain'))
  assert.ok(doc.nodes.filter((node) => node.kind === 'light').length >= 6)
  assert.equal(doc.nodes.filter((node) => node.interaction?.action === 'collect').length, 8)
  assert.ok(doc.nodes.some((node) => node.animation.start === 'trigger'))
  assert.ok(doc.environment.player!.spawn)
  const inspection = inspectSceneGeometry(doc)
  assert.equal(inspection.complete, true)
  assert.deepEqual(inspection.intersections, [])
})

test('AI recipes are adjusted to the contract instead of discarding the scene', async () => {
  const { SanitizeLog } = await import('../../src/three/sceneRecipeSanitize.ts')
  const terrain = { ...createNode('terrain'), id: 'island', dimensions: [40, 4, 40] as [number, number, number], geometry: { segments: 200 } }
  const village = { ...createNode('group'), id: 'village', position: [2, 0, -3] as [number, number, number] }
  const tree = { ...createNode('cylinder', 'village'), id: 'tree', dimensions: [0.4, 3, 0.4] as [number, number, number] }
  const broken = { ...createNode('extrude'), id: 'broken', geometry: { profile: [[-1, -1], [1, 1], [-1, 1], [1, -1]] } }
  const recipe = { name: 'Vila', background: 'azul', exposure: 9, lightIntensity: 1, duration: 500,
    nodes: [template(tree, { ...single, mode: 'scatter', count: 20, offset: [20, 0, 20], seed: 3, onto: 'island' }), template(village), template(terrain as unknown as SceneNode),
      template(broken as unknown as SceneNode), template({ ...createNode('box'), id: 'ghost', parentId: 'missing' } as SceneNode), template({ ...createNode('box'), id: 'lamp', overlapWith: ['nowhere'] } as SceneNode)] }
  assert.throws(() => expandSceneRecipe(recipe), /Segmentos/)
  const log = new SanitizeLog()
  const doc = expandSceneRecipe(recipe, () => {}, [], { lenient: true, log })
  const warnings = log.summary().join(' ')
  assert.equal(doc.nodes.find((node) => node.id === 'island')!.geometry.segments, 128)
  assert.match(warnings, /Segmentos/)
  assert.match(warnings, /forma padrão/)
  assert.equal(doc.nodes.find((node) => node.id === 'ghost')!.parentId, null)
  assert.deepEqual(doc.nodes.find((node) => node.id === 'lamp')!.overlapWith, [])
  assert.equal(doc.environment.exposure, 1.1)
  const island = doc.nodes.find((node) => node.id === 'island')!
  const trees = doc.nodes.filter((node) => node.id.startsWith('tree'))
  assert.ok(trees.length > 5)
  for (const item of trees) {
    assert.equal(item.parentId, 'village')
    const surface = island.position[1] + terrainHeightAt(island.geometry, (item.position[0] + 2) / 40, (item.position[2] - 3) / 40) * 4
    assert.ok(Math.abs(item.position[1] - (surface + 3 * item.scale[1] * 0.46)) < 1e-9)
  }
})

test('a deadline during the adjustment call delivers the best scene already built', async () => {
  const { generateThreeScene, SceneGenerationTimeoutError } = await import('../../src/three/sceneGeneration.ts')
  const a = { ...createNode('box'), id: 'a', dimensions: [40, 1, 40] as [number, number, number] }, b = { ...createNode('box'), id: 'b', dimensions: [40, 1, 40] as [number, number, number], position: [5, 0.5, 0] as [number, number, number] }
  const recipe = { name: 'Prazo', background: '#112233', exposure: 1, lightIntensity: 1, duration: 10, nodes: [template(a), template(b)] }
  const controller = new AbortController()
  let calls = 0
  const provider = { id: 'fixture', isAvailable: async () => true, initialize: async () => {}, generateStructured: async <T>() => {
    if (++calls === 1) return recipe as T
    controller.abort(new SceneGenerationTimeoutError(300, { stage: 'waiting', attempt: 2, detail: '' }))
    return new Promise<T>(() => {})
  } }
  const doc = await generateThreeScene(provider, 'Duas caixas', controller.signal)
  assert.equal(doc.nodes.length, 2)
  assert.equal(calls, 2)
  const cancelled = new AbortController()
  const pending = generateThreeScene({ ...provider, generateStructured: async <T>() => { cancelled.abort(new Error('Cancelado pelo usuário')); return new Promise<T>(() => {}) } }, 'Duas caixas', cancelled.signal)
  await assert.rejects(pending, /Cancelado/)
})

test('co-scattered trunks and crowns align, keep their height on terrain and houses resting on slopes are contacts', async () => {
  const { SanitizeLog } = await import('../../src/three/sceneRecipeSanitize.ts')
  const terrain = { ...createNode('terrain'), id: 'hill', position: [0, 1, 0] as [number, number, number], dimensions: [60, 6, 60] as [number, number, number] }
  const scatter = { ...single, mode: 'scatter', count: 25, offset: [40, 0, 40], seed: 9, jitter: 0, onto: 'hill' }
  const trunk = { ...createNode('cylinder'), id: 'trunk', position: [0, 1.5, 0] as [number, number, number], dimensions: [0.4, 3, 0.4] as [number, number, number] }
  const crown = { ...createNode('sphere'), id: 'crown', position: [0, 4, 0] as [number, number, number], dimensions: [3, 3, 3] as [number, number, number] }
  const house = { ...createNode('box'), id: 'house', position: [25, 1 + terrainHeightAt(terrain.geometry, 25 / 60, 0) * 6 + 1.2, 0] as [number, number, number], dimensions: [6, 3, 6] as [number, number, number] }
  const doc = expandSceneRecipe({ name: 'Bosque', background: '#112233', exposure: 1, lightIntensity: 1, duration: 10,
    nodes: [template(trunk, scatter), template(crown, scatter), template(terrain), template(house)] }, () => {}, [], { lenient: true, log: new SanitizeLog() })
  const trunks = doc.nodes.filter((node) => node.id.startsWith('trunk')), crowns = doc.nodes.filter((node) => node.id.startsWith('crown'))
  assert.equal(trunks.length, crowns.length)
  for (const [index, item] of trunks.entries()) {
    assert.deepEqual([item.position[0], item.position[2]], [crowns[index].position[0], crowns[index].position[2]])
    assert.ok(crowns[index].position[1] - item.position[1] > 2)
  }
  const report = inspectSceneGeometry(doc)
  assert.equal(report.complete, true)
  assert.deepEqual(report.intersections.map((issue) => `${issue.nameA}|${issue.nameB}`), [])
})

test('every prefab expands to a detailed assembly without unexpected intersections in any pose', async () => {
  const { prefabTypes } = await import('../../src/three/scenePrefabs.ts')
  for (const type of prefabTypes) {
    const doc = expandSceneRecipe({ name: type, background: '#112233', exposure: 1, lightIntensity: 1, duration: 12,
      nodes: [{ ...template({ ...createNode('box'), id: type }), prefab: { type, size: 1, seed: 3, primary: null, secondary: null, text: 'Olá', lit: true, interactive: true } }] })
    assert.ok(doc.nodes.length >= 2, type)
    const report = inspectSceneGeometry(doc)
    assert.equal(report.complete, true, type)
    assert.deepEqual(report.intersections.map((issue) => `${issue.nameA}|${issue.nameB}`), [], type)
  }
})

test('repeated prefab groups copy their subtree, rest on terrain and wire each door to its own hinge', () => {
  const terrain = { ...createNode('terrain'), id: 'ground', position: [0, 1, 0] as [number, number, number], dimensions: [80, 3, 80] as [number, number, number] }
  const house = { ...template({ ...createNode('box'), id: 'house' }, { ...single, mode: 'scatter', count: 4, offset: [50, 0, 50], seed: 5, onto: 'ground' }),
    prefab: { type: 'house', size: 1, seed: 1, primary: null, secondary: null, text: '', lit: false, interactive: true } }
  const doc = expandSceneRecipe({ name: 'Vila', background: '#112233', exposure: 1, lightIntensity: 1, duration: 12, nodes: [house, template(terrain)] })
  const houses = doc.nodes.filter((node) => node.id === 'house' || /^house~\d$/.test(node.id))
  assert.equal(houses.length, 4)
  for (const [index, root] of houses.entries()) {
    const scope = index ? `@${index + 1}` : ''
    const door = doc.nodes.find((node) => node.id === `house.door${scope}`)!
    assert.equal(door.interaction!.targetId, `house.hinge${scope}`)
    assert.equal(doc.nodes.find((node) => node.id === `house.hinge${scope}`)!.parentId, root.id)
    const ground = doc.nodes.find((node) => node.id === 'ground')!
    assert.ok(Math.abs(root.position[1] - (1 + terrainHeightAt(ground.geometry, root.position[0] / 80, root.position[2] / 80) * 3)) < 1e-9)
    for (const [dx, dz] of [[2.5, 2], [-2.5, -2], [2.5, -2], [-2.5, 2]]) assert.ok(Math.abs(1 + terrainHeightAt(ground.geometry, (root.position[0] + dx) / 80, (root.position[2] + dz) / 80) * 3 - root.position[1]) < 0.05, 'floor area is flat')
  }
  const report = inspectSceneGeometry(doc)
  assert.equal(report.complete, true)
  assert.ok(report.assemblyContacts > 0)
})

test('roads follow the terrain, scattered props avoid roads and water, and structures flatten their ground', async () => {
  const { SanitizeLog } = await import('../../src/three/sceneRecipeSanitize.ts')
  const terrain = { ...createNode('terrain'), id: 'land', position: [0, 2, 0] as [number, number, number], dimensions: [120, 8, 120] as [number, number, number] }
  terrain.geometry = { ...terrain.geometry, closed: true, seed: 4 }
  const sea = { ...createNode('plane'), id: 'sea', position: [0, 0.5, 0] as [number, number, number], dimensions: [300, 0.01, 300] as [number, number, number], collidable: false }
  sea.material = { ...sea.material, texture: 'water' }
  const tree = { ...createNode('group'), id: 'tree' }
  const recipe = { name: 'Trilha', background: '#112233', exposure: 1, lightIntensity: 1, duration: 10,
    roads: [{ name: 'Estrada principal', points: [[-40, 0], [0, 10], [40, 0]], width: 4, texture: 'sand', onto: 'land' }],
    nodes: [template(terrain), { ...template(sea), surface: { texture: 'water' } }, { ...template(tree, { ...single, mode: 'scatter', count: 80, offset: [110, 0, 110], seed: 2, onto: 'land' }), prefab: { type: 'tree', size: 1, seed: 1, primary: null, secondary: null, text: '', lit: false, interactive: false } }] }
  const doc = expandSceneRecipe(recipe, () => {}, [], { lenient: true, log: new SanitizeLog() })
  const land = doc.nodes.find((node) => node.id === 'land')!, road = doc.nodes.find((node) => node.id === 'road-1')!
  const height = (x: number, z: number) => 2 + terrainHeightAt(land.geometry, x / 120, z / 120) * 8
  assert.equal(road.kind, 'mesh')
  const vertices = road.geometry.vertices
  for (let i = 0; i < vertices.length; i += 30) assert.ok(Math.abs(vertices[i + 1] - (height(vertices[i], vertices[i + 2]) + 0.06)) < 1e-6)
  const trees = doc.nodes.filter((node) => /^tree(~\d+)?$/.test(node.id))
  assert.ok(trees.length > 10)
  for (const item of trees) {
    assert.ok(height(item.position[0], item.position[2]) > 0.85, 'tree placed in the water')
    const near = [[-40, 0, 0, 10], [0, 10, 40, 0]].some(([ax, az, bx, bz]) => { const dx = bx - ax, dz = bz - az, t = Math.max(0, Math.min(1, ((item.position[0] - ax) * dx + (item.position[2] - az) * dz) / (dx * dx + dz * dz))); return Math.hypot(item.position[0] - ax - dx * t, item.position[2] - az - dz * t) < 2.2 })
    assert.ok(!near, 'tree placed on the road')
  }
})

test('game rules: invulnerability after damage, stomp/strike defeats, goal needs the objective, time limit and auto victory', async () => {
  const { checkOutcome, createRuntime, damagePlayer, defeatEnemy, objectiveStatus, reachGoal, advanceRuntime } = await import('../../src/three/sceneRuntime.ts')
  const enemy = { ...createNode('group'), id: 'slime', behavior: { type: 'enemy' as const, speed: 2, range: 8, damage: 30 } }
  const goal = { ...createNode('box'), id: 'goal', behavior: { type: 'goal' as const, speed: 0, range: 1, damage: 0 } }
  const coin = { ...createNode('box'), id: 'coin', interaction: { trigger: 'proximity' as const, key: '', radius: 1, action: 'collect' as const, targetId: null, message: '' } }
  const doc = validateScene({ ...createEmptyScene(), nodes: [enemy, goal, coin], environment: { ...createEmptyScene().environment, objective: { type: 'collectAll', title: '', timeLimit: 0 } } })
  const runtime = createRuntime(doc)
  assert.equal(damagePlayer(runtime, 30), true)
  assert.equal(damagePlayer(runtime, 30), false)
  assert.equal(runtime.health, 70)
  advanceRuntime(runtime, 1.1)
  assert.equal(damagePlayer(runtime, 30), true)
  assert.match(reachGoal(runtime)!, /fechado/)
  triggerInteraction(runtime, 'coin')
  assert.equal(objectiveStatus(runtime).done, true)
  assert.equal(defeatEnemy(runtime, 'slime'), true)
  assert.equal(runtime.hidden.has('slime'), true)
  assert.equal(reachGoal(runtime), 'Fase concluída!')
  assert.equal(runtime.outcome, 'won')
  const timed = createRuntime(validateScene({ ...doc, environment: { ...doc.environment, objective: { type: 'defeatEnemies', title: 'Limpe a ilha', timeLimit: 5 } } }))
  advanceRuntime(timed, 6)
  checkOutcome(timed)
  assert.equal(timed.outcome, 'lost')
  const auto = createRuntime(validateScene({ ...createEmptyScene(), nodes: [coin], environment: { ...createEmptyScene().environment, objective: { type: 'collectAll', title: '', timeLimit: 0 } } }))
  triggerInteraction(auto, 'coin')
  checkOutcome(auto)
  assert.equal(auto.outcome, 'won')
})

test('ladders lift the player while pressing forward and release at the top', () => {
  const ladder = { center: new THREE.Vector3(0, 2, -0.6), axes: [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)] as [THREE.Vector3, THREE.Vector3, THREE.Vector3], half: new THREE.Vector3(0.3, 2, 0.05) }
  const state: PlayerState = { position: new THREE.Vector3(0, 0, 0), velocity: new THREE.Vector3(), yaw: 0, pitch: 0, onGround: true, fly: false }
  const collider = { bvh: null, boxes: [], floor: 0, climb: [ladder] }
  let highest = 0
  for (let i = 0; i < 120; i++) { stepPlayer(state, { ...emptyInput(), forward: true }, collider, { speed: 4, jumpHeight: 1 }, 1 / 30); highest = Math.max(highest, state.position.y) }
  assert.ok(highest > 4, `climbed to ${highest}`)
  assert.ok(highest < 5, 'the climb stops just above the ladder top')
})
