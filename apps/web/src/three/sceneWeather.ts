import * as THREE from 'three'
import { Pass } from 'three/addons/postprocessing/Pass.js'
import type { SceneEnvironment, weatherKinds } from './sceneDocument.ts'

export type WeatherKind = typeof weatherKinds[number]
export interface WeatherProfile { count: number; area: number; height: number; fall: number; drift: number; size: number; color: string; additive: boolean; streak: boolean }
export interface WeatherSystem {
  apply(kind: WeatherKind, env: SceneEnvironment): void
  update(camera: THREE.Camera, seconds: number, wind?: THREE.Vector3): void
  readonly object: THREE.Object3D
  dispose(): void
}

export const MAX_WEATHER_PARTICLES = 6000
const profiles: Record<WeatherKind, WeatherProfile> = {
  none: { count: 0, area: 1, height: 1, fall: 0, drift: 0, size: 0.01, color: '#ffffff', additive: false, streak: false },
  rain: { count: 6000, area: 36, height: 22, fall: 11, drift: 0.35, size: 0.011, color: '#a9bccf', additive: false, streak: true },
  snow: { count: 3000, area: 34, height: 18, fall: 0.9, drift: 0.8, size: 0.034, color: '#f5f9ff', additive: false, streak: false },
  embers: { count: 700, area: 22, height: 14, fall: -1.3, drift: 0.5, size: 0.03, color: '#ff7428', additive: true, streak: false },
  fireflies: { count: 260, area: 28, height: 6, fall: 0, drift: 0.15, size: 0.04, color: '#d2ff6a', additive: true, streak: false },
  dust: { count: 1600, area: 22, height: 10, fall: 0.04, drift: 0.4, size: 0.012, color: '#e9d8b4', additive: false, streak: false },
  bubbles: { count: 700, area: 18, height: 14, fall: -0.9, drift: 0.2, size: 0.045, color: '#d4f1ff', additive: false, streak: false },
  leaves: { count: 450, area: 30, height: 14, fall: 0.7, drift: 1, size: 0.07, color: '#c97a2c', additive: false, streak: false },
  ash: { count: 2200, area: 30, height: 16, fall: 0.35, drift: 0.7, size: 0.02, color: '#8a8580', additive: false, streak: false },
}
interface Style { sway: number; swayFreq: number; flicker: number; blink: number; spin: number; glow: number; shape: number; alpha: number; accent: string }
const styles: Record<WeatherKind, Style> = {
  none: { sway: 0, swayFreq: 0, flicker: 0, blink: 0, spin: 0, glow: 1, shape: 0, alpha: 0, accent: '#ffffff' },
  rain: { sway: 0, swayFreq: 0, flicker: 0, blink: 0, spin: 0, glow: 1, shape: 1, alpha: 0.38, accent: '#a9bccf' },
  snow: { sway: 0.35, swayFreq: 0.6, flicker: 0, blink: 0, spin: 0, glow: 1, shape: 0, alpha: 0.9, accent: '#f5f9ff' },
  embers: { sway: 0.25, swayFreq: 1.6, flicker: 0.6, blink: 0, spin: 0, glow: 5, shape: 4, alpha: 1, accent: '#ffd27a' },
  fireflies: { sway: 1.2, swayFreq: 0.25, flicker: 0, blink: 1, spin: 0, glow: 7, shape: 4, alpha: 1, accent: '#fff6c8' },
  dust: { sway: 0.3, swayFreq: 0.2, flicker: 0.4, blink: 0, spin: 0, glow: 1, shape: 0, alpha: 0.4, accent: '#e9d8b4' },
  bubbles: { sway: 0.12, swayFreq: 2.2, flicker: 0, blink: 0, spin: 0, glow: 1, shape: 3, alpha: 0.65, accent: '#ffffff' },
  leaves: { sway: 0.9, swayFreq: 0.7, flicker: 0, blink: 0, spin: 2.2, glow: 1, shape: 2, alpha: 1, accent: '#8f3a1c' },
  ash: { sway: 0.4, swayFreq: 0.5, flicker: 0.15, blink: 0, spin: 1.5, glow: 1, shape: 0, alpha: 0.75, accent: '#5d5955' },
}
const skyLight: Record<string, number> = { studio: 1, day: 1, sunset: 0.75, overcast: 0.7, night: 0.18, space: 0.25 }

/** Pure particle budget and motion profile; fall is metres per second downwards (negative rises). */
export function weatherProfile(kind: WeatherKind): WeatherProfile { return { ...(profiles[kind] ?? profiles.none) } }

