import type { PrefabPart, PrefabSpec } from './scenePrefabs.ts'
import type { NodeKind, SceneBehavior, SceneMaterial, Vector3Tuple, avatarKinds } from './sceneDocument.ts'
import { hashNoise, type Point2 } from './sceneGeometrySpec.ts'

export const characterTypes = ['villager', 'knight', 'wizard', 'astronaut', 'goblin', 'skeleton', 'orc', 'wolf', 'deer', 'spider', 'drone', 'golem', 'dragon'] as const
export type CharacterType = typeof characterTypes[number]
export const characterLabels: Record<CharacterType, string> = { villager: 'Aldeão (NPC)', knight: 'Cavaleiro (NPC)', wizard: 'Mago (NPC)', astronaut: 'Astronauta (NPC)',
  goblin: 'Goblin', skeleton: 'Esqueleto guerreiro', orc: 'Orc brutamontes', wolf: 'Lobo', deer: 'Cervo', spider: 'Aranha gigante', drone: 'Drone de combate', golem: 'Golem de pedra', dragon: 'Dragão (chefe)' }
export type RigKind = 'biped' | 'quadruped' | 'arachnid' | 'flyer' | 'hover'
export const characterRig: Record<CharacterType, RigKind> = { villager: 'biped', knight: 'biped', wizard: 'biped', astronaut: 'biped', goblin: 'biped', skeleton: 'biped', orc: 'biped',
  wolf: 'quadruped', deer: 'quadruped', spider: 'arachnid', drone: 'hover', golem: 'biped', dragon: 'flyer' }
export const isCharacterType = (type: string): type is CharacterType => (characterTypes as readonly string[]).includes(type)

type AvatarKind = typeof avatarKinds[number]
type Mat = Partial<SceneMaterial>
type V = Vector3Tuple
type Extra = Partial<Omit<PrefabPart, 'id' | 'parentId' | 'name' | 'kind' | 'position' | 'dimensions' | 'material'>>

const behaviors: Record<CharacterType, SceneBehavior> = {
  villager: { type: 'npc', speed: 1, range: 6, damage: 0 }, knight: { type: 'npc', speed: 1.1, range: 6, damage: 0 }, wizard: { type: 'npc', speed: 0.8, range: 6, damage: 0 },
  astronaut: { type: 'npc', speed: 1, range: 6, damage: 0 }, deer: { type: 'npc', speed: 1.4, range: 8, damage: 0 },
  goblin: { type: 'enemy', speed: 3, range: 11, damage: 15, health: 2, attack: 'melee' }, skeleton: { type: 'enemy', speed: 2.4, range: 12, damage: 20, health: 3, attack: 'melee' },
  orc: { type: 'enemy', speed: 2.2, range: 12, damage: 30, health: 5, attack: 'melee' }, wolf: { type: 'enemy', speed: 4.5, range: 16, damage: 18, health: 2, attack: 'charge' },
  spider: { type: 'enemy', speed: 3.4, range: 10, damage: 16, health: 2, attack: 'melee' }, drone: { type: 'enemy', speed: 3, range: 18, damage: 12, health: 2, attack: 'ranged', flying: true },
  golem: { type: 'enemy', speed: 1.6, range: 12, damage: 40, health: 10, attack: 'melee' }, dragon: { type: 'enemy', speed: 3.2, range: 30, damage: 35, health: 25, attack: 'ranged', flying: true },
}
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
export function characterBehavior(type: CharacterType, size: number): SceneBehavior | null {
  const base = behaviors[type]
  return base ? { ...base, speed: clamp(base.speed, 0, 12), range: clamp(Math.round(base.range * size * 100) / 100, 0.5, 80) } : null
}

const round = (v: number) => Math.round(v * 10000) / 10000
const deg = (r: number) => round(r * 180 / Math.PI)
function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16)
  return '#' + [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.round(clamp(f < 1 ? v * f : v + (255 - v) * (f - 1), 0, 255)).toString(16).padStart(2, '0')).join('')
}
const plain = (color: string, roughness = 0.6, metalness = 0): Mat => ({ color, roughness, metalness })
const skinMat = (color: string): Mat => ({ color, roughness: 0.58, metalness: 0, sheen: 0.3, clearcoat: 0.06 })
const cloth = (color: string, scale = 2.5): Mat => ({ color, texture: 'fabric', textureScale: scale, sheen: 0.6, roughness: 0.9, metalness: 0 })
const leather = (color: string): Mat => ({ color, texture: 'fabric', textureScale: 5, normalStrength: 0.5, roughness: 0.6, metalness: 0, sheen: 0.15, clearcoat: 0.2 })
const metal = (color: string, roughness = 0.3): Mat => ({ color, texture: 'metal', textureScale: 1.2, metalness: 0.9, roughness, clearcoat: 0.25 })
const rusty = (color: string): Mat => ({ color, texture: 'rust', textureScale: 1.6, metalness: 0.55, roughness: 0.78 })
const woodMat = (color: string): Mat => ({ color, texture: 'wood', textureScale: 0.8, roughness: 0.78, metalness: 0 })
const boneMat = (color: string): Mat => ({ color, texture: 'marble', textureScale: 2.5, normalStrength: 0.5, roughness: 0.72, metalness: 0, clearcoat: 0.1 })
const rockMat = (color: string): Mat => ({ color, texture: 'rock', textureScale: 1.3, normalStrength: 1.4, roughness: 0.95, metalness: 0, flatShading: true })
const fur = (color: string): Mat => ({ color, texture: 'fabric', textureScale: 6, normalStrength: 1.2, sheen: 0.8, roughness: 0.95, metalness: 0 })
const scaly = (color: string): Mat => ({ color, texture: 'tiles', textureScale: 7, normalStrength: 0.9, roughness: 0.45, metalness: 0.15, clearcoat: 0.5 })
const hairMat = (color: string): Mat => ({ color, texture: 'fabric', textureScale: 7, normalStrength: 1.3, sheen: 0.7, roughness: 0.75, metalness: 0 })
const glow = (color: string, intensity = 2.5): Mat => ({ color: shade(color, 1.45), emissive: color, emissiveIntensity: intensity, roughness: 0.3, metalness: 0 })
const eyeWhite: Mat = { color: '#f4f1ea', roughness: 0.2, metalness: 0, clearcoat: 1 }
const darkMat = plain('#16110f', 0.7)

const SKINS = ['#f2c7a5', '#e3b08c', '#c98d66', '#9a6440', '#6e4630', '#f7d9c4'] as const
const HAIRS = ['#2d2018', '#5a3a22', '#8a5a2b', '#c9a050', '#a8442a', '#1c1a1d', '#9a9590'] as const
const CLOTHS = ['#7d8f56', '#a3603b', '#4f6d94', '#b88f45', '#8b5a7b', '#5f7f78', '#a84a3e'] as const
const PANTS = ['#5b4a3a', '#46525e', '#6b5b45', '#3e4a3a'] as const
const IRIS = ['#5a3b1e', '#3d6e9a', '#4c7a3a', '#2b2b2b', '#7a5a2a'] as const

const TORSO: Point2[] = [[0, 0], [0.7, 0], [0.76, 0.1], [0.84, 0.38], [0.98, 0.66], [1, 0.8], [0.9, 0.92], [0.6, 0.985], [0, 1]]
const PELVIS: Point2[] = [[0, 0], [0.55, 0.02], [0.85, 0.2], [1, 0.55], [0.94, 1], [0, 1]]
const SKIRT: Point2[] = [[1, 0], [0.97, 0.08], [0.84, 0.5], [0.7, 0.85], [0.62, 1]]
const DOME: Point2[] = [[0.98, 0], [1, 0.25], [0.85, 0.65], [0.5, 0.92], [0, 1]]
const RING: Point2[] = [[0.84, 0], [1, 0], [1, 1], [0.84, 1]]
const BONE: Point2[] = [[0, 0], [0.85, 0.02], [1, 0.08], [0.5, 0.2], [0.42, 0.5], [0.5, 0.8], [1, 0.92], [0.85, 0.98], [0, 1]]
const SNOUT: Point2[] = [[0, 0], [0.75, 0.04], [0.95, 0.3], [1, 0.6], [0.8, 0.88], [0.45, 0.99], [0, 1]]
const taper = (bottom: number, top: number): Point2[] => [[0, 0], [bottom * 0.6, 0.015], [bottom, 0.08], [(bottom + top) / 2 + 0.06, 0.5], [top, 0.88], [top * 0.62, 0.975], [0, 1]]
const SEGMENTS: Partial<Record<NodeKind, number>> = { sphere: 14, capsule: 10, cylinder: 12, cone: 12, lathe: 14, torus: 8, tube: 8 }
const sides = [[1, 'L', 'esquerdo', 'esquerda'], [-1, 'R', 'direito', 'direita']] as const

interface Kit {
  parts: PrefabPart[]; rnd: (k: number) => number; pick: <T>(list: readonly T[], k: number) => T
  mesh: (id: string, parentId: string | null, name: string, kind: NodeKind, position: V, dimensions: V, material: Mat, extra?: Extra) => string
  joint: (id: string, parentId: string | null, name: string, position: V, rotation?: V, extra?: Extra) => string
  /** Rounded segment between two points of the parent frame; the lathe axis follows the segment. */
  bone: (id: string, parentId: string | null, name: string, from: V, to: V, width: number, material: Mat, extra?: Extra & { depth?: number; profile?: Point2[]; extend?: number }) => string
}
function kit(seed: number): Kit {
  const parts: PrefabPart[] = []
  const rnd = (k: number) => hashNoise(seed, k, 4231)
  const pick = <T>(list: readonly T[], k: number): T => list[Math.floor(rnd(k) * list.length) % list.length]
  const mesh: Kit['mesh'] = (id, parentId, name, kind, position, dimensions, material, extra = {}) => {
    const segments = SEGMENTS[kind]
    parts.push({ id, parentId, name, kind, position: position.map(round) as V, dimensions: dimensions.map((v) => round(Math.max(0.01, v))) as V, material, ...extra,
      ...(extra.rotation ? { rotation: extra.rotation.map(round) as V } : {}),
      ...(segments || extra.geometry ? { geometry: { ...(segments ? { segments } : {}), ...extra.geometry } } : {}) })
    return id
  }
  const joint: Kit['joint'] = (id, parentId, name, position, rotation, extra = {}) => {
    parts.push({ id, parentId, name, kind: 'group', position: position.map(round) as V, dimensions: [1, 1, 1], ...(rotation ? { rotation: rotation.map(round) as V } : {}), ...extra })
    return id
  }
  const bone: Kit['bone'] = (id, parentId, name, from, to, width, material, extra = {}) => {
    const { depth, profile, extend = 0, ...rest } = extra
    const d = to.map((v, i) => v - from[i]), length = Math.hypot(...d), [dx, dy, dz] = d.map((v) => v / length)
    return mesh(id, parentId, name, 'lathe', from.map((v, i) => (v + to[i]) / 2) as V, [width, length + extend, depth ?? width], material,
      { ...rest, rotation: [deg(Math.atan2(dz, dy)), 0, deg(Math.atan2(-dx, Math.hypot(dy, dz)))], geometry: { profile: profile ?? taper(0.75, 1), ...rest.geometry } })
  }
  return { parts, rnd, pick, mesh, joint, bone }
}
function scaled(parts: PrefabPart[], f: number): PrefabPart[] {
  return parts.map((part) => ({ ...part, position: part.position.map((v) => round(v * f)) as V, dimensions: part.dimensions.map((v) => round(Math.max(0.01, v * f))) as V, ...(part.light ? { light: { ...part.light, distance: part.light.distance * f } } : {}) }))
}
const pointLight = (color: string, intensity: number, distance: number) => ({ type: 'point' as const, color, intensity, distance, angle: 35, penumbra: 0.4, castShadow: false })

