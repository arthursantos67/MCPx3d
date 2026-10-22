import * as THREE from 'three'
import type { SceneNode } from './sceneDocument.ts'
import { buildNodeGeometry } from './sceneGeometry.ts'
import type { GroundField } from './sceneGroundField.ts'
import { WIND_GLSL, type WindSystem } from './sceneWind.ts'

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

/** Absolute (idempotent) UV drift of shared water textures in two directions plus a breathing normal strength; O(materials) per frame. */
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

export const RIVER_SPEED = 0.8
const MAX_WATER_SEGMENTS = 160
const physical = (node: SceneNode) => node.dimensions.map((value, axis) => Math.abs(value * node.scale[axis])) as [number, number, number]
/** Grid resolution of a water plane: ~1.2 m cells, capped so the largest sea stays under 26k vertices. */
export function waterSegments(node: SceneNode): [number, number] {
  const [x, , z] = physical(node)
  return [Math.max(1, Math.min(MAX_WATER_SEGMENTS, Math.round(x / 1.2))), Math.max(1, Math.min(MAX_WATER_SEGMENTS, Math.round(z / 1.2)))]
}
/** Wave amplitude scale for a surface: ponds ripple, open water swells. */
export function waveScale(node: SceneNode): number { const [x, , z] = physical(node); return THREE.MathUtils.clamp(Math.min(x, z) / 14, 0.15, 1) }

/**
 * Tessellated geometry for water planes (same unit footprint and UVs as buildNodeGeometry) with `waterSwell` amplitude,
 * and river meshes (role path) with per-vertex `waterFlow` along the nearest route segment. Null for other nodes.
 */
export function waterGeometry(node: SceneNode): THREE.BufferGeometry | null {
  if (node.material.texture !== 'water' || node.material.textureImage) return null
  if (node.kind === 'plane') {
    const [sx, sz] = waterSegments(node), geometry = new THREE.PlaneGeometry(1, 1, sx, sz).rotateX(-Math.PI / 2)
    geometry.setAttribute('waterSwell', new THREE.BufferAttribute(new Float32Array(geometry.getAttribute('position').count).fill(waveScale(node)), 1))
    geometry.computeBoundingBox()
    geometry.computeBoundingSphere()
    return geometry
  }
  if (node.kind === 'mesh' && node.path && node.path.points.length >= 2) {
    const geometry = buildNodeGeometry(node), position = geometry.getAttribute('position'), points = node.path.points
    const flow = new Float32Array(position.count * 2), wave = new Float32Array(position.count).fill(0.4)
    for (let i = 0; i < position.count; i++) {
      const x = node.position[0] + position.getX(i) * node.dimensions[0], z = node.position[2] + position.getZ(i) * node.dimensions[2]
      let best = Infinity, dx = 0, dz = 0
      for (let k = 1; k < points.length; k++) {
        const [ax, az] = points[k - 1], [bx, bz] = points[k], ex = bx - ax, ez = bz - az, length = Math.hypot(ex, ez)
        if (length < 1e-6) continue
        const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / (length * length))), d = Math.hypot(x - ax - ex * t, z - az - ez * t)
        if (d < best) { best = d; dx = ex / length; dz = ez / length }
      }
      // Route UVs are world XZ / 2, so metres per second become half as many UV units.
      flow[i * 2] = dx * RIVER_SPEED / 2; flow[i * 2 + 1] = dz * RIVER_SPEED / 2
    }
    geometry.setAttribute('waterFlow', new THREE.BufferAttribute(flow, 2))
    geometry.setAttribute('waterSwell', new THREE.BufferAttribute(wave, 1))
    return geometry
  }
  return null
}

