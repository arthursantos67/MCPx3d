import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three'
import { createAvatar } from '../../src/three/sceneAvatar.ts'
import { buildScene, createResources, pickNodeId, pickVisible } from '../../src/three/sceneBuild.ts'
import { buildCharacterSkins, clearSkinCache, poseSkinHands } from '../../src/three/sceneSkin.ts'
import { bakeSkinMaterial, characterExportClips } from '../../src/three/sceneSkinExport.ts'

const dispose = (avatar: ReturnType<typeof createAvatar>) => { avatar.built.dispose(); avatar.resources.dispose() }
const vertices = (mesh: THREE.SkinnedMesh, bone: number) => {
  let root: THREE.Object3D = mesh
  while (root.parent) root = root.parent
  root.updateMatrixWorld(true); mesh.skeleton.update()
  const joints = mesh.geometry.getAttribute('skinIndex'), points: THREE.Vector3[] = []
  for (let i = 0; i < joints.count; i++) if (joints.getX(i) === bone) points.push(mesh.getVertexPosition(i, new THREE.Vector3()))
  return points
}

test('the actual avatar build uses continuous skins and keeps robot anatomy rigid', () => {
  for (const kind of ['explorer', 'knight', 'wizard', 'robot'] as const) {
    const avatar = createAvatar(kind, { quality: 'medium', shadows: true }), skin = avatar.built.skins.get('avatar')
    assert.ok(avatar.built.holders.has('avatar'))
    assert.ok(!avatar.document.nodes.some((node) => /^(sword|weapon|staff|bow)/i.test(node.assetPart ?? '')), 'runtime equipment replaces authored weapons')
    if (kind === 'robot') assert.equal(skin, undefined)
    else {
      assert.equal(skin?.meshes.length, 3, kind)
      assert.ok(skin!.hidden.size > 0)
      for (const id of skin!.hidden) {
        const mesh = avatar.built.meshes.get(id)!
        assert.equal(mesh.visible, false); assert.equal(mesh.castShadow, false)
        assert.ok(pickVisible(mesh), 'hidden render proxies remain available for selection')
      }
      assert.ok(skin!.meshes.every((mesh) => mesh.castShadow))
    }
    dispose(avatar)
  }
})

test('invisible skin proxies remain pickable and follow ancestor visibility', () => {
  const avatar = createAvatar('explorer', { quality: 'medium', shadows: false })
  avatar.built.root.updateMatrixWorld(true)
  const ray = new THREE.Raycaster(new THREE.Vector3(0, 1.2, 3), new THREE.Vector3(0, 0, -1))
  const hits = ray.intersectObjects(avatar.built.pickables, false).filter((hit) => pickVisible(hit.object))
  assert.ok(hits.some((hit) => hit.object.userData.skinProxy))
  assert.equal(pickNodeId(hits.find((hit) => hit.object.userData.skinProxy)!), 'avatar')
  avatar.built.holders.get('avatar')!.visible = false
  assert.ok(!ray.intersectObjects(avatar.built.pickables, false).some((hit) => pickVisible(hit.object)))
  dispose(avatar)
})

test('skins respect edited dimensions and materials in the document rather than rebuilding stale prefab parts', () => {
  const avatar = createAvatar('wizard', { quality: 'medium', shadows: false }), document = structuredClone(avatar.document)
  const head = document.nodes.find((node) => node.assetPart === 'head')!
  head.dimensions[0] *= 1.5; head.material.color = '#ff4080'
  const resources = createResources(), built = buildScene(document, resources, { instancing: false, helpers: false, skins: (doc, holders) => buildCharacterSkins(doc, holders, { quality: 'medium', shadows: false }) })
  const geometry = built.skins.get('avatar')!.meshes[0].geometry
  assert.notDeepEqual(geometry.getAttribute('position').array, avatar.built.skins.get('avatar')!.meshes[0].geometry.getAttribute('position').array)
  const material = built.skins.get('avatar')!.meshes[0].material as THREE.MeshPhysicalMaterial[], target = new THREE.Color('#ff4080')
  const colors = material[0].userData.skinSlots.slotColor.value as THREE.Vector4[]
  assert.ok(colors.some((color) => Math.abs(color.x - target.r) + Math.abs(color.y - target.g) + Math.abs(color.z - target.b) < 1e-6))
  built.dispose(); resources.dispose(); dispose(avatar)
})