interface Frame { L: number; A: number; b: number; lb: number; bd: number; hipsY: number; hs: number; hc: V; hunch: number }
/** Biped skeleton: joints at anatomical pivots, origin at the feet, facing +Z, left = +X. */
function bipedFrame(k: Kit, o: { L?: number; A?: number; bulk?: number; head?: number; hunch?: number } = {}): Frame {
  const L = o.L ?? 1, A = o.A ?? 1, b = o.bulk ?? 1, hs = o.head ?? 1, hunch = o.hunch ?? 0, hipsY = 0.15 + 0.8 * L
  k.joint('j_hips', null, 'Quadril (articulação)', [0, hipsY, 0])
  k.joint('j_spine', 'j_hips', 'Coluna (articulação)', [0, 0.08, 0], hunch ? [hunch, 0, 0] : undefined)
  k.joint('j_neck', 'j_spine', 'Pescoço (articulação)', [0, 0.44, 0], hunch ? [-hunch * 0.6, 0, 0] : undefined)
  k.joint('j_head', 'j_neck', 'Cabeça (articulação)', [0, 0.085, 0], hunch ? [-hunch * 0.4, 0, 0] : undefined)
  for (const [side, s, , label] of sides) {
    k.joint(`j_shoulder${s}`, 'j_spine', `Ombro ${side > 0 ? 'esquerdo' : 'direito'} (articulação)`, [side * 0.205 * b, 0.385, 0], [-hunch * 0.8, 0, side * 7])
    k.joint(`j_elbow${s}`, `j_shoulder${s}`, `Cotovelo ${side > 0 ? 'esquerdo' : 'direito'} (articulação)`, [0, -0.295 * A, 0], [-8, 0, 0])
    k.joint(`j_hip${s}`, 'j_hips', `Coxa ${label} (articulação)`, [side * 0.095 * b, -0.06, 0])
    k.joint(`j_knee${s}`, `j_hip${s}`, `Joelho ${label} (articulação)`, [0, -0.4 * L, 0])
  }
  return { L, A, b, lb: b ** 0.75, bd: 0.6 + 0.4 * b, hipsY, hs, hc: [0, 0.105 * hs, 0.012 * hs], hunch }
}
interface BodyMats { torso: Mat; pelvis: Mat; thigh: Mat; shin: Mat; foot: Mat; upper: Mat; fore: Mat; hand: Mat; neck: Mat; head: Mat; deltoid?: Mat; sole?: Mat }
function body(k: Kit, f: Frame, m: BodyMats, o: { hand?: number; noHead?: boolean } = {}) {
  const { L, A, b, lb, bd, hs, hc } = f
  k.mesh('pelvis', 'j_hips', 'Pelve', 'lathe', [0, -0.01, 0], [0.31 * b, 0.2, 0.21 * bd], m.pelvis, { geometry: { profile: PELVIS, segments: 16 } })
  k.mesh('torso', 'j_spine', 'Tronco', 'lathe', [0, 0.21, 0], [0.36 * b, 0.46, 0.23 * bd], m.torso, { geometry: { profile: TORSO, segments: 18 }, overlapWith: ['pelvis'] })
  k.mesh('neck', 'j_neck', 'Pescoço', 'cylinder', [0, 0.04, 0], [0.095 * lb, 0.13, 0.095 * lb], m.neck, { overlapWith: ['torso'] })
  if (!o.noHead) k.mesh('head', 'j_head', 'Cabeça', 'sphere', hc, [0.21 * hs, 0.25 * hs, 0.235 * hs], m.head, { geometry: { segments: 18 }, overlapWith: ['neck'] })
  const footLength = 0.25 * Math.min(lb, 1.3), h = lb ** 0.8 * (o.hand ?? 1)
  for (const [side, s, label, femLabel] of sides) {
    k.mesh(`thigh${s}`, `j_hip${s}`, `Coxa ${femLabel}`, 'lathe', [0, -0.19 * L, 0.005], [0.155 * lb, 0.44 * L, 0.165 * lb], m.thigh, { geometry: { profile: taper(0.72, 1) }, overlapWith: ['pelvis'] })
    k.mesh(`shin${s}`, `j_knee${s}`, `Canela ${femLabel}`, 'lathe', [0, -0.19 * L, -0.005], [0.12 * lb, 0.42 * L, 0.13 * lb], m.shin, { geometry: { profile: taper(0.6, 0.95) } })
    k.mesh(`foot${s}`, `j_knee${s}`, `Pé ${label}`, 'capsule', [0, -0.4 * L - 0.035, footLength * 0.2], [0.105 * lb, footLength, 0.1], m.foot, { rotation: [90, 0, 0] })
    k.mesh(`sole${s}`, `j_knee${s}`, `Sola ${femLabel}`, 'box', [0, -0.4 * L - 0.0775, footLength * 0.2], [0.1 * lb, 0.025, footLength * 0.94], m.sole ?? plain('#2a211b', 0.9))
    k.mesh(`deltoid${s}`, `j_shoulder${s}`, `Ombro ${label}`, 'sphere', [0, -0.03, 0], [0.12 * lb, 0.13 * lb, 0.122 * lb], m.deltoid ?? m.upper, { overlapWith: ['torso'] })
    k.mesh(`upperArm${s}`, `j_shoulder${s}`, `Braço ${label}`, 'lathe', [0, -0.15 * A, 0], [0.105 * lb, 0.33 * A, 0.11 * lb], m.upper, { geometry: { profile: taper(0.8, 1) } })
    k.mesh(`forearm${s}`, `j_elbow${s}`, `Antebraço ${label}`, 'lathe', [0, -0.125 * A, 0], [0.09 * lb, 0.27 * A, 0.095 * lb], m.fore, { geometry: { profile: taper(0.7, 1) } })
    const y = -0.27 * A
    k.mesh(`palm${s}`, `j_elbow${s}`, `Mão ${femLabel}`, 'sphere', [0, y - 0.045 * h, 0.005], [0.05 * h, 0.1 * h, 0.088 * h], m.hand, { geometry: { segments: 12 } })
    k.mesh(`fingers${s}`, `j_elbow${s}`, `Dedos (${femLabel})`, 'capsule', [0, y - 0.1 * h, 0.014 * h], [0.046 * h, 0.085 * h, 0.074 * h], m.hand, { rotation: [-14, 0, 0], geometry: { segments: 8 } })
    k.mesh(`thumb${s}`, `j_elbow${s}`, `Polegar (${femLabel})`, 'capsule', [-side * 0.016 * h, y - 0.04 * h, 0.047 * h], [0.03 * h, 0.065 * h, 0.03 * h], m.hand, { rotation: [-38, 0, -side * 18], geometry: { segments: 8 }, collidable: false })
  }
}
/** Grip point inside the closed right/left hand, relative to the elbow joint. */
const grip = (f: Frame): V => [0, -0.27 * f.A - 0.075 * f.lb ** 0.8, 0.03]

interface FaceOpts { skin: Mat; iris?: string; glow?: string; brow?: string; angry?: boolean; nose?: 'round' | 'long' | 'wide' | 'none'; ears?: 'round' | 'pointy' | 'long' | 'none'; mouth?: boolean }
function face(k: Kit, f: Frame, o: FaceOpts) {
  const { hs, hc } = f, [, y, z] = hc
  for (const [side, s, label] of sides) {
    const x = side * 0.048 * hs
    if (o.glow) k.mesh(`eye${s}`, 'j_head', `Olho ${label} luminoso`, 'sphere', [x, y + 0.005 * hs, z + 0.1 * hs], [0.05 * hs, 0.032 * hs, 0.03 * hs], glow(o.glow, 2.2), { geometry: { segments: 10 }, collidable: false })
    else {
      k.mesh(`eye${s}`, 'j_head', `Olho ${label}`, 'sphere', [x, y + 0.005 * hs, z + 0.098 * hs], [0.05 * hs, 0.04 * hs, 0.03 * hs], eyeWhite, { geometry: { segments: 10 }, collidable: false })
      k.mesh(`iris${s}`, 'j_head', `Íris ${label === 'esquerdo' ? 'esquerda' : 'direita'}`, 'sphere', [x, y + 0.006 * hs, z + 0.1115 * hs], [0.026 * hs, 0.028 * hs, 0.012 * hs], { color: o.iris ?? '#5a3b1e', roughness: 0.25, metalness: 0, clearcoat: 1 }, { geometry: { segments: 10 }, collidable: false })
      k.mesh(`pupil${s}`, 'j_head', `Pupila ${label === 'esquerdo' ? 'esquerda' : 'direita'}`, 'sphere', [x, y + 0.006 * hs, z + 0.1175 * hs], [0.013 * hs, 0.015 * hs, 0.006 * hs], plain('#0d0b0a', 0.2), { geometry: { segments: 8 }, collidable: false })
    }
    if (o.brow) k.mesh(`brow${s}`, 'j_head', `Sobrancelha (${label})`, 'box', [side * 0.05 * hs, y + 0.04 * hs, z + 0.1 * hs], [0.056 * hs, 0.013 * hs, 0.02 * hs], plain(o.brow, 0.9), { rotation: [-8, 0, side * (o.angry ? 16 : -5)], collidable: false })
    if (o.ears === 'round') k.mesh(`ear${s}`, 'j_head', `Orelha ${label === 'esquerdo' ? 'esquerda' : 'direita'}`, 'sphere', [side * 0.104 * hs, y, z - 0.012 * hs], [0.032 * hs, 0.068 * hs, 0.048 * hs], o.skin, { geometry: { segments: 10 }, collidable: false })
    if (o.ears === 'pointy' || o.ears === 'long') {
      const long = o.ears === 'long'
      k.mesh(`ear${s}`, 'j_head', `Orelha pontuda (${label})`, 'cone', [side * (long ? 0.2 : 0.16) * hs, y + (long ? 0.035 : 0.02) * hs, z - 0.02 * hs], [(long ? 0.06 : 0.042) * hs, (long ? 0.24 : 0.13) * hs, 0.032 * hs], o.skin,
        { rotation: [-10, 0, -side * (long ? 75 : 72)], geometry: { segments: 8 }, collidable: false })
    }
  }
  if (o.nose === 'round') k.mesh('nose', 'j_head', 'Nariz', 'sphere', [0, y - 0.028 * hs, z + 0.108 * hs], [0.036 * hs, 0.05 * hs, 0.042 * hs], o.skin, { geometry: { segments: 10 }, collidable: false })
  if (o.nose === 'wide') k.mesh('nose', 'j_head', 'Nariz largo', 'sphere', [0, y - 0.03 * hs, z + 0.106 * hs], [0.062 * hs, 0.045 * hs, 0.042 * hs], o.skin, { geometry: { segments: 10 }, collidable: false })
  if (o.nose === 'long') k.mesh('nose', 'j_head', 'Nariz comprido', 'cone', [0, y - 0.025 * hs, z + 0.15 * hs], [0.045 * hs, 0.15 * hs, 0.05 * hs], o.skin, { rotation: [100, 0, 0], geometry: { segments: 10 }, collidable: false })
  if (o.mouth) k.mesh('mouth', 'j_head', 'Boca', 'box', [0, y - 0.07 * hs, z + 0.092 * hs], [0.05 * hs, 0.009 * hs, 0.014 * hs], plain('#7a3a34', 0.5), { collidable: false })
}
function hair(k: Kit, f: Frame, color: string, style: number) {
  const { hs, hc } = f, [, y, z] = hc, m = hairMat(color)
  if (style === 0) return
  k.mesh('hair', 'j_head', 'Cabelo', 'sphere', [0, y + 0.05 * hs, z - 0.02 * hs], [0.228 * hs, 0.2 * hs, 0.256 * hs], m, { geometry: { segments: 16 }, collidable: false })
  if (style === 2) k.mesh('hairBun', 'j_head', 'Coque', 'sphere', [0, y + 0.08 * hs, z - 0.13 * hs], [0.1 * hs, 0.1 * hs, 0.09 * hs], m, { geometry: { segments: 12 }, collidable: false })
  if (style === 3) k.mesh('hairLong', 'j_head', 'Cabelo comprido', 'capsule', [0, y - 0.1 * hs, z - 0.095 * hs], [0.2 * hs, 0.28 * hs, 0.075 * hs], m, { rotation: [8, 0, 0], collidable: false })
  if (style === 4) k.mesh('hairTuft', 'j_head', 'Topete', 'polyhedron', [0, y + 0.105 * hs, z + 0.03 * hs], [0.2 * hs, 0.09 * hs, 0.19 * hs], { ...m, flatShading: true }, { geometry: { detail: 1, bevel: 0.1, seed: 3 }, collidable: false })
}
function beard(k: Kit, f: Frame, color: string, long: boolean) {
  const { hs, hc } = f, [, y, z] = hc, m = hairMat(color)
  if (long) k.mesh('beard', 'j_head', 'Barba longa', 'lathe', [0, y - 0.17 * hs, z + 0.06 * hs], [0.17 * hs, 0.32 * hs, 0.12 * hs], m, { geometry: { profile: [[0, 0], [0.4, 0.25], [0.85, 0.7], [1, 0.9], [0.9, 1], [0, 1]] }, collidable: false })
  else k.mesh('beard', 'j_head', 'Barba', 'sphere', [0, y - 0.085 * hs, z + 0.05 * hs], [0.17 * hs, 0.14 * hs, 0.13 * hs], m, { geometry: { segments: 12 }, collidable: false })
  k.mesh('moustache', 'j_head', 'Bigode', 'capsule', [0, y - 0.047 * hs, z + 0.108 * hs], [0.026 * hs, 0.1 * hs, 0.026 * hs], m, { rotation: [0, 0, 90], geometry: { segments: 8 }, collidable: false })
}
function sword(k: Kit, parent: string, position: V, rotation: V, blade: Mat, hilt: Mat, length = 0.78) {
  const g = k.joint('sword', parent, 'Espada (empunhadura)', position, rotation)
  k.mesh('swordGrip', g, 'Cabo da espada', 'cylinder', [0, 0, 0], [0.034, 0.16, 0.034], leather('#3b2a1e'), { geometry: { segments: 8 } })
  k.mesh('swordPommel', g, 'Pomo', 'sphere', [0, -0.1, 0], [0.05, 0.05, 0.05], hilt, { geometry: { segments: 10 }, collidable: false })
  k.mesh('swordGuard', g, 'Guarda', 'box', [0, 0.095, 0], [0.24, 0.035, 0.045], hilt)
  k.mesh('swordBlade', g, 'Lâmina', 'extrude', [0, 0.112 + length / 2, 0], [0.06, length, 0.014], blade, { geometry: { profile: [[-0.5, 0], [0.5, 0], [0.5, 0.86], [0, 1], [-0.5, 0.86]], bevel: 0.02 } })
  k.mesh('swordFuller', g, 'Sulco da lâmina', 'box', [0, 0.112 + length * 0.4, 0], [0.012, length * 0.62, 0.0165], { ...blade, color: shade(blade.color ?? '#999999', 0.7) }, { collidable: false })
}

