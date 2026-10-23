import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three'
import { buildScene, createResources } from '../../src/three/sceneBuild.ts'
import { createNode } from '../../src/three/sceneDocument.ts'
import { expandSceneRecipe } from '../../src/three/sceneGeneration.ts'
import { buildCharacterSkins } from '../../src/three/sceneSkin.ts'
import { createAvatar } from '../../src/three/sceneAvatar.ts'
import { createEquipment, mountEquipment } from '../../src/three/sceneEquipment.ts'

const repeat = { mode: 'linear', count: 1, offset: [0, 0, 0], radius: 0, axis: 'y' }
function character(type: string, seed = 3) {
  const doc = expandSceneRecipe({ name: type, background: '#000000', exposure: 1, lightIntensity: 1, duration: 8, nodes: [{ ...createNode('group'), id: 'c', name: type, kind: 'group', position: [0, 0, 0], repeat,
    color: '#cccccc', metalness: 0, roughness: 0.6, prefab: { type, size: 1, seed, primary: null, secondary: null, text: '', lit: false, interactive: true } }] })
  const built = buildScene(doc, createResources(4), { instancing: false, helpers: false, skins: (d, holders) => buildCharacterSkins(d, holders, { quality: 'low', shadows: false }) })
  built.root.updateMatrixWorld(true)
  return { doc, built, skin: built.skins.get('c')! }
}
const world = (object: THREE.Object3D) => object.getWorldPosition(new THREE.Vector3())

test('held weapons, staves and baskets pass through the closed fist along their handle', () => {
  for (const [type, item, side, axis] of [['knight', 'sword', 'R', [0, 1, 0]], ['wizard', 'staff', 'R', [0, 1, 0]], ['orc', 'weapon', 'R', [0, 1, 0]], ['goblin', 'club', 'R', [0, 1, 0]], ['villager', 'basket', 'L', [1, 0, 0]]] as const) {
    const seed = type === 'villager' ? 11 : 3, { doc, built, skin } = character(type, seed)
    const node = doc.nodes.find((entry) => entry.assetPart === item)
    if (!node) continue
    const socket = skin.grips[side]!, holder = built.holders.get(node.id)!, palm = built.holders.get(doc.nodes.find((entry) => entry.assetPart === `palm${side}`)!.id)!
    assert.ok(world(holder).distanceTo(world(socket)) < 1e-6, `${type}: ${item} sits on the socket`)
    assert.ok(world(socket).distanceTo(world(palm)) < 0.09, `${type}: the socket is in the hand (${world(socket).distanceTo(world(palm)).toFixed(3)} m)`)
    const handle = new THREE.Vector3(...axis).applyQuaternion(holder.getWorldQuaternion(new THREE.Quaternion())), hole = new THREE.Vector3(0, 0, 1).applyQuaternion(socket.getWorldQuaternion(new THREE.Quaternion()))
    assert.ok(Math.abs(handle.dot(hole)) > 0.99, `${type}: the fist wraps the handle axis`)
    built.dispose()
  }
})

test('player weapons are seated in the fist, with staves upright and swords pointing ahead', () => {
  for (const [weapon, check] of [['sword', (z: THREE.Vector3) => z.z > 0.5], ['staff', (z: THREE.Vector3) => z.y > 0.9], ['blaster', () => true], ['bow', () => true]] as const) {
    const avatar = createAvatar('explorer', { quality: 'low', shadows: false }, weapon), skin = avatar.built.skins.get('avatar')!, equipment = createEquipment(weapon)
    assert.ok(mountEquipment(equipment, avatar.binding, avatar.built.holders, skin))
    avatar.built.root.updateMatrixWorld(true)
    const socket = skin.grips[equipment.hand]!
    assert.equal(equipment.object.parent, socket)
    assert.ok(world(equipment.object).distanceTo(world(socket)) < 1e-6)
    const z = new THREE.Vector3(0, 0, 1).applyQuaternion(equipment.object.getWorldQuaternion(new THREE.Quaternion()))
    assert.ok(check(z), `${weapon}: carried along its natural axis ${z.toArray().map((v) => v.toFixed(2))}`)
    assert.ok(equipment.object.children.length >= 4, `${weapon}: modelled from several shaped parts`)
    assert.ok(equipment.object.children.some((child) => child instanceof THREE.Mesh && !(child.geometry instanceof THREE.BoxGeometry)), `${weapon}: not only boxes`)
    equipment.dispose(); avatar.built.dispose(); avatar.resources.dispose()
  }
})

test('scene characters keep white eyes; only authored glowing eyes emit', () => {
  const tone = (skin: ReturnType<typeof character>['skin']) => {
    const shader = { uniforms: {} as Record<string, { value: THREE.Color[] }>, vertexShader: '', fragmentShader: '' }
    ;(skin.meshes[0].material as THREE.Material[])[3].onBeforeCompile(shader as never, undefined as never)
    return shader.uniforms
  }
  const villager = tone(character('villager', 7).skin), goblin = tone(character('goblin').skin)
  assert.ok(villager.eyeTone.value[0].getHSL({ h: 0, s: 0, l: 0 }).l > 0.7, 'sclera is light')
  assert.ok(villager.eyeShine.value.every((color) => color.r + color.g + color.b === 0), 'plain eyes do not glow')
  assert.ok(goblin.eyeShine.value.some((color) => color.r + color.g + color.b > 0), 'goblin eyes glow as authored')
})
