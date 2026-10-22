import * as THREE from 'three'
import type { SlotMaterial } from './sceneSkinMesh.ts'

/**
 * Skin, cloth, leather, metal and fur share one physical material whose fragment picks the nearest of eight per-vertex
 * slot distances (crisp garment borders independent of tessellation) and adds procedural micro detail in bind space.
 * No textures are sampled, so shadow and depth passes never mix sampler types.
 */
const VERTEX_PARS = /* glsl */`
attribute vec4 slotA;
attribute vec4 slotB;
attribute vec4 slotC;
varying vec4 vSlotA;
varying vec4 vSlotB;
varying vec4 vSlotC;
varying vec3 vRest;
varying vec3 vRestNormal;
varying vec2 vSkinUv;
`
const VERTEX_MAIN = /* glsl */`
vSlotA = slotA;
vSlotB = slotB;
vSlotC = slotC;
vSkinUv = uv;
vRest = position;
vRestNormal = normal;
`
const FRAGMENT_PARS = /* glsl */`
uniform vec4 slotColor[12];
uniform vec4 slotProps[12];
uniform vec4 slotGlow[12];
varying vec4 vSlotA;
varying vec4 vSlotB;
varying vec4 vSlotC;
varying vec2 vSkinUv;
varying vec3 vRest;
varying vec3 vRestNormal;
float slotHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float slotNoise(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(slotHash(i), slotHash(i + vec3(1, 0, 0)), f.x), mix(slotHash(i + vec3(0, 1, 0)), slotHash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(slotHash(i + vec3(0, 0, 1)), slotHash(i + vec3(1, 0, 1)), f.x), mix(slotHash(i + vec3(0, 1, 1)), slotHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float slotDistance(int i) { return i < 4 ? vSlotA[i] : i < 8 ? vSlotB[i - 4] : vSlotC[i - 8]; }
float slotHeight(int kind, vec3 p, vec3 n, float pixel, out float tint) {
  vec3 w = abs(n) + 1e-4; w /= w.x + w.y + w.z;
  tint = 0.0;
  if (kind == 0) { float pores = slotNoise(p * 700.0) * clamp(1.0 - pixel * 900.0, 0.0, 1.0); float soft = slotNoise(p * 90.0); tint = (soft - 0.5) * 0.08; return pores * 0.25 + soft * 0.5; }
  if (kind == 1) {
    float f = 520.0, fade = clamp(1.0 - pixel * f * 0.6, 0.0, 1.0);
    float weave = (sin(p.x * f) * sin(p.y * f)) * w.z + (sin(p.z * f) * sin(p.y * f)) * w.x + (sin(p.x * f) * sin(p.z * f)) * w.y;
    float folds = slotNoise(p * vec3(14.0, 5.0, 14.0)); tint = (folds - 0.5) * 0.18 + weave * 0.03 * fade;
    return weave * 0.35 * fade + folds * 1.2;
  }
  if (kind == 2) { float grain = slotNoise(p * 260.0) * clamp(1.0 - pixel * 300.0, 0.0, 1.0); float wear = slotNoise(p * 18.0); tint = (wear - 0.5) * 0.25; return grain * 0.5 + wear * 0.6; }
  if (kind == 3) { float brushed = slotNoise(p * vec3(40.0, 900.0, 40.0)) * clamp(1.0 - pixel * 500.0, 0.0, 1.0); float dents = slotNoise(p * 12.0); tint = (dents - 0.5) * 0.15; return brushed * 0.2 + dents * 0.4; }
  if (kind == 4 || kind == 8) {
    float f = kind == 8 ? 700.0 : 420.0, fade = clamp(1.0 - pixel * f * 0.5, 0.0, 1.0);
    float strands = slotNoise(vec3(p.x * f, p.y * f * 0.12, p.z * f)) * fade; float clumps = slotNoise(p * vec3(30.0, 8.0, 30.0));
    tint = (strands - 0.5) * 0.16 + (clumps - 0.5) * (kind == 8 ? 0.2 : 0.08); return strands * 0.8 + clumps * (kind == 8 ? 1.0 : 0.4);
  }
  if (kind == 5) {
    vec3 q = p * 26.0; vec3 cell = floor(q); vec3 f = fract(q) - 0.5;
    float d = length(f.xy) * w.z + length(f.zy) * w.x + length(f.xz) * w.y; float h = 1.0 - smoothstep(0.25, 0.5, d);
    tint = (slotHash(cell) - 0.5) * 0.2 - (1.0 - h) * 0.15; return h * clamp(1.0 - pixel * 60.0, 0.0, 1.0);
  }
  if (kind == 6) {
    float f = 650.0, fade = clamp(1.0 - pixel * f * 0.5, 0.0, 1.0);
    float rings = abs(sin(p.x * f) * sin(p.y * f * 1.3)) * w.z + abs(sin(p.z * f) * sin(p.y * f * 1.3)) * w.x + abs(sin(p.x * f) * sin(p.z * f)) * w.y;
    tint = -0.12 * (1.0 - rings) * fade; return rings * fade * 0.6;
  }
  return 0.0;
}
vec3 slotBump(vec3 surfPos, vec3 surfNorm, vec2 dHdxy, float faceDir) {
  vec3 sigmaX = normalize(dFdx(surfPos)), sigmaY = normalize(dFdy(surfPos));
  vec3 r1 = cross(sigmaY, surfNorm), r2 = cross(surfNorm, sigmaX);
  float det = dot(sigmaX, r1) * faceDir;
  vec3 grad = sign(det) * (dHdxy.x * r1 + dHdxy.y * r2);
  return normalize(abs(det) * surfNorm - grad);
}
`
const FRAGMENT_COLOR = /* glsl */`
#include <color_fragment>
int slotFirst = 0, slotSecond = 1;
float slotBest = 1e9, slotNext = 1e9;
for (int i = 0; i < 12; i++) {
  float d = slotDistance(i);
  if (d < slotBest) { slotNext = slotBest; slotSecond = slotFirst; slotBest = d; slotFirst = i; }
  else if (d < slotNext) { slotNext = d; slotSecond = i; }
}
int slotKindA = int(slotGlow[slotFirst].w), slotKindB = int(slotGlow[slotSecond].w);
float slotSoft = (slotKindA == 4 || slotKindA == 8) && (slotKindB == 4 || slotKindB == 8) ? 0.012 : 0.0;
float slotEdge = fwidth(slotNext - slotBest) * 0.75 + 1e-5 + slotSoft;
float slotMix = 0.5 + 0.5 * smoothstep(0.0, slotEdge, slotNext - slotBest);
float slotPixel = length(fwidth(vRest));
float slotTint = 0.0;
float slotBumpHeight = slotHeight(int(slotGlow[slotFirst].w), vRest, vRestNormal, slotPixel, slotTint);
float slotSeam = 1.0 - (slotSoft > 0.0 ? 0.0 : 0.18) * (1.0 - smoothstep(0.0, slotEdge * 2.5, slotNext - slotBest));
diffuseColor.rgb *= mix(slotColor[slotSecond].rgb, slotColor[slotFirst].rgb, slotMix) * (1.0 + slotTint) * slotSeam;
vec4 slotP = mix(slotProps[slotSecond], slotProps[slotFirst], slotMix);
`
const FRAGMENT_ROUGHNESS = /* glsl */`
#include <roughnessmap_fragment>
roughnessFactor = clamp(slotP.x * (1.0 - slotTint * 0.6), 0.04, 1.0);
`
const FRAGMENT_METALNESS = /* glsl */`
#include <metalnessmap_fragment>
metalnessFactor = slotP.y;
`
const FRAGMENT_NORMAL = /* glsl */`
#include <normal_fragment_maps>
normal = slotBump(-vViewPosition, normal, vec2(dFdx(slotBumpHeight), dFdy(slotBumpHeight)) * slotColor[slotFirst].w, faceDirection);
`
const FRAGMENT_EMISSIVE = /* glsl */`
#include <emissivemap_fragment>
totalEmissiveRadiance += mix(slotGlow[slotSecond].rgb, slotGlow[slotFirst].rgb, slotMix);
`
const FRAGMENT_LIGHTS = /* glsl */`
#include <lights_physical_fragment>
#ifdef USE_SHEEN
material.sheenColor = diffuseColor.rgb * slotP.z;
material.sheenRoughness = 0.55;
#endif
#ifdef USE_CLEARCOAT
material.clearcoat = slotP.w;
material.clearcoatRoughness = 0.25;
#endif
`
const BUMP: Record<number, number> = { 0: 0.004, 1: 0.012, 2: 0.008, 3: 0.004, 4: 0.016, 5: 0.02, 6: 0.02, 7: 0, 8: 0.014 }

