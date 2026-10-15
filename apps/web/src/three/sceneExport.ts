import * as THREE from 'three'
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'
import { cycleProgress, playsOnce, samplePose } from './sceneAnimation.ts'
import { buildScene, createResources } from './sceneBuild.ts'
import type { SceneNode, ThreeSceneDocument } from './sceneDocument.ts'
import { terrainGeometryForExport } from './sceneTerrainMaterial.ts'

const MAX_SAMPLES = 240_000
function tracks(node: SceneNode, holder: THREE.Object3D, frames: number, progressAt: (frame: number) => number, seconds: number) {
  const times: number[] = [], positions: number[] = [], quaternions: number[] = [], scales: number[] = [], quaternion = new THREE.Quaternion(), euler = new THREE.Euler()
  for (let frame = 0; frame <= frames; frame++) {
    const pose = samplePose(node, progressAt(frame))
    times.push(seconds * frame / frames)
    positions.push(...pose.position)
    quaternion.setFromEuler(euler.set(...pose.rotation.map(THREE.MathUtils.degToRad) as [number, number, number]))
    quaternions.push(quaternion.x, quaternion.y, quaternion.z, quaternion.w)
    scales.push(...pose.scale)
  }
  return [new THREE.VectorKeyframeTrack(`${holder.uuid}.position`, times, positions), new THREE.QuaternionKeyframeTrack(`${holder.uuid}.quaternion`, times, quaternions), new THREE.VectorKeyframeTrack(`${holder.uuid}.scale`, times, scales)]
}

/** The exporter composes some maps through a 2D canvas, which cannot draw raw DataTexture buffers. */
async function exportableTexture(texture: THREE.Texture): Promise<THREE.Texture> {
  if (texture.userData.dataUrl && !(texture.image as HTMLImageElement | undefined)?.width) {
    const loaded = await new THREE.TextureLoader().loadAsync(texture.userData.dataUrl as string)
    loaded.flipY = false; loaded.colorSpace = texture.colorSpace
    return loaded
  }
  if (!(texture instanceof THREE.DataTexture)) return texture
  const { data, width, height } = texture.image as { data: Uint8Array; width: number; height: number }
  const canvas = document.createElement('canvas')
  canvas.width = width; canvas.height = height
  canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(data), width, height), 0, 0)
  const result = new THREE.CanvasTexture(canvas)
  Object.assign(result, { flipY: false, colorSpace: texture.colorSpace, wrapS: texture.wrapS, wrapT: texture.wrapT })
  result.repeat.copy(texture.repeat)
  return result
}

/** Exports visible nodes as GLB 2.0 with PBR materials, punctual lights and baked animation clips. */
export async function exportSceneGlb(doc: ThreeSceneDocument): Promise<ArrayBuffer> {
  const resources = createResources()
  const built = buildScene(doc, resources, { instancing: false, helpers: false })
  const converted = new Map<THREE.Texture, THREE.Texture>()
  const exportGeometries:THREE.BufferGeometry[]=[]
  try {
    const animated = doc.nodes.filter((node) => node.animation.kind !== 'none' && built.holders.has(node.id))
    const looping = animated.filter((node) => !playsOnce(node)), once = animated.filter(playsOnce)
    const duration = doc.timeline.duration, frames = Math.max(16, Math.min(Math.ceil(duration * 30), Math.floor(MAX_SAMPLES / Math.max(1, looping.length))))
    const animations: THREE.AnimationClip[] = []
    if (looping.length) animations.push(new THREE.AnimationClip(doc.name, duration, looping.flatMap((node) => tracks(node, built.holders.get(node.id)!, frames, (frame) => cycleProgress(node, duration * frame / frames), duration))))
    for (const node of once) animations.push(new THREE.AnimationClip(`${node.name} (interação)`, node.animation.duration, tracks(node, built.holders.get(node.id)!, Math.max(8, Math.ceil(node.animation.duration * 30)), (frame) => frame / Math.max(8, Math.ceil(node.animation.duration * 30)), node.animation.duration)))
    built.root.name = doc.name
    const materials = new Set<THREE.MeshPhysicalMaterial>()
    built.root.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || !(object.material instanceof THREE.MeshPhysicalMaterial)) return
      materials.add(object.material)
      const layering=object.material.userData.terrainLayering
      if(layering) {
        object.geometry=terrainGeometryForExport(object.geometry,layering.metresPerTile)
        exportGeometries.push(object.geometry)
      }
    })
    // GPU-only texture references are internal resources, not portable glTF extras.
    for(const material of materials) delete material.userData.terrainTextures
    for (const material of materials) for (const slot of ['map', 'normalMap', 'roughnessMap'] as const) {
      const texture = material[slot]
      if (!texture) continue
      if (!converted.has(texture)) converted.set(texture, await exportableTexture(texture))
      material[slot] = converted.get(texture)!
    }
    const result = await new GLTFExporter().parseAsync(built.root, { binary: true, onlyVisible: true, animations })
    if (!(result instanceof ArrayBuffer)) throw new Error('O exportador não produziu um GLB binário.')
    return result
  } finally {
    built.dispose(); resources.dispose()
    for(const geometry of exportGeometries) geometry.dispose()
    for (const [source, texture] of converted) if (source !== texture) texture.dispose()
  }
}
