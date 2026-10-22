import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three'
import { avatarKinds, type ThreeSceneDocument } from '../../src/three/sceneDocument.ts'
import { expandSceneRecipe } from '../../src/three/sceneGeneration.ts'
import { buildAvatar, characterTypes, type CharacterType } from '../../src/three/sceneCharacters.ts'
import { prefabParts, type PrefabSpec } from '../../src/three/scenePrefabs.ts'
import type { CharacterSpec } from '../../src/three/sceneCharacterArchetype.ts'
import { buildCharacterSkins, clearSkinCache, skinCacheSize, skinCharacter } from '../../src/three/sceneSkin.ts'
import { primDistance, primFrom, topology } from '../../src/three/sceneSkinGeometry.ts'
import { buildSkinModel } from '../../src/three/sceneSkinModel.ts'
import type { CharacterSkin } from '../../src/three/sceneRuntimeTypes.ts'

const single = { mode: 'linear', count: 1, offset: [0, 0, 0], radius: 0, axis: 'y', columns: 1, jitter: 0, seed: 1, onto: null }
const RIGID: CharacterType[] = ['skeleton', 'golem', 'drone']
const HUMANOIDS: CharacterType[] = ['villager', 'knight', 'wizard', 'astronaut', 'goblin', 'orc']
function character(type: CharacterType, seed = 1, extra: Partial<PrefabSpec> = {}): ThreeSceneDocument {
  return expandSceneRecipe({ name: type, background: '#112233', exposure: 1, lightIntensity: 1, duration: 12, nodes: [{
    id: type, parentId: null, name: type, kind: 'group', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], dimensions: [1, 1, 1], color: '#ffffff', metalness: 0, roughness: 0.5,
    animation: { kind: 'none', axis: 'y', duration: 6, amplitude: 0, phase: 0, start: 'auto', easing: 'smooth', keys: [] }, repeat: single, overlapWith: [],
    prefab: { type, size: 1, seed, primary: null, secondary: null, text: '', lit: false, interactive: true, ...extra } }] })
}
/** Holders exactly like sceneBuild: one Object3D per node, transforms from the document, parented as in the graph. */
function holdersOf(doc: ThreeSceneDocument): { root: THREE.Group; holders: Map<string, THREE.Object3D> } {
  const root = new THREE.Group(), holders = new Map<string, THREE.Object3D>()
  for (const node of doc.nodes) {
    const holder = node.kind === 'group' ? new THREE.Group() : new THREE.Object3D()
    holder.position.fromArray(node.position)
    holder.rotation.set(...node.rotation.map(THREE.MathUtils.degToRad) as [number, number, number])
    holder.scale.fromArray(node.scale)
    holders.set(node.id, holder)
  }
  for (const node of doc.nodes) (holders.get(node.parentId ?? '') ?? root).add(holders.get(node.id)!)
  root.updateMatrixWorld(true)
  return { root, holders }
}
function skinOf(type: CharacterType, seed = 1, extra: Partial<PrefabSpec> = {}, quality: 'high' | 'medium' | 'low' = 'high') {
  const doc = character(type, seed, extra), { root, holders } = holdersOf(doc), started = performance.now()
  const skins = buildCharacterSkins(doc, holders, { quality, shadows: true })
  return { doc, root, holders, skins, skin: skins[0] as CharacterSkin | undefined, milliseconds: performance.now() - started }
}
function skinnedPositions(mesh: THREE.SkinnedMesh, filter?: (index: number) => boolean): THREE.Vector3[] {
  let top: THREE.Object3D = mesh
  while (top.parent) top = top.parent
  top.updateMatrixWorld(true)
  mesh.skeleton.update()
  const out: THREE.Vector3[] = [], count = mesh.geometry.getAttribute('position').count
  for (let i = 0; i < count; i++) if (!filter || filter(i)) out.push(mesh.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld))
  return out
}
const components = (mesh: THREE.SkinnedMesh) => mesh.geometry.userData.components as { name: string; start: number; count: number }[]
const bodyRange = (mesh: THREE.SkinnedMesh) => components(mesh).find((c) => c.name === 'corpo')!