function villager(k: Kit, spec: PrefabSpec, avatar = false) {
  const skin = skinMat(k.pick(SKINS, 1)), shirt = spec.primary ?? (avatar ? '#7a6a4a' : k.pick(CLOTHS, 2)), pants = spec.secondary ?? (avatar ? '#4d5560' : k.pick(PANTS, 3)), hairColor = k.pick(HAIRS, 4)
  const f = bipedFrame(k, { bulk: 0.95 + k.rnd(5) * 0.12, head: 1.05 }), boot = leather(avatar ? '#5a3c24' : '#6b4a2e')
  body(k, f, { torso: cloth(shirt), pelvis: cloth(pants), thigh: cloth(pants), shin: boot, foot: boot, upper: cloth(shirt), fore: avatar ? cloth(shirt) : skin, hand: avatar ? leather('#7a5a3a') : skin, neck: skin, head: skin })
  face(k, f, { skin, iris: k.pick(IRIS, 6), brow: shade(hairColor, 0.8), nose: 'round', ears: 'round', mouth: true })
  const hairStyle = avatar ? 1 : Math.floor(k.rnd(7) * 5)
  hair(k, f, hairColor, hairStyle)
  if (!avatar && k.rnd(8) > 0.6) beard(k, f, hairColor, false)
  k.mesh('tunic', 'j_hips', 'Barra da túnica', 'lathe', [0, -0.07, 0], [0.37 * f.b, 0.2, 0.27 * f.bd], { ...cloth(shirt), doubleSided: true }, { geometry: { profile: SKIRT, segments: 16 }, collidable: false })
  k.mesh('belt', 'j_spine', 'Cinto', 'cylinder', [0, 0.015, 0], [0.3 * f.b, 0.05, 0.215 * f.bd], leather('#4a3222'), { geometry: { segments: 16 } })
  k.mesh('buckle', 'j_spine', 'Fivela', 'box', [0, 0.015, 0.108 * f.bd], [0.05, 0.04, 0.012], metal('#c9a24a'), { collidable: false })
  k.mesh('collar', 'j_spine', 'Gola', 'lathe', [0, 0.43, 0], [0.2, 0.05, 0.16], cloth(shade(shirt, 0.8)), { geometry: { profile: [[0.7, 0], [1, 0.3], [0.85, 1], [0.6, 1]], closed: true }, collidable: false })
  if (!avatar) for (const [, s] of sides) k.mesh(`cuff${s}`, `j_elbow${s}`, 'Manga dobrada', 'cylinder', [0, 0.01, 0], [0.105 * f.lb, 0.05, 0.11 * f.lb], cloth(shirt), { collidable: false, overlapWith: [`upperArm${s}`] })
  if (avatar) {
    k.mesh('pack', 'j_spine', 'Mochila', 'capsule', [0, 0.24, -0.19 * f.bd], [0.28, 0.36, 0.15], leather('#8a6a3e'))
    k.mesh('packFlap', 'j_spine', 'Aba da mochila', 'box', [0, 0.32, -0.12 * f.bd - 0.155], [0.22, 0.16, 0.03], leather('#6b4f2c'), { rotation: [-8, 0, 0], collidable: false })
    k.mesh('bedroll', 'j_spine', 'Saco de dormir', 'cylinder', [0, 0.46, -0.2 * f.bd], [0.11, 0.36, 0.11], cloth('#56704a'), { rotation: [0, 0, 90], collidable: false })
    k.mesh('scarf', 'j_neck', 'Lenço', 'lathe', [0, 0.005, 0.01], [0.17, 0.07, 0.16], cloth('#b8443a', 3), { geometry: { profile: [[0.7, 0], [1, 0.4], [0.75, 1], [0.6, 1]], closed: true }, collidable: false })
    const [, y, z] = f.hc
    k.mesh('hatBrim', 'j_head', 'Aba do chapéu', 'cylinder', [0, y + 0.07, z - 0.01], [0.42, 0.018, 0.4], leather('#7a5a36'), { rotation: [-4, 0, 0], geometry: { segments: 18 }, collidable: false })
    k.mesh('hatCrown', 'j_head', 'Copa do chapéu', 'lathe', [0, y + 0.135, z - 0.015], [0.24, 0.12, 0.25], leather('#7a5a36'), { geometry: { profile: [[0, 0], [1, 0], [0.95, 0.7], [0.75, 1], [0, 0.95]] }, collidable: false })
    k.mesh('hatBand', 'j_head', 'Fita do chapéu', 'cylinder', [0, y + 0.095, z - 0.015], [0.245, 0.025, 0.255], cloth('#3a2a20'), { collidable: false })
    k.mesh('canteen', 'j_hips', 'Cantil', 'cylinder', [0.19 * f.b, 0.0, 0.02], [0.1, 0.14, 0.1], metal('#7d8a70', 0.5), { rotation: [0, 0, 90], collidable: false })
    return
  }
  if (k.rnd(9) > 0.55) {
    const [, y, z] = f.hc
    k.mesh('hatBrim', 'j_head', 'Aba do chapéu de palha', 'cylinder', [0, y + 0.08, z - 0.01], [0.5, 0.016, 0.5], { color: '#d9bd7a', texture: 'fabric', textureScale: 8, roughness: 0.9, metalness: 0 }, { geometry: { segments: 18 }, collidable: false })
    k.mesh('hatCrown', 'j_head', 'Copa do chapéu de palha', 'lathe', [0, y + 0.14, z - 0.015], [0.23, 0.11, 0.24], { color: '#d9bd7a', texture: 'fabric', textureScale: 8, roughness: 0.9, metalness: 0 }, { geometry: { profile: [[0, 0], [1, 0], [0.92, 0.75], [0.6, 1], [0, 1]] }, collidable: false })
  }
  if (k.rnd(10) > 0.5) k.mesh('apron', 'j_hips', 'Avental', 'extrude', [0, -0.16, 0.135 * f.bd], [0.26, 0.4, 0.012], cloth('#e8e0cc'), { rotation: [6, 0, 0], geometry: { profile: [[-0.45, 0.5], [0.45, 0.5], [0.5, -0.4], [0.4, -0.5], [-0.4, -0.5], [-0.5, -0.4]], bevel: 0 }, collidable: false })
  else {
    k.mesh('satchel', 'j_hips', 'Bolsa', 'capsule', [-0.2 * f.b, -0.04, 0.02], [0.08, 0.2, 0.16], leather('#8a6a3e'), { rotation: [0, 0, 90], collidable: false })
    k.mesh('strap', 'j_spine', 'Alça', 'box', [0, 0.2, 0.122 * f.bd], [0.035, 0.6, 0.012], leather('#5a3e28'), { rotation: [-6, 0, -36], collidable: false })
  }
  if (k.rnd(11) > 0.5) {
    const g = k.joint('basket', 'j_elbowL', 'Cesto (empunhadura)', grip(f), [8, 0, -7])
    k.mesh('basketBody', g, 'Cesto', 'lathe', [0, -0.12, 0.04], [0.26, 0.16, 0.2], woodMat('#b98a52'), { geometry: { profile: [[0, 0], [0.8, 0], [1, 0.9], [0.95, 1], [0, 0.98]] } })
    k.mesh('basketHandle', g, 'Alça do cesto', 'torus', [0, -0.03, 0.04], [0.2, 0.17, 0.02], woodMat('#8a6236'), { geometry: { radius: 0.06, segments: 8 }, collidable: false })
    for (let i = 0; i < 3; i++) k.mesh(`apple${i}`, g, 'Fruta', 'sphere', [(i - 1) * 0.06, -0.02, 0.04 + (i % 2) * 0.03], [0.065, 0.065, 0.065], { color: ['#c0392b', '#d9a43a', '#7aa33a'][i], roughness: 0.4, metalness: 0, clearcoat: 0.6 }, { geometry: { segments: 10 }, collidable: false })
  }
}

function knight(k: Kit, spec: PrefabSpec) {
  const steel = metal(spec.primary ?? '#b9c0c8'), dark = metal(shade(spec.primary ?? '#b9c0c8', 0.55), 0.45), heraldry = spec.secondary ?? k.pick(['#9b2c2c', '#2c4f9b', '#2c7a4a', '#c79a2c'], 1)
  const mail: Mat = { color: '#80868e', texture: 'fabric', textureScale: 12, normalStrength: 1.5, metalness: 0.8, roughness: 0.5 }, gold = metal('#d4a94a', 0.25), skin = skinMat(k.pick(SKINS, 2))
  const f = bipedFrame(k, { bulk: 1.08 }), [, y, z] = f.hc
  body(k, f, { torso: steel, pelvis: mail, thigh: mail, shin: steel, foot: steel, upper: mail, fore: steel, hand: dark, neck: mail, head: skin, deltoid: mail })
  k.mesh('faulds', 'j_hips', 'Faldas da armadura', 'lathe', [0, -0.07, 0], [0.37 * f.b, 0.18, 0.27 * f.bd], { ...steel, doubleSided: true }, { geometry: { profile: SKIRT, segments: 16 }, collidable: false })
  k.mesh('tabard', 'j_spine', 'Sobreveste heráldica', 'extrude', [0, 0.04, 0.135 * f.bd], [0.28, 0.62, 0.012], cloth(heraldry), { rotation: [-3, 0, 0], geometry: { profile: [[-0.42, 0.5], [0.42, 0.5], [0.5, -0.3], [0, -0.5], [-0.5, -0.3]], bevel: 0 }, collidable: false })
  k.mesh('emblem', 'j_spine', 'Brasão', 'cylinder', [0, 0.2, 0.15 * f.bd], [0.1, 0.012, 0.1], gold, { rotation: [87, 0, 0], geometry: { segments: 16 }, collidable: false })
  k.mesh('belt', 'j_spine', 'Cinturão', 'cylinder', [0, 0.012, 0], [0.33 * f.b, 0.05, 0.24 * f.bd], leather('#3b2a1e'), { geometry: { segments: 16 } })
  k.mesh('gorget', 'j_neck', 'Gorjal', 'lathe', [0, 0.0, 0], [0.2, 0.08, 0.18], steel, { geometry: { profile: DOME }, collidable: false })
  for (const [side, s, label] of sides) {
    k.mesh(`pauldron${s}`, `j_shoulder${s}`, `Ombreira (${label})`, 'lathe', [side * 0.02, 0.0, 0], [0.21, 0.12, 0.2], { ...steel, doubleSided: true }, { rotation: [0, 0, side * 14], geometry: { profile: DOME, segments: 16 } })
    k.mesh(`pauldronLame${s}`, `j_shoulder${s}`, `Lâmina da ombreira (${label})`, 'lathe', [side * 0.025, -0.075, 0], [0.18, 0.06, 0.17], { ...steel, doubleSided: true }, { rotation: [0, 0, side * 14], geometry: { profile: SKIRT }, collidable: false })
    k.mesh(`couter${s}`, `j_elbow${s}`, `Cotoveleira (${label})`, 'sphere', [0, 0.0, -0.02], [0.1, 0.09, 0.09], steel, { geometry: { segments: 12 }, collidable: false })
    k.mesh(`poleyn${s}`, `j_knee${s}`, `Joelheira (${label})`, 'sphere', [0, 0.0, 0.035], [0.11, 0.1, 0.08], steel, { geometry: { segments: 12 }, collidable: false })
  }
  k.mesh('helm', 'j_head', 'Elmo', 'lathe', [0, y + 0.01, z - 0.005], [0.27, 0.31, 0.285], { ...steel, doubleSided: true }, { geometry: { profile: [[0.92, 0], [0.98, 0.4], [1, 0.7], [0.85, 0.9], [0.5, 0.99], [0, 1]], segments: 18 }, overlapWith: ['head'] })
  k.mesh('visor', 'j_head', 'Fenda do visor', 'box', [0, y + 0.025, z + 0.135], [0.17, 0.022, 0.03], darkMat, { collidable: false })
  k.mesh('helmRidge', 'j_head', 'Crista do elmo', 'box', [0, y + 0.15, z - 0.01], [0.016, 0.03, 0.24], gold, { collidable: false })
  k.mesh('plume', 'j_head', 'Pluma', 'capsule', [0, y + 0.2, z - 0.1], [0.06, 0.3, 0.07], { ...cloth(heraldry, 4), sheen: 1 }, { rotation: [-62, 0, 0], collidable: false })
  sword(k, 'j_elbowR', grip(f), [118, 0, 7], metal('#dfe4ea', 0.18), gold)
  const shield = k.joint('shield', 'j_elbowL', 'Escudo (fixação)', [0.085 * f.lb, -0.13, 0.02], [0, 90, 0])
  k.mesh('shieldBody', shield, 'Escudo', 'extrude', [0, 0, 0.02], [0.42, 0.55, 0.04], woodMat('#8a6a46'), { geometry: { profile: [[-0.5, 0.5], [0.5, 0.5], [0.48, 0], [0.3, -0.35], [0, -0.55], [-0.3, -0.35], [-0.48, 0]], bevel: 0.03 } })
  k.mesh('shieldFace', shield, 'Pintura do escudo', 'extrude', [0, 0.01, 0.042], [0.36, 0.48, 0.02], { ...metal(heraldry, 0.4), metalness: 0.4 }, { geometry: { profile: [[-0.5, 0.5], [0.5, 0.5], [0.48, 0], [0.3, -0.35], [0, -0.55], [-0.3, -0.35], [-0.48, 0]], bevel: 0.02 }, collidable: false })
  k.mesh('shieldBoss', shield, 'Umbo', 'sphere', [0, 0.04, 0.06], [0.09, 0.09, 0.05], gold, { geometry: { segments: 12 }, collidable: false })
  k.mesh('cape', 'j_spine', 'Capa', 'extrude', [0, -0.08, -0.15 * f.bd], [0.46, 0.95, 0.02], { ...cloth(shade(heraldry, 0.75)), doubleSided: true }, { rotation: [9, 0, 0], geometry: { profile: [[-0.32, 0.5], [0.32, 0.5], [0.5, -0.45], [0.2, -0.5], [0, -0.46], [-0.2, -0.5], [-0.5, -0.45]], bevel: 0 }, collidable: false })
}

function wizard(k: Kit, spec: PrefabSpec) {
  const robe = spec.primary ?? k.pick(['#3b4a8f', '#5a2f7a', '#2f6a5a', '#7a2f2f'], 1), trim = '#d8b04a', gem = spec.secondary ?? k.pick(['#5fd8ff', '#b07aff', '#6aff9a'], 2)
  const skin = skinMat(k.pick(SKINS, 3)), beardColor = k.pick(['#e8e6e0', '#b9b4aa', '#8a7f72'], 4)
  const f = bipedFrame(k, { bulk: 0.95, hunch: 6 }), [, y, z] = f.hc
  body(k, f, { torso: cloth(robe), pelvis: cloth(robe), thigh: cloth(robe), shin: cloth('#3a3436'), foot: leather('#4a3424'), upper: cloth(robe), fore: cloth(robe), hand: skin, neck: skin, head: skin })
  face(k, f, { skin, iris: '#6a8fb0', brow: beardColor, nose: 'round', ears: 'round' })
  beard(k, f, beardColor, true)
  hair(k, f, beardColor, 3)
  k.mesh('robe', 'j_hips', 'Túnica longa', 'lathe', [0, -0.42, 0], [0.52, 0.86, 0.44], { ...cloth(robe), doubleSided: true }, { geometry: { profile: [[1, 0], [0.96, 0.05], [0.8, 0.4], [0.66, 0.8], [0.6, 1]], segments: 20 }, collidable: false })
  k.mesh('robeHem', 'j_hips', 'Barra bordada', 'lathe', [0, -0.835, 0], [0.535, 0.04, 0.455], { ...metal(trim, 0.5), metalness: 0.5 }, { geometry: { profile: [[0.97, 0], [1, 0.5], [0.97, 1]], segments: 20 }, collidable: false })
  k.mesh('sash', 'j_spine', 'Faixa', 'cylinder', [0, 0.02, 0], [0.3 * f.b, 0.055, 0.22 * f.bd], cloth(trim), { geometry: { segments: 16 } })
  k.mesh('sashTail', 'j_spine', 'Ponta da faixa', 'box', [0.07, -0.12, 0.112 * f.bd], [0.05, 0.24, 0.012], cloth(trim), { rotation: [4, 0, 6], collidable: false })
  k.mesh('mantle', 'j_spine', 'Manto dos ombros', 'lathe', [0, 0.37, -0.005], [0.5 * f.b, 0.13, 0.3 * f.bd], { ...cloth(shade(robe, 0.8)), doubleSided: true }, { geometry: { profile: [[1, 0], [0.9, 0.5], [0.5, 0.95], [0.3, 1]] }, collidable: false })
  for (const [, s, label] of sides) k.mesh(`sleeve${s}`, `j_elbow${s}`, `Manga larga (${label})`, 'lathe', [0, -0.15, 0], [0.18, 0.28, 0.18], { ...cloth(robe), doubleSided: true }, { geometry: { profile: [[1, 0], [0.95, 0.1], [0.62, 0.6], [0.5, 1]] }, collidable: false })
  k.mesh('hatBrim', 'j_head', 'Aba do chapéu', 'cylinder', [0, y + 0.1, z - 0.01], [0.44, 0.02, 0.44], cloth(robe), { rotation: [-6, 0, 0], geometry: { segments: 18 }, collidable: false })
  k.mesh('hatCone', 'j_head', 'Chapéu pontudo', 'cone', [0, y + 0.29, z - 0.03], [0.26, 0.38, 0.26], cloth(robe), { rotation: [-6, 0, 0], geometry: { segments: 16 }, collidable: false })
  k.mesh('hatTip', 'j_head', 'Ponta caída', 'cone', [0, y + 0.5, z - 0.1], [0.08, 0.18, 0.08], cloth(robe), { rotation: [-48, 0, 0], geometry: { segments: 10 }, collidable: false })
  k.mesh('hatBand', 'j_head', 'Fita do chapéu', 'cylinder', [0, y + 0.13, z - 0.012], [0.25, 0.04, 0.25], cloth(trim), { rotation: [-6, 0, 0], geometry: { segments: 16 }, collidable: false })
  k.mesh('hatStar', 'j_head', 'Estrela', 'polyhedron', [0.06, y + 0.25, z + 0.075], [0.05, 0.05, 0.02], glow(trim, 1.4), { geometry: { variant: 'octahedron' }, collidable: false })
  const staff = k.joint('staff', 'j_elbowR', 'Cajado (empunhadura)', grip(f), [8, 0, 7])
  k.mesh('staffShaft', staff, 'Cajado', 'cylinder', [0, 0.15, 0], [0.042, 1.8, 0.042], woodMat('#6b4a2e'), { geometry: { segments: 10 } })
  k.mesh('staffKnot', staff, 'Nó do cajado', 'sphere', [0, 1.02, 0], [0.07, 0.09, 0.07], woodMat('#5a3c24'), { geometry: { segments: 10 } })
  for (let i = 0; i < 3; i++) {
    const a = i * 2 * Math.PI / 3
    k.bone(`staffClaw${i}`, staff, 'Garra do cajado', [Math.cos(a) * 0.02, 1.05, Math.sin(a) * 0.02], [Math.cos(a) * 0.065, 1.2, Math.sin(a) * 0.065], 0.022, woodMat('#5a3c24'), { collidable: false, geometry: { segments: 8 } })
  }
  k.mesh('staffGem', staff, 'Gema mágica', 'polyhedron', [0, 1.17, 0], [0.09, 0.15, 0.09], { ...glow(gem, 3), clearcoat: 1, flatShading: true }, { geometry: { variant: 'octahedron' }, collidable: false })
  if (spec.lit) k.parts.push({ id: 'light', parentId: staff, name: 'Luz da gema', kind: 'light', position: [0, 1.3, 0], dimensions: [0.1, 0.1, 0.1], light: pointLight(gem, 2.5, 6) })
}

