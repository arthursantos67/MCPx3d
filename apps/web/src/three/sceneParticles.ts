import * as THREE from 'three'
import { hasSurface, type SceneNode, type ThreeSceneDocument, type Vector3Tuple } from './sceneDocument.ts'
import type { QualityLevel } from './sceneRuntimeTypes.ts'
import type { WindSystem } from './sceneWind.ts'

export const particleKinds = ['fire', 'smoke', 'sparks', 'magic', 'steam', 'fountain', 'leaves', 'dust', 'embers', 'splash', 'impact', 'footstep'] as const
export type ParticleKind = typeof particleKinds[number]
export interface ParticleProfile {
  additive: boolean; rate: number; life: [number, number]; speed: [number, number]; mode: 'up' | 'sphere' | 'ring'; radial: number
  gravity: number; drag: number; turbulence: number; wind: number; size: number; grow: number; shape: number; stretch: number; spin: number; color: string; alpha: number; burst: number
}
export interface ParticleBurst { count?: number; direction?: THREE.Vector3; color?: string; scale?: number }
export interface ParticleEmitter { id: string; kind: ParticleKind; rate: number; spread: number; position: () => THREE.Vector3 | null }
export interface ParticleSystem {
  object: THREE.Object3D
  burst(kind: ParticleKind, position: THREE.Vector3, options?: ParticleBurst): void
  setEmitters(list: ParticleEmitter[]): void
  update(camera: THREE.Camera, seconds: number, dt: number): void
  setQuality(quality: QualityLevel): void
  /** Sky light multiplier for normally blended particles (smoke at night is dark). */
  setLight(value: number): void
  /** Live particle count per blend mode, for budgets and tests. */
  stats(): { additive: number; normal: number }
  dispose(): void
}

// shape: 0 soft puff, 1 flame, 2 spark streak, 3 leaf, 4 glow star, 5 droplet streak
const P = (p: Partial<ParticleProfile> & Pick<ParticleProfile, 'additive' | 'rate' | 'life' | 'speed' | 'size' | 'shape' | 'color'>): ParticleProfile =>
  ({ mode: 'up', radial: 0.2, gravity: 0, drag: 1, turbulence: 0, wind: 0, grow: 0, stretch: 0, spin: 0, alpha: 1, burst: 12, ...p })