const commonGLSL = /* glsl */`
${WIND_GLSL}
uniform float waterAmplitude;
vec3 waterWave(vec2 xz) {
  vec2 d0 = windDirection;
  vec2 d1 = vec2(d0.x * 0.825 - d0.y * 0.565, d0.x * 0.565 + d0.y * 0.825);
  vec2 d2 = vec2(d0.x * 0.622 + d0.y * 0.783, -d0.x * 0.783 + d0.y * 0.622);
  vec2 d3 = vec2(-d0.y, d0.x);
  vec4 amp = waterAmplitude * (0.04 + 0.09 * windStrength) * vec4(0.5, 0.3, 0.2, 0.12);
  vec4 k = vec4(0.35, 0.62, 1.1, 1.9);
  vec4 phase = vec4(dot(d0, xz), dot(d1, xz), dot(d2, xz), dot(d3, xz)) * k - sqrt(9.8 * k) * windTime + vec4(0.0, 1.7, 4.1, 2.3);
  vec4 slope = cos(phase) * amp * k;
  return vec3(dot(sin(phase), amp), d0 * slope.x + d1 * slope.y + d2 * slope.z + d3 * slope.w);
}
varying vec3 vWaterWorld;
varying float vWaterScale;
varying vec2 vWaterFlow;`
const vertexHead = /* glsl */`
${commonGLSL}
attribute float waterSwell;
attribute vec2 waterFlow;
uniform vec2 waterFlowDefault;`
const vertexProject = /* glsl */`
vec4 waterWorld = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
waterWorld = instanceMatrix * waterWorld;
#endif
waterWorld = modelMatrix * waterWorld;
vWaterScale = waterSwell > 0.0 ? waterSwell : 0.35;
float waterLift = waterSwell > 0.0 ? waterWave(waterWorld.xz).x * waterSwell : 0.0;
waterWorld.y += waterLift;
vWaterWorld = waterWorld.xyz;
vec2 waterFlowUv = dot(waterFlow, waterFlow) > 0.0 ? waterFlow : waterFlowDefault;
#ifdef USE_NORMALMAP
vWaterFlow = mat2( normalMapTransform ) * waterFlowUv;
#else
vWaterFlow = waterFlowUv;
#endif
vec4 mvPosition = viewMatrix * waterWorld;
gl_Position = projectionMatrix * mvPosition;`
const vertexWorld = /* glsl */`
#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
worldPosition.y += waterLift;
#endif`
const fragmentHead = /* glsl */`
${commonGLSL}
uniform float waterShore;
uniform vec3 waterDeep;
float waterHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float waterNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(waterHash(i), waterHash(i + vec2(1.0, 0.0)), u.x), mix(waterHash(i + vec2(0.0, 1.0)), waterHash(i + vec2(1.0, 1.0)), u.x), u.y);
}`
const fragmentSurface = /* glsl */`
vec3 waterState = waterWave(vWaterWorld.xz);
vec4 waterGround = groundSample(vWaterWorld.xz);
float waterDepth = waterShore * waterGround.z > 0.5 ? max(0.0, vWaterWorld.y - waterGround.x) : 50.0;
vec2 waterDrift = vWaterWorld.xz * 1.6 + vec2(0.11, -0.07) * windTime;
float waterGrain = waterNoise(waterDrift + windTime * 0.15) * 0.65 + waterNoise(waterDrift * 2.7 - windTime * 0.21) * 0.35;
float waterBand = 0.5 + 0.5 * sin(waterDepth * 11.0 - windTime * 1.4 + waterGrain * 3.0);
float waterShoreFoam = (1.0 - smoothstep(0.0, 0.35 + 0.35 * waterGrain, waterDepth)) * smoothstep(0.25, 0.7, waterGrain * 0.7 + waterBand * 0.5);
float waterAmp = max(1e-4, waterAmplitude * (0.04 + 0.09 * windStrength) * 1.12);
float waterCrest = smoothstep(0.62, 0.95, waterState.x / waterAmp * 0.5 + 0.5) * smoothstep(0.45, 0.8, waterGrain) * vWaterScale * smoothstep(0.3, 1.2, windStrength);
float waterFoam = clamp(waterShoreFoam + waterCrest * 0.7, 0.0, 1.0);
diffuseColor.rgb *= mix(vec3(1.06, 1.05, 1.0), waterDeep, smoothstep(0.3, 6.0, waterDepth));
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92, 0.95, 0.96), waterFoam);
diffuseColor.a = mix(diffuseColor.a * mix(0.45, 1.0, smoothstep(0.0, 1.2, waterDepth)), 1.0, waterFoam);`
const fragmentNormal = /* glsl */`
#ifdef USE_NORMALMAP_TANGENTSPACE
float waterPhaseA = fract(windTime * 0.25), waterPhaseB = fract(windTime * 0.25 + 0.5);
vec3 waterStill = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
vec3 waterA = texture2D( normalMap, vNormalMapUv - vWaterFlow * waterPhaseA * 4.0 ).xyz * 2.0 - 1.0;
vec3 waterB = texture2D( normalMap, vNormalMapUv - vWaterFlow * waterPhaseB * 4.0 + 0.5 ).xyz * 2.0 - 1.0;
vec3 mapN = mix(waterStill, mix(waterB, waterA, 1.0 - abs(2.0 * waterPhaseA - 1.0)), step(1e-8, dot(vWaterFlow, vWaterFlow)));
vec3 waterDetail = texture2D( normalMap, vNormalMapUv * 2.31 + vec2(0.37, 0.11) + vec2(0.013, -0.009) * windTime ).xyz * 2.0 - 1.0;
mapN = vec3( mapN.xy + waterDetail.xy * 0.5, mapN.z );
mapN.xy *= normalScale;
normal = normalize( tbn * mapN );
#else
#include <normal_fragment_maps>
#endif
normal = normalize( normal + mat3( viewMatrix ) * vec3( - waterState.y, 0.0, - waterState.z ) * vWaterScale );`