function astronaut(k: Kit, spec: PrefabSpec) {
  const suit: Mat = { ...cloth('#e8ecef', 3), sheen: 0.3, roughness: 0.8 }, accent = spec.primary ?? k.pick(['#e2643a', '#3a7ae2', '#e2c23a'], 1), visor = spec.secondary ?? '#d9a441'
  const grey = { ...metal('#8d939a', 0.5), metalness: 0.4 }, f = bipedFrame(k, { bulk: 1.15 }), [, y, z] = f.hc, skin = skinMat(k.pick(SKINS, 2))
  body(k, f, { torso: suit, pelvis: suit, thigh: suit, shin: suit, foot: grey, upper: suit, fore: suit, hand: grey, neck: suit, head: skin, sole: plain('#3a3d42', 0.9) }, { hand: 1.15 })
  k.mesh('helmet', 'j_head', 'Capacete', 'sphere', [0, y, z], [0.34, 0.34, 0.34], { color: '#f3f5f7', roughness: 0.2, metalness: 0.1, clearcoat: 1 }, { geometry: { segments: 20 }, overlapWith: ['head'] })
  k.mesh('visor', 'j_head', 'Viseira espelhada', 'sphere', [0, y + 0.01, z + 0.1], [0.26, 0.2, 0.16], { color: visor, metalness: 0.8, roughness: 0.12, clearcoat: 1, iridescence: 0.4, emissive: shade(visor, 0.35), emissiveIntensity: 0.6 }, { geometry: { segments: 18 }, collidable: false })
  k.mesh('helmetRing', 'j_neck', 'Anel do capacete', 'lathe', [0, 0.0, 0], [0.3, 0.06, 0.3], grey, { geometry: { profile: RING, closed: true, segments: 18 }, collidable: false })
  k.mesh('helmetLamp', 'j_head', 'Lanterna do capacete', 'cylinder', [0.12, y + 0.1, z + 0.06], [0.05, 0.06, 0.05], glow('#fff3c4', 1.5), { rotation: [70, 0, 0], geometry: { segments: 10 }, collidable: false })
  k.mesh('pack', 'j_spine', 'Sistema de suporte de vida', 'box', [0, 0.24, -0.2 * f.bd], [0.38, 0.48, 0.17], { color: '#e3e7ea', roughness: 0.5, metalness: 0.1, clearcoat: 0.4 })
  for (const [side, s] of sides) k.mesh(`tank${s}`, 'j_spine', 'Cilindro de oxigênio', 'capsule', [side * 0.1, 0.27, -0.2 * f.bd - 0.13], [0.11, 0.42, 0.11], metal('#b8bec4', 0.35), { geometry: { segments: 12 }, collidable: false })
  k.mesh('packLight', 'j_spine', 'Indicador do suporte', 'box', [0.11, 0.42, -0.2 * f.bd + 0.088], [0.05, 0.02, 0.012], glow('#4cff7a', 2), { collidable: false })
  k.mesh('antenna', 'j_spine', 'Antena', 'cylinder', [-0.15, 0.6, -0.22 * f.bd], [0.012, 0.22, 0.012], grey, { geometry: { segments: 8 }, collidable: false })
  k.mesh('chestUnit', 'j_spine', 'Painel de controle', 'box', [0, 0.24, 0.138 * f.bd], [0.2, 0.12, 0.07], { color: '#cfd4d8', roughness: 0.4, metalness: 0.3 })
  for (let i = 0; i < 3; i++) k.mesh(`button${i}`, 'j_spine', 'Botão luminoso', 'sphere', [(i - 1) * 0.05, 0.255, 0.138 * f.bd + 0.036], [0.025, 0.025, 0.015], glow(['#ff4a3a', '#4cff7a', '#4ab8ff'][i], 2), { geometry: { segments: 8 }, collidable: false })
  k.mesh('hose', 'j_spine', 'Mangueira', 'tube', [0.17, 0.2, 0.0], [0.08, 0.2, 0.36], grey, { geometry: { points: [[-0.5, 0.2, 0.5], [0.3, 0, 0.2], [0.5, -0.4, -0.2], [0.2, 0.5, -0.5]], radius: 0.06, segments: 8 }, collidable: false })
  for (const [, s, label] of sides) {
    k.mesh(`armBand${s}`, `j_shoulder${s}`, `Faixa (${label})`, 'cylinder', [0, -0.1, 0], [0.13 * f.lb, 0.04, 0.135 * f.lb], cloth(accent), { collidable: false })
    k.mesh(`kneePad${s}`, `j_knee${s}`, `Joelheira (${label})`, 'sphere', [0, 0.0, 0.05], [0.12, 0.11, 0.08], grey, { geometry: { segments: 10 }, collidable: false })
    k.mesh(`glove${s}`, `j_elbow${s}`, `Punho da luva (${label})`, 'cylinder', [0, -0.255 * f.A, 0], [0.11 * f.lb, 0.05, 0.115 * f.lb], grey, { collidable: false })
    k.mesh(`bootCuff${s}`, `j_knee${s}`, `Cano da bota (${label})`, 'cylinder', [0, -0.3, 0], [0.15 * f.lb, 0.14, 0.16 * f.lb], grey, { collidable: false })
  }
  k.mesh('belt', 'j_spine', 'Cinto de ferramentas', 'cylinder', [0, 0.01, 0], [0.33 * f.b, 0.05, 0.25 * f.bd], cloth(accent), { geometry: { segments: 16 } })
}

function goblin(k: Kit, spec: PrefabSpec) {
  const skinColor = spec.primary ?? k.pick(['#6f9a3c', '#7f9c3a', '#5f8a4a', '#8a9a4a'], 1), skin = skinMat(skinColor), hide = leather(spec.secondary ?? '#6b4a2e')
  const f = bipedFrame(k, { L: 0.7, A: 1.12, bulk: 0.85, head: 1.5, hunch: 18 }), [, y, z] = f.hc
  body(k, f, { torso: skin, pelvis: hide, thigh: skin, shin: skin, foot: skin, upper: skin, fore: skin, hand: skin, neck: skin, head: skin, sole: skinMat(shade(skinColor, 0.75)) }, { hand: 1.15 })
  face(k, f, { skin, glow: '#ffd23a', brow: shade(skinColor, 0.5), angry: true, nose: 'long', ears: 'long' })
  k.mesh('mouth', 'j_head', 'Boca', 'box', [0, y - 0.1, z + 0.125], [0.1, 0.012, 0.02], plain('#3a1a14', 0.6), { rotation: [-10, 0, 0], collidable: false })
  for (const [side, s] of sides) k.mesh(`tusk${s}`, 'j_head', 'Presa', 'cone', [side * 0.035, y - 0.08, z + 0.135], [0.02, 0.05, 0.02], boneMat('#efe6c8'), { rotation: [-15, 0, 0], geometry: { segments: 8 }, collidable: false })
  if (k.rnd(2) > 0.4) for (let i = 0; i < 3; i++) k.mesh(`spike${i}`, 'j_head', 'Tufo de cabelo', 'cone', [0, y + 0.17 - i * 0.02, z - 0.02 - i * 0.07], [0.05, 0.09, 0.05], hairMat('#2a2018'), { rotation: [-25 - i * 25, 0, 0], geometry: { segments: 8 }, collidable: false })
  k.mesh('loincloth', 'j_hips', 'Tanga de couro', 'lathe', [0, -0.08, 0], [0.34 * f.b, 0.22, 0.25 * f.bd], { ...hide, doubleSided: true }, { geometry: { profile: [[1, 0], [0.95, 0.15], [0.8, 0.6], [0.7, 1]], segments: 10 }, collidable: false })
  k.mesh('harness', 'j_spine', 'Correia', 'box', [0, 0.22, 0.108 * f.bd], [0.035, 0.52, 0.012], hide, { rotation: [-4, 0, 38], collidable: false })
  for (const [, s] of sides) k.mesh(`bracer${s}`, `j_elbow${s}`, 'Bracelete de couro', 'cylinder', [0, -0.17, 0], [0.098 * f.lb, 0.08, 0.103 * f.lb], hide, { collidable: false })
  if (spec.seed % 2 === 0) {
    const g = k.joint('spear', 'j_elbowR', 'Lança (empunhadura)', grip(f), [-10, 0, 7])
    k.mesh('spearShaft', g, 'Haste da lança', 'cylinder', [0, 0.3, 0], [0.035, 1.36, 0.035], woodMat('#7a5a36'), { geometry: { segments: 8 } })
    k.mesh('spearTip', g, 'Ponta da lança', 'cone', [0, 1.07, 0], [0.07, 0.2, 0.035], rusty('#7a5a48'), { geometry: { segments: 8 } })
    k.mesh('spearWrap', g, 'Amarração', 'cylinder', [0, 0.95, 0], [0.045, 0.06, 0.045], hide, { collidable: false })
  } else {
    const g = k.joint('club', 'j_elbowR', 'Porrete (empunhadura)', grip(f), [100, 0, 7])
    k.mesh('clubBody', g, 'Porrete', 'lathe', [0, 0.28, 0], [0.13, 0.62, 0.13], woodMat('#7a5a36'), { geometry: { profile: [[0, 0], [0.3, 0.02], [0.35, 0.3], [0.7, 0.75], [1, 0.92], [0.7, 1], [0, 1]], segments: 12 } })
    for (let i = 0; i < 4; i++) k.mesh(`clubSpike${i}`, g, 'Cravo', 'cone', [Math.cos(i * 1.57) * 0.065, 0.48 + (i % 2) * 0.06, Math.sin(i * 1.57) * 0.065], [0.03, 0.06, 0.03], rusty('#6a6a6a'), { rotation: [Math.sin(i * 1.57) * 90, 0, -Math.cos(i * 1.57) * 90], geometry: { segments: 8 }, collidable: false })
  }
  return scaled(k.parts, 0.72)
}

