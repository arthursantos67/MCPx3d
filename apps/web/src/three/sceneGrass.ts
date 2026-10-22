import * as THREE from 'three'
import type { QualityLevel } from './sceneRuntimeTypes.ts'
import type { GroundField } from './sceneGroundField.ts'
import { WIND_GLSL, type WindSystem } from './sceneWind.ts'

export type GrassDensity = 'auto' | 'dense'
export interface GrassBudget { count: number; area: number; fadeStart: number; fadeEnd: number; height: number; width: number }
export interface GrassSystem {
  object: THREE.Object3D
  update(camera: THREE.Camera, seconds: number, player: THREE.Vector3 | null): void
  setQuality(quality: QualityLevel): void
  dispose(): void
}

export const MAX_GRASS_BLADES = 72000
const SEGMENTS = 4, TRAIL = 6
const tiers: Record<QualityLevel, { count: number; area: number }> = { low: { count: 7000, area: 22 }, medium: { count: 20000, area: 32 }, high: { count: 48000, area: 44 } }

/** Blades per camera tile; the tile wraps around the camera, so density is count / area². */
export function grassBudget(quality: QualityLevel, density: GrassDensity): GrassBudget {
  const tier = tiers[quality] ?? tiers.medium, dense = density === 'dense'
  const fadeEnd = tier.area * 0.48
  return { count: Math.min(MAX_GRASS_BLADES, Math.round(tier.count * (dense ? 1.5 : 1))), area: tier.area, fadeStart: fadeEnd * 0.55, fadeEnd, height: dense ? 0.55 : 0.42, width: 0.075 }
}

/** Uniform [0, 1)^4 seeds shared by CPU planning and the instanced attribute. */
export function grassSeeds(count = MAX_GRASS_BLADES): Float32Array {
  const data = new Float32Array(count * 4)
  let state = 0x2545f491
  for (let i = 0; i < data.length; i++) { state = (state + 0x6d2b79f5) | 0; let t = Math.imul(state ^ (state >>> 15), 1 | state); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; data[i] = ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
  return data
}
const mod = (value: number, size: number) => ((value % size) + size) % size
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }
/** World XZ of blade `index` around `center`, fixed in the world while the camera tile slides (mirror of the vertex shader). */
export function bladeRoot(seeds: Float32Array, index: number, center: [number, number], area: number): [number, number] {
  const px = seeds[index * 4] * area, pz = seeds[index * 4 + 1] * area
  return [center[0] + mod(px - center[0] + area / 2, area) - area / 2, center[1] + mod(pz - center[1] + area / 2, area) - area / 2]
}
/** CPU mirror of the keep rule: a blade survives where its seed is below the mask and fades out with distance. Returns blade scale (0 = culled). */
export function bladeScale(field: GroundField, seeds: Float32Array, index: number, center: [number, number], budget: GrassBudget): number {
  const [x, z] = bladeRoot(seeds, index, center, budget.area)
  const density = field.grassAt(x, z) * field.coverAt(x, z), fade = 1 - smooth(budget.fadeStart, budget.fadeEnd, Math.hypot(x - center[0], z - center[1]))
  return smooth(0, 0.25, density - seeds[index * 4 + 2]) * fade
}