/**
 * Upgrades a water material in place (idempotent): vertex swell on tessellated geometry, wave normals everywhere,
 * shore foam where the ground field meets the surface, crest foam, depth tint and two-phase flow along `waterFlow`.
 * `flow` is the still-water drift in UV units per second for surfaces without a per-vertex flow.
 */
export function prepareWater(material: THREE.MeshPhysicalMaterial, wind: WindSystem, field: GroundField | null, options: { flow?: [number, number]; amplitude?: number } = {}): void {
  if (field && wind.uniforms.groundMap.value !== field.texture) wind.setGround(field)
  const existing = material.userData.waterUniforms as Record<string, THREE.IUniform> | undefined
  if (existing) {
    ;(existing.waterFlowDefault.value as THREE.Vector2).set(...options.flow ?? [0, 0])
    existing.waterShore.value = field ? 1 : 0
    existing.waterAmplitude.value = options.amplitude ?? 1
    return
  }
  const own: Record<string, THREE.IUniform> = { waterFlowDefault: { value: new THREE.Vector2(...options.flow ?? [0, 0]) }, waterShore: { value: field ? 1 : 0 },
    waterAmplitude: { value: options.amplitude ?? 1 }, waterDeep: { value: new THREE.Color(0.42, 0.58, 0.74) } }
  material.userData.waterUniforms = own
  const previous = material.onBeforeCompile, previousKey = material.customProgramCacheKey.bind(material)
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer)
    Object.assign(shader.uniforms, wind.uniforms, own)
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\n${vertexHead}`)
      .replace('#include <project_vertex>', vertexProject)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>${vertexWorld}`)
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\n${fragmentHead}`)
      .replace('#include <map_fragment>', `#include <map_fragment>\n${fragmentSurface}`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix( roughnessFactor, 0.75, waterFoam );')
      .replace('#include <normal_fragment_maps>', fragmentNormal)
  }
  material.customProgramCacheKey = () => `${previousKey()}|water-v1`
  material.needsUpdate = true
}