test('organic characters get a continuous skinned body; machines, bones and stone stay rigid', () => {
  clearSkinCache()
  for (const type of characterTypes) {
    const { doc, skins, skin } = skinOf(type)
    if (RIGID.includes(type)) { assert.equal(skins.length, 0, `${type} stays rigid`); continue }
    assert.equal(skins.length, 1, `${type} has a skin`)
    assert.ok(skin!.object instanceof THREE.LOD && skin!.meshes.length === 3, `${type}: three LOD levels`)
    const ids = new Set(doc.nodes.map((node) => node.id))
    assert.ok(skin!.hidden.size >= 8 && [...skin!.hidden].every((id) => ids.has(id)), `${type}: hidden proxies are document nodes`)
    assert.ok(skin!.meshes.every((mesh) => mesh.skeleton === skin!.meshes[0].skeleton), `${type}: LODs share the skeleton`)
    const triangles = skin!.meshes.map((mesh) => mesh.geometry.index!.count / 3)
    assert.ok(triangles[0] > triangles[1] && triangles[1] > triangles[2], `${type}: LOD triangles decrease ${triangles}`)
    assert.ok(triangles[0] <= 22000, `${type}: LOD0 budget ${triangles[0]}`)
    for (const [level, mesh] of skin!.meshes.entries()) {
      const geometry = mesh.geometry, position = geometry.getAttribute('position'), normal = geometry.getAttribute('normal')
      const weight = geometry.getAttribute('skinWeight'), index = geometry.getAttribute('skinIndex'), bones = mesh.skeleton.bones.length
      for (let i = 0; i < position.count; i++) {
        assert.ok(Number.isFinite(position.getX(i) + position.getY(i) + position.getZ(i)) && Number.isFinite(normal.getX(i) + normal.getY(i) + normal.getZ(i)), `${type} LOD${level}: NaN at ${i}`)
        const sum = weight.getX(i) + weight.getY(i) + weight.getZ(i) + weight.getW(i)
        assert.ok(Math.abs(sum - 1) < 1e-3, `${type} LOD${level}: weights sum ${sum}`)
        for (const k of [index.getX(i), index.getY(i), index.getZ(i), index.getW(i)]) assert.ok(k >= 0 && k < bones)
      }
      const body = bodyRange(mesh), shape = topology(geometry.index!.array.slice(body.start, body.start + body.count), position.count)
      const pieces = type === 'spider' || (type === 'dragon' && level === 2) ? 3 : 1
      assert.ok(shape.components <= pieces, `${type} LOD${level}: body is ${shape.components} pieces`)
      if (level === 2 || !HUMANOIDS.includes(type) || type === 'knight' || type === 'astronaut') assert.equal(shape.openEdges, 0, `${type} LOD${level}: body is closed`)
    }
  }
})

test('the open mouth is the only cut in a humanoid body and every edge elsewhere is shared twice', () => {
  const { skin, holders, doc } = skinOf('villager', 2)
  const mesh = skin!.meshes[0], body = bodyRange(mesh), index = mesh.geometry.index!.array, position = mesh.geometry.getAttribute('position')
  const head = holders.get(doc.nodes.find((node) => node.assetPart === 'head')!.id)!
  const mouth = new THREE.Vector3(0, -0.07 * 1.05, 0.1).applyMatrix4(head.matrixWorld), edges = new Map<string, number>()
  for (let t = body.start; t < body.start + body.count; t += 3) for (let e = 0; e < 3; e++) {
    const a = index[t + e], b = index[t + (e + 1) % 3], key = a < b ? `${a}:${b}` : `${b}:${a}`
    edges.set(key, (edges.get(key) ?? 0) + 1)
  }
  const open = [...edges].filter(([, n]) => n !== 2)
  assert.ok(open.length > 0, 'the lips are cut so the jaw can open')
  for (const [key] of open) {
    const v = new THREE.Vector3().fromBufferAttribute(position, Number(key.split(':')[0])).applyMatrix4(mesh.matrixWorld)
    assert.ok(v.distanceTo(mouth) < 0.06, `open edge away from the mouth at ${v.toArray().map((x) => x.toFixed(3))}`)
  }
})

