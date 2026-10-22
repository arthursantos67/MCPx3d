import assert from 'node:assert/strict'
import test from 'node:test'
import { createNode, subtreeIds, validateBehavior, validateScene, type ThreeSceneDocument } from '../../src/three/sceneDocument.ts'
import { estimateTriangles } from '../../src/three/sceneGeometrySpec.ts'
import { expandSceneRecipe } from '../../src/three/sceneGeneration.ts'
import { prefabRootBehavior, prefabSpec, structurePrefabs } from '../../src/three/scenePrefabs.ts'
import { orbPower, worldNaturalPrefabs, worldPrefabTypes, worldStructurePrefabs, type WorldPrefabType } from '../../src/three/scenePrefabsWorld.ts'
import { createRuntime, triggerInteraction } from '../../src/three/sceneRuntime.ts'

const single = { mode: 'linear', count: 1, offset: [0, 0, 0], radius: 0, axis: 'y', columns: 1, jitter: 0, seed: 1, onto: null }
type Options = { seed?: number; size?: number; text?: string; lit?: boolean; interactive?: boolean; position?: [number, number, number]; id?: string }
function entry(type: WorldPrefabType, options: Options = {}) {
  const base = createNode('box')
  return { id: options.id ?? type, parentId: null, name: type, kind: 'group', position: options.position ?? [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], dimensions: [1, 1, 1],
    color: base.material.color, metalness: 0, roughness: 0.5, animation: base.animation, repeat: single, overlapWith: [],
    prefab: { type, size: options.size ?? 1, seed: options.seed ?? 0, primary: null, secondary: null, text: options.text ?? '', lit: options.lit ?? false, interactive: options.interactive ?? true } }
}
const scene = (...nodes: ReturnType<typeof entry>[]): ThreeSceneDocument => expandSceneRecipe({ name: 'Mundo', background: '#112233', exposure: 1, lightIntensity: 1, duration: 12, nodes })
const expand = (type: WorldPrefabType, options: Options = {}) => scene(entry(type, options))
const interactions = (doc: ThreeSceneDocument) => doc.nodes.filter((node) => node.interaction)

test('every world prefab expands into a valid scene for seeds, sizes, lighting and interactivity', () => {
  for (const type of worldPrefabTypes) for (const [seed, size, lit, interactive] of [[0, 1, false, true], [1, 2.5, true, true], [2, 0.6, false, false], [3, 5, true, true]] as const) {
    const doc = expand(type, { seed, size, lit, interactive, text: seed % 2 ? 'Relíquia' : '' })
    assert.doesNotThrow(() => validateScene(doc), `${type} seed=${seed}`)
    assert.ok(doc.nodes.length > 3, `${type} deve ter detalhes`)
    assert.ok(doc.nodes.every((node) => node.id === type || node.id.startsWith(`${type}.`)))
    if (!interactive) assert.equal(interactions(doc).length, 0, `${type} sem interações quando interactive=false`)
  }
})

test('world prefabs keep triangle budgets reasonable and declare their terrain role', () => {
  for (const type of worldPrefabTypes) {
    const doc = expand(type, { lit: true, seed: 1 })
    const triangles = doc.nodes.reduce((sum, node) => sum + estimateTriangles(node.kind, node.geometry), 0)
    assert.ok(triangles < 40000, `${type}: ${triangles} triângulos`)
    assert.ok(doc.nodes.filter((node) => node.kind === 'light').length <= 3, `${type}: luzes demais`)
    assert.equal(doc.nodes[0].role, worldStructurePrefabs.includes(type) ? 'structure' : 'prop')
  }
  for (const type of worldStructurePrefabs) assert.ok(structurePrefabs.includes(type))
  assert.ok(!worldStructurePrefabs.some((type) => worldNaturalPrefabs.includes(type)))
})

test('gate and chest require the item named by text; without text they open freely', () => {
  for (const type of ['gate', 'chest'] as const) {
    const locked = interactions(expand(type, { text: 'Chave de ferro' }))
    assert.ok(locked.length > 0)
    for (const node of locked) {
      assert.equal(node.interaction!.action, 'toggleAnimation')
      assert.equal(node.interaction!.requires, 'Chave de ferro')
      assert.match(node.interaction!.message, /Chave de ferro/)
    }
    assert.ok(interactions(expand(type)).every((node) => node.interaction!.requires === undefined))
    assert.equal(interactions(expand(type, { interactive: false, text: 'Chave de ferro' })).length, 0)
  }
  const doc = expand('gate', { text: 'Chave de ferro' })
  const target = interactions(doc)[0].interaction!.targetId!
  const animated = [...subtreeIds(doc.nodes, target)].filter((id) => doc.nodes.find((node) => node.id === id)!.animation.kind === 'keyframes')
  assert.equal(animated.length, 2, 'duas folhas articuladas')
  const open = expand('gate', { interactive: false })
  assert.ok(open.nodes.every((node) => node.animation.kind === 'none'), 'arco estático aberto')
})