const profiles: Record<ParticleKind, ParticleProfile> = {
  fire: P({ additive: true, rate: 36, life: [0.55, 1], speed: [0.6, 1.4], radial: 0.25, gravity: -2.2, drag: 1.6, turbulence: 0.35, wind: 0.5, size: 0.32, grow: -0.65, shape: 1, spin: 0.6, color: '#ffffff', alpha: 0.9 }),
  smoke: P({ additive: false, rate: 7, life: [3.2, 5.5], speed: [0.5, 1], gravity: -0.35, drag: 0.7, turbulence: 0.8, wind: 0.9, size: 0.45, grow: 3, shape: 0, spin: 0.5, color: '#6b6661', alpha: 0.32 }),
  sparks: P({ additive: true, rate: 14, life: [0.4, 0.9], speed: [2, 4.5], mode: 'sphere', radial: 1, gravity: 9.8, drag: 0.6, turbulence: 0.1, wind: 0.1, size: 0.03, grow: -0.3, shape: 2, stretch: 0.06, color: '#ffb347', burst: 24 }),
  magic: P({ additive: true, rate: 18, life: [0.9, 1.6], speed: [0.2, 0.7], mode: 'sphere', gravity: -0.5, drag: 1.2, turbulence: 1, wind: 0.1, size: 0.1, grow: -0.4, shape: 4, spin: 1.5, color: '#9b7bff', burst: 30 }),
  steam: P({ additive: false, rate: 12, life: [1.4, 2.4], speed: [1, 1.8], radial: 0.15, gravity: -0.6, drag: 1.3, turbulence: 0.6, wind: 0.8, size: 0.28, grow: 2.6, shape: 0, spin: 0.4, color: '#e9eef2', alpha: 0.28 }),
  fountain: P({ additive: false, rate: 70, life: [0.9, 1.3], speed: [3.6, 4.4], radial: 0.7, gravity: 9.8, drag: 0.15, turbulence: 0.05, wind: 0.15, size: 0.045, grow: 0.3, shape: 5, stretch: 0.05, color: '#d8f2ff', alpha: 0.65 }),
  leaves: P({ additive: false, rate: 0.6, life: [6, 9], speed: [0.1, 0.4], mode: 'sphere', gravity: 0.9, drag: 1.4, turbulence: 0.9, wind: 1, size: 0.09, shape: 3, spin: 2, color: '#b5a23a', burst: 8 }),
  dust: P({ additive: false, rate: 5, life: [1.6, 2.8], speed: [0.2, 0.6], mode: 'ring', gravity: -0.05, drag: 2, turbulence: 0.5, wind: 0.7, size: 0.22, grow: 2.2, shape: 0, spin: 0.3, color: '#cdb994', alpha: 0.22 }),
  embers: P({ additive: true, rate: 5, life: [1.6, 3.2], speed: [0.8, 1.6], radial: 0.4, gravity: -0.7, drag: 0.9, turbulence: 0.9, wind: 0.6, size: 0.035, grow: -0.5, shape: 4, color: '#ff8a3a' }),
  splash: P({ additive: false, rate: 30, life: [0.45, 0.85], speed: [2, 3.4], radial: 1.6, gravity: 9.8, drag: 0.4, wind: 0.05, size: 0.05, grow: 0.2, shape: 5, stretch: 0.05, color: '#e6f6ff', alpha: 0.75, burst: 26 }),
  impact: P({ additive: true, rate: 20, life: [0.18, 0.4], speed: [2.5, 5.5], mode: 'sphere', gravity: 3, drag: 3.5, size: 0.05, grow: -0.4, shape: 2, stretch: 0.05, color: '#fff1c4', burst: 18 }),
  footstep: P({ additive: false, rate: 10, life: [0.7, 1.2], speed: [0.3, 0.8], mode: 'ring', gravity: 0.3, drag: 3, turbulence: 0.2, wind: 0.4, size: 0.14, grow: 2, shape: 0, spin: 0.4, color: '#bda983', alpha: 0.3, burst: 7 }),
}
export function particleProfile(kind: ParticleKind): ParticleProfile { return { ...(profiles[kind] ?? profiles.smoke) } }

export interface ParticleBudget { capacity: number; rateScale: number; distance: number; frameShare: number }
const budgets: Record<QualityLevel, ParticleBudget> = {
  low: { capacity: 1200, rateScale: 0.3, distance: 40, frameShare: 0.125 },
  medium: { capacity: 3000, rateScale: 0.6, distance: 60, frameShare: 0.125 },
  high: { capacity: 6000, rateScale: 1, distance: 90, frameShare: 0.125 },
}
/** Ring capacity per blend mode, emission scale, emitter cull distance and the largest share of a ring one frame may spawn. */
export function particleBudget(quality: QualityLevel): ParticleBudget { return { ...(budgets[quality] ?? budgets.medium) } }
export const MAX_PARTICLES = budgets.high.capacity