const vertexShader = /* glsl */`
attribute vec4 seed;
uniform vec3 uCamera, uOffsetA, uOffsetB, uVelocity;
uniform float uTime, uArea, uHeight, uSize, uSway, uSwayFreq, uSpin, uFlicker, uBlink, uShape, uPixel, uStreak;
varying vec2 vUv;
varying float vAlpha, vSeed, vShade;
#include <fog_pars_vertex>
void main() {
  vec3 box = vec3(uArea, uHeight, uArea);
  float ph = seed.w * 6.2831853, t = uTime * uSwayFreq;
  vec3 p = seed.xyz * box + mix(uOffsetA, uOffsetB, step(0.5, fract(seed.w * 7.0)));
  p.x += (sin(t + ph) + 0.35 * sin(t * 2.3 + ph * 3.0)) * uSway;
  p.z += cos(t * 0.83 + ph * 1.7) * uSway;
  p.y += sin(t * 0.61 + ph * 2.3) * uSway * (uShape > 3.5 ? 0.5 : 0.15);
  vec3 center = uCamera + vec3(0.0, uHeight * 0.18, 0.0);
  vec3 rel = mod(p - center + box * 0.5, box) - box * 0.5;
  vec3 e = abs(rel) / (box * 0.5);
  float fade = (1.0 - smoothstep(0.7, 1.0, max(e.x, e.z))) * (1.0 - smoothstep(0.75, 1.0, e.y));
  vec4 mv = viewMatrix * vec4(center + rel, 1.0);
  float dist = -mv.z;
  fade *= smoothstep(0.25, 1.0, dist);
  float width = max(uSize, dist * uPixel * 1.5);
  fade *= uShape > 0.5 && uShape < 1.5 ? uSize / width : (uSize / width) * (uSize / width);
  vec2 corner = position.xy, offset;
  vShade = 1.0;
  if (uShape > 0.5 && uShape < 1.5) {
    vec2 dir = (viewMatrix * vec4(uVelocity, 0.0)).xy;
    float len = length(dir);
    dir = len > 1e-4 ? dir / len : vec2(0.0, 1.0);
    offset = dir * corner.y * max(width * 3.0, len * uStreak) + vec2(-dir.y, dir.x) * corner.x * width;
  } else {
    float a = uSpin * uTime * (0.5 + seed.w) + ph;
    float flip = uSpin > 0.0 ? cos(uTime * uSpin * 0.7 * (0.6 + seed.y) + ph) : 1.0;
    vShade = 0.6 + 0.4 * abs(flip);
    vec2 c = vec2(corner.x * (uSpin > 0.0 ? abs(flip) * 0.85 + 0.15 : 1.0), corner.y);
    offset = mat2(cos(a), sin(a), -sin(a), cos(a)) * c * width * (uShape > 3.5 ? 4.0 : 1.0);
  }
  mv.xy += offset;
  gl_Position = projectionMatrix * mv;
  vUv = corner;
  float flick = 1.0 - uFlicker * (0.5 + 0.5 * sin(uTime * (7.0 + seed.y * 9.0) + ph * 5.0));
  float blink = mix(1.0, 0.04 + pow(max(0.0, sin(uTime * (0.6 + seed.z * 0.9) + ph * 4.0)), 3.0), uBlink);
  vAlpha = fade * flick * blink;
  vSeed = seed.w;
  #ifdef USE_FOG
  vFogDepth = dist;
  #endif
}`
const fragmentShader = /* glsl */`
uniform vec3 uColor, uAccent;
uniform float uShape, uAlpha, uGlow, uLight, uAdditive;
varying vec2 vUv;
varying float vAlpha, vSeed, vShade;
#include <fog_pars_fragment>
void main() {
  vec2 uv = vUv;
  float r = length(uv), a;
  vec3 col = uColor;
  if (uShape < 0.5) a = 1.0 - smoothstep(0.35, 1.0, r);
  else if (uShape < 1.5) a = exp(-uv.x * uv.x * 5.0) * (1.0 - smoothstep(0.2, 1.0, abs(uv.y))) * (0.6 + 0.4 * (0.5 - 0.5 * uv.y));
  else if (uShape < 2.5) {
    float w = (1.0 - uv.y * uv.y) * 0.55;
    a = 1.0 - smoothstep(w * 0.75, w, abs(uv.x));
    col = mix(uColor, uAccent, fract(vSeed * 13.7)) * (0.8 + 0.2 * smoothstep(0.0, 0.08, abs(uv.x))) * vShade;
    col = mix(col, col * vec3(0.75, 1.05, 0.5), step(0.85, fract(vSeed * 5.3)));
  } else if (uShape < 3.5) {
    float rim = smoothstep(0.62, 0.9, r) * (1.0 - smoothstep(0.9, 1.0, r));
    vec2 h = uv - vec2(-0.35, 0.35);
    a = rim * 0.8 + exp(-dot(h, h) * 30.0) + 0.06 * (1.0 - smoothstep(0.9, 1.0, r));
  } else {
    float core = exp(-r * r * 60.0);
    a = core + exp(-r * r * 7.0) * 0.35;
    col = mix(uColor, uAccent, core * 0.6);
  }
  a *= vAlpha * uAlpha;
  if (a < 0.003) discard;
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

function seeds() {
  const data = new Float32Array(MAX_WEATHER_PARTICLES * 4)
  let state = 0x9e3779b9
  for (let i = 0; i < data.length; i++) { state = (state + 0x6d2b79f5) | 0; let t = Math.imul(state ^ (state >>> 15), 1 | state); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; data[i] = ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
  return data
}
const wrap = (value: number, size: number) => ((value % size) + size) % size

/** Camera-following particle weather; positions wrap in the vertex shader so CPU work per frame is constant. */
export function createWeather(): WeatherSystem {
  const geometry = new THREE.InstancedBufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3))
  geometry.setIndex([0, 1, 2, 0, 2, 3])
  geometry.setAttribute('seed', new THREE.InstancedBufferAttribute(seeds(), 4))
  geometry.instanceCount = 0
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    uCamera: { value: new THREE.Vector3() }, uOffsetA: { value: new THREE.Vector3() }, uOffsetB: { value: new THREE.Vector3() }, uVelocity: { value: new THREE.Vector3() },
    uTime: { value: 0 }, uArea: { value: 1 }, uHeight: { value: 1 }, uSize: { value: 0.01 }, uSway: { value: 0 }, uSwayFreq: { value: 0 }, uSpin: { value: 0 }, uFlicker: { value: 0 }, uBlink: { value: 0 },
    uShape: { value: 0 }, uPixel: { value: 0.001 }, uStreak: { value: 0.035 }, uColor: { value: new THREE.Color() }, uAccent: { value: new THREE.Color() }, uAlpha: { value: 0 }, uGlow: { value: 1 }, uLight: { value: 1 }, uAdditive: { value: 0 },
  }])
  const material = new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader, transparent: true, depthWrite: false, fog: true })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = 'weather'
  mesh.frustumCulled = false
  mesh.matrixAutoUpdate = false
  mesh.renderOrder = 10
  mesh.visible = false
  mesh.raycast = () => {}
  let profile = weatherProfile('none'), last: number | null = null
  const velocity = new THREE.Vector3(), breeze = new THREE.Vector3(0.8, 0, 0.3)
  const advance = (offset: THREE.Vector3, scale: number, dt: number) => offset.set(
    wrap(offset.x + velocity.x * scale * dt, profile.area), wrap(offset.y + velocity.y * scale * dt, profile.height), wrap(offset.z + velocity.z * scale * dt, profile.area))
  return {
    object: mesh,
    apply(kind, env) {
      profile = weatherProfile(kind)
      const style = styles[kind] ?? styles.none
      geometry.instanceCount = Math.min(MAX_WEATHER_PARTICLES, profile.count)
      mesh.visible = profile.count > 0
      material.blending = profile.additive ? THREE.AdditiveBlending : THREE.NormalBlending
      uniforms.uArea.value = profile.area; uniforms.uHeight.value = profile.height; uniforms.uSize.value = profile.size
      uniforms.uSway.value = style.sway; uniforms.uSwayFreq.value = style.swayFreq; uniforms.uSpin.value = style.spin; uniforms.uFlicker.value = style.flicker; uniforms.uBlink.value = style.blink
      uniforms.uShape.value = profile.streak ? 1 : style.shape; uniforms.uAlpha.value = style.alpha; uniforms.uGlow.value = style.glow; uniforms.uAdditive.value = profile.additive ? 1 : 0
      uniforms.uColor.value.set(profile.color); uniforms.uAccent.value.set(style.accent)
      uniforms.uLight.value = (skyLight[env.sky ?? 'studio'] ?? 1) * THREE.MathUtils.clamp(env.lightIntensity ?? 1, 0.4, 1.5)
    },
    update(camera, seconds, wind = breeze) {
      const dt = last === null ? 0 : THREE.MathUtils.clamp(seconds - last, 0, 0.1)
      last = seconds
      camera.getWorldPosition(uniforms.uCamera.value)
      velocity.set(wind.x * profile.drift, wind.y * profile.drift - profile.fall, wind.z * profile.drift)
      uniforms.uVelocity.value.copy(velocity)
      advance(uniforms.uOffsetA.value, 1, dt); advance(uniforms.uOffsetB.value, 0.78, dt)
      uniforms.uTime.value = wrap(seconds, 2400)
      if (camera instanceof THREE.PerspectiveCamera) uniforms.uPixel.value = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) / (1000 * camera.zoom)
    },
    dispose() { mesh.removeFromParent(); geometry.dispose(); material.dispose() },
  }
}

/** Draws weather after the sky pass into the composer's read buffer, depth-tested against the scene and invisible to SSAO/outline prepasses. */
export function createWeatherPass(weather: WeatherSystem, scene: THREE.Scene, camera: THREE.Camera): Pass {
  const holder = new THREE.Scene()
  holder.add(weather.object)
  const pass = new Pass()
  pass.needsSwap = false
  pass.render = (renderer, _writeBuffer, readBuffer) => {
    if (!weather.object.visible) return
    holder.fog = scene.fog
    const autoClear = renderer.autoClear
    renderer.autoClear = false
    renderer.setRenderTarget(pass.renderToScreen ? null : readBuffer)
    renderer.render(holder, camera)
    renderer.autoClear = autoClear
  }
  return pass
}
