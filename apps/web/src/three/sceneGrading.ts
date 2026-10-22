import * as THREE from 'three'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import type { gradePresets } from './sceneDocument.ts'

export type GradePreset = typeof gradePresets[number]
type RGB = [number, number, number]
export interface GradeSettings { exposure: number; contrast: number; saturation: number; warmth: number; tint: number; vignette: number; lift: RGB; gain: RGB; grain: number }

const neutral: GradeSettings = { exposure: 1, contrast: 1, saturation: 1, warmth: 0, tint: 0, vignette: 0, lift: [0, 0, 0], gain: [1, 1, 1], grain: 0 }
const presets: Record<GradePreset, GradeSettings> = {
  none: neutral,
  warm: { exposure: 1.03, contrast: 1.06, saturation: 1.08, warmth: 0.55, tint: 0.05, vignette: 0.18, lift: [0.02, 0.012, 0], gain: [1.04, 1, 0.92], grain: 0 },
  cool: { exposure: 0.98, contrast: 1.08, saturation: 0.88, warmth: -0.5, tint: -0.05, vignette: 0.25, lift: [0, 0.015, 0.035], gain: [0.94, 1, 1.06], grain: 0.01 },
  cinematic: { exposure: 1, contrast: 1.15, saturation: 1.05, warmth: 0.08, tint: 0, vignette: 0.32, lift: [-0.012, 0.012, 0.03], gain: [1.06, 1, 0.9], grain: 0.015 },
  vivid: { exposure: 1.02, contrast: 1.1, saturation: 1.35, warmth: 0.05, tint: 0, vignette: 0.1, lift: [0, 0, 0], gain: [1, 1, 1], grain: 0 },
  noir: { exposure: 1.02, contrast: 1.4, saturation: 0.06, warmth: 0.03, tint: 0, vignette: 0.5, lift: [0, 0, 0], gain: [1, 1, 1], grain: 0.045 },
  dreamy: { exposure: 1.06, contrast: 0.84, saturation: 0.85, warmth: 0.12, tint: 0.12, vignette: 0.12, lift: [0.07, 0.05, 0.08], gain: [1.02, 0.98, 1.03], grain: 0 },
  retro: { exposure: 1, contrast: 0.9, saturation: 0.72, warmth: 0.25, tint: 0.04, vignette: 0.3, lift: [0.07, 0.055, 0.035], gain: [0.98, 0.94, 0.84], grain: 0.06 },
}

/** Display-referred grade parameters; 'none' is the identity. */
export function gradeSettings(preset: GradePreset): GradeSettings {
  const s = presets[preset] ?? neutral
  return { ...s, lift: [...s.lift], gain: [...s.gain] }
}

const GradingShader = {
  name: 'GradingShader',
  uniforms: {
    tDiffuse: { value: null }, exposure: { value: 1 }, contrast: { value: 1 }, saturation: { value: 1 }, warmth: { value: 0 }, tint: { value: 0 }, vignette: { value: 0 }, grain: { value: 0 }, time: { value: 0 },
    lift: { value: new THREE.Vector3() }, gain: { value: new THREE.Vector3(1, 1, 1) }, resolution: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
uniform sampler2D tDiffuse;
uniform float exposure, contrast, saturation, warmth, tint, vignette, grain, time;
uniform vec3 lift, gain;
uniform vec2 resolution;
varying vec2 vUv;
float hash(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
void main() {
  vec4 texel = texture2D(tDiffuse, vUv);
  vec3 c = texel.rgb * exposure;
  c *= vec3(1.0 + warmth * 0.1 + tint * 0.03, 1.0 - tint * 0.06, 1.0 - warmth * 0.1 + tint * 0.03);
  c = clamp(c * gain + lift * (1.0 - c), 0.0, 1.0);
  vec3 lo = 0.5 * pow(c * 2.0, vec3(contrast)), hi = 1.0 - 0.5 * pow((1.0 - c) * 2.0, vec3(contrast));
  c = mix(lo, hi, step(0.5, c));
  float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = clamp(mix(vec3(luma), c, saturation), 0.0, 1.0);
  float aspect = resolution.x / max(resolution.y, 1.0);
  vec2 q = (vUv - 0.5) * vec2(aspect, 1.0) / length(vec2(aspect, 1.0) * 0.5);
  c *= 1.0 - vignette * pow(smoothstep(0.3, 1.1, length(q)), 1.5);
  float n = hash(gl_FragCoord.xy + fract(time * 7.13) * vec2(193.0, 71.0)) + hash(gl_FragCoord.xy * 0.5 + fract(time * 3.7) * 97.0) - 1.0;
  c += n * grain * (0.25 + 3.0 * luma * (1.0 - luma));
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), texel.a);
}`,
}

/**
 * Colour grade, vignette and film grain in display (sRGB, tone-mapped) space.
 * Insert immediately after OutputPass; the composer then routes OutputPass to a buffer and this pass to the screen.
 */
export function createGradingPass() {
  const pass = new ShaderPass(GradingShader)
  const u = pass.uniforms as typeof GradingShader.uniforms
  pass.setSize = (width: number, height: number) => { u.resolution.value.set(width, height) }
  const apply = (preset: GradePreset) => {
    const s = gradeSettings(preset)
    pass.enabled = preset !== 'none'
    u.exposure.value = s.exposure; u.contrast.value = s.contrast; u.saturation.value = s.saturation; u.warmth.value = s.warmth; u.tint.value = s.tint
    u.vignette.value = s.vignette; u.grain.value = s.grain; u.lift.value.fromArray(s.lift); u.gain.value.fromArray(s.gain)
  }
  apply('none')
  return { pass: pass as ShaderPass, apply, setTime(seconds: number) { u.time.value = seconds % 1000 }, dispose() { pass.dispose() } }
}
