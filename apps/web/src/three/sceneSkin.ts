import * as THREE from 'three'
import { buildAvatar, isCharacterType } from './sceneCharacters.ts'
import type { avatarKinds, ThreeSceneDocument } from './sceneDocument.ts'
import { prefabParts, type PrefabPart, type PrefabSpec } from './scenePrefabs.ts'
import type { CharacterSkin, FaceState, HandPose, QualityLevel, SpringChainSpec } from './sceneRuntimeTypes.ts'
import { MATERIAL_BODY, MATERIAL_EYE, MATERIAL_HAIR, MATERIAL_SHELL } from './sceneSkinMesh.ts'
import { eyeMaterial, slotMaterial } from './sceneSkinMaterial.ts'
import { buildSkinModel, type SkinLod, type SkinModel } from './sceneSkinModel.ts'
import type { AnimState } from './sceneCharacterAnimator.ts'

export type AvatarKind = typeof avatarKinds[number]
export interface SkinOptions { quality: QualityLevel; shadows: boolean; avatar?: AvatarKind; parts?: PrefabPart[] }
export function poseSkinHands(skin: CharacterSkin, state: AnimState, held: Partial<HandPose> = {}, wave = false): void {
  const hands = { ...skin.restHands, ...held }
  if (state === 'climb' || state === 'attack') { hands.left = 'grip'; hands.right = 'grip' }
  else if (state === 'interact' && hands.right !== 'grip') hands.right = 'point'
  else if (state === 'death') { hands.left = 'relaxed'; hands.right = 'relaxed' }
  if (wave && hands.left !== 'grip') hands.left = 'open'
  skin.setHands(hands)
}

interface CacheEntry { model: SkinModel; geometries: THREE.BufferGeometry[]; materials: THREE.Material[]; references: number; cached: boolean }
const CACHE_LIMIT = 48
const cache = new Map<string, CacheEntry>()
const disposeEntry = (entry: CacheEntry) => { entry.geometries.forEach((geometry) => geometry.dispose()); entry.materials.forEach((material) => material.dispose()) }
function pruneCache() {
  for (const [key, entry] of cache) {
    if (cache.size <= CACHE_LIMIT) break
    if (entry.references) continue
    cache.delete(key); entry.cached = false; disposeEntry(entry)
  }
}

function geometryOf(lod: SkinLod): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(lod.positions, 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(lod.normals, 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(lod.uvs, 2))
  geometry.setAttribute('color', new THREE.BufferAttribute(lod.colors, 3))
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(lod.skinIndex, 4))
  geometry.setAttribute('skinWeight', new THREE.BufferAttribute(lod.skinWeight, 4))
  geometry.setAttribute('slotA', new THREE.BufferAttribute(lod.slotA, 4))
  geometry.setAttribute('slotB', new THREE.BufferAttribute(lod.slotB, 4))
  geometry.setAttribute('slotC', new THREE.BufferAttribute(lod.slotC, 4))
  geometry.setIndex(new THREE.BufferAttribute(lod.indices, 1))
  for (const group of lod.groups) geometry.addGroup(group.start, group.count, group.material)
  geometry.userData.components = lod.components
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}
function entryOf(key: string, build: () => SkinModel | null): CacheEntry | null {
  const known = cache.get(key)
  if (known) { cache.delete(key); cache.set(key, known); return known }
  const model = build()
  if (!model) return null
  const geometries = model.lods.map(geometryOf), materials: THREE.Material[] = []
  materials[MATERIAL_BODY] = slotMaterial(model.slots, { side: THREE.FrontSide, name: 'Pele' })
  materials[MATERIAL_SHELL] = slotMaterial(model.slots, { side: THREE.DoubleSide, name: 'Tecido' })
  materials[MATERIAL_HAIR] = slotMaterial(model.hairSlots.length ? model.hairSlots : model.slots, { side: THREE.DoubleSide, name: 'Cabelo' })
  materials[MATERIAL_EYE] = eyeMaterial(model.eyeSlots.length ? model.eyeSlots : model.slots, THREE.FrontSide)
  const entry = { model, geometries, materials, references: 0, cached: true }
  cache.set(key, entry)
  return entry
}
/** Clears lookup entries; resources still used by live skins are released when their last owner leaves. */
export function clearSkinCache(): void {
  for (const entry of cache.values()) { entry.cached = false; if (!entry.references) disposeEntry(entry) }
  cache.clear()
}
export const skinCacheSize = () => cache.size

const round = (v: number) => Math.round(v * 1e4) / 1e4
const neutral: FaceState = { blink: 0, jaw: 0, brow: 0, smile: 0, gaze: [0, 0] }

/**
 * Continuous skinned body for one character root. `holders` must contain the root and every joint holder (`j_*`), already in the
 * rest pose; `parts` maps assetPart → nodeId. Bones are attached to the joint holders, so the existing rig drives the skin.
 * Returns null when the type stays rigid (skeleton, golem, drone, robot avatar) or a joint holder is missing.
 */
