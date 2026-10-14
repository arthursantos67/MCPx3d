import * as THREE from 'three'
import type { SceneMaterial } from './sceneDocument.ts'

/** Deterministic UV textures, generated locally without CDN/image dependencies. */
export function proceduralTexture(kind: SceneMaterial['texture'], scale = 1): THREE.DataTexture {
  const size = 256, bytes = new Uint8Array(size * size * 4)
  let seed = 8437
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0
    const noise = (seed >>> 0) / 4294967295
    let rgb = [220, 220, 220]
    if (kind === 'metal') { const n = 190 + 35 * noise + 12 * Math.sin(y * 4); rgb = [n, n + 3, n + 6] }
    if (kind === 'concrete') { const n = 170 + noise * 60; rgb = [n, n - 3, n - 8] }
    if (kind === 'wood') { const grain = 0.5 + 0.5 * Math.sin(y * 0.36 + Math.sin(x * 0.03) * 3 + noise * 0.9); rgb = [125 + grain * 85, 75 + grain * 70, 35 + grain * 50] }
    if (kind === 'solar') { const line = x % 32 < 2 || y % 64 < 2; rgb = line ? [174, 197, 216] : [20 + noise * 8, 48 + noise * 12, 98 + noise * 20] }
    if (kind === 'tiles') { const line = x % 64 < 3 || y % 64 < 3; const n = line ? 90 : 205 + noise * 18; rgb = [n, n, n] }
    const index = (y * size + x) * 4
    bytes[index] = rgb[0]; bytes[index + 1] = rgb[1]; bytes[index + 2] = rgb[2]; bytes[index + 3] = 255
  }
  const texture = new THREE.DataTexture(bytes, size, size, THREE.RGBAFormat)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(scale, scale)
  texture.generateMipmaps = true
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.needsUpdate = true
  return texture
}
