import * as THREE from 'three'
import type { TextureKind } from './sceneDocument.ts'
import { hashNoise } from './sceneGeometrySpec.ts'

const SIZE = 512
interface Sample { rgb: [number, number, number]; height: number; rough: number; alpha?:number }
interface TextureData { color: Uint8Array; normal: Uint8Array; rough: Uint8Array }
/** Internal terrain layers stay out of the portable scene material schema. */
export type SurfaceTextureKind = TextureKind | 'groundGrass' | 'groundRock' | 'groundSand' | 'groundSnow'
const cache = new Map<SurfaceTextureKind, TextureData>()

function noise(x: number, y: number, px: number, py: number, seed: number) {
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy)
  const at = (i: number, j: number) => hashNoise(((i % px) + px) % px, ((j % py) + py) % py, seed)
  const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1)
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy
}
/** Tileable fractal noise: integer frequencies wrap exactly at the texture border. */
function fbm(u: number, v: number, fx: number, fy: number, seed: number, octaves = 4) {
  let sum = 0, amplitude = 1, total = 0
  for (let o = 0; o < octaves; o++) {
    const m = 2 ** o
    sum += noise(u * fx * m, v * fy * m, fx * m, fy * m, seed + o * 31) * amplitude
    total += amplitude; amplitude *= 0.5
  }
  return sum / total
}
const mix = (a: [number, number, number], b: [number, number, number], t: number): [number, number, number] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
const shade = (c: [number, number, number], f: number): [number, number, number] => [c[0] * f, c[1] * f, c[2] * f]
const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
function seam(position: number, count: number, width: number) { const f = position * count % 1; return Math.min(f, 1 - f) < width }