test('skin follows the rig: a bent knee moves the shin vertices and leaves the head in place', () => {
  const { skin, holders, doc, root } = skinOf('villager', 1)
  const mesh = skin!.meshes[0], bones = mesh.skeleton.bones, knee = bones.findIndex((bone) => bone.name === 'skin:j_kneeL'), head = bones.findIndex((bone) => bone.name === 'skin:j_head')
  const weight = mesh.geometry.getAttribute('skinWeight'), index = mesh.geometry.getAttribute('skinIndex')
  const dominant = (bone: number) => (i: number) => index.getX(i) === bone && weight.getX(i) > 0.999
  const shinBefore = skinnedPositions(mesh, dominant(knee)), headBefore = skinnedPositions(mesh, dominant(head))
  assert.ok(shinBefore.length > 50 && headBefore.length > 50)
  const holder = holders.get(doc.nodes.find((node) => node.assetPart === 'j_kneeL')!.id)!
  holder.rotation.x += Math.PI / 3
  root.updateMatrixWorld(true)
  const shinAfter = skinnedPositions(mesh, dominant(knee)), headAfter = skinnedPositions(mesh, dominant(head))
  const moved = shinAfter.reduce((sum, p, i) => sum + p.distanceTo(shinBefore[i]), 0) / shinAfter.length
  const still = headAfter.reduce((max, p, i) => Math.max(max, p.distanceTo(headBefore[i])), 0)
  assert.ok(moved > 0.08, `shin moved ${moved}`)
  assert.ok(still < 1e-5, `head moved ${still}`)
  const pivot = new THREE.Vector3().setFromMatrixPosition(holder.matrixWorld)
  shinAfter.forEach((p, i) => assert.ok(Math.abs(p.distanceTo(pivot) - shinBefore[i].distanceTo(pivot)) < 1e-4, 'rigidly weighted vertices rotate about the knee'))
})

test('the rest-pose skin wraps the hidden proxies closely', () => {
  for (const type of ['villager', 'wizard', 'goblin', 'orc', 'wolf', 'deer', 'spider', 'dragon'] as CharacterType[]) {
    const { skin, doc, holders } = skinOf(type, 1)
    const proxies = doc.nodes.filter((node) => skin!.hidden.has(node.id) && ['sphere', 'capsule', 'lathe', 'cylinder', 'cone', 'box'].includes(node.kind)).map((node) => primFrom({
      kind: node.kind as 'sphere', dimensions: node.dimensions, matrix: holders.get(node.id)!.matrixWorld.elements, profile: node.geometry.profile as [number, number][] }))
    const mesh = skin!.meshes[0], body = bodyRange(mesh), used = new Set<number>()
    for (let t = body.start; t < body.start + body.count; t++) used.add(mesh.geometry.index!.getX(t))
    const points = skinnedPositions(mesh, (i) => used.has(i) && i % 3 === 0), distances = points.map((p) => Math.min(...proxies.map((prim) => Math.abs(primDistance(prim, p.x, p.y, p.z))))).sort((a, b) => a - b)
    const mean = distances.reduce((sum, d) => sum + d, 0) / distances.length, p95 = distances[Math.floor(distances.length * 0.95)], scale = type === 'dragon' ? 2.5 : 1
    console.log(`pele→proxy ${type}: média ${(mean * 100).toFixed(2)} cm, p95 ${(p95 * 100).toFixed(2)} cm`)
    assert.ok(mean < 0.025 * scale, `${type}: mean skin→proxy ${mean}`)
    assert.ok(p95 < 0.07 * scale, `${type}: p95 skin→proxy ${p95}`)
  }
})