export function skinCharacter(rootId: string, spec: PrefabSpec, holders: Map<string, THREE.Object3D>, parts: Map<string, string>, options: SkinOptions): CharacterSkin | null {
  const root = holders.get(rootId)
  if (!root || (!options.avatar && !isCharacterType(spec.type))) return null
  const source = options.parts ?? (options.avatar ? buildAvatar(options.avatar) : prefabParts(spec))
  const overrides = new Map<string, { position: [number, number, number]; quaternion: [number, number, number, number] }>()
  for (const part of source) if (part.kind === 'group' && part.id.startsWith('j_')) {
    const holder = holders.get(parts.get(part.id) ?? '')
    if (!holder) return null
    overrides.set(part.id, { position: holder.position.toArray().map(round) as [number, number, number], quaternion: holder.quaternion.toArray().map(round) as [number, number, number, number] })
  }
  const type = options.avatar ? (options.avatar === 'explorer' ? 'villager' : options.avatar) : spec.type
  const entryFor = (quality: QualityLevel) => entryOf(JSON.stringify([type, options.avatar ?? null, spec.seed, spec.size, spec.character ?? null, spec.primary, spec.secondary, quality, source, [...overrides]]), () => buildSkinModel({ type, parts: source, quality, seed: spec.seed, overrides, avatar: options.avatar, character: options.avatar ? undefined : spec.character }))
  const initial = entryFor(options.quality)
  if (!initial) return null
  let entry = initial, quality = options.quality
  entry.references++
  pruneCache()
  const { model } = entry
  root.updateMatrixWorld(true)
  const bones: THREE.Bone[] = []
  for (const description of model.bones) {
    const bone = new THREE.Bone()
    bone.name = `skin:${description.name}`
    if (description.joint) holders.get(parts.get(description.joint)!)!.add(bone)
    else { description.local.decompose(bone.position, bone.quaternion, bone.scale); bones[description.parent].add(bone) }
    bones.push(bone)
  }
  const inverses = model.bones.map((bone) => root.matrixWorld.clone().multiply(bone.bind).invert())
  const skeleton = new THREE.Skeleton(bones, inverses), lod = new THREE.LOD(), meshes: THREE.SkinnedMesh[] = []
  const unit = Math.max(0.5, model.height / 1.8), near = options.quality === 'low' ? 6 : 9, far = options.quality === 'low' ? 15 : 22
  entry.geometries.forEach((geometry, level) => {
    const mesh = new THREE.SkinnedMesh(geometry, entry.materials)
    mesh.name = `Pele LOD${level}`
    mesh.userData.nodeId = rootId
    mesh.castShadow = options.shadows
    mesh.receiveShadow = true
    mesh.boundingSphere = geometry.boundingSphere!.clone()
    mesh.boundingSphere.radius = mesh.boundingSphere.radius * 1.35 + 0.2 * unit
    mesh.raycast = () => {}
    lod.addLevel(mesh, [0, near * unit, far * unit][level])
    meshes.push(mesh)
  })
  lod.name = 'Pele contínua'
  lod.userData.nodeId = rootId
  root.add(lod)
  root.updateMatrixWorld(true)
  for (const mesh of meshes) mesh.bind(skeleton, root.matrixWorld.clone())
  const hidden = new Set(model.hidden.map((id) => parts.get(id)).filter((id): id is string => !!id))
  // Fist sockets live on the forearm holders; a held part is moved so its handle passes through the closed fingers.
  const grips: CharacterSkin['grips'] = {}
  for (const grip of model.grips) {
    const forearm = holders.get(parts.get(`j_elbow${grip.side}`) ?? '')
    if (!forearm) continue
    const socket = new THREE.Object3D()
    socket.name = `Encaixe da mão ${grip.side === 'L' ? 'esquerda' : 'direita'}`
    socket.position.set(...grip.position)
    socket.quaternion.set(...grip.quaternion)
    forearm.add(socket)
    grips[grip.side] = socket
    const item = grip.item ? holders.get(parts.get(grip.item) ?? '') : undefined
    if (item?.parent === forearm) item.position.copy(socket.position)
  }
  const springs: SpringChainSpec[] = model.springs.map((chain) => ({ bones: chain.bones.map((index) => bones[index]), stiffness: chain.stiffness, damping: chain.damping, gravity: chain.gravity, limit: chain.limit, wind: chain.wind }))
  const face = model.face, rest = bones.map((bone) => ({ position: bone.position.clone(), quaternion: bone.quaternion.clone() }))
  const euler = new THREE.Euler(), turn = new THREE.Quaternion()
  const pose = (index: number, x: number, y: number, z: number, offset?: [number, number, number]) => {
    if (index < 0) return
    const bone = bones[index], base = rest[index]
    bone.quaternion.copy(base.quaternion).multiply(turn.setFromEuler(euler.set(x, y, z)))
    bone.position.copy(base.position)
    if (offset) bone.position.add(new THREE.Vector3(...offset))
  }
  const setFace = (state: FaceState) => {
    if (!face) return
    const s = face.scale, clamp = (v: number, a = -1, b = 1) => Math.min(b, Math.max(a, Number.isFinite(v) ? v : 0))
    const blink = clamp(state.blink, 0, 1), jaw = clamp(state.jaw, 0, 1), brow = clamp(state.brow), smile = clamp(state.smile)
    const yaw = clamp(state.gaze?.[0] ?? 0, -0.6, 0.6), pitch = clamp(state.gaze?.[1] ?? 0, -0.45, 0.45)
    pose(face.jaw, jaw * 0.32, 0, 0)
    face.eyes.forEach((eye) => pose(eye, -pitch, yaw, 0))
    face.lids.forEach((lid) => pose(lid, blink * face.lidClosed + Math.max(0, -pitch) * 0.15, 0, 0))
    face.brows.forEach((index, i) => { const side = i === 0 ? 1 : -1; pose(index, 0, 0, side * Math.max(0, -brow) * 0.22, [0, brow * 0.007 * s, 0]) })
    face.corners.forEach((index, i) => { const side = i === 0 ? 1 : -1; pose(index, 0, 0, 0, [side * smile * 0.004 * s, smile * 0.007 * s, -Math.abs(smile) * 0.002 * s]) })
  }
  const setHands = (state: HandPose) => {
    for (const finger of model.hands) {
      const gesture = finger.side === 'L' ? state.left : state.right, side = finger.side === 'L' ? 1 : -1
      const open = gesture === 'open' || (gesture === 'point' && finger.finger === 0), grip = gesture === 'grip' || gesture === 'point'
      const target = open ? [0, 0, 0] : finger.finger === 4 ? grip ? [0.7, 0.7] : [0.2, 0.2] : grip ? [1.2, 1.45, 0.95] : [0.32, 0.45, 0.3]
      finger.bones.forEach((index, i) => pose(index, 0, 0, -side * (target[i] - finger.curl[i])))
    }
  }
  setFace(neutral)
  const restHands: HandPose = { left: model.hands.some((finger) => finger.side === 'L' && finger.curl[0] > 1) ? 'grip' : 'relaxed', right: model.hands.some((finger) => finger.side === 'R' && finger.curl[0] > 1) ? 'grip' : 'relaxed' }
  let disposed = false
  const setQuality = (next: QualityLevel) => {
    if (disposed || next === quality) return
    const replacement = entryFor(next)
    if (!replacement) return
    if (replacement.model.bones.length !== model.bones.length || replacement.model.bones.some((bone, i) => bone.name !== model.bones[i].name)) throw new Error('O LOD mudou a estrutura do esqueleto.')
    replacement.references++
    entry.references--
    if (!entry.cached && !entry.references) disposeEntry(entry)
    entry = replacement; quality = next
    meshes.forEach((mesh, i) => {
      mesh.geometry = entry.geometries[i]; mesh.material = entry.materials
      mesh.boundingSphere = mesh.geometry.boundingSphere!.clone(); mesh.boundingSphere.radius = mesh.boundingSphere.radius * 1.35 + 0.2 * unit
      lod.levels[i].distance = [0, next === 'low' ? 6 * unit : 9 * unit, next === 'low' ? 15 * unit : 22 * unit][i]
    })
    pruneCache()
  }
  return {
    rootId, object: lod, meshes, hidden, springs, restHands, grips, setFace, setHands, setQuality,
    dispose() {
      if (disposed) return
      disposed = true
      lod.removeFromParent()
      for (const socket of Object.values(grips)) socket?.removeFromParent()
      for (const bone of bones) if (bone.parent && !(bone.parent instanceof THREE.Bone)) bone.removeFromParent()
      skeleton.dispose()
      entry.references--
      if (!entry.cached && !entry.references) disposeEntry(entry)
      pruneCache()
    },
  }
}