const vertexHead = /* glsl */`
${WIND_GLSL}
attribute vec4 bladeSeed;
uniform vec3 grassCamera;
uniform vec4 grassShape;
uniform vec4 grassTrail[${TRAIL}];
uniform vec3 grassColor;
uniform float grassUseTint;
varying vec3 vGrassColor;`
const vertexBlade = /* glsl */`
vec2 bladeRel = mod(bladeSeed.xy * grassShape.x - grassCamera.xz + grassShape.x * 0.5, grassShape.x) - grassShape.x * 0.5;
vec2 bladeRoot = grassCamera.xz + bladeRel;
vec4 bladeGround = groundSample(bladeRoot);
float bladeFade = 1.0 - smoothstep(grassShape.y, grassShape.z, length(bladeRel));
float bladeSize = smoothstep(0.0, 0.25, bladeGround.y * bladeGround.z - bladeSeed.z) * bladeFade;
float bladeVariant = fract(bladeSeed.w * 13.7);
float bladeHeight = grassShape.w * (0.55 + 0.9 * bladeVariant) * bladeSize;
float bladeWidth = 0.075 * (0.7 + 0.6 * fract(bladeSeed.w * 5.1)) * min(1.0, 0.4 + bladeSize);
float bladeYaw = fract(bladeSeed.w * 31.3) * 6.2831853;
vec3 bladeFacing = vec3(cos(bladeYaw), 0.0, sin(bladeYaw)), bladeSide = vec3(-bladeFacing.z, 0.0, bladeFacing.x);
vec2 bladeBend = windField(bladeRoot) * 0.55 + bladeFacing.xz * (0.12 + 0.25 * fract(bladeSeed.w * 7.9));
for (int i = 0; i < ${TRAIL}; i++) {
  vec2 away = bladeRoot - grassTrail[i].xz;
  float d = length(away);
  float push = grassTrail[i].w * (1.0 - smoothstep(0.15, 0.95, d)) * (1.0 - smoothstep(0.6, 1.6, abs(bladeGround.x - grassTrail[i].y)));
  bladeBend += (d > 1e-3 ? away / d : bladeFacing.xz) * push * 1.8;
}
float bladeAngle = min(length(bladeBend), 1.35);
vec3 bladeDir = bladeAngle > 1e-3 ? vec3(bladeBend.x, 0.0, bladeBend.y) / length(bladeBend) : bladeFacing;
float bladeT = position.y;
float bladeForward = bladeAngle > 1e-3 ? bladeHeight / bladeAngle * (1.0 - cos(bladeAngle * bladeT)) : 0.0;
float bladeUp = bladeAngle > 1e-3 ? bladeHeight / bladeAngle * sin(bladeAngle * bladeT) : bladeHeight * bladeT;
vec3 bladeTangent = normalize(bladeDir * sin(bladeAngle * bladeT) + vec3(0.0, cos(bladeAngle * bladeT), 0.0));
vec3 bladePosition = vec3(bladeRoot.x, bladeGround.x - 0.03, bladeRoot.y) + bladeDir * bladeForward + vec3(0.0, bladeUp, 0.0)
  + bladeSide * position.x * bladeWidth * (1.0 - bladeT * 0.85) + bladeFacing * abs(position.x) * bladeWidth * 0.3;
vec3 bladeNormal = normalize(mix(normalize(cross(bladeSide, bladeTangent)), vec3(0.0, 1.0, 0.0), 0.55));
vec3 bladeTint = grassUseTint > 0.5 ? texture2D(groundTint, groundUv(bladeRoot)).rgb : grassColor;
bladeTint *= mix(vec3(1.0), vec3(1.12, 1.05, 0.62), step(0.82, fract(bladeSeed.w * 3.7)) * 0.6) * (0.85 + 0.3 * fract(bladeSeed.w * 17.3));
vGrassColor = bladeTint * mix(0.5, 1.22, bladeT);
vec3 objectNormal = bladeSize > 0.0 ? bladeNormal : vec3(0.0, 1.0, 0.0);`