function sample(kind: SurfaceTextureKind, u: number, v: number): Sample {
  switch (kind) {
    case 'groundGrass': {
      const patch=fbm(u,v,7,7,181,3), grain=noise(u*210,v*210,210,210,182)
      // Crossing fibres at centimetre scale, with larger worn patches underneath.
      const a=noise(u*130+Math.sin(v*Math.PI*8)*1.2,v*24,130,24,183)
      const b=noise(u*30,v*145+Math.sin(u*Math.PI*6),30,145,184)
      const fibre=Math.max(a,b), h=patch*0.16+fibre*0.58+grain*0.26
      return {rgb:shade([225,225,225],0.67+fibre*0.24+grain*0.12+patch*0.08),height:h,rough:0.83+grain*0.17}
    }
    case 'groundRock': {
      const mass=fbm(u,v,5,5,191,4),grain=noise(u*190,v*190,190,190,192)
      const fissure=clamp01((Math.abs(fbm(u,v,12,12,193,3)-0.5)-0.014)*25)
      return {rgb:shade([225,225,225],(0.72+mass*0.22+grain*0.12)*(0.7+fissure*0.3)),height:mass*0.38+grain*0.15+fissure*0.3,rough:0.78+grain*0.2}
    }
    case 'groundSand': {
      const wave=0.5+0.5*Math.sin((v*14+fbm(u,v,3,3,201,3))*Math.PI*2),grain=noise(u*240,v*240,240,240,202)
      return {rgb:shade([225,225,225],0.82+wave*0.08+grain*0.12),height:wave*0.23+grain*0.2,rough:0.94+grain*0.06}
    }
    case 'groundSnow': {
      const grain=noise(u*230,v*230,230,230,212),drift=fbm(u,v,5,7,211,3)
      return {rgb:shade([245,245,245],0.86+drift*0.08+grain*0.06),height:drift*0.18+grain*0.07,rough:0.83+grain*0.15}
    }
    case 'foliage': case 'needles': {
      const count=kind==='needles'?13:5,x=u-0.5,y=v-0.5
      let mask=Math.abs(x)<0.008 && Math.abs(y)<0.45?1:0,vein=0
      for(let i=0;i<count;i++) for(const side of [-1,1]) {
        const at=-0.37+i*0.74/(count-1),length=kind==='needles'?0.23:0.21,spread=(1-Math.abs(at)*0.8)*0.19
        const dx=x-side*spread,dy=y-at,angle=side*0.65,c=Math.cos(angle),s=Math.sin(angle)
        const a=dx*c+dy*s,b=-dx*s+dy*c,width=kind==='needles'?0.018:0.085
        const radius=(a/width)**2+(b/length)**2
        mask=Math.max(mask,clamp01((1-radius)*12));vein=Math.max(vein,Math.exp(-Math.abs(a)*140)*clamp01(1-Math.abs(b)/length))
      }
      const grain=noise(u*80,v*80,80,80,173)
      return {rgb:shade(kind==='needles'?[121,157,111]:[154,179,111],0.83+grain*0.14+vein*0.08),height:vein*0.03+grain*0.015,rough:0.88,alpha:mask}
    }
    case 'metal': { const streak = fbm(u, v, 3, 160, 5, 3), n = fbm(u, v, 8, 8, 9, 3); return { rgb: shade([205, 208, 214], 0.82 + streak * 0.18 + n * 0.05), height: streak * 0.4, rough: 0.7 + streak * 0.3 } }
    case 'concrete': { const n = fbm(u, v, 6, 6, 11, 5), pit = noise(u * 96, v * 96, 96, 96, 12) > 0.86 ? 0.65 : 1; return { rgb: shade([178, 174, 166], (0.78 + n * 0.3) * pit), height: n * 0.7 * pit, rough: 0.85 + n * 0.15 } }
    case 'wood': {
      // Longitudinal fibres with restrained contrast, rather than large marble-like swirls.
      const plank = Math.floor(u*5), warp=fbm(u,v,5,2,20,3), fibre=fbm(u,v,180,3,21,3)
      const grain=0.5+0.5*Math.sin((u*85+warp*0.45)*Math.PI*2), variation=hashNoise(plank,3,4)
      const base=shade([188,160,125],0.82+variation*0.1+fibre*0.07+grain*0.05)
      return seam(u,5,0.004)?{rgb:[105,86,65],height:0.43,rough:0.9}:{rgb:base,height:0.5+grain*0.035+fibre*0.025,rough:0.76+fibre*0.12}
    }
    case 'solar': { const line = seam(u, 8, 0.012) || seam(v, 4, 0.02), n = noise(u * 64, v * 64, 64, 64, 30); return line ? { rgb: [190, 200, 212], height: 1, rough: 0.4 } : { rgb: [22 + n * 10, 44 + n * 14, 96 + n * 24], height: 0.6, rough: 0.35 } }
    case 'tiles': {
      const tile = hashNoise(Math.floor(u * 4), Math.floor(v * 4), 41), n = fbm(u, v, 16, 16, 42, 3)
      return seam(u, 4, 0.012) || seam(v, 4, 0.012) ? { rgb: [128, 126, 120], height: 0, rough: 1 } : { rgb: shade([222, 222, 218], 0.9 + tile * 0.1 + n * 0.04), height: 0.8, rough: 0.55 + n * 0.1 }
    }
    case 'brick': {
      const row = Math.floor(v * 8), offset = row % 2 ? 0.125 : 0, brick = hashNoise(Math.floor((u + offset) * 4) % 4, row, 51), n = fbm(u, v, 16, 16, 52, 4)
      if (seam(v, 8, 0.05) || seam(u + offset, 4, 0.025)) return { rgb: shade([176, 168, 152], 0.9 + n * 0.15), height: 0.1, rough: 1 }
      return { rgb: shade(mix([132, 52, 34], [176, 86, 56], brick), 0.82 + n * 0.3), height: 0.7 + n * 0.3, rough: 0.8 + n * 0.2 }
    }
    case 'marble': { const t = fbm(u, v, 3, 3, 61, 6), vein = Math.pow(Math.abs(Math.sin((u + v + t * 2.2) * Math.PI * 3)), 0.25); return { rgb: mix([128, 132, 140], [238, 236, 232], vein), height: vein * 0.2, rough: 0.6 + (1 - vein) * 0.4 } }
    case 'fabric': { const warp = 0.5 + 0.5 * Math.sin(u * Math.PI * 2 * 96), weft = 0.5 + 0.5 * Math.sin(v * Math.PI * 2 * 96), n = fbm(u, v, 12, 12, 71, 3); const weave = (Math.floor(u * 96) + Math.floor(v * 96)) % 2 ? warp : weft; return { rgb: shade([196, 192, 186], 0.78 + weave * 0.18 + n * 0.08), height: weave, rough: 0.92 } }
    case 'grass': { const n = fbm(u, v, 8, 8, 81, 5), blade = noise(u * 160, v * 40, 160, 40, 82); return { rgb: mix([58, 92, 38], [118, 156, 66], n * 0.6 + blade * 0.4), height: blade * 0.6 + n * 0.4, rough: 0.85 + blade * 0.15 } }
    case 'rock': {
      const n = fbm(u, v, 4, 4, 91, 6), grain = noise(u * 96, v * 96, 96, 96, 93)
      const vein = Math.abs(fbm(u, v, 6, 6, 92, 3) - 0.5), crack = 0.88 + clamp01((vein - 0.01) / 0.04) * 0.12
      return { rgb: shade(mix([112, 108, 99], [170, 163, 147], n), crack), height: n * 0.65 + grain * 0.12 + crack * 0.15, rough: 0.85 + grain * 0.15 }
    }
    case 'sand': { const ripple = 0.5 + 0.5 * Math.sin((v * 10 + fbm(u, v, 3, 3, 101, 3) * 3) * Math.PI * 2), grain = noise(u * 256, v * 256, 256, 256, 102); return { rgb: shade([214, 190, 146], 0.88 + ripple * 0.08 + grain * 0.08), height: ripple * 0.5 + grain * 0.2, rough: 0.95 } }
    case 'asphalt': { const n = fbm(u, v, 8, 8, 111, 4), speck = noise(u * 200, v * 200, 200, 200, 112); return { rgb: shade([64, 64, 66], 0.8 + n * 0.25 + (speck > 0.8 ? 0.5 : 0)), height: n * 0.5 + speck * 0.3, rough: 0.85 + n * 0.15 } }
    case 'carbon': { const cu = Math.floor(u * 48), cv = Math.floor(v * 48), diagonal = ((cu + cv) >> 1) % 2, local = diagonal ? u * 48 % 1 : v * 48 % 1, lobe = Math.sin(local * Math.PI); return { rgb: shade([38, 40, 44], 0.6 + lobe * 0.6), height: lobe, rough: 0.5 + (1 - lobe) * 0.4 } }
    case 'rust': { const patch = fbm(u, v, 5, 5, 121, 5), spot = clamp01((patch - 0.42) * 5), n = fbm(u, v, 32, 32, 122, 3); return { rgb: mix([150, 152, 156], shade([138, 66, 30], 0.8 + n * 0.4), spot), height: spot * 0.6 + n * 0.2, rough: 0.55 + spot * 0.45 } }
    case 'plaster': { const n = fbm(u, v, 6, 6, 131, 5); return { rgb: shade([232, 226, 214], 0.92 + n * 0.1), height: n, rough: 0.9 } }
    case 'water': { const w = fbm(u, v, 4, 4, 141, 5), r = 0.5 + 0.5 * Math.sin((u * 6 + w * 2) * Math.PI * 2); return { rgb: mix([24, 92, 118], [60, 150, 170], w * 0.7 + r * 0.3), height: w * 0.7 + r * 0.3, rough: 0.6 } }
    case 'leaves': { const clump = fbm(u, v, 10, 10, 151, 4), leaf = noise(u * 64, v * 64, 64, 64, 152); return { rgb: mix([34, 70, 30], [92, 140, 58], clump * 0.6 + leaf * 0.4), height: leaf * 0.7 + clump * 0.3, rough: 0.8 } }
    default: return { rgb: [220, 220, 220], height: 0.5, rough: 1 }
  }
}