function skeleton(k: Kit, spec: PrefabSpec) {
  const bone = boneMat(spec.primary ?? '#e6dcc3'), eye = spec.secondary ?? k.pick(['#5ff2ff', '#ff4a3a', '#9aff5a'], 1), f = bipedFrame(k, { bulk: 0.85 }), { L, A } = f
  k.mesh('pelvis', 'j_hips', 'Bacia', 'lathe', [0, 0.0, 0], [0.27, 0.15, 0.18], { ...bone, doubleSided: true }, { geometry: { profile: [[0.55, 0], [0.8, 0.35], [1, 0.8], [0.95, 1]], segments: 14 } })
  k.mesh('spineColumn', 'j_spine', 'Coluna vertebral', 'lathe', [0, 0.2, -0.07], [0.04, 0.46, 0.04], bone, { geometry: { profile: taper(1, 0.8), segments: 8 }, overlapWith: ['pelvis'] })
  for (let i = 0; i < 4; i++) k.mesh(`vertebra${i}`, 'j_spine', 'Vértebra', 'cylinder', [0, 0.04 + i * 0.05, -0.07], [0.06, 0.025, 0.05], bone, { geometry: { segments: 8 }, collidable: false })
  for (let i = 0; i < 4; i++) k.mesh(`rib${i}`, 'j_spine', 'Costela', 'lathe', [0, 0.17 + i * 0.07, -0.01], [0.3 - Math.abs(i - 1.6) * 0.03, 0.032, 0.2 - Math.abs(i - 1.6) * 0.02], bone, { rotation: [-12, 0, 0], geometry: { profile: RING, closed: true, segments: 14 } })
  k.mesh('sternum', 'j_spine', 'Esterno', 'box', [0, 0.27, 0.088], [0.035, 0.22, 0.02], bone, { rotation: [-8, 0, 0], collidable: false })
  for (const [side, s, label] of sides) {
    k.bone(`clavicle${s}`, 'j_spine', `Clavícula (${label})`, [side * 0.02, 0.39, 0.06], [side * 0.2, 0.39, 0.0], 0.03, bone, { profile: BONE, collidable: false, geometry: { segments: 8 } })
    k.mesh(`shoulderBall${s}`, `j_shoulder${s}`, `Ombro (${label})`, 'sphere', [0, 0, 0], [0.07, 0.07, 0.07], bone, { geometry: { segments: 10 } })
    k.mesh(`upperArm${s}`, `j_shoulder${s}`, `Úmero (${label})`, 'lathe', [0, -0.15 * A, 0], [0.04, 0.3 * A, 0.04], bone, { geometry: { profile: BONE, segments: 8 } })
    k.mesh(`forearm${s}`, `j_elbow${s}`, `Rádio (${label})`, 'lathe', [0.012, -0.13 * A, 0], [0.032, 0.27 * A, 0.032], bone, { geometry: { profile: BONE, segments: 8 } })
    k.mesh(`ulna${s}`, `j_elbow${s}`, `Ulna (${label})`, 'lathe', [-0.012, -0.13 * A, -0.01], [0.026, 0.27 * A, 0.026], bone, { geometry: { profile: BONE, segments: 8 }, collidable: false })
    k.mesh(`palm${s}`, `j_elbow${s}`, `Mão óssea (${label})`, 'sphere', [0, -0.3 * A, 0.01], [0.035, 0.07, 0.07], bone, { geometry: { segments: 8 } })
    for (let i = 0; i < 3; i++) k.mesh(`finger${s}${i}`, `j_elbow${s}`, 'Falange', 'lathe', [0, -0.37 * A, (i - 1) * 0.022 + 0.012], [0.016, 0.08, 0.016], bone, { rotation: [-12, 0, 0], geometry: { profile: BONE, segments: 8 }, collidable: false })
    k.mesh(`thigh${s}`, `j_hip${s}`, `Fêmur (${label})`, 'lathe', [0, -0.2 * L, 0], [0.05, 0.42 * L, 0.05], bone, { geometry: { profile: BONE, segments: 8 }, overlapWith: ['pelvis'] })
    k.mesh(`kneecap${s}`, `j_knee${s}`, `Patela (${label})`, 'sphere', [0, 0.0, 0.025], [0.06, 0.06, 0.04], bone, { geometry: { segments: 10 }, collidable: false })
    k.mesh(`shin${s}`, `j_knee${s}`, `Tíbia (${label})`, 'lathe', [0, -0.2 * L, 0], [0.042, 0.4 * L, 0.042], bone, { geometry: { profile: BONE, segments: 8 } })
    k.mesh(`foot${s}`, `j_knee${s}`, `Pé ósseo (${label})`, 'sphere', [0, -0.4 * L - 0.05, 0.05], [0.08, 0.06, 0.2], bone, { geometry: { segments: 10 } })
    for (let i = 0; i < 3; i++) k.mesh(`toe${s}${i}`, `j_knee${s}`, 'Dedo do pé', 'lathe', [(i - 1) * 0.025, -0.4 * L - 0.07, 0.17], [0.016, 0.07, 0.016], bone, { rotation: [90, 0, 0], geometry: { profile: BONE, segments: 8 }, collidable: false })
  }
  k.mesh('neck', 'j_neck', 'Vértebras cervicais', 'lathe', [0, 0.04, -0.02], [0.04, 0.12, 0.04], bone, { geometry: { profile: BONE, segments: 8 }, overlapWith: ['spineColumn'] })
  k.mesh('skull', 'j_head', 'Crânio', 'sphere', [0, 0.13, -0.005], [0.2, 0.19, 0.23], bone, { geometry: { segments: 16 } })
  k.mesh('maxilla', 'j_head', 'Maxilar', 'sphere', [0, 0.06, 0.05], [0.15, 0.09, 0.13], bone, { geometry: { segments: 12 }, overlapWith: ['skull'] })
  k.mesh('teeth', 'j_head', 'Dentes', 'box', [0, 0.03, 0.105], [0.08, 0.022, 0.025], boneMat('#f2ecd8'), { collidable: false })
  k.mesh('noseHole', 'j_head', 'Cavidade nasal', 'cone', [0, 0.075, 0.112], [0.03, 0.035, 0.02], darkMat, { rotation: [180, 0, 0], geometry: { segments: 8 }, collidable: false })
  k.joint('j_jaw', 'j_head', 'Mandíbula (articulação)', [0, 0.03, 0.0], [6, 0, 0])
  k.mesh('jaw', 'j_jaw', 'Mandíbula', 'lathe', [0, -0.02, 0.05], [0.13, 0.05, 0.12], bone, { geometry: { profile: [[0, 0], [0.7, 0.05], [1, 0.5], [0.9, 1], [0, 0.95]], segments: 12 } })
  for (const [side, s, label] of sides) {
    k.mesh(`socket${s}`, 'j_head', `Órbita (${label})`, 'sphere', [side * 0.045, 0.125, 0.087], [0.058, 0.052, 0.045], darkMat, { geometry: { segments: 10 }, collidable: false })
    k.mesh(`eye${s}`, 'j_head', `Brilho do olho (${label})`, 'sphere', [side * 0.045, 0.125, 0.1], [0.022, 0.022, 0.022], glow(eye, 4), { geometry: { segments: 8 }, collidable: false })
  }
  if (spec.seed % 2 === 1) k.mesh('helm', 'j_head', 'Elmo enferrujado', 'lathe', [0, 0.185, -0.005], [0.235, 0.13, 0.26], { ...rusty('#7a5a44'), doubleSided: true }, { geometry: { profile: [[1, 0], [0.98, 0.1], [0.85, 0.2], [0.82, 0.6], [0.5, 0.95], [0, 1]], segments: 16 }, collidable: false })
  k.mesh('rag', 'j_hips', 'Trapo rasgado', 'extrude', [0, -0.13, 0.085], [0.2, 0.26, 0.012], { ...cloth('#4a4252'), doubleSided: true }, { rotation: [8, 0, 0], geometry: { profile: [[-0.5, 0.5], [0.5, 0.5], [0.45, -0.2], [0.3, -0.5], [0.15, -0.25], [0, -0.45], [-0.2, -0.2], [-0.35, -0.5], [-0.5, -0.1]], bevel: 0 }, collidable: false })
  sword(k, 'j_elbowR', grip(f), [112, 0, 7], rusty('#8a6a52'), rusty('#5a4636'), 0.7)
  if (spec.seed % 3 === 0) {
    const shield = k.joint('shield', 'j_elbowL', 'Escudo (fixação)', [0.06, -0.13, 0.02], [0, 0, -90])
    k.mesh('shieldBody', shield, 'Escudo rachado', 'cylinder', [0, -0.03, 0], [0.42, 0.04, 0.42], woodMat('#6b5236'), { geometry: { segments: 16 } })
    k.mesh('shieldRim', shield, 'Aro de ferro', 'lathe', [0, -0.03, 0], [0.44, 0.05, 0.44], rusty('#6a5040'), { geometry: { profile: RING, closed: true, segments: 16 }, collidable: false })
  }
}

function orc(k: Kit, spec: PrefabSpec) {
  const skinColor = spec.primary ?? k.pick(['#5e7d4a', '#6b7a4f', '#7a8a5a', '#4f6b52'], 1), skin = skinMat(skinColor), hide = leather(spec.secondary ?? '#5a3e2b')
  const iron = metal('#5d6066', 0.55), f = bipedFrame(k, { A: 1.12, bulk: 1.45, head: 0.95, hunch: 12 }), [, y, z] = f.hc, hs = f.hs
  body(k, f, { torso: skin, pelvis: hide, thigh: cloth('#4a3c30'), shin: hide, foot: hide, upper: skin, fore: skin, hand: skin, neck: skin, head: skin }, { hand: 1.15 })
  face(k, f, { skin, glow: '#ff6a2a', brow: shade(skinColor, 0.6), angry: true, nose: 'wide', ears: 'pointy' })
  k.mesh('browRidge', 'j_head', 'Arcada', 'capsule', [0, y + 0.04 * hs, z + 0.088 * hs], [0.035 * hs, 0.17 * hs, 0.04 * hs], skin, { rotation: [0, 0, 90], geometry: { segments: 8 }, collidable: false })
  k.mesh('chin', 'j_head', 'Queixo', 'sphere', [0, y - 0.075 * hs, z + 0.045 * hs], [0.17 * hs, 0.1 * hs, 0.15 * hs], skin, { geometry: { segments: 12 }, collidable: false })
  for (const [side, s] of sides) k.mesh(`tusk${s}`, 'j_head', 'Presa', 'cone', [side * 0.045 * hs, y - 0.04 * hs, z + 0.105 * hs], [0.028 * hs, 0.08 * hs, 0.028 * hs], boneMat('#efe3c0'), { rotation: [-12, 0, side * -10], geometry: { segments: 8 }, collidable: false })
  k.mesh('topknot', 'j_head', 'Rabo de cavalo', 'capsule', [0, y + 0.15 * hs, z - 0.06 * hs], [0.06, 0.16, 0.06], hairMat('#1c1a1d'), { rotation: [-35, 0, 0], collidable: false })
  k.mesh('topknotTie', 'j_head', 'Amarração do cabelo', 'cylinder', [0, y + 0.115 * hs, z - 0.04 * hs], [0.068, 0.03, 0.068], hide, { rotation: [-35, 0, 0], collidable: false })
  k.mesh('loincloth', 'j_hips', 'Tanga', 'extrude', [0, -0.17, 0.125 * f.bd], [0.22, 0.34, 0.014], cloth(spec.secondary ? shade(spec.secondary, 0.8) : '#7a2e24'), { rotation: [6, 0, 0], geometry: { profile: [[-0.5, 0.5], [0.5, 0.5], [0.4, -0.4], [0, -0.5], [-0.4, -0.4]], bevel: 0 }, collidable: false })
  k.mesh('belt', 'j_spine', 'Cinturão', 'cylinder', [0, 0.01, 0], [0.33 * f.b, 0.07, 0.24 * f.bd], hide, { geometry: { segments: 16 } })
  k.mesh('buckle', 'j_spine', 'Fivela de crânio', 'sphere', [0, 0.01, 0.125 * f.bd], [0.09, 0.08, 0.05], boneMat('#e6dcc3'), { geometry: { segments: 10 }, collidable: false })
  k.mesh('strap', 'j_spine', 'Correia peitoral', 'box', [0, 0.23, 0.124 * f.bd], [0.05, 0.62, 0.014], hide, { rotation: [-4, 0, 35], collidable: false })
  k.mesh('pauldron', 'j_shoulderL', 'Ombreira cravejada', 'lathe', [0.03, 0.01, 0], [0.26, 0.15, 0.25], { ...iron, doubleSided: true }, { rotation: [0, 0, 16], geometry: { profile: DOME, segments: 14 } })
  for (let i = 0; i < 3; i++) k.mesh(`pauldronSpike${i}`, 'j_shoulderL', 'Cravo', 'cone', [0.05 + i * 0.035, 0.08 - i * 0.02, (i - 1) * 0.06], [0.04, 0.1, 0.04], iron, { rotation: [0, 0, -25 - i * 15], geometry: { segments: 8 }, collidable: false })
  for (const [, s] of sides) k.mesh(`bracer${s}`, `j_elbow${s}`, 'Bracelete de ferro', 'cylinder', [0, -0.15, 0], [0.105 * f.lb, 0.1, 0.11 * f.lb], iron, { collidable: false })
  const g = k.joint('weapon', 'j_elbowR', 'Machado (empunhadura)', grip(f), [100, 0, 7])
  k.mesh('axeHaft', g, 'Cabo do machado', 'cylinder', [0, 0.25, 0], [0.05, 0.95, 0.05], woodMat('#5a3c24'), { geometry: { segments: 8 } })
  if (spec.seed % 2 === 0) {
    k.mesh('axeHead', g, 'Lâmina do machado', 'extrude', [0, 0.6, 0.13], [0.26, 0.36, 0.025], iron, { rotation: [0, -90, 0], geometry: { profile: [[-0.5, 0.25], [0.2, 0.35], [0.5, 0.5], [0.42, 0], [0.5, -0.5], [0.2, -0.35], [-0.5, -0.25]], bevel: 0.02 } })
    k.mesh('axeBack', g, 'Contrapeso', 'cone', [0, 0.6, -0.06], [0.05, 0.1, 0.05], iron, { rotation: [-90, 0, 0], geometry: { segments: 8 }, collidable: false })
  } else {
    k.mesh('clubHead', g, 'Maça', 'lathe', [0, 0.62, 0], [0.2, 0.3, 0.2], woodMat('#6b4a2e'), { geometry: { profile: [[0, 0], [0.6, 0.05], [1, 0.5], [0.8, 0.95], [0, 1]], segments: 12 } })
    for (let i = 0; i < 5; i++) k.mesh(`maceSpike${i}`, g, 'Cravo', 'cone', [Math.cos(i * 1.256) * 0.1, 0.62 + (i % 2 ? 0.06 : -0.04), Math.sin(i * 1.256) * 0.1], [0.04, 0.08, 0.04], iron, { rotation: [Math.sin(i * 1.256) * 90, 0, -Math.cos(i * 1.256) * 90], geometry: { segments: 8 }, collidable: false })
  }
  return scaled(k.parts, 1.15)
}