/** Circular slot allocator: oldest particles are overwritten, and only the slots written since the last flush are uploaded. */
export interface ParticleRing { readonly size: number; readonly capacity: number; readonly high: number; setCapacity(count: number): void; take(count: number): [number, number][]; flush(): [number, number][] }
export function createRing(size: number): ParticleRing {
  let capacity = size, cursor = 0, high = 0, pending: [number, number][] = []
  return {
    size,
    get capacity() { return capacity },
    get high() { return high },
    setCapacity(count) { capacity = Math.max(1, Math.min(size, Math.floor(count))); if (cursor >= capacity) cursor = 0 },
    take(count) {
      const out: [number, number][] = []
      let left = Math.max(0, Math.min(capacity, Math.floor(count)))
      while (left > 0) {
        const n = Math.min(left, capacity - cursor)
        out.push([cursor, n])
        pending.push([cursor, n])
        cursor = (cursor + n) % capacity
        high = Math.max(high, out[out.length - 1][0] + n)
        left -= n
      }
      return out
    },
    flush() {
      const sorted = pending.sort((a, b) => a[0] - b[0]), merged: [number, number][] = []
      for (const [start, count] of sorted) {
        const last = merged[merged.length - 1]
        if (last && start <= last[0] + last[1]) last[1] = Math.max(last[1], start + count - last[0])
        else merged.push([start, count])
      }
      pending = []
      return merged
    },
  }
}
/** Whole particles to spawn this frame and the fractional remainder carried to the next. */
export function emissionCount(rate: number, dt: number, carry: number): { count: number; carry: number } {
  const total = Math.max(0, carry + Math.max(0, rate) * Math.max(0, dt)), count = Math.floor(total)
  return { count, carry: total - count }
}

export interface EmitterSpec { id: string; nodeId: string; kind: ParticleKind; rate: number; spread: number; offset: Vector3Tuple }
const MAX_LEAF_EMITTERS = 24
/** Explicit `node.emitter` sources plus automatic ones (flames, campfire smoke, chimneys, fountain jets, reactor vents, portals, crystals, falling leaves). Offsets are in the node holder's frame. */
export function sceneEmitters(doc: ThreeSceneDocument): EmitterSpec[] {
  const byId = new Map(doc.nodes.map((node) => [node.id, node])), result: EmitterSpec[] = []
  const rootOf = (node: SceneNode): SceneNode | undefined => { for (let c: SceneNode | undefined = node; c; c = c.parentId ? byId.get(c.parentId) : undefined) if (c.asset) return c }
  const explicitRoots = new Set<string>()
  const add = (node: SceneNode, kind: ParticleKind, rate: number, spread: number, offset: Vector3Tuple) =>
    result.push({ id: `${node.id}:${kind}`, nodeId: node.id, kind, rate: Math.round(rate * 1000) / 1000, spread: Math.round(spread * 1000) / 1000, offset: offset.map((v) => Math.round(v * 1000) / 1000) as Vector3Tuple })
  for (const node of doc.nodes) if (node.emitter) {
    add(node, node.emitter.preset, node.emitter.rate, node.emitter.spread, hasSurface(node.kind) ? [0, node.dimensions[1] / 2, 0] : [0, 0, 0])
    if (node.asset) explicitRoots.add(node.id)
  }
  let leaves = 0
  for (const node of doc.nodes) {
    const root = rootOf(node), type = root?.asset?.type, part = node.assetPart ?? '', [w, h] = node.dimensions, size = root?.asset?.size ?? 1
    if (root && explicitRoots.has(root.id)) continue
    if (hasSurface(node.kind) && (/flame$/i.test(part) || (!part && node.name === 'Chama')) && node.material.emissive) {
      const big = type === 'campfire'
      add(node, 'fire', big ? 1 : THREE.MathUtils.clamp(w / 0.5, 0.3, 1), w * 0.35, [0, -0.3 * h, 0])
      if (big) { add(node, 'smoke', 0.8, 0.15 * size, [0, 0.6 * h, 0]); add(node, 'embers', 0.6, 0.2 * size, [0, 0, 0]) }
      else if (type === 'torch') add(node, 'embers', 0.25, 0.05 * size, [0, 0, 0])
      continue
    }
    if (type === 'fountain' && part === 'jet') add(node, 'fountain', 1, 0.05 * size, [0, 0.35 * h, 0])
    else if (type === 'reactor' && part === 'vent') add(node, 'steam', 0.6, 0.1 * size, [0, 0.5 * h + 0.05, 0])
    else if (type === 'portal' && part === 'disc') add(node, 'magic', 0.8, 0.9 * size, [0, 0, 0])
    else if ((type === 'crystalCluster' || type === 'powerOrb') && node === root) add(node, 'magic', type === 'powerOrb' ? 0.35 : 0.25, (type === 'powerOrb' ? 0.25 : 0.5) * size, [0, (type === 'powerOrb' ? 1 : 0.8) * size, 0])
    else if (type === 'tree' && part === 'foliage0' && root!.asset!.seed % 2 === 0 && leaves < MAX_LEAF_EMITTERS) { leaves++; add(node, 'leaves', 0.6, 1.4 * size, [0, 0, 0]) }
    else if (hasSurface(node.kind) && /chamin|chimney/i.test(node.name) && !node.assetPart) add(node, 'smoke', 0.7, 0.12, [0, h / 2 + 0.1, 0])
  }
  return result
}
/** Emitters following live holders; hidden holders (or hidden ancestors) stop emitting. */
export function emitterSources(specs: EmitterSpec[], holders: Map<string, THREE.Object3D>): ParticleEmitter[] {
  return specs.flatMap((spec) => {
    const holder = holders.get(spec.nodeId)
    if (!holder) return []
    const point = new THREE.Vector3()
    return [{ id: spec.id, kind: spec.kind, rate: spec.rate, spread: spec.spread, position: () => {
      for (let o: THREE.Object3D | null = holder; o; o = o.parent) if (!o.visible) return null
      return holder.localToWorld(point.set(...spec.offset))
    } }]
  })
}