/** Instanced grass in one draw call on a camera-following tile: ground-fitted, masked, wind-bent and trampled by the player. */
export function createGrass(field: GroundField, wind: WindSystem, options: { density: GrassDensity; quality: QualityLevel; color?: string }): GrassSystem | null {
  const data = field.texture.image.data as Uint8Array
  let any = false
  for (let i = 2; i < data.length && !any; i += 4) any = data[i] > 12
  if (!any) return null
  if (wind.uniforms.groundMap.value !== field.texture) wind.setGround(field)
  const blade = new THREE.InstancedBufferGeometry(), positions: number[] = [], indices: number[] = []
  for (let r = 0; r < SEGMENTS; r++) positions.push(-0.5, r / SEGMENTS, 0, 0.5, r / SEGMENTS, 0)
  positions.push(0, 1, 0)
  for (let r = 0; r < SEGMENTS - 1; r++) { const a = r * 2; indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2) }
  indices.push((SEGMENTS - 1) * 2, (SEGMENTS - 1) * 2 + 1, SEGMENTS * 2)
  blade.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  blade.setAttribute('normal', new THREE.Float32BufferAttribute(positions.map((_, i) => i % 3 === 1 ? 1 : 0), 3))
  blade.setIndex(indices)
  blade.setAttribute('bladeSeed', new THREE.InstancedBufferAttribute(grassSeeds(), 4))
  const trail = Array.from({ length: TRAIL }, () => new THREE.Vector4(0, -1e4, 0, 0))
  const uniforms: Record<string, THREE.IUniform> = { grassCamera: { value: new THREE.Vector3() }, grassShape: { value: new THREE.Vector4() }, grassTrail: { value: trail },
    grassColor: { value: new THREE.Color(options.color ?? '#5d7d42') }, grassUseTint: { value: options.color ? 0 : 1 } }
  // alphaTest keeps the blades out of the SSAO normal prepass, which cannot run this vertex shader.
  const material = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.88, metalness: 0, side: THREE.DoubleSide, alphaTest: 0.001 })
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, wind.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\n${vertexHead}`)
      .replace('#include <beginnormal_vertex>', vertexBlade)
      .replace('#include <begin_vertex>', 'vec3 transformed = bladePosition;')
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vGrassColor;')
      .replace('#include <color_fragment>', 'diffuseColor.rgb *= vGrassColor;')
      // Both faces share the up-biased normal so blades light like the ground they grow from.
      .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n#ifdef DOUBLE_SIDED\nnormal *= faceDirection;\nnonPerturbedNormal = normal;\n#endif')
  }
  material.customProgramCacheKey = () => `grass-v1:${TRAIL}`
  const mesh = new THREE.Mesh(blade, material)
  mesh.name = 'grass'
  mesh.frustumCulled = false
  mesh.matrixAutoUpdate = false
  mesh.castShadow = false
  mesh.receiveShadow = true
  mesh.raycast = () => {}
  const setQuality = (quality: QualityLevel) => {
    const budget = grassBudget(quality, options.density)
    blade.instanceCount = budget.count
    ;(uniforms.grassShape.value as THREE.Vector4).set(budget.area, budget.fadeStart, budget.fadeEnd, budget.height)
  }
  setQuality(options.quality)
  let last: number | null = null, pushed = -Infinity
  const ages = new Float32Array(TRAIL).fill(Infinity)
  return {
    object: mesh,
    update(camera, seconds, player) {
      const dt = last === null ? 0 : THREE.MathUtils.clamp(seconds - last, 0, 0.25)
      last = seconds
      camera.getWorldPosition(uniforms.grassCamera.value as THREE.Vector3)
      for (let i = 1; i < TRAIL; i++) ages[i] += dt
      if (player) {
        const previous = trail[1]
        if (seconds - pushed > 0.2 || Math.hypot(previous.x - player.x, previous.z - player.z) > 0.4) {
          for (let i = TRAIL - 1; i > 1; i--) { trail[i].copy(trail[i - 1]); ages[i] = ages[i - 1] }
          trail[1].set(player.x, player.y, player.z, 1); ages[1] = 0; pushed = seconds
        }
        trail[0].set(player.x, player.y, player.z, 1); ages[0] = 0
      } else { trail[0].w = 0; ages[0] = Infinity }
      // Older footprints relax over about two seconds instead of snapping back.
      for (let i = 1; i < TRAIL; i++) trail[i].w = Number.isFinite(ages[i]) ? Math.exp(-ages[i] / 0.9) : 0
    },
    setQuality,
    dispose() { mesh.removeFromParent(); blade.dispose(); material.dispose() },
  }
}