/** Skins for every character root of the document (nested characters are skipped by their own roots). */
export function buildCharacterSkins(doc: ThreeSceneDocument, holders: Map<string, THREE.Object3D>, options: SkinOptions): CharacterSkin[] {
  const children = new Map<string, string[]>()
  for (const node of doc.nodes) if (node.parentId) children.set(node.parentId, [...children.get(node.parentId) ?? [], node.id])
  const byId = new Map(doc.nodes.map((node) => [node.id, node])), skins: CharacterSkin[] = []
  for (const root of doc.nodes) {
    if (!root.asset || !isCharacterType(root.asset.type) || !root.visible) continue
    const parts = new Map<string, string>(), stack = [...children.get(root.id) ?? []]
    while (stack.length) {
      const node = byId.get(stack.pop()!)!
      if (node.asset && isCharacterType(node.asset.type)) continue
      if (node.assetPart) parts.set(node.assetPart, node.id)
      stack.push(...children.get(node.id) ?? [])
    }
    const source = prefabParts(root.asset).flatMap((part): PrefabPart[] => {
      const node = byId.get(parts.get(part.id) ?? '')
      return node ? [{ ...part, kind: node.kind, position: node.position, rotation: node.rotation, dimensions: node.dimensions, material: node.material, geometry: node.geometry }] : part.kind === 'group' && part.id.startsWith('j_') ? [part] : []
    })
    const skin = skinCharacter(root.id, root.asset, holders, parts, { quality: options.quality, shadows: options.shadows, parts: source })
    if (skin) skins.push(skin)
  }
  return skins
}
