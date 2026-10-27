import * as THREE from 'three'
import { buildSceneSteps, createResources, type BuiltScene, type SceneResources } from '../sceneBuild.ts'
import { createEmptyScene, createNode, defaultAnimation, validateMaterial, validateScene } from '../sceneDocument.ts'
import { prefabParts, type PrefabSpec } from '../scenePrefabs.ts'
import { applyRig, bindRigs, type RigBinding } from '../sceneCharacterRig.ts'
import { buildCharacterSkins } from '../sceneSkin.ts'
import type { QualityLevel } from '../sceneRuntimeTypes.ts'

/** Riding speed in m/s before sprint (sprint ×1.8 gives the world's 18 m/s maximum the streaming is sized for). */
export const MOUNT_SPEED = 10
/** Extra eye height while riding. */
export const MOUNT_EYE = 0.9

export interface Mount {
  readonly object: THREE.Group
  readonly built: BuiltScene
  riding: boolean
  /** Places the mount under the player and animates its gait from the horizontal speed. */
  update(position: THREE.Vector3, yaw: number, speed: number, seconds: number): void
  dispose(): void
}

/**
 * A procedural deer the player rides across the world. It is built after play starts, in slices of about 8 ms (its
 * skin is the costly part), and the caller links its programs before the first time it is shown.
 */
export async function createMount(options: { quality: QualityLevel; shadows: boolean }, cancelled: () => boolean): Promise<Mount | null> {
  const spec: PrefabSpec = { type: 'deer', size: 1.25, seed: 3, primary: null, secondary: null, text: '', lit: false, interactive: false }
  const root = { ...createNode('group'), id: 'montaria', name: 'Montaria', asset: spec }
  const doc = validateScene({ ...createEmptyScene(), nodes: [root, ...prefabParts(spec).map((part) => ({ ...createNode(part.kind), id: `montaria.${part.id}`, parentId: part.parentId ? `montaria.${part.parentId}` : root.id,
    name: part.name, position: part.position, rotation: part.rotation ?? [0, 0, 0], dimensions: part.dimensions, collidable: false, assetPart: part.id,
    material: validateMaterial({ color: '#8a6a4a', metalness: 0, roughness: 0.7, ...part.material }), geometry: { ...createNode(part.kind).geometry, ...part.geometry }, animation: { ...defaultAnimation(), ...part.animation } }))] })
  const resources: SceneResources = createResources(4)
  const steps = buildSceneSteps(doc, resources, { instancing: false, helpers: false, skins: (document, holders) => buildCharacterSkins(document, holders, options) })
  let built: BuiltScene | null = null, slice = performance.now()
  for (let step = steps.next(); ; step = steps.next()) {
    if (step.done) { built = step.value; break }
    if (performance.now() - slice > 8) { await new Promise((resolve) => setTimeout(resolve, 0)); slice = performance.now() }
    if (cancelled()) { resources.dispose(); return null }
  }
  const binding: RigBinding | undefined = bindRigs(doc)[0]
  const object = new THREE.Group()
  object.name = 'Montaria'
  object.add(built.root)
  object.visible = false
  built.root.traverse((child) => { const mesh = child as THREE.Mesh; if (mesh.isMesh) mesh.castShadow = options.shadows && mesh.visible })
  let time = 0
  const mount: Mount = {
    object, built, riding: false,
    update(position, yaw, speed, seconds) {
      object.visible = mount.riding
      if (!mount.riding) return
      time += seconds
      object.position.copy(position)
      // The deer faces +z in its own frame; the player looks down -z at yaw 0.
      object.rotation.set(0, yaw + Math.PI, 0)
      if (binding) applyRig(binding, built.holders, { time, speed, airborne: false, attack: -1, hurt: 0, dead: 0 })
      object.updateMatrixWorld(true)
    },
    dispose() { object.removeFromParent(); built!.dispose(); resources.dispose() },
  }
  return mount
}
