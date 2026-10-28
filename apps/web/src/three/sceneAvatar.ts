import * as THREE from 'three'
import { buildScene, createResources } from './sceneBuild.ts'
import { buildAvatar } from './sceneCharacters.ts'
import { bindParts } from './sceneCharacterRig.ts'
import { createEmptyScene, createNode, defaultAnimation, validateMaterial, validateScene } from './sceneDocument.ts'
import { skinCharacter, type AvatarKind, type SkinOptions } from './sceneSkin.ts'
import type { PrefabPart, PrefabSpec } from './scenePrefabs.ts'
import type { WeaponKind } from './sceneCombat.ts'

/** Invisible handle that closes the fist around the weapon's natural carrying axis (the weapon itself is runtime equipment). */
const handles: Partial<Record<WeaponKind, { hand: 'L' | 'R'; rotation: [number, number, number] }>> = {
  sword: { hand: 'R', rotation: [112, 0, 7] }, axe: { hand: 'R', rotation: [112, 0, 7] }, blaster: { hand: 'R', rotation: [90, 0, 0] }, staff: { hand: 'R', rotation: [6, 0, 6] }, bow: { hand: 'L', rotation: [4, 0, -6] },
}

export function createAvatar(kind: AvatarKind, options: Pick<SkinOptions, 'quality' | 'shadows'>, weapon: WeaponKind = 'none') {
  const authored = buildAvatar(kind), removed = new Set(authored.filter((part) => /^(sword|weapon|staff|bow)/i.test(part.id)).map((part) => part.id))
  for (const part of authored) if (part.parentId && removed.has(part.parentId)) removed.add(part.id)
  const handle = handles[weapon], held: PrefabPart[] = handle && authored.some((part) => part.id === `j_elbow${handle.hand}`)
    ? [{ id: 'weaponHandle', parentId: `j_elbow${handle.hand}`, name: 'Empunhadura da arma', kind: 'group', position: [0, -0.33, 0.03], rotation: handle.rotation, dimensions: [1, 1, 1] }] : []
  const parts = [...authored.filter((part) => !removed.has(part.id)), ...held], id = (part: string) => `avatar.${part}`
  const spec: PrefabSpec = { type: kind === 'explorer' || kind === 'robot' ? 'villager' : kind, size: 1, seed: 0, primary: null, secondary: null, text: '', lit: false, interactive: false }
  const root = { ...createNode('group'), id: 'avatar', name: 'Avatar', asset: spec }
  const document = validateScene({ ...createEmptyScene(), nodes: [root, ...parts.map((part) => ({ ...createNode(part.kind), id: id(part.id), parentId: part.parentId ? id(part.parentId) : root.id, name: part.name,
    position: part.position, rotation: part.rotation ?? [0, 0, 0], dimensions: part.dimensions, collidable: false, assetPart: part.id,
    material: validateMaterial({ color: '#cccccc', metalness: 0, roughness: 0.6, ...part.material }), geometry: { ...createNode(part.kind).geometry, ...part.geometry },
    animation: { ...defaultAnimation(), ...part.animation }, ...(part.light ? { light: part.light } : {}) }))] })
  const resources = createResources(4), partIds = new Map(parts.map((part) => [part.id, id(part.id)]))
  const built = buildScene(document, resources, { instancing: false, helpers: false, skins: (_, holders) => {
    const skin = skinCharacter(root.id, spec, holders, partIds, { ...options, avatar: kind, parts })
    return skin ? [skin] : []
  } })
  built.root.traverse((object) => {
    if (object instanceof THREE.Mesh && !(object instanceof THREE.SkinnedMesh)) object.castShadow = object.visible && options.shadows && !(object.material as THREE.MeshPhysicalMaterial).map
  })
  const binding = bindParts(root.id, 'biped', parts, 1, id)
  return { built, resources, binding, document }
}