test('skins are deterministic per seed, cached across rebuilds and vary with the seed', () => {
  clearSkinCache()
  const a = skinOf('villager', 4), positions = (s: ReturnType<typeof skinOf>) => Array.from(s.skin!.meshes[0].geometry.getAttribute('position').array as Float32Array)
  const reuse = skinOf('villager', 4)
  assert.equal(reuse.skin!.meshes[0].geometry, a.skin!.meshes[0].geometry, 'same spec reuses the cached geometry')
  assert.ok(reuse.milliseconds < a.milliseconds, `cache hit ${reuse.milliseconds} < first build ${a.milliseconds}`)
  const first = positions(a)
  clearSkinCache()
  assert.deepEqual(positions(skinOf('villager', 4)), first, 'rebuilding from scratch is deterministic')
  assert.notDeepEqual(positions(skinOf('villager', 5)), first, 'another seed gives another body')
  const size = skinCacheSize()
  a.skin!.dispose()
  assert.equal(skinCacheSize(), size, 'dispose keeps the cached geometry')
  assert.ok(a.skin!.meshes[0].geometry.getAttribute('position'), 'cached geometry is still usable')
  assert.ok(!a.skin!.object.parent, 'the LOD leaves the root')
  assert.ok(![...a.holders.values()].some((holder) => holder.children.some((child) => child instanceof THREE.Bone)), 'bones leave the joint holders')
})

test('faces blink, open the jaw, raise brows, smile and look around; long hair and capes hang on springs', () => {
  const { skin } = skinOf('villager', 3)
  const mesh = skin!.meshes[0], bones = mesh.skeleton.bones, weight = mesh.geometry.getAttribute('skinWeight'), index = mesh.geometry.getAttribute('skinIndex')
  const on = (name: string, min = 0.6) => { const b = bones.findIndex((bone) => bone.name === `skin:${name}`); assert.ok(b >= 0, name); return (i: number) => [0, 1, 2, 3].some((k) => index.getComponent(i, k) === b && weight.getComponent(i, k) > min) }
  const lowest = (points: THREE.Vector3[]) => Math.min(...points.map((p) => p.y)), average = (points: THREE.Vector3[]) => points.reduce((s, p) => s.add(p), new THREE.Vector3()).divideScalar(points.length)
  const lid = lowest(skinnedPositions(mesh, on('lidL'))), jaw = average(skinnedPositions(mesh, on('jaw'))), brow = average(skinnedPositions(mesh, on('browL')))
  const corner = average(skinnedPositions(mesh, on('mouthL', 0.3))), eye = skinnedPositions(mesh, on('eyeL'))
  skin!.setFace({ blink: 0, jaw: 0, brow: 0, smile: 1, gaze: [0, 0] })
  assert.ok(average(skinnedPositions(mesh, on('mouthL', 0.3))).y > corner.y + 0.0015, 'the corner of the mouth lifts')
  skin!.setFace({ blink: 1, jaw: 1, brow: 1, smile: 0, gaze: [0.4, 0] })
  assert.ok(lowest(skinnedPositions(mesh, on('lidL'))) < lid - 0.008, 'the upper lid closes')
  assert.ok(average(skinnedPositions(mesh, on('jaw'))).y < jaw.y - 0.005, 'the jaw drops')
  assert.ok(average(skinnedPositions(mesh, on('browL'))).y > brow.y + 0.004, 'the brow rises')
  assert.ok(skinnedPositions(mesh, on('eyeL')).some((p, i) => p.distanceTo(eye[i]) > 0.003), 'the eye turns')
  skin!.setFace({ blink: Number.NaN, jaw: 9, brow: -9, smile: 0, gaze: [Number.NaN, 5] })
  assert.ok(bones.every((bone) => Number.isFinite(bone.quaternion.x + bone.position.x)), 'face input is clamped')
  for (const [type, extra] of [['wizard', {}], ['knight', {}], ['villager', { character: { age: 'adult', build: 'average', height: 1, style: 'stylized', skin: null, hair: null, hairStyle: 'ponytail', beard: 'none' } as CharacterSpec }]] as const) {
    const springs = skinOf(type, 1, extra).skin!.springs
    assert.ok(springs.length >= 1 && springs.every((chain) => chain.bones.length >= 3 && chain.bones.every((bone) => bone instanceof THREE.Bone) && chain.limit > 0), `${type} springs`)
  }
})