/** Material shared by every skin of the same palette; `side` selects closed bodies (front) or open cloth/hair (double). */
export function slotMaterial(slots: SlotMaterial[], options: { side: THREE.Side; clearcoat?: number; name: string }): THREE.MeshPhysicalMaterial {
  const color = slots.map(() => new THREE.Vector4()), props = slots.map(() => new THREE.Vector4()), glow = slots.map(() => new THREE.Vector4())
  while (color.length < 12) { color.push(new THREE.Vector4(1, 0, 1, 0)); props.push(new THREE.Vector4(1, 0, 0, 0)); glow.push(new THREE.Vector4(0, 0, 0, 7)) }
  const linear = new THREE.Color()
  slots.forEach((slot, i) => {
    linear.set(slot.color)
    color[i].set(linear.r, linear.g, linear.b, BUMP[slot.pattern] ?? 0)
    props[i].set(slot.roughness, slot.metalness, slot.sheen, Math.max(slot.clearcoat, options.clearcoat ?? 0))
    linear.set(slot.emissive).multiplyScalar(slot.emissiveIntensity)
    glow[i].set(linear.r, linear.g, linear.b, slot.pattern)
  })
  const material = new THREE.MeshPhysicalMaterial({ color: '#ffffff', vertexColors: true, roughness: 0.6, metalness: 0, sheen: 1, sheenColor: '#ffffff', clearcoat: options.clearcoat ?? 0.2, side: options.side, name: options.name })
  const uniforms = { slotColor: { value: color }, slotProps: { value: props }, slotGlow: { value: glow } }
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\n${VERTEX_PARS}`).replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERTEX_MAIN}`)
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\n${FRAGMENT_PARS}`)
      .replace('#include <color_fragment>', FRAGMENT_COLOR).replace('#include <roughnessmap_fragment>', FRAGMENT_ROUGHNESS).replace('#include <metalnessmap_fragment>', FRAGMENT_METALNESS)
      .replace('#include <normal_fragment_maps>', FRAGMENT_NORMAL).replace('#include <emissivemap_fragment>', FRAGMENT_EMISSIVE).replace('#include <lights_physical_fragment>', FRAGMENT_LIGHTS)
  }
  material.customProgramCacheKey = () => 'forma-skin-slots-1'
  material.userData.skinSlots = uniforms
  return material
}