const vertexShader = /* glsl */`
attribute vec4 pStart;
attribute vec4 pVelocity;
attribute vec4 pParams;
attribute vec4 pColor;
uniform float uTime, uPixel;
uniform vec3 uWind;
uniform vec4 uKindA[${particleKinds.length}];
uniform vec4 uKindB[${particleKinds.length}];
varying vec2 vUv;
varying vec4 vColor;
varying float vShape, vT, vSeed, vShade;
#include <fog_pars_vertex>
void main() {
  float age = uTime - pStart.w, life = pVelocity.w;
  if (age < 0.0 || age > life || life <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  int kind = int(pParams.y + 0.5);
  vec4 A = uKindA[kind], B = uKindB[kind];
  float t = age / life, drag = max(A.y, 1e-3), decay = exp(-drag * age), k = (1.0 - decay) / drag;
  float ph = pParams.z * 6.2831853;
  vec3 p = pStart.xyz + pVelocity.xyz * k + vec3(0.0, -A.x, 0.0) * (age - k) / drag + uWind * A.w * (age - k);
  p += vec3(sin(age * 1.7 + ph), 0.5 * sin(age * 1.3 + ph * 2.0), cos(age * 1.9 + ph * 3.0)) * A.z * t;
  vec3 velocity = pVelocity.xyz * decay + vec3(0.0, -A.x, 0.0) * (1.0 - decay) / drag + uWind * A.w * (1.0 - decay);
  vec4 mv = viewMatrix * vec4(p, 1.0);
  float dist = -mv.z;
  float size = pParams.x * max(0.05, 1.0 + B.x * t);
  float width = max(size, dist * uPixel * 1.5);
  float alpha = smoothstep(0.0, 0.08, t) * (1.0 - smoothstep(0.55, 1.0, t)) * (size / width) * (size / width) * smoothstep(0.1, 0.4, dist);
  vec2 corner = position.xy, offset;
  vShade = 1.0;
  if (B.z > 0.0) {
    vec2 dir = (viewMatrix * vec4(velocity, 0.0)).xy;
    float len = length(dir);
    dir = len > 1e-4 ? dir / len : vec2(0.0, 1.0);
    offset = dir * corner.y * max(width * 2.0, len * B.z * 3.0) + vec2(-dir.y, dir.x) * corner.x * width;
  } else {
    float a = B.w * age * (pParams.z - 0.5) * 2.0 + ph;
    float flip = B.y > 2.5 && B.y < 3.5 ? cos(age * B.w * 0.7 + ph) : 1.0;
    vShade = 0.6 + 0.4 * abs(flip);
    vec2 c = vec2(corner.x * (abs(flip) * 0.85 + 0.15), corner.y);
    offset = mat2(cos(a), sin(a), -sin(a), cos(a)) * c * width;
  }
  mv.xy += offset;
  gl_Position = projectionMatrix * mv;
  vUv = corner;
  vColor = vec4(pColor.rgb, pColor.a * alpha);
  vShape = B.y; vT = t; vSeed = pParams.z;
  #ifdef USE_FOG
  vFogDepth = dist;
  #endif
}`
const fragmentShader = /* glsl */`
uniform float uAdditive, uLight, uGlow;
varying vec2 vUv;
varying vec4 vColor;
varying float vShape, vT, vSeed, vShade;
#include <fog_pars_fragment>
void main() {
  vec2 uv = vUv;
  float r = length(uv), a;
  vec3 col = vColor.rgb;
  if (vShape < 0.5) {
    float n = sin(uv.x * 5.0 + vSeed * 20.0) * sin(uv.y * 4.0 - vSeed * 13.0) * 0.15;
    a = 1.0 - smoothstep(0.15, 1.0, r + n);
  } else if (vShape < 1.5) {
    vec2 q = vec2(uv.x * (1.0 + 0.7 * max(uv.y, 0.0)), uv.y * 0.8 + 0.15);
    float d = length(q);
    a = 1.0 - smoothstep(0.25, 1.0, d);
    float heat = clamp(1.0 - vT * 1.3 - d * 0.6, 0.0, 1.0);
    vec3 ramp = mix(vec3(0.85, 0.16, 0.03), vec3(1.0, 0.6, 0.14), smoothstep(0.1, 0.6, heat));
    col = mix(ramp, vec3(1.0, 0.94, 0.75), smoothstep(0.65, 1.0, heat)) * col;
  } else if (vShape < 2.5) {
    a = exp(-uv.x * uv.x * 6.0) * (1.0 - smoothstep(0.3, 1.0, abs(uv.y)));
    col *= 1.6;
  } else if (vShape < 3.5) {
    float w = (1.0 - uv.y * uv.y) * 0.55;
    a = 1.0 - smoothstep(w * 0.75, w, abs(uv.x));
    col = mix(col, col * vec3(0.7, 0.55, 0.35), fract(vSeed * 13.7)) * (0.8 + 0.2 * smoothstep(0.0, 0.08, abs(uv.x))) * vShade;
  } else if (vShape < 4.5) {
    a = exp(-r * r * 14.0) + exp(-r * r * 3.0) * 0.3 + max(0.0, 1.0 - abs(uv.x * uv.y) * 30.0) * (1.0 - r) * 0.35;
    col = mix(col, vec3(1.0), exp(-r * r * 30.0) * 0.6);
  } else {
    a = exp(-uv.x * uv.x * 4.0) * (1.0 - smoothstep(0.4, 1.0, abs(uv.y)));
    col = mix(col, vec3(1.0), smoothstep(0.5, -0.5, uv.y) * 0.4);
  }
  a = clamp(a, 0.0, 1.0) * vColor.a;
  if (a < 0.004) discard;
  col *= uAdditive > 0.5 ? uGlow : uLight;
  #ifdef USE_FOG
  #ifdef FOG_EXP2
  float fogF = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
  #else
  float fogF = smoothstep(fogNear, fogFar, vFogDepth);
  #endif
  if (uAdditive > 0.5) col *= 1.0 - fogF;
  else { col = mix(col, fogColor, fogF); a *= 1.0 - fogF * 0.7; }
  #endif
  gl_FragColor = vec4(col, a);
}`