test('finger joints bend only their own vertices and gestures restore the resting pose', () => {
  const avatar = createAvatar('explorer', { quality: 'high', shadows: false }), skin = avatar.built.skins.get('avatar')!, mesh = skin.meshes[0]
  const finger = mesh.skeleton.bones.findIndex((bone) => bone.name === 'skin:fingerL0_2'), other = mesh.skeleton.bones.findIndex((bone) => bone.name === 'skin:fingerR0_2')
  assert.ok(finger >= 0 && other >= 0)
  const before = vertices(mesh, finger), right = vertices(mesh, other)
  assert.ok(before.length > 7)
  skin.setHands({ left: 'grip', right: 'relaxed' })
  assert.ok(vertices(mesh, finger).some((point, i) => point.distanceTo(before[i]) > 0.01))
  assert.ok(vertices(mesh, other).every((point, i) => point.distanceTo(right[i]) < 1e-6))
  skin.setHands({ left: 'relaxed', right: 'relaxed' })
  assert.ok(vertices(mesh, finger).every((point, i) => point.distanceTo(before[i]) < 1e-6))
  poseSkinHands(skin, 'climb')
  assert.ok(vertices(mesh, finger).some((point, i) => point.distanceTo(before[i]) > 0.01))
  poseSkinHands(skin, 'interact')
  assert.ok(mesh.skeleton.bones.find((bone) => bone.name === 'skin:fingerR0_0')!.quaternion.z !== 0)
  dispose(avatar)
})

test('quality swaps mesh budgets while preserving the live skeleton and transforms', () => {
  const avatar = createAvatar('wizard', { quality: 'high', shadows: false }), skin = avatar.built.skins.get('avatar')!, mesh = skin.meshes[0]
  avatar.built.root.position.set(3, 1, -2)
  const skeleton = mesh.skeleton, original = mesh.geometry, triangles = original.index!.count
  const knee = avatar.built.holders.get('avatar.j_kneeL')!; knee.rotation.x = 0.5
  skin.setQuality('low')
  assert.equal(mesh.skeleton, skeleton); assert.ok(mesh.geometry.index!.count < triangles)
  assert.equal(knee.rotation.x, 0.5); assert.deepEqual(avatar.built.root.position.toArray(), [3, 1, -2])
  skin.setFace({ blink: 1, jaw: 0.5, smile: 0.5, brow: 0, gaze: [0, 0] })
  skin.setHands({ left: 'open', right: 'grip' })
  skin.setQuality('high'); assert.equal(mesh.geometry, original)
  dispose(avatar)
})

test('clearing the cache does not dispose resources still owned by a live avatar', () => {
  const first = createAvatar('explorer', { quality: 'medium', shadows: false }), second = createAvatar('explorer', { quality: 'medium', shadows: false })
  const geometry = first.built.skins.get('avatar')!.meshes[0].geometry
  assert.equal(second.built.skins.get('avatar')!.meshes[0].geometry, geometry)
  let releases = 0; geometry.addEventListener('dispose', () => { releases++ })
  clearSkinCache(); assert.equal(releases, 0)
  dispose(first); assert.equal(releases, 0)
  dispose(second); assert.equal(releases, 1)
  dispose(second); assert.equal(releases, 1, 'skin release is idempotent')
})

test('GLB preparation bakes palette and PBR properties without changing cached geometry', () => {
  const avatar = createAvatar('explorer', { quality: 'high', shadows: false }), skin = avatar.built.skins.get('avatar')!, mesh = skin.meshes[0], original = mesh.geometry
  const baked = bakeSkinMaterial(mesh)
  assert.notEqual(baked.geometry, original); assert.ok(original.getAttribute('slotC')); assert.equal(baked.geometry.getAttribute('slotC'), undefined)
  assert.ok(baked.materials.length >= 3 && baked.materials.every((material) => !material.userData.skinSlots && material.vertexColors))
  assert.equal(baked.geometry.groups.length, baked.materials.length, 'each material gets one primitive rather than thousands of alternating groups')
  assert.ok(new Set(baked.geometry.getAttribute('color').array).size > 5)
  assert.deepEqual(baked.geometry.getAttribute('skinWeight').array, original.getAttribute('skinWeight').array)
  baked.geometry.dispose(); baked.materials.forEach((material) => material.dispose()); dispose(avatar)
})

test('portable character clips animate joints and face and restore the original document and pose', () => {
  const avatar = createAvatar('wizard', { quality: 'medium', shadows: false }), original = JSON.stringify(avatar.document)
  const knee = avatar.built.holders.get('avatar.j_kneeL')!, rest = knee.quaternion.clone(), skin = avatar.built.skins.get('avatar')!
  const clips = characterExportClips(avatar.document, avatar.built)
  assert.equal(clips.length, 2)
  const walk = clips.find((clip) => clip.name.includes('caminhada'))!, track = walk.tracks.find((track) => track.name === `${knee.uuid}.quaternion`)!
  assert.ok(new Set(track.values).size > 10)
  const jaw = skin.meshes[0].skeleton.bones.find((bone) => bone.name === 'skin:jaw')!
  assert.ok(clips[0].tracks.some((track) => track.name === `${jaw.uuid}.quaternion`))
  assert.ok(knee.quaternion.equals(rest)); assert.equal(JSON.stringify(avatar.document), original)
  dispose(avatar)
})