test('archetypes change the measured height of the skin', () => {
  const height = (character?: CharacterSpec) => {
    const { skin } = skinOf('villager', 1, character ? { character } : {})
    const box = new THREE.Box3().setFromPoints(skinnedPositions(skin!.meshes[2]))
    return box.max.y - box.min.y
  }
  const base: CharacterSpec = { age: 'adult', build: 'average', height: 1, style: 'stylized', skin: null, hair: null, hairStyle: 'auto', beard: 'auto' }
  const child = height({ ...base, age: 'child' }), adult = height(base), short = height({ ...base, height: 0.85 }), tall = height({ ...base, height: 1.15 })
  console.log(`altura medida (m): criança ${child.toFixed(2)}, baixo ${short.toFixed(2)}, adulto ${adult.toFixed(2)}, alto ${tall.toFixed(2)}`)
  assert.ok(child < short && short < adult && adult < tall, `${child} < ${short} < ${adult} < ${tall}`)
  assert.ok(Math.abs(adult - height()) < 0.02, 'the default archetype keeps the 0.5 proportions')
})

test('player avatars skin from their own parts; the robot stays rigid', () => {
  for (const kind of avatarKinds) {
    const parts = buildAvatar(kind), holders = new Map<string, THREE.Object3D>(), map = new Map<string, string>(), root = new THREE.Group()
    holders.set('avatar', root)
    for (const part of parts) {
      const holder = new THREE.Object3D()
      holder.position.fromArray(part.position)
      holder.rotation.set(...(part.rotation ?? [0, 0, 0]).map(THREE.MathUtils.degToRad) as [number, number, number])
      holders.set(`avatar.${part.id}`, holder)
      map.set(part.id, `avatar.${part.id}`)
    }
    for (const part of parts) (part.parentId ? holders.get(`avatar.${part.parentId}`)! : root).add(holders.get(`avatar.${part.id}`)!)
    root.updateMatrixWorld(true)
    const spec: PrefabSpec = { type: kind === 'explorer' || kind === 'robot' ? 'villager' : kind, size: 1, seed: 0, primary: null, secondary: null, text: '', lit: false, interactive: false }
    const skin = skinCharacter('avatar', spec, holders, map, { quality: 'medium', shadows: true, avatar: kind })
    if (kind === 'robot') { assert.equal(skin, null); continue }
    assert.ok(skin && skin.meshes.length === 3, kind)
    assert.ok([...skin.hidden].every((id) => id.startsWith('avatar.')), `${kind}: hidden avatar holders`)
    if (kind === 'explorer') assert.ok(!skin.hidden.has('avatar.hatBrim') && !skin.hidden.has('avatar.pack'), 'hat and backpack stay rigid')
  }
})

test('generation time and triangle budget per character (measured, CPU)', () => {
  const report: string[] = []
  buildSkinModel({ type: 'villager', parts: prefabParts({ type: 'villager', size: 1, seed: 9, primary: null, secondary: null, text: '', lit: false, interactive: true }), quality: 'high', seed: 9 })
  for (const type of characterTypes) {
    const model = buildSkinModel({ type, parts: prefabParts({ type, size: 1, seed: 2, primary: null, secondary: null, text: '', lit: false, interactive: true }), quality: 'high', seed: 2 })
    if (!model) { report.push(`${type}: rígido`); continue }
    report.push(`${type}: ${Math.round(model.milliseconds)} ms, LOD ${model.lods.map((lod) => lod.indices.length / 3).join('/')} triângulos`)
    assert.ok(model.milliseconds < 5000, `${type} took ${model.milliseconds} ms`)
  }
  console.log(`geração (qualidade alta, CPU):\n${report.join('\n')}`)
})