const STRIDE = 16
interface Layer { mesh: THREE.Mesh; geometry: THREE.InstancedBufferGeometry; buffer: THREE.InstancedInterleavedBuffer; ring: ParticleRing; material: THREE.ShaderMaterial }
const color = new THREE.Color(), tint = new THREE.Color()

/** GPU particles: one ring buffer and one draw call per blend mode; trajectories are evaluated in the vertex shader, so the CPU only writes new particles. */
export function createParticles(wind?: WindSystem): ParticleSystem {
  const kindA = particleKinds.map((kind) => { const p = profiles[kind]; return new THREE.Vector4(p.gravity, p.drag, p.turbulence, p.wind) })
  const kindB = particleKinds.map((kind) => { const p = profiles[kind]; return new THREE.Vector4(p.grow, p.shape, p.stretch, p.spin) })
  const shared = { uTime: { value: 0 }, uPixel: { value: 0.001 }, uWind: { value: new THREE.Vector3() }, uKindA: { value: kindA }, uKindB: { value: kindB }, uLight: { value: 1 } }
  const group = new THREE.Group()
  group.name = 'particles'
  const layer = (additive: boolean): Layer => {
    const geometry = new THREE.InstancedBufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3))
    geometry.setIndex([0, 1, 2, 0, 2, 3])
    const buffer = new THREE.InstancedInterleavedBuffer(new Float32Array(MAX_PARTICLES * STRIDE), STRIDE)
    buffer.setUsage(THREE.DynamicDrawUsage)
    ;['pStart', 'pVelocity', 'pParams', 'pColor'].forEach((name, i) => geometry.setAttribute(name, new THREE.InterleavedBufferAttribute(buffer, 4, i * 4)))
    geometry.instanceCount = 0
    const material = new THREE.ShaderMaterial({ uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uAdditive: { value: additive ? 1 : 0 }, uGlow: { value: 2.2 } }]),
      vertexShader, fragmentShader, transparent: true, depthWrite: false, fog: true, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending })
    Object.assign(material.uniforms, shared)
    const mesh = new THREE.Mesh(geometry, material)
    mesh.name = additive ? 'particles-additive' : 'particles-normal'
    mesh.frustumCulled = false
    mesh.matrixAutoUpdate = false
    mesh.renderOrder = additive ? 12 : 11
    mesh.raycast = () => {}
    group.add(mesh)
    return { mesh, geometry, buffer, ring: createRing(MAX_PARTICLES), material }
  }
  const layers = { normal: layer(false), additive: layer(true) }
  let budget = particleBudget('high'), emitters: ParticleEmitter[] = [], epoch: number | null = null, now = 0, seed = 0x51ed27
  const carry = new Map<string, number>(), spawned = { normal: 0, additive: 0 }
  const random = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
  const direction = new THREE.Vector3(), spot = new THREE.Vector3(), cameraPosition = new THREE.Vector3()
  const spawn = (kind: ParticleKind, origin: THREE.Vector3, count: number, spread: number, options: ParticleBurst = {}) => {
    const profile = profiles[kind], target = profile.additive ? layers.additive : layers.normal, key = profile.additive ? 'additive' : 'normal'
    const allowed = Math.max(1, Math.floor(target.ring.capacity * budget.frameShare)) - spawned[key]
    const ranges = target.ring.take(Math.min(count, allowed))
    if (!ranges.length) return
    const data = target.buffer.array as Float32Array, scale = options.scale ?? 1, index = particleKinds.indexOf(kind)
    tint.set(options.color ?? profile.color)
    for (const [start, n] of ranges) for (let i = start; i < start + n; i++) {
      spawned[key]++
      const angle = random() * Math.PI * 2, radius = Math.sqrt(random()) * spread
      spot.set(origin.x + Math.cos(angle) * radius, origin.y + (random() - 0.5) * spread * 0.2, origin.z + Math.sin(angle) * radius)
      const speed = (profile.speed[0] + random() * (profile.speed[1] - profile.speed[0])) * scale
      if (profile.mode === 'up') direction.set(Math.cos(angle) * profile.radial * random(), 1, Math.sin(angle) * profile.radial * random())
      else if (profile.mode === 'ring') direction.set(Math.cos(angle), 0.25 + random() * 0.3, Math.sin(angle))
      else { const z = random() * 2 - 1, s = Math.sqrt(1 - z * z); direction.set(Math.cos(angle) * s, z * 0.8 + 0.35, Math.sin(angle) * s) }
      if (options.direction && options.direction.lengthSq() > 1e-8) direction.normalize().addScaledVector(options.direction.clone().normalize(), 1.2)
      if (profile.mode !== 'up') direction.normalize()
      direction.multiplyScalar(speed / (profile.mode === 'up' ? Math.max(1, direction.length()) : 1))
      const life = profile.life[0] + random() * (profile.life[1] - profile.life[0]), jitter = 0.88 + random() * 0.24
      color.copy(tint).multiplyScalar(jitter)
      data.set([spot.x, spot.y, spot.z, now, direction.x, direction.y, direction.z, life, profile.size * scale * (0.75 + random() * 0.5), index, random(), 0, color.r, color.g, color.b, profile.alpha], i * STRIDE)
    }
    target.geometry.instanceCount = target.ring.high
  }
  return {
    object: group,
    burst(kind, position, options = {}) { spawn(kind, position, Math.max(1, Math.round(options.count ?? profiles[kind].burst * Math.max(0.35, budget.rateScale))), 0.08 * (options.scale ?? 1), options) },
    setEmitters(list) { emitters = list; for (const id of [...carry.keys()]) if (!list.some((emitter) => emitter.id === id)) carry.delete(id) },
    update(camera, seconds, dt) {
      if (epoch === null) epoch = seconds
      now = (seconds - epoch) % 100000
      shared.uTime.value = now
      spawned.normal = 0; spawned.additive = 0
      camera.getWorldPosition(cameraPosition)
      if (wind) wind.vector(shared.uWind.value); else shared.uWind.value.set(0.4, 0, 0.15)
      if (camera instanceof THREE.PerspectiveCamera) shared.uPixel.value = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) / (1000 * camera.zoom)
      const step = THREE.MathUtils.clamp(dt, 0, 0.1)
      for (const emitter of emitters) {
        const position = emitter.position()
        if (!position) continue
        const distance = position.distanceTo(cameraPosition)
        if (distance > budget.distance) continue
        const rate = profiles[emitter.kind].rate * emitter.rate * budget.rateScale * (1 - 0.7 * THREE.MathUtils.smoothstep(distance, budget.distance * 0.5, budget.distance))
        const planned = emissionCount(rate, step, carry.get(emitter.id) ?? 0)
        carry.set(emitter.id, planned.carry)
        if (planned.count) spawn(emitter.kind, position, planned.count, emitter.spread)
      }
      for (const { ring, buffer } of Object.values(layers)) {
        const ranges = ring.flush()
        if (!ranges.length) continue
        buffer.clearUpdateRanges()
        for (const [start, count] of ranges) buffer.addUpdateRange(start * STRIDE, count * STRIDE)
        buffer.needsUpdate = true
      }
    },
    setQuality(quality) { budget = particleBudget(quality); for (const { ring } of Object.values(layers)) ring.setCapacity(budget.capacity) },
    setLight(value) { shared.uLight.value = THREE.MathUtils.clamp(value, 0.05, 1.5) },
    stats() {
      const live = (target: Layer) => { const data = target.buffer.array as Float32Array; let n = 0; for (let i = 0; i < target.ring.high; i++) { const age = now - data[i * STRIDE + 3]; if (age >= 0 && age <= data[i * STRIDE + 7]) n++ } return n }
      return { additive: live(layers.additive), normal: live(layers.normal) }
    },
    dispose() { group.removeFromParent(); for (const { geometry, material } of Object.values(layers)) { geometry.dispose(); material.dispose() } },
  }
}
