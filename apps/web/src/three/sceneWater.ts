import * as THREE from 'three'

type Mapped = THREE.Material & { map?: THREE.Texture | null; normalMap?: THREE.Texture | null; roughnessMap?: THREE.Texture | null; normalScale?: THREE.Vector2 }

/** Water surfaces are flagged at build time with material.userData.water = true. */
export function isWaterMaterial(material: THREE.Material): boolean { return material.userData?.water === true }

export function collectWaterMaterials(root: THREE.Object3D): THREE.Material[] {
  const found = new Set<THREE.Material>()
  root.traverse((object) => {
    const material = (object as THREE.Mesh).material
    if (!material) return
    for (const entry of Array.isArray(material) ? material : [material]) if (isWaterMaterial(entry)) found.add(entry)
  })
  return [...found]
}

function drift(texture: THREE.Texture | null | undefined, seconds: number, u: number, v: number, swirl: number) {
  if (!texture) return
  const base = (texture.userData.waterBase ??= { x: texture.offset.x, y: texture.offset.y, rotation: texture.rotation }) as { x: number; y: number; rotation: number }
  texture.offset.set(base.x + (u * seconds) % 1, base.y + (v * seconds) % 1)
  if (swirl) texture.rotation = base.rotation + swirl * Math.sin(seconds * 0.07)
}

/** Absolute (idempotent) UV drift of shared water textures in two directions plus a breathing normal strength; O(materials) per frame, no shader changes. */
export function animateWater(materials: Iterable<THREE.Material>, seconds: number): void {
  for (const entry of materials) {
    if (!isWaterMaterial(entry)) continue
    const material = entry as Mapped
    drift(material.normalMap, seconds, 0.021, 0.013, 0.015)
    drift(material.roughnessMap, seconds, -0.017, 0.024, 0)
    drift(material.map, seconds, -0.006, 0.004, 0)
    if (material.normalScale) {
      const base = (material.userData.waterNormalScale ??= material.normalScale.clone()) as THREE.Vector2
      material.normalScale.copy(base).multiplyScalar(1 + 0.22 * Math.sin(seconds * 0.9) + 0.08 * Math.sin(seconds * 2.3))
    }
  }
}