test('a gate stays shut until the matching key is collected', () => {
  const doc = scene(entry('gate', { text: 'Chave de ferro' }), entry('key', { id: 'chave', text: 'Chave de ferro', position: [0, 0, 6] }))
  const runtime = createRuntime(doc)
  const leaf = doc.nodes.find((node) => node.interaction?.action === 'toggleAnimation')!
  const hinges = [...subtreeIds(doc.nodes, leaf.interaction!.targetId!)].filter((id) => runtime.states.has(id))
  triggerInteraction(runtime, leaf.id)
  assert.ok(hinges.every((id) => runtime.states.get(id)!.direction === -1), 'trancado sem a chave')
  const key = doc.nodes.find((node) => node.interaction?.action === 'collect')!
  assert.equal(key.interaction!.item, 'Chave de ferro')
  triggerInteraction(runtime, key.id)
  triggerInteraction(runtime, leaf.id)
  assert.ok(hinges.every((id) => runtime.states.get(id)!.direction === 1), 'abre com a chave')
})

test('pickups: key collects an item, heart heals, power orb grants a chosen or seeded power', () => {
  const key = interactions(expand('key'))[0].interaction!
  assert.deepEqual([key.trigger, key.action, key.item, key.targetId], ['proximity', 'collect', 'Chave dourada', null])
  assert.match(key.message, /Chave dourada/)
  assert.equal(interactions(expand('key', { text: 'Selo rúnico' }))[0].interaction!.item, 'Selo rúnico')
  const heart = expand('heart')
  const heal = interactions(heart)[0]
  assert.deepEqual([heal.interaction!.trigger, heal.interaction!.action, heal.interaction!.amount, heal.interaction!.targetId, heal.interaction!.radius], ['proximity', 'heal', 35, null, 1.4])
  assert.ok(heart.nodes.filter((node) => node.kind !== 'group' && node.kind !== 'light').every((node) => node.collidable === false))
  for (const power of ['speed', 'jump', 'shield', 'strength'] as const) {
    const orb = interactions(expand('powerOrb', { text: power }))[0].interaction!
    assert.deepEqual([orb.action, orb.power, orb.amount, orb.targetId], ['powerup', power, 12, null])
  }
  const seeded = [0, 1, 2, 3].map((seed) => interactions(expand('powerOrb', { seed, text: 'qualquer' }))[0].interaction!.power)
  assert.deepEqual(seeded, ['speed', 'jump', 'shield', 'strength'])
  assert.equal(orbPower({ text: ' Shield ', seed: 0 }), 'shield')
  assert.equal(interactions(expand('heart', { interactive: false })).length, 0)
})

test('lever toggles its own handle; moving platform loops about 4 m scaled by size', () => {
  const lever = interactions(expand('lever'))
  assert.equal(lever.length, 1)
  assert.deepEqual([lever[0].interaction!.action, lever[0].interaction!.targetId, lever[0].interaction!.message], ['toggleAnimation', null, 'Alavanca acionada'])
  assert.equal(lever[0].animation.kind, 'keyframes')
  const mover = expand('movingPlatform', { size: 2 }).nodes.find((node) => node.animation.kind === 'keyframes')!
  assert.equal(mover.animation.start, 'auto')
  assert.equal(Math.max(...mover.animation.keys!.map((key) => key.move[0])), 8)
  assert.ok(expand('movingPlatform').nodes.some((node) => node.kind === 'box' && node.collidable !== false))
})

test('turret and jump pad declare validated root behaviors; ambient props carry sounds', () => {
  for (const size of [1, 2, 5]) {
    const turret = prefabRootBehavior(prefabSpec({ type: 'turret', size })!)!
    assert.deepEqual(validateBehavior(turret), turret)
    assert.deepEqual(turret, { type: 'enemy', speed: 0, range: Math.min(80, 18 * size), damage: 15, health: 4, attack: 'ranged' })
    const pad = prefabRootBehavior(prefabSpec({ type: 'jumpPad', size })!)!
    assert.deepEqual(validateBehavior(pad), pad)
    assert.deepEqual(pad, { type: 'launcher', speed: 0, range: 6 * size, damage: 0 })
  }
  assert.equal(expand('turret').nodes[0].behavior?.type, 'enemy')
  assert.equal(expand('jumpPad', { size: 2 }).nodes[0].behavior?.range, 12)
  assert.equal(prefabRootBehavior(prefabSpec({ type: 'castleWall' })!), null)
  for (const [type, preset] of [['fountain', 'water'], ['reactor', 'machine'], ['jumpPad', 'magic'], ['powerOrb', 'magic']] as const)
    assert.ok(expand(type).nodes.some((node) => node.sound?.preset === preset), `${type} deve soar ${preset}`)
  assert.ok(expand('castleWall').nodes.some((node) => node.behavior?.type === 'climbable'), 'muralha tem escada até o adarve')
})