function golem(k: Kit, spec: PrefabSpec) {
  const stone = rockMat(spec.primary ?? '#8a8580'), dark = rockMat(shade(spec.primary ?? '#8a8580', 0.75)), rune = spec.secondary ?? (spec.seed % 2 ? '#ff7a2a' : '#56d8ff'), moss: Mat = { color: '#5f7f3a', texture: 'grass', textureScale: 3, roughness: 1, metalness: 0 }
  const f = bipedFrame(k, { L: 0.9, A: 1.3, bulk: 1.9, hunch: 15 }), { L, A } = f
  const rock = (id: string, parent: string, name: string, position: V, dims: V, seed: number, material = stone, extra: Extra = {}) =>
    k.mesh(id, parent, name, 'polyhedron', position, dims, material, { ...extra, geometry: { variant: seed % 2 ? 'dodecahedron' : 'icosahedron', detail: 1, bevel: 0.14, seed: (spec.seed + seed) % 9999, ...extra.geometry } })
  rock('pelvis', 'j_hips', 'Quadril de pedra', [0, -0.02, 0], [0.5, 0.26, 0.34], 1, dark)
  rock('torso', 'j_spine', 'Torso de pedra', [0, 0.24, 0], [0.74, 0.56, 0.48], 2, stone, { overlapWith: ['pelvis'] })
  rock('chestPlate', 'j_spine', 'Placa peitoral', [0, 0.32, 0.12], [0.5, 0.3, 0.3], 3, dark, { collidable: false })
  k.mesh('core', 'j_spine', 'Núcleo rúnico', 'polyhedron', [0, 0.25, 0.25], [0.13, 0.17, 0.09], { ...glow(rune, 4), flatShading: true }, { geometry: { variant: 'octahedron' }, collidable: false })
  for (let i = 0; i < 3; i++) k.mesh(`crack${i}`, 'j_spine', 'Fissura brilhante', 'box', [(i - 1) * 0.12, 0.2 + (i % 2) * 0.12, 0.23 - Math.abs(i - 1) * 0.03], [0.014, 0.16, 0.02], glow(rune, 3), { rotation: [0, 0, (i - 1) * 35], collidable: false })
  for (let i = 0; i < 3; i++) k.mesh(`crystal${i}`, 'j_spine', 'Cristal dorsal', 'polyhedron', [(i - 1) * 0.16, 0.42 - Math.abs(i - 1) * 0.08, -0.2], [0.09, 0.22, 0.09], { ...glow(rune, 1.8), clearcoat: 1, flatShading: true }, { rotation: [-30, 0, (i - 1) * 25], geometry: { variant: 'octahedron' }, collidable: false })
  rock('neck', 'j_neck', 'Pescoço de pedra', [0, 0.02, 0.0], [0.2, 0.12, 0.2], 4, dark, { overlapWith: ['torso'] })
  rock('head', 'j_head', 'Cabeça de pedra', [0, 0.07, 0.07], [0.24, 0.2, 0.22], 5, stone, { overlapWith: ['neck'] })
  rock('brow', 'j_head', 'Testa', [0, 0.13, 0.13], [0.24, 0.07, 0.1], 6, dark, { collidable: false })
  for (const [side, s, label] of sides) {
    k.mesh(`eye${s}`, 'j_head', `Olho rúnico (${label})`, 'sphere', [side * 0.05, 0.085, 0.18], [0.05, 0.028, 0.025], glow(rune, 4), { geometry: { segments: 8 }, collidable: false })
    rock(`boulder${s}`, `j_shoulder${s}`, `Ombro rochoso (${label})`, [side * 0.05, 0.04, 0], [0.32, 0.28, 0.32], 7 + side, stone)
    k.mesh(`moss${s}`, `j_shoulder${s}`, 'Musgo', 'sphere', [side * 0.05, 0.17, -0.02], [0.24, 0.05, 0.22], moss, { geometry: { segments: 10 }, collidable: false })
    rock(`upperArm${s}`, `j_shoulder${s}`, `Braço de pedra (${label})`, [0, -0.17 * A, 0], [0.22, 0.32 * A, 0.22], 9 + side, dark)
    rock(`forearm${s}`, `j_elbow${s}`, `Antebraço de pedra (${label})`, [0, -0.14 * A, 0.01], [0.27, 0.32 * A, 0.27], 11 + side, stone)
    rock(`fist${s}`, `j_elbow${s}`, `Punho de pedra (${label})`, [0, -0.34 * A, 0.03], [0.3, 0.28, 0.3], 13 + side, stone)
    k.mesh(`armRune${s}`, `j_elbow${s}`, 'Runa do braço', 'box', [side * 0.13, -0.14 * A, 0.04], [0.012, 0.12, 0.04], glow(rune, 3), { rotation: [0, 0, side * 6], collidable: false })
    rock(`thigh${s}`, `j_hip${s}`, `Coxa de pedra (${label})`, [0, -0.19 * L, 0], [0.24, 0.36 * L, 0.25], 15 + side, dark)
    rock(`shin${s}`, `j_knee${s}`, `Perna de pedra (${label})`, [0, -0.2 * L, 0.0], [0.26, 0.34 * L, 0.27], 17 + side, stone)
    rock(`foot${s}`, `j_knee${s}`, `Pé de pedra (${label})`, [0, -0.4 * L - 0.015, 0.06], [0.32, 0.15, 0.4], 19 + side, dark)
    k.mesh(`legRune${s}`, `j_knee${s}`, 'Runa da perna', 'box', [0, -0.2 * L, 0.135], [0.04, 0.1, 0.012], glow(rune, 3), { collidable: false })
  }
  if (spec.lit) k.parts.push({ id: 'light', parentId: 'j_spine', name: 'Brilho do núcleo', kind: 'light', position: [0, 0.25, 0.45], dimensions: [0.1, 0.1, 0.1], light: pointLight(rune, 4, 6) })
  return scaled(k.parts, 1.45)
}

function robot(k: Kit) {
  const shell = metal('#c9d2db', 0.28), joint = metal('#2c3138', 0.5), visor = '#4ad8ff', f = bipedFrame(k, { bulk: 1.05 }), { L, A } = f
  body(k, f, { torso: shell, pelvis: joint, thigh: shell, shin: shell, foot: joint, upper: shell, fore: shell, hand: joint, neck: joint, head: shell, deltoid: joint, sole: plain('#22262b', 0.8) }, { noHead: true })
  k.mesh('head', 'j_head', 'Cabeça robótica', 'lathe', [0, 0.11, 0.01], [0.24, 0.24, 0.25], shell, { geometry: { profile: [[0, 0], [0.8, 0], [0.95, 0.15], [1, 0.6], [0.85, 0.92], [0.4, 1], [0, 1]], segments: 18 } })
  k.mesh('visor', 'j_head', 'Visor', 'sphere', [0, 0.125, 0.1], [0.19, 0.07, 0.07], glow(visor, 2.5), { geometry: { segments: 14 }, collidable: false })
  k.mesh('antenna', 'j_head', 'Antena', 'cylinder', [0.08, 0.27, -0.02], [0.012, 0.1, 0.012], joint, { geometry: { segments: 8 }, collidable: false })
  k.mesh('antennaTip', 'j_head', 'Ponta da antena', 'sphere', [0.08, 0.325, -0.02], [0.03, 0.03, 0.03], glow('#ff5a3a', 2), { geometry: { segments: 8 }, collidable: false })
  k.mesh('chestLight', 'j_spine', 'Núcleo do peito', 'cylinder', [0, 0.28, 0.115], [0.07, 0.02, 0.07], glow(visor, 2.5), { rotation: [84, 0, 0], geometry: { segments: 14 }, collidable: false })
  for (const [, s, label] of sides) {
    k.mesh(`elbowJoint${s}`, `j_elbow${s}`, `Junta do cotovelo (${label})`, 'sphere', [0, 0, 0], [0.085, 0.085, 0.085], joint, { geometry: { segments: 10 }, collidable: false })
    k.mesh(`kneeJoint${s}`, `j_knee${s}`, `Junta do joelho (${label})`, 'sphere', [0, 0, 0], [0.1, 0.1, 0.1], joint, { geometry: { segments: 10 }, collidable: false })
    k.mesh(`armStripe${s}`, `j_elbow${s}`, 'Faixa luminosa', 'cylinder', [0, -0.12 * A, 0], [0.093, 0.015, 0.098], glow(visor, 1.5), { collidable: false })
    k.mesh(`legStripe${s}`, `j_knee${s}`, 'Faixa luminosa', 'cylinder', [0, -0.18 * L, 0], [0.118, 0.015, 0.128], glow(visor, 1.5), { collidable: false })
  }
}

interface LegSpec { anchor: V; upper: number; widths: [number, number]; foot: number; hoof?: boolean; mats: [Mat, Mat, Mat] }
function quadLeg(k: Kit, id: 'FL' | 'FR' | 'BL' | 'BR', bodyY: number, o: LegSpec) {
  const lower = bodyY + o.anchor[1] - o.upper - o.foot, [w0, w1] = o.widths, label = { FL: 'dianteira esquerda', FR: 'dianteira direita', BL: 'traseira esquerda', BR: 'traseira direita' }[id]
  k.joint(`j_leg${id}`, 'j_body', `Pata ${label} (articulação)`, o.anchor)
  k.mesh(`upper${id}`, `j_leg${id}`, `Coxa ${label}`, 'lathe', [0, -o.upper / 2 + 0.03, id[0] === 'B' ? -0.02 : 0], [w0, o.upper + 0.08, w0 * 1.2], o.mats[0], { geometry: { profile: taper(0.7, 1) }, overlapWith: ['body'] })
  k.joint(`j_knee${id}`, `j_leg${id}`, `Joelho ${label} (articulação)`, [0, -o.upper, 0])
  k.mesh(`knob${id}`, `j_knee${id}`, 'Articulação', 'sphere', [0, 0, id[0] === 'B' ? -0.015 : 0.005], [w1 * 1.15, w1 * 1.3, w1 * 1.2], o.mats[1], { geometry: { segments: 10 }, collidable: false })
  k.mesh(`lower${id}`, `j_knee${id}`, `Canela ${label}`, 'lathe', [0, -lower / 2, 0], [w1, lower + 0.02, w1 * 1.1], o.mats[1], { geometry: { profile: taper(0.75, 1) } })
  if (o.hoof) k.mesh(`hoof${id}`, `j_knee${id}`, `Casco ${label}`, 'cylinder', [0, -lower - o.foot / 2, 0.008], [w1 * 1.05, o.foot, w1 * 1.25], o.mats[2], { geometry: { segments: 10 } })
  else k.mesh(`paw${id}`, `j_knee${id}`, `Pata ${label}`, 'sphere', [0, -lower - o.foot / 2, 0.03], [w1 * 1.45, o.foot, w1 * 1.9], o.mats[2], { geometry: { segments: 10 } })
}

function wolf(k: Kit, spec: PrefabSpec) {
  const coat = spec.primary ?? k.pick(['#6d6a66', '#8a8178', '#4a4644', '#b9b2a8', '#7a5f48'], 1), light = spec.secondary ?? shade(coat, 1.45), m = fur(coat), pale = fur(light), bodyY = 0.72
  k.joint('j_body', null, 'Corpo (articulação)', [0, bodyY, 0])
  k.mesh('body', 'j_body', 'Corpo do lobo', 'lathe', [0, 0.02, 0], [0.42, 1.15, 0.46], m, { rotation: [90, 0, 0], geometry: { profile: [[0, 0], [0.45, 0.03], [0.72, 0.15], [0.78, 0.4], [0.9, 0.65], [1, 0.82], [0.8, 0.95], [0.3, 1], [0, 1]], segments: 16 } })
  k.mesh('belly', 'j_body', 'Ventre', 'sphere', [0, -0.11, 0.08], [0.3, 0.2, 0.7], pale, { geometry: { segments: 12 }, collidable: false })
  k.mesh('ruff', 'j_body', 'Juba', 'sphere', [0, 0.04, 0.38], [0.45, 0.44, 0.38], fur(shade(coat, 1.2)), { geometry: { segments: 14 } })
  k.mesh('hackles', 'j_body', 'Pelos do dorso', 'polyhedron', [0, 0.2, 0.12], [0.26, 0.14, 0.6], { ...fur(shade(coat, 0.75)), flatShading: true }, { geometry: { detail: 1, bevel: 0.12, seed: (spec.seed + 4) % 50 }, collidable: false })
  k.joint('j_neck', 'j_body', 'Pescoço (articulação)', [0, 0.12, 0.55], [55, 0, 0])
  k.mesh('neck', 'j_neck', 'Pescoço', 'lathe', [0, 0.14, 0], [0.24, 0.36, 0.27], m, { geometry: { profile: taper(0.85, 1) }, overlapWith: ['ruff'] })
  k.joint('j_head', 'j_neck', 'Cabeça (articulação)', [0, 0.3, 0], [-55, 0, 0])
  k.mesh('skull', 'j_head', 'Cabeça do lobo', 'sphere', [0, 0.02, 0.03], [0.28, 0.24, 0.3], m, { geometry: { segments: 16 }, overlapWith: ['neck'] })
  k.mesh('snout', 'j_head', 'Focinho', 'lathe', [0, -0.03, 0.25], [0.14, 0.26, 0.13], pale, { rotation: [90, 0, 0], geometry: { profile: SNOUT } })
  k.mesh('nose', 'j_head', 'Trufa', 'sphere', [0, -0.0, 0.385], [0.06, 0.045, 0.05], { color: '#1a1716', roughness: 0.25, metalness: 0, clearcoat: 0.8 }, { geometry: { segments: 10 }, collidable: false })
  k.joint('j_jaw', 'j_head', 'Mandíbula (articulação)', [0, -0.07, 0.12], [6, 0, 0])
  k.mesh('jaw', 'j_jaw', 'Mandíbula', 'lathe', [0, -0.01, 0.1], [0.11, 0.21, 0.06], pale, { rotation: [90, 0, 0], geometry: { profile: SNOUT, segments: 10 } })
  for (const [side, s, label] of sides) {
    k.mesh(`fang${s}`, 'j_head', 'Presa', 'cone', [side * 0.035, -0.085, 0.31], [0.02, 0.045, 0.02], boneMat('#f2ead8'), { rotation: [180, 0, 0], geometry: { segments: 8 }, collidable: false })
    k.mesh(`ear${s}`, 'j_head', `Orelha (${label})`, 'cone', [side * 0.085, 0.17, -0.02], [0.08, 0.15, 0.05], m, { rotation: [-12, 0, -side * 14], geometry: { segments: 8 }, collidable: false })
    k.mesh(`eye${s}`, 'j_head', `Olho (${label})`, 'sphere', [side * 0.075, 0.05, 0.16], [0.045, 0.032, 0.03], glow('#ffb43a', 1.6), { rotation: [0, side * 25, 0], geometry: { segments: 10 }, collidable: false })
    k.mesh(`cheek${s}`, 'j_head', 'Bochecha peluda', 'polyhedron', [side * 0.12, -0.04, 0.0], [0.1, 0.14, 0.14], { ...pale, flatShading: true }, { geometry: { detail: 0, bevel: 0.1, seed: 2 + side }, collidable: false })
  }
  const legs = (anchor: V, upper: number, widths: [number, number]): LegSpec => ({ anchor, upper, widths, foot: 0.07, mats: [m, m, fur(shade(coat, 0.7))] })
  for (const [side, s] of sides) {
    quadLeg(k, `F${s}`, bodyY, legs([side * 0.13, -0.04, 0.36], 0.32, [0.14, 0.09]))
    quadLeg(k, `B${s}`, bodyY, legs([side * 0.13, -0.02, -0.4], 0.34, [0.2, 0.09]))
  }
  k.joint('j_tail', 'j_body', 'Cauda (articulação)', [0, 0.12, -0.56], [-120, 0, 0])
  k.mesh('tail', 'j_tail', 'Cauda', 'lathe', [0, 0.24, 0], [0.13, 0.5, 0.15], m, { geometry: { profile: [[0, 0], [0.7, 0.05], [1, 0.45], [0.8, 0.85], [0, 1]] } })
  k.mesh('tailTip', 'j_tail', 'Ponta da cauda', 'sphere', [0, 0.47, 0], [0.08, 0.12, 0.09], pale, { geometry: { segments: 10 }, collidable: false })
}

