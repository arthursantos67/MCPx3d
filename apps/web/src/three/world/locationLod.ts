import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { BuiltScene } from '../sceneBuild.ts'
import { LOCATION_GROUP, locationOfNode } from './worldScene.ts'

/** Locations closer than this are drawn in full; beyond it (with 10% hysteresis) as one merged mesh. */
export const LOCATION_DETAIL_RANGE = 600
const SMALL_PART = 0.6
/** Layer no camera renders: a distant location's surfaces move there while its lights stay counted. */
export const LOD_HIDDEN_LAYER = 30

interface LocationEntry { id: string; holder: THREE.Object3D; surfaces: { object: THREE.Object3D; mask: number }[]; instanced: THREE.InstancedMesh[]; center: THREE.Vector3; detailed: boolean; proxy: THREE.Mesh | null }
export interface LocationLod {
  readonly object: THREE.Group
  /** Works on the merged meshes for about 8 ms; returns false when all are done (call it again on later tasks). */
  buildNext(): boolean
  update(camera: THREE.Vector3): void
  /** Shows every location in full (e.g. while the play-mode collider is built from visible surfaces). */
  showAll(): void
  readonly materials: THREE.Material[]
  dispose(): void
}

/**
 * Distance LOD for the locations composed into a world scene. Each location's group and the instanced batches made
 * only of its nodes toggle together; beyond the range a single vertex-coloured mesh of its larger static surfaces,
 * in world space, stands in for it (one draw call). Hiding never touches `visible` and never hides lights: every
 * program's key includes the number of visible lights and shadow casters, so toggling them would recompile all
 * materials of the scene whenever the player crosses the range. Surfaces move to a layer the cameras do not render.
 */
export function createLocationLod(built: BuiltScene): LocationLod {
  const object = new THREE.Group(), material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 })
  object.name = 'Locais distantes'
  const entries = new Map<string, LocationEntry>()
  for (const [id, holder] of built.holders) if (id.startsWith(LOCATION_GROUP)) {
    holder.updateWorldMatrix(true, false)
    const surfaces: LocationEntry['surfaces'] = []
    holder.traverse((child) => { if (!(child as THREE.Light).isLight) surfaces.push({ object: child, mask: child.layers.mask }) })
    entries.set(locationOfNode(id)!, { id, holder, surfaces, instanced: [], center: new THREE.Vector3().setFromMatrixPosition(holder.matrixWorld), detailed: true, proxy: null })
  }
  for (const { mesh } of built.instances.values()) {
    const location = locationOfNode((mesh.userData.nodeIds as string[])[0] ?? '')
    const entry = location ? entries.get(location) : undefined
    if (entry && !entry.instanced.includes(mesh)) { entry.instanced.push(mesh); entry.surfaces.push({ object: mesh, mask: mesh.layers.mask }) }
  }
  const queue = [...entries.values()], box = new THREE.Box3(), color = new THREE.Color()
  let current: { entry: LocationEntry; steps: Generator<void, THREE.Mesh | null> } | null = null
  /** Merges one location's surfaces, yielding whenever a slice has used its time. */
  function* merged(entry: LocationEntry): Generator<void, THREE.Mesh | null> {
    const parts: THREE.BufferGeometry[] = []
    const take = (geometry: THREE.BufferGeometry, matrix: THREE.Matrix4, tint: THREE.Color) => {
      if (!geometry.boundingBox) geometry.computeBoundingBox()
      box.copy(geometry.boundingBox!).applyMatrix4(matrix)
      if (box.getSize(new THREE.Vector3()).length() < SMALL_PART) return
      const part = (geometry.index ? geometry.toNonIndexed() : geometry.clone())
      for (const name of Object.keys(part.attributes)) if (name !== 'position' && name !== 'normal') part.deleteAttribute(name)
      if (!part.getAttribute('normal')) part.computeVertexNormals()
      part.applyMatrix4(matrix)
      const colors = new Float32Array(part.getAttribute('position').count * 3)
      for (let i = 0; i < colors.length; i += 3) { colors[i] = tint.r; colors[i + 1] = tint.g; colors[i + 2] = tint.b }
      part.setAttribute('color', new THREE.BufferAttribute(colors, 3))
      parts.push(part)
    }
    // World matrices are current: the frame loop keeps them, and static subtrees were refreshed when aligned.
    const meshes: THREE.Mesh[] = []
    entry.holder.traverse((child) => {
      const mesh = child as THREE.Mesh
      if (!mesh.isMesh || (mesh as THREE.SkinnedMesh).isSkinnedMesh || Array.isArray(mesh.material) || !mesh.visible) return
      meshes.push(mesh)
    })
    for (const mesh of meshes) { take(mesh.geometry, mesh.matrixWorld, color.copy((mesh.material as THREE.MeshStandardMaterial).color ?? color.set('#999999'))); yield }
    const matrix = new THREE.Matrix4(), world = new THREE.Matrix4()
    for (const mesh of entry.instanced) {
      for (let i = 0; i < mesh.count; i++) { mesh.getMatrixAt(i, matrix); take(mesh.geometry, world.multiplyMatrices(mesh.matrixWorld, matrix), color.copy((mesh.material as THREE.MeshStandardMaterial).color)); yield }
    }
    const geometry = parts.length ? mergeGeometries(parts) : null
    for (const part of parts) part.dispose()
    if (!geometry) return null
    const proxy = new THREE.Mesh(geometry, material)
    proxy.name = `${entry.holder.name} (distante)`
    proxy.castShadow = false
    proxy.receiveShadow = true
    proxy.matrixAutoUpdate = false
    proxy.visible = false
    return proxy
  }
  const show = (entry: LocationEntry, detailed: boolean) => {
    entry.detailed = detailed
    for (const { object, mask } of entry.surfaces) if (detailed) object.layers.mask = mask; else object.layers.set(LOD_HIDDEN_LAYER)
    if (entry.proxy) entry.proxy.visible = !detailed
  }
  return {
    object, materials: [material],
    buildNext() {
      const started = performance.now()
      while (performance.now() - started < 8) {
        if (!current) { const entry = queue.shift(); if (!entry) return false; current = { entry, steps: merged(entry) } }
        const step = current.steps.next()
        if (!step.done) continue
        current.entry.proxy = step.value
        if (step.value) object.add(step.value)
        current = null
      }
      return true
    },
    update(camera) {
      for (const entry of entries.values()) {
        const distance = Math.hypot(camera.x - entry.center.x, camera.z - entry.center.z)
        // A location stays detailed until its merged mesh exists, so it never disappears.
        if (entry.detailed && distance > LOCATION_DETAIL_RANGE * 1.1 && entry.proxy) show(entry, false)
        else if (!entry.detailed && distance < LOCATION_DETAIL_RANGE * 0.9) show(entry, true)
      }
    },
    showAll() { for (const entry of entries.values()) show(entry, true) },
    dispose() { for (const entry of entries.values()) entry.proxy?.geometry.dispose(); material.dispose() },
  }
}