function generate(kind: SurfaceTextureKind): TextureData {
  const color = new Uint8Array(SIZE * SIZE * 4), normal = new Uint8Array(SIZE * SIZE * 4), rough = new Uint8Array(SIZE * SIZE * 4), heights = new Float32Array(SIZE * SIZE)
  const byte = (value: number) => Math.round(clamp01(value) * 255)
  for (let y = 0, index = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++, index++) {
    const s = sample(kind, x / SIZE, y / SIZE), o = index * 4
    heights[index] = s.height
    color[o] = byte(s.rgb[0] / 255); color[o + 1] = byte(s.rgb[1] / 255); color[o + 2] = byte(s.rgb[2] / 255); color[o + 3] = Math.round((s.alpha ?? 1) * 255)
    rough[o] = 255; rough[o + 1] = byte(s.rough); rough[o + 2] = 255; rough[o + 3] = 255
  }
  const h = (i: number, j: number) => heights[((j + SIZE) % SIZE) * SIZE + (i + SIZE) % SIZE]
  for (let y = 0, o = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++, o += 4) {
    const dx = (h(x + 1, y) - h(x - 1, y)) * 4, dy = (h(x, y + 1) - h(x, y - 1)) * 4, length = Math.hypot(dx, dy, 1)
    normal[o] = Math.round((-dx / length * 0.5 + 0.5) * 255); normal[o + 1] = Math.round((-dy / length * 0.5 + 0.5) * 255); normal[o + 2] = Math.round((1 / length * 0.5 + 0.5) * 255); normal[o + 3] = 255
  }
  return { color, normal, rough }
}

/** Deterministic, seamless UV textures generated locally without CDN/image dependencies. */
const sources = new Map<string, THREE.DataTexture>()
/** Deterministic, seamless UV textures generated locally without CDN/image dependencies. Every scale clones one texture, so the GPU holds a single upload per kind and channel. */
export function proceduralTexture(kind: SurfaceTextureKind, channel: 'map' | 'normal' | 'rough', scale = 1): THREE.DataTexture {
  const key = `${kind}:${channel}`
  if (!sources.has(key)) {
    if (!cache.has(kind)) cache.set(kind, generate(kind))
    const data = cache.get(kind)!
    const base = new THREE.DataTexture(channel === 'map' ? data.color : channel === 'normal' ? data.normal : data.rough, SIZE, SIZE, THREE.RGBAFormat)
    base.colorSpace = channel === 'map' ? THREE.SRGBColorSpace : THREE.NoColorSpace
    base.wrapS = base.wrapT = THREE.RepeatWrapping
    base.generateMipmaps = true
    base.minFilter = THREE.LinearMipmapLinearFilter
    base.magFilter = THREE.LinearFilter
    base.needsUpdate = true
    sources.set(key, base)
  }
  const result = sources.get(key)!.clone()
  result.repeat.set(scale, scale)
  return result
}