function deer(k: Kit, spec: PrefabSpec) {
  const coat = spec.primary ?? k.pick(['#a0714a', '#8a5e3c', '#b38458'], 1), belly = spec.secondary ?? '#eadfcb', m = fur(coat), pale = fur(belly), antler = boneMat('#d9c6a2'), bodyY = 0.98
  k.joint('j_body', null, 'Corpo (articulação)', [0, bodyY, 0])
  k.mesh('body', 'j_body', 'Corpo do cervo', 'lathe', [0, 0.02, 0], [0.36, 1.05, 0.42], m, { rotation: [90, 0, 0], geometry: { profile: [[0, 0], [0.55, 0.03], [0.85, 0.15], [0.9, 0.45], [0.95, 0.7], [1, 0.82], [0.75, 0.96], [0, 1]], segments: 16 } })
  k.mesh('belly', 'j_body', 'Ventre claro', 'sphere', [0, -0.1, 0.05], [0.26, 0.2, 0.7], pale, { geometry: { segments: 12 }, collidable: false })
  k.mesh('rump', 'j_body', 'Garupa clara', 'sphere', [0, 0.06, -0.47], [0.24, 0.24, 0.1], pale, { geometry: { segments: 10 }, collidable: false })
  k.joint('j_neck', 'j_body', 'Pescoço (articulação)', [0, 0.08, 0.42], [35, 0, 0])
  k.mesh('neck', 'j_neck', 'Pescoço', 'lathe', [0, 0.22, 0], [0.18, 0.5, 0.21], m, { geometry: { profile: taper(0.75, 1) }, overlapWith: ['body'] })
  k.mesh('throat', 'j_neck', 'Garganta clara', 'sphere', [0, 0.12, 0.07], [0.12, 0.3, 0.1], pale, { geometry: { segments: 10 }, collidable: false })
  k.joint('j_head', 'j_neck', 'Cabeça (articulação)', [0, 0.45, 0], [-45, 0, 0])
  k.mesh('skull', 'j_head', 'Cabeça do cervo', 'sphere', [0, 0.03, 0.02], [0.18, 0.18, 0.22], m, { geometry: { segments: 14 }, overlapWith: ['neck'] })
  k.mesh('snout', 'j_head', 'Focinho', 'lathe', [0, -0.02, 0.18], [0.1, 0.22, 0.11], m, { rotation: [100, 0, 0], geometry: { profile: SNOUT } })
  k.mesh('nose', 'j_head', 'Focinho escuro', 'sphere', [0, -0.03, 0.29], [0.06, 0.045, 0.04], { color: '#1a1716', roughness: 0.25, metalness: 0, clearcoat: 0.8 }, { geometry: { segments: 10 }, collidable: false })
  for (const [side, s, label] of sides) {
    k.mesh(`eye${s}`, 'j_head', `Olho (${label})`, 'sphere', [side * 0.07, 0.05, 0.07], [0.04, 0.045, 0.045], { color: '#1a120c', roughness: 0.1, metalness: 0, clearcoat: 1 }, { geometry: { segments: 10 }, collidable: false })
    k.mesh(`ear${s}`, 'j_head', `Orelha (${label})`, 'sphere', [side * 0.13, 0.12, -0.04], [0.15, 0.06, 0.08], m, { rotation: [0, side * 20, side * 30], geometry: { segments: 10 }, collidable: false })
    if (spec.seed % 4 !== 3) {
      k.mesh(`antler${s}`, 'j_head', `Galhada (${label})`, 'tube', [side * 0.16, 0.36, -0.08], [0.24, 0.48, 0.24], antler, { geometry: { points: [[-0.5, -0.5, 0.2], [-0.1, -0.1, 0.05], [0.25, 0.2, -0.2], [0.45, 0.5, 0.1]].map(([x, y, z]) => [x * side, y, z]) as V[], radius: 0.05, segments: 8 }, overlapWith: ['skull'] })
      for (let i = 0; i < 2 + (spec.seed % 2); i++) k.mesh(`tine${s}${i}`, 'j_head', 'Ponta da galhada', 'cone', [side * (0.11 + i * 0.05), 0.3 + i * 0.1, 0.0 - i * 0.05], [0.03, 0.14, 0.03], antler, { rotation: [20, 0, -side * 15], geometry: { segments: 8 }, collidable: false })
    }
  }
  const legs = (anchor: V, upper: number, widths: [number, number]): LegSpec => ({ anchor, upper, widths, foot: 0.07, hoof: true, mats: [m, m, plain('#2a211b', 0.4)] })
  for (const [side, s] of sides) {
    quadLeg(k, `F${s}`, bodyY, legs([side * 0.11, -0.08, 0.36], 0.4, [0.11, 0.055]))
    quadLeg(k, `B${s}`, bodyY, legs([side * 0.11, -0.05, -0.38], 0.42, [0.15, 0.06]))
  }
  k.joint('j_tail', 'j_body', 'Cauda (articulação)', [0, 0.12, -0.52], [-30, 0, 0])
  k.mesh('tail', 'j_tail', 'Cauda', 'sphere', [0, 0.06, 0], [0.08, 0.14, 0.06], pale, { geometry: { segments: 10 }, collidable: false })
}

function spider(k: Kit, spec: PrefabSpec) {
  const chitin = fur(spec.primary ?? k.pick(['#2b2324', '#3a2f22', '#25262e'], 1)), mark = spec.secondary ?? k.pick(['#c0392b', '#e0a030', '#8a3ad0'], 2), eye = glow('#ff3b30', 2.5)
  const glossy: Mat = { ...chitin, clearcoat: 0.7, roughness: 0.5 }, bodyY = 0.48
  k.joint('j_body', null, 'Corpo (articulação)', [0, bodyY, 0])
  k.mesh('cephalothorax', 'j_body', 'Cefalotórax', 'sphere', [0, 0.02, 0.16], [0.42, 0.24, 0.46], glossy, { geometry: { segments: 16 } })
  k.mesh('carapace', 'j_body', 'Desenho da carapaça', 'sphere', [0, 0.11, 0.14], [0.24, 0.06, 0.28], { ...fur(mark), emissive: mark, emissiveIntensity: 0.25 }, { geometry: { segments: 12 }, collidable: false })
  k.mesh('pedicel', 'j_body', 'Pedicelo', 'sphere', [0, 0.04, -0.1], [0.14, 0.12, 0.14], chitin, { geometry: { segments: 10 } })
  k.mesh('abdomen', 'j_body', 'Abdômen', 'sphere', [0, 0.14, -0.44], [0.66, 0.54, 0.78], glossy, { rotation: [-12, 0, 0], geometry: { segments: 18 } })
  for (let i = 0; i < 2; i++) k.mesh(`marking${i}`, 'j_body', 'Marca do abdômen', 'sphere', [0, 0.38 - i * 0.07, -0.36 - i * 0.2], [0.16 - i * 0.04, 0.05, 0.16 - i * 0.03], { ...glow(mark, 0.8), roughness: 0.4 }, { rotation: [-15 - i * 20, 0, 0], geometry: { segments: 10 }, collidable: false })
  k.mesh('spinneret', 'j_body', 'Fiandeira', 'cone', [0, 0.08, -0.84], [0.08, 0.1, 0.08], chitin, { rotation: [-100, 0, 0], geometry: { segments: 8 }, collidable: false })
  for (const [side, s, label] of sides) {
    k.mesh(`eyeBig${s}`, 'j_body', `Olho principal (${label})`, 'sphere', [side * 0.045, 0.08, 0.37], [0.06, 0.06, 0.05], eye, { geometry: { segments: 10 }, collidable: false })
    k.mesh(`eyeSide${s}`, 'j_body', 'Olho lateral', 'sphere', [side * 0.1, 0.09, 0.33], [0.04, 0.04, 0.035], eye, { geometry: { segments: 8 }, collidable: false })
    for (let i = 0; i < 2; i++) k.mesh(`eyeTop${s}${i}`, 'j_body', 'Olho dorsal', 'sphere', [side * (0.03 + i * 0.045), 0.125, 0.315 - i * 0.03], [0.028, 0.028, 0.028], eye, { geometry: { segments: 8 }, collidable: false })
    k.bone(`chelicera${s}`, 'j_body', `Quelícera (${label})`, [side * 0.05, -0.02, 0.33], [side * 0.045, -0.15, 0.4], 0.07, glossy)
    k.mesh(`fang${s}`, 'j_body', `Presa (${label})`, 'cone', [side * 0.045, -0.2, 0.41], [0.035, 0.08, 0.035], { color: '#120e0e', roughness: 0.2, metalness: 0.2, clearcoat: 1 }, { rotation: [190, 0, 0], geometry: { segments: 8 }, collidable: false })
    k.bone(`palp${s}`, 'j_body', `Pedipalpo (${label})`, [side * 0.11, -0.01, 0.3], [side * 0.16, -0.12, 0.46], 0.045, chitin, { collidable: false, geometry: { segments: 8 } })
  }
  const spread = [52, 20, -12, -42], zs = [0.28, 0.21, 0.13, 0.05], femur = [0.36, 0.32, 0.3, 0.36], tibia = [0.42, 0.32, 0.3, 0.42]
  for (const [side, , , label] of sides) for (let i = 0; i < 4; i++) {
    const n = side > 0 ? i : 4 + i, leg = `j_leg${n}`, knee = `j_knee${n}`, top: V = [femur[i], 0.24, 0]
    k.joint(leg, 'j_body', `Pata ${i + 1} ${label} (articulação)`, [side * 0.17, 0.0, zs[i]], [0, side > 0 ? -spread[i] : 180 + spread[i], 0])
    k.mesh(`coxa${n}`, leg, 'Coxa da pata', 'sphere', [0.02, 0, 0], [0.08, 0.08, 0.08], chitin, { geometry: { segments: 8 }, overlapWith: ['cephalothorax'] })
    k.bone(`femur${n}`, leg, `Fêmur da pata ${i + 1}`, [0, 0, 0], top, 0.07, chitin, { extend: 0.04, geometry: { segments: 8 } })
    k.joint(knee, leg, `Joelho da pata ${i + 1} (articulação)`, top)
    k.mesh(`kneeBall${n}`, knee, 'Articulação da pata', 'sphere', [0, 0, 0], [0.065, 0.065, 0.065], glossy, { geometry: { segments: 8 }, collidable: false })
    k.bone(`tibia${n}`, knee, `Tíbia da pata ${i + 1}`, [0, 0, 0], [tibia[i], -0.72, 0], 0.055, chitin, { profile: taper(0.25, 1), geometry: { segments: 8 } })
    k.bone(`band${n}`, knee, 'Faixa da pata', [tibia[i] * 0.18, -0.13, 0], [tibia[i] * 0.24, -0.173, 0], 0.06, fur(mark), { profile: [[0, 0], [1, 0.05], [1, 0.95], [0, 1]], collidable: false, geometry: { segments: 8 } })
  }
}

function drone(k: Kit, spec: PrefabSpec) {
  const hull = metal(spec.primary ?? '#3c4650', 0.35), accent = spec.secondary ?? '#ff5a3a', dark = metal('#1e2328', 0.5), bodyY = 1.3
  k.joint('j_body', null, 'Corpo (articulação)', [0, bodyY, 0])
  k.mesh('hull', 'j_body', 'Casco do drone', 'lathe', [0, 0, 0], [0.7, 0.3, 0.7], hull, { geometry: { profile: [[0, 0], [0.5, 0.05], [0.9, 0.3], [1, 0.5], [0.85, 0.75], [0.45, 0.95], [0, 1]], segments: 20 } })
  k.mesh('dome', 'j_body', 'Cúpula', 'sphere', [0, 0.13, -0.02], [0.34, 0.16, 0.34], { color: '#141a20', metalness: 0.6, roughness: 0.1, clearcoat: 1 }, { geometry: { segments: 16 }, overlapWith: ['hull'] })
  k.mesh('band', 'j_body', 'Faixa sinalizadora', 'lathe', [0, 0.0, 0], [0.712, 0.035, 0.712], { ...glow(accent, 0.8), metalness: 0.3 }, { geometry: { profile: [[0.97, 0], [1, 0.5], [0.97, 1]], segments: 20 }, collidable: false })
  k.mesh('eyeHousing', 'j_body', 'Alojamento do sensor', 'cylinder', [0, -0.02, 0.32], [0.17, 0.08, 0.17], dark, { rotation: [90, 0, 0], geometry: { segments: 14 }, overlapWith: ['hull'] })
  k.mesh('eye', 'j_body', 'Sensor óptico', 'sphere', [0, -0.02, 0.365], [0.12, 0.12, 0.05], glow('#ff2a1a', 3.5), { geometry: { segments: 12 }, collidable: false })
  k.mesh('turret', 'j_body', 'Torreta', 'sphere', [0, -0.16, 0.06], [0.17, 0.12, 0.17], dark, { geometry: { segments: 12 }, overlapWith: ['hull'] })
  for (const side of [1, -1]) k.mesh(`barrel${side > 0 ? 'L' : 'R'}`, 'j_body', 'Cano do canhão', 'cylinder', [side * 0.035, -0.18, 0.25], [0.035, 0.28, 0.035], dark, { rotation: [90, 0, 0], geometry: { segments: 8 } })
  k.mesh('thruster', 'j_body', 'Propulsor ventral', 'cylinder', [0, -0.152, -0.12], [0.14, 0.012, 0.14], glow('#6ad8ff', 2), { geometry: { segments: 14 }, collidable: false })
  k.mesh('antenna', 'j_body', 'Antena', 'cylinder', [0.1, 0.25, -0.12], [0.012, 0.18, 0.012], dark, { geometry: { segments: 8 }, collidable: false })
  k.mesh('antennaTip', 'j_body', 'Luz da antena', 'sphere', [0.1, 0.345, -0.12], [0.028, 0.028, 0.028], glow(accent, 3), { geometry: { segments: 8 }, collidable: false })
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + i * Math.PI / 2, c = Math.cos(a), s = Math.sin(a), rotor = `j_rotor${i}`, spin = `spin${i}`
    k.bone(`arm${i}`, 'j_body', 'Braço do rotor', [c * 0.27, 0.03, s * 0.27], [c * 0.45, 0.05, s * 0.45], 0.05, hull, { profile: [[0, 0], [1, 0.05], [1, 0.95], [0, 1]], geometry: { segments: 8 }, overlapWith: ['hull'] })
    k.joint(rotor, 'j_body', `Rotor ${i + 1} (articulação)`, [c * 0.62, 0.06, s * 0.62])
    k.mesh(`housing${i}`, rotor, 'Carenagem do rotor', 'lathe', [0, 0, 0], [0.44, 0.06, 0.44], hull, { geometry: { profile: RING, closed: true, segments: 20 }, overlapWith: [`arm${i}`] })
    k.mesh(`motor${i}`, rotor, 'Motor', 'cylinder', [0, -0.015, 0], [0.07, 0.07, 0.07], dark, { geometry: { segments: 10 }, overlapWith: [`arm${i}`] })
    k.joint(spin, rotor, 'Hélice (giro)', [0, 0.045, 0], undefined, { animation: { kind: 'spin', axis: 'y', duration: 0.35 + i * 0.02, amplitude: 0, phase: i * 40, start: 'auto', easing: 'linear', keys: [] } })
    k.mesh(`hub${i}`, spin, 'Cubo da hélice', 'cylinder', [0, 0, 0], [0.05, 0.03, 0.05], dark, { geometry: { segments: 8 }, collidable: false })
    for (const turn of [0, 90]) k.mesh(`blade${i}${turn}`, spin, 'Pá da hélice', 'box', [0, 0, 0], [0.34, 0.008, 0.035], { color: '#cfd5da', metalness: 0.3, roughness: 0.4, opacity: 0.85, transparent: true }, { rotation: [0, turn, 0], collidable: false })
  }
  if (spec.lit) k.parts.push({ id: 'light', parentId: 'j_body', name: 'Luz do sensor', kind: 'light', position: [0, -0.02, 0.6], dimensions: [0.1, 0.1, 0.1], light: pointLight('#ff3a2a', 2.5, 6) })
}

function dragon(k: Kit, spec: PrefabSpec) {
  const hide = spec.primary ?? k.pick(['#8a2a22', '#2f5a3a', '#2a3f6e', '#3b3340'], 1), membraneColor = spec.secondary ?? shade(hide, 0.7), body = scaly(hide), belly = scaly('#d8b67a')
  const horn = boneMat('#e8dcc0'), claw = { color: '#1c1816', roughness: 0.3, metalness: 0.1, clearcoat: 0.8 }, eye = glow('#ffd23a', 3), bodyY = 1.3
  const membrane: Mat = { color: membraneColor, roughness: 0.65, metalness: 0, sheen: 0.4, doubleSided: true, transmission: 0 }
  k.joint('j_body', null, 'Corpo (articulação)', [0, bodyY, 0])
  k.mesh('body', 'j_body', 'Corpo do dragão', 'lathe', [0, 0, 0], [1.2, 2.6, 1.25], body, { rotation: [90, 0, 0], geometry: { profile: [[0, 0], [0.4, 0.04], [0.75, 0.2], [0.95, 0.45], [1, 0.62], [0.88, 0.82], [0.55, 0.96], [0, 1]], segments: 20 } })
  k.mesh('belly', 'j_body', 'Ventre escamado', 'sphere', [0, -0.3, 0.1], [0.85, 0.6, 2.0], belly, { geometry: { segments: 16 }, collidable: false })
  for (let i = 0; i < 5; i++) k.mesh(`spike${i}`, 'j_body', 'Espinho dorsal', 'cone', [0, 0.6 - Math.abs(i - 1.5) * 0.04, 0.9 - i * 0.42], [0.14, 0.3 - Math.abs(i - 2) * 0.04, 0.22], horn, { rotation: [-25, 0, 0], geometry: { segments: 8 }, collidable: false })
  k.joint('j_neck', 'j_body', 'Pescoço (articulação)', [0, 0.3, 1.05], [32, 0, 0])
  k.mesh('neck', 'j_neck', 'Pescoço', 'lathe', [0, 0.6, 0], [0.58, 1.35, 0.62], body, { geometry: { profile: taper(0.65, 1), segments: 16 }, overlapWith: ['body'] })
  k.mesh('neckBelly', 'j_neck', 'Placas do pescoço', 'capsule', [0, 0.55, 0.16], [0.3, 1.15, 0.24], belly, { geometry: { segments: 10 }, collidable: false })
  for (let i = 0; i < 3; i++) k.mesh(`neckSpike${i}`, 'j_neck', 'Espinho do pescoço', 'cone', [0, 0.3 + i * 0.35, -0.24], [0.08, 0.2, 0.14], horn, { rotation: [-60, 0, 0], geometry: { segments: 8 }, collidable: false })
  k.joint('j_head', 'j_neck', 'Cabeça (articulação)', [0, 1.25, 0], [-42, 0, 0])
  k.mesh('skull', 'j_head', 'Crânio do dragão', 'lathe', [0, 0.05, 0.28], [0.5, 0.95, 0.42], body, { rotation: [90, 0, 0], geometry: { profile: [[0, 0], [0.8, 0.06], [1, 0.3], [0.85, 0.6], [0.6, 0.85], [0.45, 0.97], [0, 1]], segments: 16 }, overlapWith: ['neck'] })
  k.joint('j_jaw', 'j_head', 'Mandíbula (articulação)', [0, -0.1, 0.05], [4, 0, 0])
  k.mesh('jaw', 'j_jaw', 'Mandíbula', 'lathe', [0, -0.04, 0.34], [0.36, 0.72, 0.15], belly, { rotation: [90, 0, 0], geometry: { profile: [[0, 0], [0.8, 0.05], [1, 0.3], [0.7, 0.8], [0.4, 0.97], [0, 1]], segments: 12 } })
  for (const [side, s, label] of sides) {
    k.mesh(`eye${s}`, 'j_head', `Olho (${label})`, 'sphere', [side * 0.17, 0.17, 0.3], [0.07, 0.05, 0.09], eye, { rotation: [0, side * 30, 0], geometry: { segments: 10 }, collidable: false })
    k.mesh(`brow${s}`, 'j_head', 'Arcada escamada', 'cone', [side * 0.16, 0.22, 0.27], [0.08, 0.22, 0.08], body, { rotation: [80, 0, side * -10], geometry: { segments: 8 }, collidable: false })
    k.mesh(`horn${s}`, 'j_head', `Chifre (${label})`, 'cone', [side * 0.15, 0.32, -0.12], [0.1, 0.55, 0.12], horn, { rotation: [-62, 0, -side * 12], geometry: { segments: 10 }, collidable: false })
    k.mesh(`hornSmall${s}`, 'j_head', 'Chifre menor', 'cone', [side * 0.23, 0.1, -0.05], [0.06, 0.28, 0.07], horn, { rotation: [-70, 0, -side * 40], geometry: { segments: 8 }, collidable: false })
    k.mesh(`nostril${s}`, 'j_head', 'Narina', 'sphere', [side * 0.07, 0.07, 0.74], [0.05, 0.035, 0.04], spec.lit ? glow('#ff7a2a', 2) : darkMat, { geometry: { segments: 8 }, collidable: false })
    for (let i = 0; i < 3; i++) k.mesh(`tooth${s}${i}`, 'j_head', 'Dente', 'cone', [side * (0.13 - i * 0.03), -0.09, 0.4 + i * 0.12], [0.035, 0.08, 0.035], horn, { rotation: [180, 0, 0], geometry: { segments: 8 }, collidable: false })
  }
  for (const [side, s, label] of sides) {
    const wing = `j_wing${s}`, p = (x: number, z: number): V => [side * x, 0.02, z]
    k.joint(wing, 'j_body', `Asa ${label === 'esquerdo' ? 'esquerda' : 'direita'} (articulação)`, [side * 0.42, 0.45, 0.45], [0, 0, side * 15])
    k.mesh(`wingRoot${s}`, wing, 'Raiz da asa', 'sphere', [side * 0.05, 0, 0], [0.26, 0.22, 0.3], body, { geometry: { segments: 10 }, overlapWith: ['body'] })
    k.bone(`humerus${s}`, wing, 'Úmero da asa', p(0, 0.05), p(0.9, 0.38), 0.13, body, { geometry: { segments: 10 } })
    k.bone(`radius${s}`, wing, 'Antebraço da asa', p(0.9, 0.38), p(2.0, 0.12), 0.1, body, { geometry: { segments: 10 } })
    k.mesh(`wingClaw${s}`, wing, 'Garra da asa', 'cone', p(2.02, 0.22), [0.06, 0.2, 0.06], horn, { rotation: [80, 0, 0], geometry: { segments: 8 }, collidable: false })
    for (const [i, [x, z]] of ([[3.0, -0.3], [2.5, -1.1], [1.6, -1.4]] as const).entries()) k.bone(`finger${s}${i}`, wing, 'Dedo da asa', p(2.0, 0.12), p(x, z), 0.06, body, { profile: taper(0.3, 1), geometry: { segments: 8 }, collidable: false })
    const outline: Point2[] = [[0, 0.2], [0.9, 0.38], [2.0, 0.12], [3.0, -0.3], [2.45, -0.55], [2.5, -1.1], [1.85, -0.95], [1.6, -1.4], [0.9, -1.0], [0.2, -0.7], [0, -0.4]]
    k.mesh(`membrane${s}`, wing, `Membrana da asa (${label === 'esquerdo' ? 'esquerda' : 'direita'})`, 'extrude', [side * 1.5, 0, -0.51], [3.0, 1.78, 0.03], membrane,
      { rotation: [90, 0, 0], geometry: { profile: (side > 0 ? outline : [...outline].reverse()).map(([x, z]) => [side * x, z]), bevel: 0 } })
  }
  k.joint('j_tail', 'j_body', 'Cauda (articulação)', [0, 0.1, -1.2], [-100, 0, 0])
  k.mesh('tail', 'j_tail', 'Cauda', 'lathe', [0, 0.6, 0], [0.5, 1.3, 0.5], body, { geometry: { profile: taper(0.55, 1), segments: 14 }, overlapWith: ['body'] })
  k.joint('j_tail2', 'j_tail', 'Ponta da cauda (articulação)', [0, 1.18, 0], [10, 0, 0])
  k.mesh('tail2', 'j_tail2', 'Cauda distal', 'lathe', [0, 0.55, 0], [0.3, 1.2, 0.3], body, { geometry: { profile: taper(0.3, 1), segments: 12 }, overlapWith: ['tail'] })
  k.mesh('tailSpade', 'j_tail2', 'Ponta em lança', 'extrude', [0, 1.2, 0], [0.4, 0.42, 0.04], horn, { geometry: { profile: [[0, -0.5], [0.5, 0], [0, 0.5], [-0.5, 0]], bevel: 0.02 }, collidable: false })
  for (let i = 0; i < 3; i++) k.mesh(`tailSpike${i}`, 'j_tail', 'Espinho da cauda', 'cone', [0, 0.25 + i * 0.35, 0.22 - i * 0.03], [0.08, 0.2, 0.12], horn, { rotation: [55, 0, 0], geometry: { segments: 8 }, collidable: false })
  for (const [side, s] of sides) {
    const leg = (id: 'F' | 'B') => {
      const front = id === 'F', joint = `j_leg${id}${s}`, knee = `j_knee${id}${s}`, upper = front ? 0.55 : 0.58, anchorY = front ? -0.22 : -0.15, kneeY = bodyY + anchorY - upper, footH = front ? 0.14 : 0.16
      k.joint(joint, 'j_body', `Pata ${front ? 'dianteira' : 'traseira'} (articulação)`, [side * (front ? 0.4 : 0.42), anchorY, front ? 0.75 : -0.7])
      k.mesh(`upper${id}${s}`, joint, front ? 'Braço do dragão' : 'Coxa do dragão', 'lathe', [0, -upper / 2 + 0.05, front ? 0 : 0.05], front ? [0.36, 0.68, 0.4] : [0.55, 0.78, 0.66], body, { geometry: { profile: taper(0.65, 1) }, overlapWith: ['body'] })
      k.joint(knee, joint, `Joelho ${front ? 'dianteiro' : 'traseiro'} (articulação)`, [0, -upper, front ? 0 : 0.08])
      k.mesh(`lower${id}${s}`, knee, 'Canela do dragão', 'lathe', [0, -(kneeY - footH) / 2, -0.02], [front ? 0.24 : 0.3, kneeY - footH + 0.06, front ? 0.27 : 0.33], body, { geometry: { profile: taper(0.75, 1) } })
      k.mesh(`foot${id}${s}`, knee, 'Pé do dragão', 'sphere', [0, -kneeY + footH / 2, 0.08], [front ? 0.3 : 0.36, footH, front ? 0.42 : 0.5], body, { geometry: { segments: 12 } })
      for (let i = 0; i < 3; i++) k.mesh(`claw${id}${s}${i}`, knee, 'Garra', 'cone', [(i - 1) * 0.09, -kneeY + 0.05, front ? 0.31 : 0.36], [0.05, 0.12, 0.05], claw, { rotation: [100, 0, 0], geometry: { segments: 8 }, collidable: false })
    }
    leg('F'); leg('B')
  }
  if (spec.lit) k.parts.push({ id: 'light', parentId: 'j_head', name: 'Brasa da garganta', kind: 'light', position: [0, -0.05, 0.6], dimensions: [0.1, 0.1, 0.1], light: pointLight('#ff7a2a', 6, 8) })
}

export function buildCharacter(spec: PrefabSpec): PrefabPart[] {
  const k = kit(spec.seed)
  switch (spec.type as CharacterType) {
    case 'villager': villager(k, spec); break
    case 'knight': knight(k, spec); break
    case 'wizard': wizard(k, spec); break
    case 'astronaut': astronaut(k, spec); break
    case 'goblin': return goblin(k, spec)
    case 'skeleton': skeleton(k, spec); break
    case 'orc': return orc(k, spec)
    case 'golem': return golem(k, spec)
    case 'wolf': wolf(k, spec); break
    case 'deer': deer(k, spec); break
    case 'spider': spider(k, spec); break
    case 'drone': drone(k, spec); break
    case 'dragon': dragon(k, spec); break
  }
  return k.parts
}
/** Third-person player avatar: about 1.75 m, origin at the feet, facing +Z, rigged as a biped. */
export function buildAvatar(kind: AvatarKind): PrefabPart[] {
  const spec = (type: CharacterType): PrefabSpec => ({ type, size: 1, seed: 0, primary: null, secondary: null, text: '', lit: false, interactive: false })
  const k = kit(7)
  if (kind === 'robot') { robot(k); return k.parts }
  if (kind === 'explorer') { villager(k, spec('villager'), true); return k.parts }
  return buildCharacter(spec(kind))
}
