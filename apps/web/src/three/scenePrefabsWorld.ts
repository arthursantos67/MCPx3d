import type { PrefabPart, PrefabSpec } from './scenePrefabs.ts'
import type { NodeKind, PowerKind, SceneAnimation, SceneBehavior, SceneInteraction, SceneLight, SceneMaterial, SceneSound, SoundPreset, Vector3Tuple } from './sceneDocument.ts'
import { hashNoise } from './sceneGeometrySpec.ts'

export const worldPrefabTypes = ['castleWall', 'castleTower', 'gate', 'fountain', 'statue', 'marketStall', 'cart', 'haystack', 'chest', 'lever', 'banner', 'tombstone', 'ruinArch',
  'dock', 'lighthouse', 'container', 'console', 'reactor', 'radarDish', 'turret', 'movingPlatform', 'jumpPad', 'heart', 'key', 'powerOrb'] as const
export type WorldPrefabType = typeof worldPrefabTypes[number]
export const worldPrefabLabels: Record<WorldPrefabType, string> = { castleWall: 'Muralha de castelo (6 m)', castleTower: 'Torre de castelo', gate: 'Portão (abre com chave opcional)', fountain: 'Chafariz',
  statue: 'Estátua', marketStall: 'Barraca de feira', cart: 'Carroça', haystack: 'Monte de feno', chest: 'Baú de tesouro', lever: 'Alavanca', banner: 'Estandarte', tombstone: 'Lápide',
  ruinArch: 'Arco em ruínas', dock: 'Píer', lighthouse: 'Farol', container: 'Contêiner de carga', console: 'Console de controle', reactor: 'Reator de energia', radarDish: 'Antena radar',
  turret: 'Torreta (inimigo fixo)', movingPlatform: 'Plataforma móvel', jumpPad: 'Plataforma de salto', heart: 'Coração (cura)', key: 'Chave (item)', powerOrb: 'Orbe de poder' }
export const worldStructurePrefabs: readonly WorldPrefabType[] = ['castleWall', 'castleTower', 'gate', 'fountain', 'statue', 'marketStall', 'ruinArch', 'dock', 'lighthouse', 'container', 'reactor', 'radarDish']
export const worldNaturalPrefabs: readonly WorldPrefabType[] = ['haystack', 'tombstone', 'banner', 'heart', 'key', 'powerOrb', 'lever']

const powers: readonly PowerKind[] = ['speed', 'jump', 'shield', 'strength']
const powerColors: Record<PowerKind, string> = { speed: '#ffd23f', jump: '#4dff88', shield: '#4fb8ff', strength: '#ff5a3c' }
const powerNames: Record<PowerKind, string> = { speed: 'velocidade', jump: 'super pulo', shield: 'escudo', strength: 'força' }
/** Power granted by a powerOrb: the text when it names a power, otherwise chosen by seed. */
export function orbPower(spec: Pick<PrefabSpec, 'text' | 'seed'>): PowerKind {
  const named = spec.text.trim().toLowerCase()
  return powers.find((power) => power === named) ?? powers[spec.seed % powers.length]
}

export function worldPrefabBehavior(spec: PrefabSpec): SceneBehavior | null {
  if (spec.type === 'turret') return { type: 'enemy', speed: 0, range: Math.min(80, 18 * spec.size), damage: 15, health: 4, attack: 'ranged' }
  if (spec.type === 'jumpPad') return { type: 'launcher', speed: 0, range: Math.min(80, Math.max(0.5, 6 * spec.size)), damage: 0 }
  return null
}

type Pt = [number, number]
type Material = Partial<SceneMaterial>
type Extra = Partial<Omit<PrefabPart, 'id' | 'name' | 'kind' | 'position' | 'dimensions' | 'material'>>
const round = (value: number) => Math.round(value * 1e5) / 1e5
const rad = (deg: number) => deg * Math.PI / 180
const ellipse = (cx: number, cy: number, rx: number, ry: number, from: number, to: number, steps: number): Pt[] =>
  Array.from({ length: steps + 1 }, (_, i) => { const a = rad(from + (to - from) * i / steps); return [round(cx + Math.cos(a) * rx), round(cy + Math.sin(a) * ry)] })
const arc = (cx: number, cy: number, r: number, from: number, to: number, steps: number) => ellipse(cx, cy, r, r, from, to, steps)
const circle = (r: number, steps: number): Pt[] => arc(0, 0, r, 0, 360 - 360 / steps, steps - 1)
const extent = (points: Pt[]) => {
  const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys)
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 }
}
/** Yaw that turns a part's local +Z towards the horizontal direction at `angle` radians in the XZ plane. */
const yaw = (angle: number) => round(Math.atan2(Math.cos(angle), Math.sin(angle)) * 180 / Math.PI)
const loop = (kind: SceneAnimation['kind'], axis: 'x' | 'y' | 'z', duration: number, amplitude: number, phase = 0): Partial<SceneAnimation> =>
  ({ kind, axis, duration, amplitude, phase: round(((phase % 360) + 360) % 360), start: 'auto', easing: 'smooth', keys: [] })
const still: Vector3Tuple = [0, 0, 0], unit: Vector3Tuple = [1, 1, 1]
const opening = (turn: Vector3Tuple, duration: number): Partial<SceneAnimation> =>
  ({ kind: 'keyframes', axis: 'y', duration, amplitude: 0, phase: 0, start: 'trigger', easing: 'smooth', keys: [{ at: 0, move: still, turn: still, scale: unit }, { at: 1, move: still, turn, scale: unit }] })
const point = (color: string, intensity: number, distance: number): SceneLight => ({ type: 'point', color, intensity, distance, angle: 35, penumbra: 0.4, castShadow: false })
const shade = (hex: string, factor: number) => '#' + [1, 3, 5].map((i) => Math.max(0, Math.min(255, Math.round(parseInt(hex.slice(i, i + 2), 16) * factor))).toString(16).padStart(2, '0')).join('')
const segmentDefaults: Partial<Record<NodeKind, number>> = { sphere: 16, torus: 24, capsule: 12, lathe: 24, cylinder: 20, cone: 16, tube: 12 }

const wood: Material = { color: '#b48a62', texture: 'wood', textureScale: 1, roughness: 0.78, metalness: 0 }
const darkWood: Material = { ...wood, color: '#7a5636' }
const iron: Material = { color: '#34383e', metalness: 0.85, roughness: 0.4 }
const darkStone: Material = { color: '#9a958c', texture: 'rock', textureScale: 1.4, roughness: 0.95, metalness: 0 }
const paving: Material = { color: '#a8a296', texture: 'tiles', textureScale: 3, roughness: 0.9, metalness: 0 }
const water: Material = { color: '#5fb3c8', texture: 'water', textureScale: 1, roughness: 0.06, metalness: 0.1, clearcoat: 1, opacity: 0.82, transparent: true }
const glass: Material = { color: '#cfeaff', metalness: 0, roughness: 0.05, transmission: 0.6, ior: 1.45, thickness: 0.1, opacity: 0.4, transparent: true }
const climb: SceneBehavior = { type: 'climbable', speed: 0, range: 1, damage: 0 }
const stone = (color: string): Material => ({ color, texture: 'rock', textureScale: 2, roughness: 0.92, metalness: 0, normalStrength: 1.1 })
const metal = (color: string): Material => ({ color, texture: 'metal', textureScale: 1.5, metalness: 0.7, roughness: 0.38 })
const cloth = (color: string): Material => ({ color, texture: 'fabric', textureScale: 2, sheen: 0.5, roughness: 0.85, metalness: 0, doubleSided: true })
const emissive = (color: string, intensity: number, base = '#ffffff'): Material => ({ color: base, emissive: color, emissiveIntensity: intensity, roughness: 0.35, metalness: 0 })

export function buildWorldPrefab(spec: PrefabSpec): PrefabPart[] {
  const type = spec.type as WorldPrefabType, primary = spec.primary, secondary = spec.secondary, lit = spec.lit, interactive = spec.interactive
  const random = (k: number) => hashNoise(spec.seed, k, 4111)
  const required = spec.text.trim().slice(0, 40)
  const sound = (preset: SoundPreset, volume: number, radius: number): SceneSound => ({ preset, volume, radius: Math.min(200, Math.max(1, round(radius * spec.size))) })
  const parts: PrefabPart[] = []
  const P = (id: string, kind: NodeKind, name: string, position: Vector3Tuple, dimensions: Vector3Tuple, material?: Material, extra: Extra = {}) => {
    parts.push({ id, parentId: null, name, kind, position, dimensions, ...(material ? { material } : {}), ...extra }); return id
  }
  const G = (id: string, name: string, position: Vector3Tuple, extra: Extra = {}) => P(id, 'group', name, position, [1, 1, 1], undefined, extra)
  /** Vertical extrusion of a footprint drawn in world XZ. */
  const prism = (id: string, name: string, profile: Pt[], y0: number, height: number, material: Material, extra: Extra = {}, holes: Pt[][] = []) => {
    const e = extent(profile)
    return P(id, 'extrude', name, [e.cx, y0 + height / 2, e.cy], [e.w, e.h, height], material, { rotation: [90, 0, 0], geometry: { profile, holes, bevel: 0 }, ...extra })
  }
  /** Front elevation drawn in XY and extruded along Z around `z`. */
  const slab = (id: string, name: string, profile: Pt[], z: number, depth: number, material: Material, extra: Extra = {}, holes: Pt[][] = []) => {
    const e = extent(profile)
    return P(id, 'extrude', name, [e.cx, e.cy, z], [e.w, e.h, depth], material, { geometry: { profile, holes, bevel: 0 }, ...extra })
  }
  /** Side elevation drawn in (Z, Y) and extruded along X around `x`. */
  const side = (id: string, name: string, profile: Pt[], x: number, width: number, material: Material, extra: Extra = {}) => {
    const e = extent(profile)
    return P(id, 'extrude', name, [x, e.cy, e.cx], [e.w, e.h, width], material, { rotation: [0, -90, 0], geometry: { profile, bevel: 0 }, ...extra })
  }
  const tube = (id: string, name: string, points: Vector3Tuple[], radius: number, material: Material, extra: Extra = {}) => {
    const center = [0, 1, 2].map((axis) => (Math.min(...points.map((p) => p[axis])) + Math.max(...points.map((p) => p[axis]))) / 2) as Vector3Tuple
    const size = [0, 1, 2].map((axis) => Math.max(...points.map((p) => p[axis])) - Math.min(...points.map((p) => p[axis])) + radius * 2) as Vector3Tuple
    return P(id, 'tube', name, center, size, material, { geometry: { points: points.map((p) => p.map((v, axis) => round(v - center[axis])) as Vector3Tuple), radius, segments: 12 }, ...extra })
  }
  const ladder = (prefix: string, x: number, z: number, y0: number, height: number, rungs: number, parentId: string | null = null) => {
    for (const s of [-1, 1]) P(`${prefix}Rail${s}`, 'box', 'Montante da escada', [x + s * 0.25, y0 + height / 2, z], [0.07, height, 0.07], darkWood, { behavior: climb, parentId })
    for (let i = 0; i < rungs; i++) P(`${prefix}Rung${i}`, 'box', 'Degrau', [x, y0 + 0.35 + i * 0.5, z], [0.56, 0.05, 0.05], darkWood, { behavior: climb, parentId })
  }
  /** Parapet with merlons and arrow slits, as a single extruded elevation. */
  const battlement = (id: string, length: number, y0: number, z: number, depth: number, material: Material) => {
    const gap = 0.5, parapet = 0.9, top = 1.6, count = Math.max(2, Math.round((length + gap) / 1.3)), width = (length - (count - 1) * gap) / count, half = length / 2
    const profile: Pt[] = [[-half, 0], [half, 0], [half, top]]
    for (let i = count - 1; i > 0; i--) { const right = -half + i * (width + gap); profile.push([right, top], [right, parapet], [right - gap, parapet], [right - gap, top]) }
    profile.push([-half, top])
    const holes = Array.from({ length: Math.min(count, 8) }, (_, i): Pt[] => { const c = -half + width / 2 + i * (width + gap); return [[c - 0.05, parapet - 0.3], [c + 0.05, parapet - 0.3], [c + 0.05, top - 0.2], [c - 0.05, top - 0.2]] })
    const lift = (points: Pt[]) => points.map(([x, y]): Pt => [round(x), round(y0 + y)])
    slab(id, 'Ameias com seteiras', lift(profile), z, depth, material, {}, holes.map(lift))
  }
  const sconce = (id: string, x: number, y: number, z: number) => {
    P(`${id}Arm`, 'box', 'Suporte da tocha', [x, y, z + 0.15], [0.07, 0.07, 0.3], iron)
    P(`${id}Cup`, 'cylinder', 'Braseiro', [x, y + 0.08, z + 0.28], [0.18, 0.12, 0.18], iron)
    if (lit) P(`${id}Flame`, 'cone', 'Chama', [x, y + 0.3, z + 0.28], [0.16, 0.3, 0.16], { color: '#ffb347', emissive: '#ff7a1a', emissiveIntensity: 2.5, opacity: 0.9, transparent: true, roughness: 0.5, metalness: 0 },
      { animation: loop('pulse', 'y', 0.5 + random(x * 10 + 3) * 0.3, 0.15, random(x * 10 + 4) * 360), collidable: false })
  }

  switch (type) {
    case 'castleWall': {
      const S = stone(primary ?? '#bdb6aa')
      P('core', 'box', 'Muralha', [0, 2, 0], [6, 4, 1.6], S)
      P('plinth', 'box', 'Embasamento', [0, 0.25, 0], [5.96, 0.7, 1.86], darkStone)
      P('course', 'box', 'Cordão de pedra', [0, 3.55, 0], [5.96, 0.14, 1.76], darkStone)
      P('walk', 'box', 'Adarve (passarela)', [0, 4.05, -0.22], [6, 0.1, 1.16], paving)
      battlement('battlement', 6, 4, 0.58, 0.44, S)
      for (const x of [-1.5, 1.5]) side(`buttress${x}`, 'Contraforte', [[0.7, -0.05], [1.75, -0.05], [1.75, 0.35], [1.2, 2.6], [0.7, 3.1]], x, 0.7, S)
      for (const [i, slot] of [-2.45, -0.45, 0.45, 2.45].entries()) {
        const depth = 0.05 + i * 0.006
        P(`ashlar${i}`, 'box', 'Pedra saliente', [slot + (random(i) - 0.5) * 0.3, 0.9 + random(i + 9) * 2.2, 0.78 + depth / 2], [0.5 + random(i + 20) * 0.2, 0.26, depth], { ...S, color: shade(S.color!, 0.9 + random(i + 30) * 0.15) })
      }
      ladder('ladder', 2.2, -0.98, 0, 4.5, 8)
      sconce('torch', 0, 2.6, 0.8)
      if (lit) P('light', 'light', 'Luz da tocha', [0, 3.2, 1.4], [0.15, 0.15, 0.15], undefined, { light: point('#ff9a4a', 4, 9) })
      break
    }
    case 'castleTower': {
      const S = stone(primary ?? '#b9b3a7'), R = 2.2, r = 1.7, H = 8, roofed = spec.seed % 2 === 0
      const outer = Math.asin(0.6 / R) * 180 / Math.PI, inner = Math.asin(0.6 / r) * 180 / Math.PI
      P('footing', 'cylinder', 'Sapata', [0, 0.05, 0], [5, 0.3, 5], darkStone, { geometry: { segments: 32 } })
      prism('shell', 'Torre circular', [...arc(0, 0, R, 90 + outer, 450 - outer, 28), ...arc(0, 0, r, 450 - inner, 90 + inner, 22)], 0, H, S)
      prism('lintel', 'Verga da porta', [...arc(0, 0, R, 90 - outer, 90 + outer, 3), ...arc(0, 0, r, 90 + inner, 90 - inner, 3)], 2.5, H - 2.5, S)
      const windowMaterial: Material = lit ? emissive('#ffb45a', 1.3, '#3a2a1a') : { color: '#211c18', roughness: 0.6, metalness: 0 }
      for (const [i, [deg, y]] of [[30, 3.4], [150, 4.6], [270, 5.6], [90, 5.4], [210, 6.6]].entries()) {
        const a = rad(deg)
        P(`window${i}`, 'box', 'Janela', [round(Math.cos(a) * 2.17), y, round(Math.sin(a) * 2.17)], [0.38, 0.95, 0.12], windowMaterial, { rotation: [0, yaw(a), 0] })
        P(`sill${i}`, 'box', 'Peitoril', [round(Math.cos(a) * 2.24), y - 0.53, round(Math.sin(a) * 2.24)], [0.56, 0.1, 0.18], darkStone, { rotation: [0, yaw(a), 0] })
      }
      for (let i = 0; i < 12; i++) { const a = rad(i * 30 + 15); P(`corbel${i}`, 'box', 'Mísula', [round(Math.cos(a) * 2.3), 7.8, round(Math.sin(a) * 2.3)], [0.24, 0.32, 0.4], darkStone, { rotation: [0, yaw(a), 0] }) }
      prism('parapet', 'Parapeito', circle(2.55, 28), H, 0.9, S, {}, [circle(2, 24)])
      const flagColor = secondary ?? '#a3212b'
      if (roofed) {
        P('roof', 'cone', 'Telhado cônico', [0, 10.8, 0], [5.6, 3.8, 5.6], { color: '#5a6b82', texture: 'tiles', textureScale: 3, roughness: 0.7, metalness: 0 }, { geometry: { segments: 24 } })
        P('spire', 'cylinder', 'Haste do pináculo', [0, 13.2, 0], [0.07, 1.2, 0.07], iron)
        P('finial', 'sphere', 'Pináculo', [0, 12.75, 0], [0.22, 0.22, 0.22], { color: '#e0b04a', metalness: 1, roughness: 0.3 })
        const pennant = G('pennant', 'Flâmula', [0.04, 13.65, 0], { animation: loop('swing', 'y', 2.4 + random(3), 14, random(4) * 360) })
        slab('pennantCloth', 'Flâmula', [[0, 0.2], [0.9, 0], [0, -0.2]], 0, 0.02, cloth(flagColor), { parentId: pennant, collidable: false })
      } else {
        prism('deck', 'Piso do topo', circle(1.75, 32), 7.82, 0.15, paving, {}, [[[-0.45, -1.6], [0.45, -1.6], [0.45, -1], [-0.45, -1]]])
        ladder('inner', 0, -1.45, 0.2, 8.7, 16)
        for (let i = 0; i < 10; i++) { const a = rad(i * 36 + 18); P(`merlon${i}`, 'box', 'Merlão', [round(Math.cos(a) * 2.27), 9.2, round(Math.sin(a) * 2.27)], [0.7, 0.6, 0.5], S, { rotation: [0, yaw(a), 0] }) }
        P('flagpole', 'cylinder', 'Mastro', [0.6, 9.885, 0.4], [0.08, 3.83, 0.08], darkWood)
        const flag = G('flag', 'Bandeira', [0.64, 11.4, 0.4], { animation: loop('swing', 'y', 2.2 + random(3), 12, random(4) * 360) })
        P('flagCloth', 'box', 'Bandeira', [0.55, 0, 0], [1.1, 0.65, 0.03], cloth(flagColor), { parentId: flag, collidable: false })
      }
      if (lit) P('light', 'light', 'Luz da entrada', [0, 2.8, 3], [0.15, 0.15, 0.15], undefined, { light: point('#ffb45a', 5, 10) })
      break
    }
    case 'gate': {
      const S = stone(primary ?? '#b7b0a4'), trim = stone('#a39c90'), half = 1.3, spring = 2.6
      slab('body', 'Arco do portão', [[-3, 0], [-half, 0], ...arc(0, spring, half, 180, 0, 14), [half, 0], [3, 0], [3, 5], [-3, 5]], 0, 1.6, S)
      for (const s of [-1, 1]) P(`plinth${s}`, 'box', 'Embasamento', [s * 2.23, 0.25, 0], [1.5, 0.7, 1.86], darkStone)
      P('course', 'box', 'Cordão de pedra', [0, 4.3, 0], [5.96, 0.14, 1.76], darkStone)
      P('walk', 'box', 'Adarve', [0, 5.05, -0.22], [6, 0.1, 1.16], paving)
      battlement('battlement', 6, 5, 0.58, 0.44, S)
      slab('archTrim', 'Aduelas do arco', [[-1.62, 0], [-1.33, 0], ...arc(0, spring, 1.33, 180, 0, 14), [1.33, 0], [1.62, 0], ...arc(0, spring, 1.62, 0, 180, 14)], 0.86, 0.12, trim)
      P('keystone', 'box', 'Pedra de fecho', [0, 4, 0.9], [0.42, 0.45, 0.2], trim)
      for (const s of [-1, 1]) sconce(`torch${s}`, s * 2.2, 2.8, 0.8)
      const doors = G('doors', 'Folhas do portão', [0, 0, 0])
      const leaf: Pt[] = [[0, 0.03], [1.35, 0.03], [1.35, 3.9], ...arc(1.36, spring, 1.36, 92, 180, 8)]
      const interaction: SceneInteraction | undefined = interactive ? { trigger: 'click', key: '', radius: 4, action: 'toggleAnimation', targetId: 'doors',
        message: required ? `Portão destrancado com ${required}.` : 'O portão range e se move.', ...(required ? { requires: required } : {}) } : undefined
      const doorWood: Material = { ...darkWood, color: secondary ?? '#6e4a2c' }
      for (const s of [-1, 1]) {
        const hinge = G(`hinge${s}`, 'Dobradiça do portão', [s * 1.36, 0, -0.87], interactive ? { parentId: doors, animation: opening([0, -s * 90, 0], 2.2) } : { parentId: doors, rotation: [0, -s * 90, 0] })
        slab(`leaf${s}`, 'Folha do portão', leaf.map(([u, y]): Pt => [round(-s * u), y]), 0, 0.1, doorWood, { parentId: hinge, ...(interaction ? { interaction } : {}) })
        for (const y of [0.5, 1.5, 2.5]) P(`band${s}${y * 10}`, 'box', 'Ferragem', [-s * 0.7, y, -0.065], [1.2, 0.1, 0.03], iron, { parentId: hinge })
        P(`boss${s}`, 'cylinder', 'Espelho da argola', [-s * 1.15, 1.3, 0.065], [0.07, 0.03, 0.07], iron, { parentId: hinge, rotation: [90, 0, 0] })
        P(`ring${s}`, 'torus', 'Argola', [-s * 1.15, 1.2, 0.085], [0.18, 0.18, 0.025], iron, { parentId: hinge, geometry: { radius: 0.07 } })
      }
      if (lit) P('light', 'light', 'Luz do portão', [0, 3.2, 1.8], [0.15, 0.15, 0.15], undefined, { light: point('#ff9a4a', 5, 10) })
      break
    }
    case 'fountain': {
      const S = { ...stone(primary ?? '#d8d2c6'), texture: 'marble' as const, textureScale: 1.4, roughness: 0.6 }, segments = spec.seed % 2 ? 8 : 32
      const flow: Material = { ...water, emissive: '#3fb8d8', emissiveIntensity: lit ? 0.6 : 0.15 }
      P('basin', 'lathe', 'Bacia inferior', [0, 0.325, 0], [4.1, 0.65, 4.1], S, { geometry: { profile: [[0, 0], [2, 0], [2.05, 0.12], [2.05, 0.55], [1.95, 0.65], [1.8, 0.65], [1.75, 0.25], [0, 0.25]], segments } })
      P('pool', 'cylinder', 'Água do chafariz', [0, 0.5, 0], [segments === 8 ? 3.25 : 3.5, 0.04, segments === 8 ? 3.25 : 3.5], flow, { collidable: false, geometry: { segments: 32 }, sound: sound('water', 0.55, 14) })
      P('pedestal', 'lathe', 'Coluna central', [0, 0.84, 0], [0.84, 1.2, 0.84], S, { geometry: { profile: [[0, 0], [0.42, 0], [0.42, 0.1], [0.3, 0.25], [0.24, 0.7], [0.3, 1.2], [0, 1.2]] } })
      P('bowl', 'lathe', 'Taça superior', [0, 1.63, 0], [2, 0.4, 2], S, { geometry: { profile: [[0, 0], [0.25, 0], [0.8, 0.2], [1, 0.36], [0.93, 0.4], [0.8, 0.3], [0, 0.3]], segments } })
      P('bowlWater', 'cylinder', 'Água da taça', [0, 1.765, 0], [1.6, 0.03, 1.6], flow, { collidable: false, geometry: { segments: 24 } })
      P('curtain', 'lathe', 'Cortina de água', [0, 1.155, 0], [1.98, 1.27, 1.98], { ...flow, opacity: 0.32, doubleSided: true }, { collidable: false, geometry: { profile: [[0.99, 0], [0.96, 0.5], [0.99, 1]] }, animation: loop('pulse', 'y', 0.9, 0.02) })
      P('spout', 'lathe', 'Bica', [0, 1.98, 0], [0.28, 0.5, 0.28], S, { geometry: { profile: [[0, 0], [0.14, 0], [0.1, 0.3], [0.12, 0.5], [0, 0.5]], segments: 16 } })
      P('crown', 'lathe', 'Taça do topo', [0, 2.3, 0], [0.6, 0.15, 0.6], S, { geometry: { profile: [[0, 0], [0.08, 0], [0.3, 0.12], [0.27, 0.15], [0.2, 0.1], [0, 0.1]], segments: 16 } })
      P('jet', 'capsule', 'Jato de água', [0, 2.75, 0], [0.1, 0.8, 0.1], { ...flow, opacity: 0.7 }, { collidable: false, animation: loop('pulse', 'y', 1.6, 0.18) })
      for (let i = 0; i < 3; i++) { const a = random(i) * Math.PI * 2, d = 0.6 + random(i + 5) * 0.8; P(`coin${i}`, 'cylinder', 'Moeda no fundo', [round(Math.cos(a) * d), 0.265, round(Math.sin(a) * d)], [0.12, 0.015, 0.12], { color: '#e8b84a', metalness: 1, roughness: 0.3 }, { collidable: false, geometry: { segments: 12 } }) }
      if (lit) P('light', 'light', 'Luz da água', [0, 0.9, 0], [0.15, 0.15, 0.15], undefined, { light: point('#7fd8ff', 4, 8) })
      break
    }
    case 'statue': {
      const S = stone('#c9c3b8'), M: Material = { color: primary ?? '#ece7df', texture: 'marble', textureScale: 1.2, roughness: 0.4, metalness: 0, clearcoat: 0.2 }
      P('step', 'box', 'Degrau', [0, 0.15, 0], [1.7, 0.3, 1.7], darkStone)
      P('die', 'box', 'Pedestal', [0, 0.9, 0], [1.2, 1.2, 1.2], S)
      P('cap', 'box', 'Cornija', [0, 1.575, 0], [1.4, 0.15, 1.4], S)
      P('plaque', 'box', 'Placa de bronze', [0, 0.95, 0.615], [0.8, 0.36, 0.03], { color: '#9a6b2f', metalness: 0.9, roughness: 0.35 })
      P('inscription', 'text', 'Inscrição', [0, 0.95, 0.636], [0.74, 0.3, 0.01], { color: '#2c1f0e', roughness: 0.6, metalness: 0 }, { geometry: { text: (spec.text || 'Ao fundador').slice(0, 60) } })
      const lean = (random(1) - 0.5) * 10
      const figure = G('figure', 'Figura', [0, 1.65, 0], { rotation: [0, round(lean * 3), 0] })
      P('head', 'sphere', 'Cabeça', [0, 1.62, 0], [0.3, 0.34, 0.3], M, { parentId: figure })
      P('neck', 'cylinder', 'Pescoço', [0, 1.43, 0], [0.12, 0.12, 0.12], M, { parentId: figure })
      if (spec.seed % 2 === 0) {
        for (const s of [-1, 1]) P(`leg${s}`, 'capsule', 'Perna', [s * 0.13, 0.43, s * 0.04], [0.2, 0.86, 0.22], M, { parentId: figure })
        P('torso', 'capsule', 'Tronco', [0, 1.1, 0], [0.5, 0.75, 0.32], M, { parentId: figure })
        P('cape', 'box', 'Capa', [0, 0.95, -0.2], [0.55, 0.95, 0.05], M, { parentId: figure, rotation: [8, 0, 0] })
        const arm = G('swordArm', 'Braço da espada', [0.3, 1.3, 0], { parentId: figure, rotation: [0, 0, -15] })
        P('armR', 'capsule', 'Braço', [0, 0.28, 0], [0.14, 0.6, 0.14], M, { parentId: arm })
        P('guard', 'box', 'Guarda', [0, 0.68, 0], [0.28, 0.05, 0.06], M, { parentId: arm })
        P('blade', 'box', 'Lâmina', [0, 1.15, 0], [0.07, 0.9, 0.02], M, { parentId: arm })
        P('armL', 'capsule', 'Braço', [-0.33, 0.95, 0.05], [0.14, 0.6, 0.14], M, { parentId: figure, rotation: [0, 0, 10] })
        P('shield', 'cylinder', 'Escudo', [-0.42, 0.9, 0.16], [0.55, 0.06, 0.55], M, { parentId: figure, rotation: [90, 0, 0] })
      } else {
        P('robe', 'lathe', 'Manto', [0, 0.575, 0], [0.8, 1.15, 0.8], M, { parentId: figure, geometry: { profile: [[0, 0], [0.4, 0], [0.32, 0.5], [0.22, 1.1], [0, 1.15]] } })
        P('shoulders', 'capsule', 'Ombros', [0, 1.22, 0], [0.18, 0.62, 0.22], M, { parentId: figure, rotation: [0, 0, 90] })
        P('hood', 'cone', 'Capuz', [0, 1.72, -0.03], [0.38, 0.42, 0.38], M, { parentId: figure })
        P('staff', 'cylinder', 'Cajado', [0.4, 1, 0.12], [0.05, 2, 0.05], M, { parentId: figure })
        P('hand', 'capsule', 'Braço', [0.3, 1.12, 0.08], [0.13, 0.42, 0.13], M, { parentId: figure, rotation: [0, 0, 55] })
        P('orb', 'sphere', 'Orbe', [0.4, 2.08, 0.12], [0.2, 0.2, 0.2], lit ? emissive(secondary ?? '#8fd3ff', 2.4) : M, { parentId: figure })
      }
      if (lit) P('light', 'light', 'Iluminação da estátua', [0, 0.5, 1.7], [0.15, 0.15, 0.15], undefined, { light: point('#ffe2b0', 5, 8) })
      break
    }
    case 'marketStall': {
      const c1 = primary ?? ['#c0392b', '#2e6fa8', '#2f8a57', '#c47a1c'][spec.seed % 4], c2 = secondary ?? '#f2ead8'
      P('counter', 'box', 'Balcão', [0, 0.95, 0.35], [2.8, 0.08, 1.1], wood)
      P('front', 'box', 'Frente do balcão', [0, 0.465, 0.87], [2.8, 0.89, 0.06], darkWood)
      for (const s of [-1, 1]) {
        P(`postF${s}`, 'box', 'Esteio', [s * 1.45, 1.15, 0.95], [0.1, 2.3, 0.1], darkWood)
        P(`postB${s}`, 'box', 'Esteio', [s * 1.45, 1.325, -0.95], [0.1, 2.65, 0.1], darkWood)
      }
      P('shelf', 'box', 'Prateleira', [0, 1.35, -0.72], [2.8, 0.05, 0.4], wood)
      P('backdrop', 'box', 'Pano de fundo', [0, 1.45, -0.96], [2.8, 1.6, 0.03], cloth(c2))
      const slope = 0.35 / 1.9, tilt = round(Math.atan(slope) * 180 / Math.PI), length = round(2.35 / Math.cos(Math.atan(slope))), stripe = 3.2 / 6, y = (z: number) => 2.67 - (z + 0.95) * slope
      for (let i = 0; i < 6; i++) {
        const x = round(-1.6 + stripe * (i + 0.5))
        P(`stripe${i}`, 'box', 'Toldo listrado', [x, round(y(0.125)), 0.125], [stripe, 0.04, length], cloth(i % 2 ? c2 : c1), { rotation: [tilt, 0, 0] })
        slab(`valance${i}`, 'Babado do toldo', [[-stripe / 2, 0], [stripe / 2, 0], ...ellipse(0, -0.08, stripe / 2, 0.1, 0, -180, 8)].map(([u, v]): Pt => [round(x + u), round(y(1.3) + v)]), 1.31, 0.02, cloth(i % 2 ? c1 : c2))
      }
      for (const s of [-1, 1]) {
        P(`crate${s}`, 'roundedBox', 'Caixote', [s * 0.75, 1.14, 0.3], [0.55, 0.3, 0.42], { ...wood, color: '#c9a77c' }, { geometry: { bevel: 0.02 } })
        const fruit = s < 0 ? ['#d63a2f', '#b82a22'][spec.seed % 2] : ['#f39c27', '#e8d23a'][spec.seed % 2]
        for (let i = 0; i < 6; i++) P(`fruit${s}${i}`, 'sphere', 'Fruta', [round(s * 0.75 + ((i % 3) - 1) * 0.15), 1.345, round(0.3 + (i < 3 ? -0.08 : 0.08))], [0.13, 0.13, 0.13], { color: shade(fruit, 0.9 + random(i + s * 7 + 20) * 0.2), roughness: 0.45, metalness: 0, clearcoat: 0.4 }, { collidable: false, geometry: { segments: 12 } })
      }
      P('basket', 'lathe', 'Cesto', [0, 1.09, 0.45], [0.48, 0.2, 0.48], { ...wood, color: '#c79e62', textureScale: 3 }, { geometry: { profile: [[0, 0], [0.18, 0], [0.24, 0.18], [0.22, 0.2], [0.15, 0.04], [0, 0.04]], segments: 16 } })
      for (let i = 0; i < 3; i++) P(`greens${i}`, 'sphere', 'Verdura', [round((i - 1) * 0.1), 1.17, round(0.45 + (i % 2) * 0.05)], [0.16, 0.14, 0.16], { color: '#6fa64a', roughness: 0.7, metalness: 0 }, { collidable: false, geometry: { segments: 12 } })
      for (const [i, [x, z]] of [[-1, -0.5], [-0.55, -0.62]].entries()) P(`sack${i}`, 'capsule', 'Saca', [x, 0.3, z], [0.4, 0.6, 0.38], { ...cloth('#b89a6a'), doubleSided: false })
      P('signBoard', 'box', 'Placa da barraca', [0, 0.55, 0.92], [1.3, 0.36, 0.04], { ...wood, color: '#e6d3b0' })
      P('signText', 'text', 'Nome da barraca', [0, 0.55, 0.945], [1.2, 0.28, 0.01], { color: '#3a2412', roughness: 0.6, metalness: 0 }, { geometry: { text: (spec.text || 'Feira').slice(0, 40) } })
      P('chain', 'cylinder', 'Corrente', [1.2, 2.08, 1.15], [0.02, 0.18, 0.02], iron)
      P('lantern', 'roundedBox', 'Lanterna', [1.2, 1.86, 1.15], [0.18, 0.26, 0.18], lit ? emissive('#ffb64d', 2.2, '#fff3d6') : { color: '#e8e2d2', roughness: 0.3, metalness: 0 }, { geometry: { bevel: 0.03 }, collidable: false })
      if (lit) P('light', 'light', 'Luz da barraca', [1.2, 1.7, 1.3], [0.12, 0.12, 0.12], undefined, { light: point('#ffc477', 3, 7) })
      break
    }
    case 'cart': {
      const W: Material = { ...wood, color: primary ?? '#a77b52' }
      P('bed', 'box', 'Assoalho', [0, 0.75, 0], [1.4, 0.1, 2.2], W)
      for (const s of [-1, 1]) {
        P(`side${s}`, 'box', 'Tábua lateral', [s * 0.67, 1, 0], [0.06, 0.4, 2.2], W)
        P(`end${s}`, 'box', 'Tábua frontal', [0, 1, s * 1.07], [1.28, 0.4, 0.06], W)
        P(`rim${s}`, 'torus', 'Aro da roda', [s * 0.85, 0.45, 0], [0.9, 0.9, 0.07], iron, { rotation: [0, 90, 0], geometry: { radius: round(0.07 / 1.8) } })
        P(`hub${s}`, 'cylinder', 'Cubo', [s * 0.85, 0.45, 0], [0.18, 0.16, 0.18], darkWood, { rotation: [0, 0, 90] })
        for (let i = 0; i < 6; i++) P(`spoke${s}${i}`, 'box', 'Raio da roda', [s * 0.85, 0.45, 0], [0.04, 0.82, 0.04], darkWood, { rotation: [i * 30, 0, 0] })
        P(`shaft${s}`, 'box', 'Varal', [s * 0.45, 0.72, 2], [0.07, 0.07, 1.85], W)
        P(`stand${s}`, 'box', 'Apoio', [s * 0.45, 0.3425, 2.8], [0.06, 0.685, 0.06], darkWood)
      }
      P('axle', 'cylinder', 'Eixo', [0, 0.45, 0], [0.1, 1.86, 0.1], iron, { rotation: [0, 0, 90] })
      P('yoke', 'box', 'Travessa', [0, 0.72, 2.8], [0.9, 0.06, 0.06], W)
      if (spec.seed % 2 === 0) P('hay', 'polyhedron', 'Carga de feno', [0, 1.1, 0], [1.25, 0.7, 2], { color: '#e0c068', texture: 'needles', textureScale: 2, roughness: 1, metalness: 0 }, { geometry: { variant: 'icosahedron', detail: 2, bevel: 0.1, seed: spec.seed % 50 } })
      else {
        for (const s of [-1, 1]) P(`barrel${s}`, 'lathe', 'Barril', [s * 0.3, 1.15, -0.5], [0.52, 0.7, 0.52], { ...wood, color: '#c49a6c' }, { geometry: { profile: [[0, 0], [0.21, 0], [0.25, 0.25], [0.26, 0.5], [0.25, 0.75], [0.21, 1], [0, 1]] } })
        P('sack', 'capsule', 'Saca', [0, 0.98, 0.5], [0.36, 0.9, 0.36], { ...cloth('#b89a6a'), doubleSided: false }, { rotation: [0, 0, 90] })
      }
      break
    }
    case 'haystack': {
      const straw: Material = { color: primary ?? '#e2c46c', texture: 'needles', textureScale: 2, roughness: 1, metalness: 0 }
      P('mound', 'polyhedron', 'Feno', [0, 0.65, 0], [round(2.3 * (0.9 + random(1) * 0.2)), 1.5, 2], straw, { geometry: { variant: 'icosahedron', detail: 2, bevel: 0.12, seed: spec.seed % 50 } })
      P('top', 'polyhedron', 'Feno', [0.1, 1.35, 0], [1.4, 0.9, 1.3], { ...straw, color: shade(straw.color!, 1.05) }, { geometry: { variant: 'icosahedron', detail: 1, bevel: 0.12, seed: (spec.seed + 1) % 50 } })
      for (let i = 0; i < 5; i++) { const a = random(i + 3) * Math.PI * 2, d = 1.25 + random(i + 8) * 0.5; P(`straw${i}`, 'box', 'Palha solta', [round(Math.cos(a) * d), 0.01, round(Math.sin(a) * d)], [0.5, 0.02, 0.05], straw, { rotation: [0, round(random(i + 13) * 180), 0], collidable: false }) }
      if (spec.seed % 2) {
        const fork = G('fork', 'Forcado', [1.3, 0, 0.3], { rotation: [0, 0, 20] })
        P('forkHandle', 'cylinder', 'Cabo do forcado', [0, 0.85, 0], [0.05, 1.7, 0.05], darkWood, { parentId: fork })
        P('forkHead', 'box', 'Cabeça do forcado', [0, 1.72, 0], [0.3, 0.04, 0.04], iron, { parentId: fork })
        for (const x of [-0.12, 0, 0.12]) P(`tine${x * 100}`, 'cylinder', 'Dente do forcado', [x, 1.88, 0], [0.02, 0.3, 0.02], iron, { parentId: fork })
      }
      break
    }
    case 'chest': {
      const W: Material = { ...wood, color: primary ?? '#8a5a35' }, trim: Material = { color: secondary ?? '#c9a24a', metalness: 0.9, roughness: 0.3 }
      P('body', 'box', 'Corpo do baú', [0, 0.25, 0], [1, 0.5, 0.65], W, interactive ? { interaction: { trigger: 'click', key: '', radius: 3, action: 'toggleAnimation', targetId: 'hinge',
        message: required ? `Baú destrancado com ${required}.` : 'O baú se abre.', ...(required ? { requires: required } : {}) } } : {})
      for (const s of [-1, 1]) P(`strap${s}`, 'box', 'Cinta de metal', [s * 0.35, 0.2475, 0.0075], [0.06, 0.485, 0.655], trim)
      for (const s of [-1, 1]) P(`foot${s}`, 'box', 'Rodapé', [0, 0.02, s * 0.295], [1.04, 0.06, 0.07], darkWood)
      const hinge = G('hinge', 'Dobradiça da tampa', [0, 0.5, -0.325], interactive ? { animation: opening([-100, 0, 0], 1.2) } : {})
      const lid = ellipse(0, 0, 0.325, 0.25, 0, 180, 12)
      side('lid', 'Tampa', lid.map(([u, v]): Pt => [round(u + 0.325), round(v + 0.005)]), 0, 1, W, { parentId: hinge })
      for (const s of [-1, 1]) side(`lidStrap${s}`, 'Cinta da tampa', [...ellipse(0, 0, 0.335, 0.26, 0, 180, 12), ...ellipse(0, 0, 0.325, 0.25, 180, 0, 12)].map(([u, v]): Pt => [round(u + 0.325), round(v + 0.005)]), s * 0.35, 0.06, trim, { parentId: hinge })
      P('lock', 'box', 'Fechadura', [0, 0.06, 0.665], [0.14, 0.16, 0.03], trim, { parentId: hinge })
      if (lit) P('light', 'light', 'Brilho do tesouro', [0, 0.9, 0.5], [0.12, 0.12, 0.12], undefined, { light: point('#ffd36b', 2, 4) })
      break
    }
    case 'lever': {
      P('base', 'box', 'Base da alavanca', [0, 0.125, 0], [0.6, 0.25, 0.4], darkStone)
      P('plate', 'box', 'Chapa', [0, 0.27, 0], [0.48, 0.04, 0.3], iron)
      for (const s of [-1, 1]) P(`cheek${s}`, 'box', 'Mancal', [s * 0.15, 0.37, 0], [0.04, 0.2, 0.16], iron)
      P('pivot', 'cylinder', 'Pino', [0, 0.37, 0], [0.07, 0.34, 0.07], iron, { rotation: [0, 0, 90] })
      P('lamp', 'sphere', 'Indicador', [0.2, 0.14, 0.2], [0.06, 0.06, 0.06], lit ? emissive('#4dff88', 2.5) : { color: '#3d5a45', roughness: 0.4, metalness: 0 }, { collidable: false })
      const hinge = G('hinge', 'Articulação da alavanca', [0, 0.37, 0], interactive
        ? { animation: opening([-70, 0, 0], 0.6), interaction: { trigger: 'click', key: '', radius: 3, action: 'toggleAnimation', targetId: null, message: 'Alavanca acionada' } } : {})
      const tilt = G('tilt', 'Inclinação da alavanca', [0, 0, 0], { parentId: hinge, rotation: [35, 0, 0] })
      P('rod', 'cylinder', 'Haste', [0, 0.38, 0], [0.05, 0.76, 0.05], metal(primary ?? '#6b7078'), { parentId: tilt, overlapWith: ['pivot'] })
      P('knob', 'sphere', 'Manopla', [0, 0.8, 0], [0.13, 0.13, 0.13], { color: secondary ?? '#b8322a', roughness: 0.35, metalness: 0.1, clearcoat: 0.6 }, { parentId: tilt })
      break
    }
    case 'banner': {
      const c1 = primary ?? '#a3212b', c2 = secondary ?? '#e8c25a', gold: Material = { color: '#e0b04a', metalness: 1, roughness: 0.3 }
      P('foot', 'cylinder', 'Base', [0, 0.1, 0], [0.42, 0.2, 0.42], darkStone)
      P('pole', 'cylinder', 'Mastro', [0, 1.9, 0], [0.08, 3.6, 0.08], darkWood)
      P('finial', 'sphere', 'Ponteira', [0, 3.75, 0], [0.14, 0.14, 0.14], gold)
      P('bracket', 'box', 'Suporte', [0, 3.3, 0.08], [0.06, 0.06, 0.1], iron)
      P('bar', 'cylinder', 'Travessa', [0, 3.3, 0.13], [0.05, 1.2, 0.05], darkWood, { rotation: [0, 0, 90] })
      for (const s of [-1, 1]) P(`tassel${s}`, 'sphere', 'Borla', [s * 0.62, 3.3, 0.13], [0.08, 0.08, 0.08], gold)
      const sway = G('cloth', 'Tecido do estandarte', [0, 3.27, 0.16], { animation: loop('swing', 'x', 3 + random(1) * 1.5, 3, random(2) * 360) })
      slab('flag', 'Estandarte', [[-0.5, 0], [0.5, 0], [0.5, -1.8], [0, -1.45], [-0.5, -1.8]], 0, 0.025, cloth(c1), { parentId: sway, collidable: false })
      const crest: Material = { color: c2, roughness: 0.5, metalness: 0.2 }
      if (spec.seed % 3 === 0) P('emblem', 'cylinder', 'Brasão', [0, -0.65, 0.017], [0.42, 0.008, 0.42], crest, { parentId: sway, rotation: [90, 0, 0], collidable: false })
      else if (spec.seed % 3 === 1) P('emblem', 'box', 'Brasão', [0, -0.65, 0.017], [0.32, 0.32, 0.008], crest, { parentId: sway, rotation: [0, 0, 45], collidable: false })
      else for (const [i, d] of ([[0.12, 0.5], [0.42, 0.12]] as const).entries()) P(`emblem${i}`, 'box', 'Brasão', [0, -0.65, 0.017 + i * 0.001], [d[0], d[1], 0.008], crest, { parentId: sway, collidable: false })
      break
    }
    case 'tombstone': {
      const S = stone(primary ?? '#9a968e'), variant = spec.seed % 3, epitaph = (spec.text || 'Descanse em paz').slice(0, 40)
      P('base', 'box', 'Base', [0, 0.05, 0], [0.9, 0.2, 0.5], darkStone)
      const tilt = G('stone', 'Lápide', [0, 0.12, 0], { rotation: [round((random(1) - 0.5) * 8), 0, round((random(2) - 0.5) * 8 + 0.5)] })
      const text = { color: '#3d3a35', roughness: 0.8, metalness: 0 }
      if (variant === 0) {
        slab('slab', 'Lápide arredondada', [[-0.36, 0], [0.36, 0], ...arc(0, 0.75, 0.36, 0, 180, 12)], 0, 0.16, S, { parentId: tilt })
        P('epitaph', 'text', 'Epitáfio', [0, 0.55, 0.086], [0.56, 0.3, 0.01], text, { parentId: tilt, geometry: { text: epitaph } })
        P('moss', 'sphere', 'Musgo', [0.12, 1.08, 0], [0.35, 0.12, 0.2], { color: '#5f7d38', texture: 'grass', textureScale: 2, roughness: 1, metalness: 0 }, { parentId: tilt, collidable: false, geometry: { segments: 12 } })
      } else if (variant === 1) {
        P('post', 'box', 'Haste da cruz', [0, 0.6, 0], [0.18, 1.2, 0.14], S, { parentId: tilt })
        P('arm', 'box', 'Braço da cruz', [0, 0.85, 0], [0.66, 0.18, 0.13], S, { parentId: tilt })
        P('epitaph', 'text', 'Epitáfio', [0, 0.05, 0.256], [0.8, 0.14, 0.01], text, { geometry: { text: epitaph } })
      } else {
        slab('obelisk', 'Obelisco', [[-0.22, 0], [0.22, 0], [0.15, 1.25], [0, 1.45], [-0.15, 1.25]], 0, 0.3, S, { parentId: tilt })
        P('epitaph', 'text', 'Epitáfio', [0, 0.5, 0.156], [0.36, 0.25, 0.01], text, { parentId: tilt, geometry: { text: epitaph } })
      }
      P('baseMoss', 'sphere', 'Musgo', [-0.35, 0.15, 0.15], [0.3, 0.08, 0.25], { color: '#5f7d38', texture: 'grass', textureScale: 2, roughness: 1, metalness: 0 }, { collidable: false, geometry: { segments: 12 } })
      P('mound', 'polyhedron', 'Terra da sepultura', [0, 0, 1.1], [0.85, 0.24, 1.5], { color: '#6b5a44', texture: 'sand', textureScale: 1.5, roughness: 1, metalness: 0 }, { collidable: false, geometry: { variant: 'dodecahedron', detail: 1, bevel: 0.1, seed: spec.seed % 10 } })
      if (spec.seed % 4 === 3) for (let i = 0; i < 3; i++) P(`flower${i}`, 'sphere', 'Flor', [round(-0.2 + i * 0.2), 0.14, round(0.8 + random(i + 4) * 0.4)], [0.09, 0.09, 0.09], { color: ['#f4f0e6', '#d9534f', '#f2c14e'][i], roughness: 0.6, metalness: 0 }, { collidable: false, geometry: { segments: 10 } })
      break
    }
    case 'ruinArch': {
      const S = stone(primary ?? '#b8ad98'), broken = round(1.6 + random(1)), moss: Material = { color: '#5c7a36', texture: 'leaves', textureScale: 2, roughness: 0.9, metalness: 0 }
      for (const s of [-1, 1]) P(`footing${s}`, 'box', 'Base do pilar', [s * 1.6, 0.1, 0], [1, 0.3, 1], darkStone)
      P('pierL', 'box', 'Pilar', [-1.6, 1.7, 0], [0.8, 3.4, 0.8], S)
      P('pierR', 'box', 'Pilar partido', [1.6, broken / 2, 0], [0.8, broken, 0.8], S)
      P('capital', 'box', 'Capitel', [-1.6, 3.3, 0], [0.96, 0.16, 0.96], darkStone)
      slab('arch', 'Arco partido', [...arc(0, 3.4, 2, 180, 100, 8), ...arc(0, 3.4, 1.2, 100, 180, 6)], 0, 0.8, S)
      P('stub', 'polyhedron', 'Topo partido', [1.6, broken + 0.05, 0], [0.85, 0.35, 0.85], { ...S, flatShading: true }, { geometry: { variant: 'dodecahedron', detail: 1, bevel: 0.15, seed: spec.seed % 10 } })
      for (const [i, [x, z, w, h, d]] of [[0.4, 1.3, 0.7, 0.4, 0.5], [2.6, 1, 0.6, 0.38, 0.45], [0.9, -1.2, 0.65, 0.4, 0.5], [-0.5, 0.6, 0.5, 0.3, 0.4]].entries())
        P(`block${i}`, 'box', 'Bloco caído', [round(x + (random(i + 3) - 0.5) * 0.1), h / 2, z], [w, h, d], { ...S, color: shade(S.color!, 0.85 + random(i + 7) * 0.2) }, { rotation: [0, round(random(i + 11) * 90), 0] })
      P('rubble', 'polyhedron', 'Entulho', [2.2, 0.15, -1.1], [0.6, 0.3, 0.5], { ...S, flatShading: true }, { geometry: { variant: 'dodecahedron', detail: 1, bevel: 0.15, seed: (spec.seed + 3) % 10 } })
      tube('ivy', 'Hera', [[-1.8, 0.1, 0.43], [-1.5, 1, 0.44], [-1.75, 2, 0.43], [-1.45, 3, 0.44]], 0.035, moss, { collidable: false })
      for (let i = 0; i < 4; i++) P(`leaf${i}`, 'sphere', 'Folhas de hera', [round(-1.75 + (i % 2) * 0.3), round(0.6 + i * 0.75), 0.45], [0.3, 0.26, 0.1], moss, { collidable: false, geometry: { segments: 10 } })
      P('archMoss', 'sphere', 'Musgo', [-1.3, 5.05, 0], [0.7, 0.16, 0.7], moss, { collidable: false, geometry: { segments: 12 } })
      break
    }
    case 'dock': {
      const W: Material = { ...wood, color: primary ?? '#9c7b58' }
      for (let i = 0; i < 16; i++) P(`plank${i}`, 'box', 'Tábua do píer', [0, 0.6, -3.75 + i * 0.5], [2.4, 0.06, 0.46], { ...W, color: shade(W.color!, 0.88 + random(i) * 0.24) },
        { rotation: [0, round((random(i + 40) - 0.5) * 1.2), 0], ...(i === 8 ? { sound: sound('waves', 0.3, 14) } : {}) })
      for (const s of [-1, 1]) P(`stringer${s}`, 'box', 'Longarina', [s * 0.9, 0.47, 0], [0.15, 0.2, 8], darkWood)
      for (const z of [-3.8, -1.3, 1.3, 3.8]) {
        for (const s of [-1, 1]) P(`post${s}${z * 10}`, 'cylinder', 'Estaca', [s * 1.32, -0.2, z], [0.22, 2.4, 0.22], darkWood)
        P(`beam${z * 10}`, 'box', 'Travessa', [0, 0.29, z], [2.84, 0.15, 0.15], darkWood)
      }
      for (const s of [-1, 1]) P(`bollard${s}`, 'lathe', 'Cabeço de amarração', [s * 0.85, 0.8, 3.55], [0.32, 0.34, 0.32], iron, { geometry: { profile: [[0, 0], [0.13, 0], [0.11, 0.22], [0.16, 0.28], [0.14, 0.34], [0, 0.34]], segments: 16 } })
      P('coil', 'torus', 'Rolo de corda', [-0.7, 0.66, 2.6], [0.5, 0.5, 0.06], { color: '#c8b48a', texture: 'fabric', textureScale: 4, roughness: 0.95, metalness: 0 }, { rotation: [90, 0, 0], geometry: { radius: 0.06 }, collidable: false })
      tube('rope', 'Corda de amarração', [[0.85, 0.98, 3.55], [1.05, 0.75, 2.6], [1.32, 0.98, 1.3]], 0.025, { color: '#c8b48a', roughness: 0.95, metalness: 0 }, { collidable: false })
      ladder('ladder', 0, 4.05, -1, 1.65, 3)
      P('crate', 'roundedBox', 'Caixote', [-0.7, 0.93, -2.5], [0.6, 0.6, 0.6], { ...wood, color: '#c9a77c' }, { rotation: [0, round(10 + random(3) * 20), 0], geometry: { bevel: 0.03 } })
      P('lantern', 'roundedBox', 'Lanterna', [-1.32, 1.15, 3.8], [0.2, 0.3, 0.2], lit ? emissive('#ffb64d', 2.2, '#fff3d6') : { color: '#e8e2d2', roughness: 0.3, metalness: 0 }, { geometry: { bevel: 0.03 } })
      if (lit) P('light', 'light', 'Luz do píer', [-1.32, 1.5, 3.8], [0.12, 0.12, 0.12], undefined, { light: point('#ffc477', 3, 9) })
      break
    }
    case 'lighthouse': {
      const white: Material = { color: primary ?? '#f4f1ea', texture: 'plaster', textureScale: 2, roughness: 0.85, metalness: 0 }, red: Material = { ...white, color: secondary ?? '#c23b30' }
      const bands = 6, low = 0.45, top = 10.5, r0 = 1.7, r1 = 1.1, radiusAt = (y: number) => r0 + (r1 - r0) * (y - low) / (top - low)
      P('base', 'cylinder', 'Base de pedra', [0, 0.2, 0], [4.4, 0.6, 4.4], darkStone, { geometry: { segments: 32 } })
      for (let i = 0; i < bands; i++) {
        const ya = low + (top - low) * i / bands, yb = low + (top - low) * (i + 1) / bands, ra = radiusAt(ya), rb = radiusAt(yb), h = round(yb - ya)
        P(`band${i}`, 'lathe', 'Faixa da torre', [0, round((ya + yb) / 2), 0], [round(2 * ra), h, round(2 * ra)], i % 2 ? red : white, { geometry: { profile: [[0, 0], [round(ra), 0], [round(rb), h], [0, h]], segments: 32 } })
      }
      P('door', 'box', 'Porta', [0, 1.25, 1.62], [0.8, 1.5, 0.22], darkWood)
      for (const [i, deg] of [200, 330, 80].entries()) {
        const y = 3.5 + i * 2.3, a = rad(deg), rr = radiusAt(y) + 0.02
        P(`window${i}`, 'box', 'Janela', [round(Math.cos(a) * rr), y, round(Math.sin(a) * rr)], [0.3, 0.55, 0.16], lit ? emissive('#ffcf7a', 1.2, '#3a2a1a') : { color: '#26303a', roughness: 0.3, metalness: 0.2 }, { rotation: [0, yaw(a), 0] })
      }
      P('corbel', 'lathe', 'Mísula da galeria', [0, 10.3, 0], [3.4, 0.4, 3.4], darkStone, { geometry: { profile: [[0, 0], [1.1, 0], [1.7, 0.4], [0, 0.4]], segments: 32 } })
      P('gallery', 'cylinder', 'Galeria', [0, 10.6, 0], [3.4, 0.2, 3.4], metal('#3c4148'), { geometry: { segments: 32 }, sound: sound('wind', 0.3, 18) })
      for (let i = 0; i < 16; i++) { const a = rad(i * 22.5); P(`baluster${i}`, 'cylinder', 'Balaústre', [round(Math.cos(a) * 1.6), 11.15, round(Math.sin(a) * 1.6)], [0.04, 0.9, 0.04], iron, { geometry: { segments: 8 } }) }
      P('rail', 'torus', 'Guarda-corpo', [0, 11.62, 0], [3.24, 3.24, 0.06], iron, { rotation: [90, 0, 0], geometry: { radius: round(0.06 / 6.48), segments: 32 } })
      P('lampRoom', 'cylinder', 'Lanterna de vidro', [0, 11.4, 0], [1.6, 1.4, 1.6], glass, { geometry: { segments: 24 } })
      for (let i = 0; i < 6; i++) { const a = rad(i * 60); P(`mullion${i}`, 'box', 'Montante', [round(Math.cos(a) * 0.82), 11.4, round(Math.sin(a) * 0.82)], [0.06, 1.4, 0.06], iron, { rotation: [0, yaw(a), 0] }) }
      P('lamp', 'sphere', 'Lâmpada', [0, 11.4, 0], [0.5, 0.5, 0.5], emissive('#ffe7a0', lit ? 5 : 0.5, '#fff8e0'), { geometry: { segments: 20 } })
      P('roof', 'cone', 'Cúpula', [0, 12.55, 0], [2, 0.9, 2], { ...metal('#2f3a33'), color: secondary ?? '#8f2a22' }, { geometry: { segments: 24 } })
      P('finial', 'sphere', 'Pináculo', [0, 13.05, 0], [0.2, 0.2, 0.2], iron)
      P('rod', 'cylinder', 'Para-raios', [0, 13.4, 0], [0.03, 0.6, 0.03], iron)
      const beam = G('beam', 'Feixe giratório', [0, 11.4, 0], { animation: loop('spin', 'y', 8, 0) })
      P('optic', 'cylinder', 'Lente rotativa', [0, 0, 0], [0.18, 0.7, 0.18], { color: '#d8f0ff', metalness: 0.2, roughness: 0.05, clearcoat: 1 }, { parentId: beam, collidable: false })
      if (lit) {
        const ray: Material = { color: '#fff6d0', emissive: '#ffe9a8', emissiveIntensity: 1.5, opacity: 0.16, transparent: true, doubleSided: true, roughness: 1, metalness: 0 }
        P('rayA', 'cone', 'Feixe de luz', [0, 0, -2.2], [1.6, 4, 1.6], ray, { parentId: beam, rotation: [90, 0, 0], collidable: false })
        P('rayB', 'cone', 'Feixe de luz', [0, 0, 2.2], [1.6, 4, 1.6], ray, { parentId: beam, rotation: [-90, 0, 0], collidable: false })
        P('beamLight', 'light', 'Facho do farol', [0, 0, 0.3], [0.2, 0.2, 0.2], undefined, { parentId: beam, rotation: [-90, 0, 0], light: { type: 'spot', color: '#fff1c4', intensity: 80, distance: 60, angle: 14, penumbra: 0.5, castShadow: false } })
        P('lampLight', 'light', 'Brilho da lanterna', [0, 12.3, 0], [0.15, 0.15, 0.15], undefined, { light: point('#ffe7a0', 6, 12) })
      }
      break
    }
    case 'container': {
      const C = { ...metal(primary ?? ['#b5432f', '#2f6db5', '#3a8a4a', '#d08a2a', '#6b4c9a'][spec.seed % 5]), metalness: 0.55, roughness: 0.45, textureScale: 2 }, frame = { ...C, color: shade(C.color!, 0.7) }
      P('shell', 'box', 'Casco do contêiner', [0, 1.31, 0], [6, 2.5, 2.4], C)
      for (const s of [-1, 1]) {
        for (let i = 0; i < 14; i++) P(`rib${s}${i}`, 'box', 'Nervura', [round(-2.6 + i * 0.4), 1.31, s * 1.22], [0.14, 2.3, 0.06], C)
        P(`topRail${s}`, 'box', 'Longarina superior', [0, 2.54, s * 1.2], [5.76, 0.1, 0.1], frame)
        P(`bottomRail${s}`, 'box', 'Longarina inferior', [0, 0.06, s * 1.2], [5.76, 0.12, 0.1], frame)
        for (const x of [-1, 1]) P(`corner${s}${x}`, 'box', 'Coluna de canto', [x * 2.96, 1.3, s * 1.16], [0.16, 2.6, 0.16], frame)
        P(`door${s}`, 'box', 'Porta do contêiner', [3.0175, 1.31, s * 0.54], [0.035, 2.36, 1.06], C)
        for (const z of [0.3, 0.8]) P(`bar${s}${z * 10}`, 'cylinder', 'Barra de travamento', [3.055, 1.31, s * z], [0.045, 2.3, 0.045], iron, { geometry: { segments: 10 } })
      }
      P('code', 'text', 'Código do contêiner', [0, 1.9, 1.26], [2.4, 0.4, 0.01], { color: '#f2f2f2', roughness: 0.7, metalness: 0 }, { geometry: { text: (spec.text || `FRMU ${String(100000 + (spec.seed * 7919) % 900000)}`).slice(0, 40) } })
      break
    }
    case 'console': {
      const body = metal(primary ?? '#3b4452'), glow = secondary ?? '#38e1ff', strength = lit ? 1.8 : 0.9
      side('desk', 'Mesa de controle', [[-0.45, 0], [0.45, 0], [0.45, 0.75], [0.35, 0.85], [-0.25, 1.1], [-0.45, 1.1]], 0, 2.2, body,
        interactive ? { interaction: { trigger: 'click', key: '', radius: 3, action: 'message', targetId: null, message: (spec.text || 'Sistemas online.').slice(0, 160) }, sound: sound('machine', 0.15, 6) } : { sound: sound('machine', 0.15, 6) })
      P('panel', 'box', 'Painel traseiro', [0, 1.55, -0.38], [2.2, 0.9, 0.12], body)
      for (let i = 0; i < 3; i++) P(`screen${i}`, 'box', 'Monitor', [round((i - 1) * 0.72), 1.58, -0.315], [0.64, 0.5, 0.015], emissive(i === 1 ? glow : shade(glow, 0.8), strength, '#0c1a22'))
      const angle = Math.atan2(0.25, 0.6), nz = Math.sin(angle), ny = Math.cos(angle), at = (t: number, lift: number): [number, number] => [round(0.35 - 0.6 * t + nz * lift), round(0.85 + 0.25 * t + ny * lift)]
      const tilt = round(angle * 180 / Math.PI)
      const [kz, ky] = at(0.38, 0.0145)
      P('keyboard', 'box', 'Teclado', [0, ky, kz], [0.9, 0.025, 0.22], { color: '#1d232b', metalness: 0.3, roughness: 0.5 }, { rotation: [tilt, 0, 0] })
      const colors = ['#ff4d4d', '#4dff88', '#ffd23f']
      for (const s of [-1, 1]) for (let j = 0; j < 6; j++) {
        const [z, y] = at(0.25 + Math.floor(j / 3) * 0.3, 0.016)
        P(`button${s}${j}`, 'cylinder', 'Botão', [round(s * (0.6 + (j % 3) * 0.13)), y, z], [0.07, 0.03, 0.07], emissive(colors[(j + (s > 0 ? 1 : 0)) % 3], strength, '#222222'), { rotation: [tilt, 0, 0], geometry: { segments: 12 }, collidable: false })
      }
      if (lit) P('light', 'light', 'Brilho das telas', [0, 1.6, 0.6], [0.12, 0.12, 0.12], undefined, { light: point(glow, 3, 6) })
      break
    }
    case 'reactor': {
      const energy = primary ?? '#38e1ff', shell = metal(secondary ?? '#59606b'), dark = metal('#2e3339')
      P('platform', 'cylinder', 'Plataforma', [0, 0.15, 0], [4.2, 0.3, 4.2], dark, { geometry: { segments: 32 } })
      P('collarLow', 'cylinder', 'Anel inferior', [0, 0.5, 0], [1.9, 0.4, 1.9], shell, { geometry: { segments: 24 } })
      P('collarHigh', 'cylinder', 'Anel superior', [0, 3.5, 0], [1.9, 0.4, 1.9], shell, { geometry: { segments: 24 } })
      P('chamber', 'cylinder', 'Câmara do núcleo', [0, 2, 0], [1.4, 2.8, 1.4], { ...glass, emissive: energy, emissiveIntensity: 0.3, opacity: 0.45 }, { geometry: { segments: 24 } })
      P('plasma', 'capsule', 'Plasma', [0, 2, 0], [0.6, 2.4, 0.6], emissive(energy, lit ? 4 : 2.2, '#e9fdff'), { collidable: false, animation: loop('pulse', 'y', 1.4, 0.08), sound: sound('machine', 0.55, 16) })
      for (let i = 0; i < 3; i++) P(`ring${i}`, 'torus', 'Anel de contenção', [0, 1.3 + i * 0.7, 0], [1.85, 1.85, 0.12], { ...shell, emissive: energy, emissiveIntensity: lit ? 2 : 0.8 },
        { rotation: [90, 0, 0], geometry: { radius: round(0.12 / 3.7), segments: 24 }, collidable: false, animation: loop('pulse', 'y', 1.4, 0.05, i * 60) })
      for (let i = 0; i < 4; i++) { const a = rad(45 + i * 90); P(`strut${i}`, 'box', 'Escora', [round(Math.cos(a) * 0.85), 2, round(Math.sin(a) * 0.85)], [0.14, 2.6, 0.14], dark, { rotation: [0, yaw(a), 0] }) }
      P('dome', 'lathe', 'Cúpula', [0, 3.95, 0], [1.9, 0.5, 1.9], shell, { geometry: { profile: [[0, 0], [0.95, 0], [0.8, 0.25], [0.45, 0.45], [0, 0.5]] } })
      P('vent', 'cylinder', 'Exaustor', [0, 4.3, 0], [0.3, 0.2, 0.3], emissive(energy, lit ? 3 : 1.2, '#cfffff'), { collidable: false, animation: loop('pulse', 'y', 0.9, 0.1) })
      for (const s of [-1, 1]) {
        P(`tank${s}`, 'capsule', 'Tanque de refrigeração', [s * 2.6, 0.9, 0], [0.8, 1.8, 0.8], shell)
        tube(`pipe${s}`, 'Tubulação', [[s * 2.6, 1.75, 0], [s * 2.3, 2.6, 0], [s * 1.6, 3.1, 0], [s * 0.95, 3.35, 0]], 0.08, dark)
        tube(`feed${s}`, 'Tubulação', [[s * 2.25, 0.6, 0.3], [s * 1.6, 0.62, 0.35], [s * 0.95, 0.5, 0.3]], 0.06, dark)
      }
      if (lit) P('light', 'light', 'Brilho do reator', [0, 2, 0], [0.15, 0.15, 0.15], undefined, { light: point(energy, 10, 14) })
      break
    }
    case 'radarDish': {
      const M = metal(primary ?? '#c9cdd2'), dark = metal('#3a3f46'), dishMaterial: Material = { color: primary ?? '#eef0f2', metalness: 0.3, roughness: 0.4, doubleSided: true }
      P('pad', 'box', 'Base de concreto', [0, 0.2, 0], [2, 0.4, 2], { color: '#a7a7a2', texture: 'concrete', textureScale: 1.5, roughness: 0.95, metalness: 0 })
      P('mast', 'cylinder', 'Coluna', [0, 1.5, 0], [0.5, 2.2, 0.5], M)
      P('bearing', 'cylinder', 'Rolamento', [0, 2.725, 0], [0.9, 0.25, 0.9], dark, { sound: sound('machine', 0.2, 8) })
      const turn = G('yaw', 'Giro do radar', [0, 2.85, 0], { animation: loop('spin', 'y', 10 + random(1) * 6, 0) })
      P('turntable', 'cylinder', 'Mesa giratória', [0, 0.1, 0], [0.9, 0.2, 0.9], M, { parentId: turn })
      for (const s of [-1, 1]) P(`arm${s}`, 'box', 'Braço do suporte', [s * 0.2, 0.65, 0], [0.08, 0.9, 0.22], M, { parentId: turn })
      P('axle', 'cylinder', 'Eixo de elevação', [0, 1.2, 0], [0.12, 0.56, 0.12], dark, { parentId: turn, rotation: [0, 0, 90] })
      const tilt = G('tilt', 'Elevação da antena', [0, 1.2, 0], { parentId: turn, rotation: [round(40 + random(2) * 20), 0, 0] })
      P('hub', 'cylinder', 'Cubo da antena', [0, 0.1, 0], [0.3, 0.25, 0.3], dark, { parentId: tilt })
      P('dish', 'lathe', 'Antena parabólica', [0, 0.32, 0], [2.6, 0.5, 2.6], dishMaterial, { parentId: tilt, geometry: { profile: [[0.08, 0], [0.6, 0.08], [1, 0.24], [1.3, 0.46], [1.28, 0.5], [0.98, 0.28], [0.58, 0.12], [0.06, 0.04]], closed: true, segments: 32 } })
      P('feedArm', 'cylinder', 'Haste do receptor', [0, 0.75, 0], [0.05, 0.9, 0.05], dark, { parentId: tilt })
      P('feed', 'cone', 'Receptor', [0, 1.25, 0], [0.16, 0.2, 0.16], dark, { parentId: tilt, rotation: [180, 0, 0] })
      P('beacon', 'sphere', 'Sinalizador', [0, 1.42, 0], [0.12, 0.12, 0.12], emissive('#ff4040', lit ? 3 : 1), { parentId: tilt, collidable: false, animation: loop('pulse', 'y', 1.2, 0.3) })
      break
    }
    case 'turret': {
      const armor = metal(primary ?? '#596673'), dark = metal('#2a2f35'), eye = secondary ?? '#ff3b30'
      P('pedestal', 'lathe', 'Pedestal', [0, 0.5, 0], [1.8, 1, 1.8], dark, { geometry: { profile: [[0, 0], [0.9, 0], [0.9, 0.2], [0.7, 0.35], [0.55, 1], [0, 1]], segments: 24 } })
      for (let i = 0; i < 6; i++) { const a = rad(i * 60 + 30); P(`bolt${i}`, 'cylinder', 'Parafuso', [round(Math.cos(a) * 0.78), 0.23, round(Math.sin(a) * 0.78)], [0.08, 0.06, 0.08], iron, { geometry: { segments: 8 } }) }
      const head = G('head', 'Cabeça giratória', [0, 1, 0], { animation: loop('spin', 'y', 6 + random(1) * 3, 0) })
      P('ring', 'cylinder', 'Anel giratório', [0, 0.06, 0], [1, 0.12, 1], dark, { parentId: head })
      P('housing', 'roundedBox', 'Carcaça', [0, 0.42, 0], [1.1, 0.6, 1], armor, { parentId: head, geometry: { bevel: 0.08 } })
      for (const s of [-1, 1]) P(`plate${s}`, 'box', 'Blindagem lateral', [s * 0.58, 0.42, -0.05], [0.06, 0.45, 0.8], armor, { parentId: head })
      P('visor', 'box', 'Sensor', [0, 0.55, 0.505], [0.5, 0.12, 0.03], emissive(eye, lit ? 3 : 1.5, '#ffd0c8'), { parentId: head, collidable: false })
      for (const s of [-1, 1]) {
        P(`barrel${s}`, 'cylinder', 'Cano', [s * 0.22, 0.32, 0.95], [0.12, 1, 0.12], dark, { parentId: head, rotation: [90, 0, 0] })
        P(`muzzle${s}`, 'cylinder', 'Boca do cano', [s * 0.22, 0.32, 1.45], [0.18, 0.12, 0.18], iron, { parentId: head, rotation: [90, 0, 0] })
      }
      P('antenna', 'cylinder', 'Antena', [0.35, 0.95, -0.3], [0.03, 0.5, 0.03], iron, { parentId: head })
      if (lit) P('light', 'light', 'Luz do sensor', [0, 0.6, 0.8], [0.12, 0.12, 0.12], undefined, { parentId: head, light: point(eye, 2, 5) })
      break
    }
    case 'movingPlatform': {
      const span = 4, mover = G('mover', 'Plataforma deslizante', [0, 0, 0], { animation: { kind: 'keyframes', axis: 'x', duration: 8, amplitude: 0, phase: round(random(1) * 360), start: 'auto', easing: 'smooth',
        keys: [{ at: 0, move: still, turn: still, scale: unit }, { at: 0.5, move: [span, 0, 0], turn: still, scale: unit }, { at: 1, move: still, turn: still, scale: unit }] } })
      const glow = secondary ?? '#4fd8ff'
      P('deck', 'box', 'Piso da plataforma', [0, 0.75, 0], [3, 0.3, 3], metal(primary ?? '#6f7b88'), { parentId: mover })
      for (const s of [-1, 1]) {
        P(`trimX${s}`, 'box', 'Faixa de segurança', [0, 0.86, s * 1.47], [3.04, 0.08, 0.1], { color: '#e8b923', roughness: 0.5, metalness: 0.3 }, { parentId: mover })
        P(`trimZ${s}`, 'box', 'Faixa de segurança', [s * 1.47, 0.86, 0], [0.1, 0.08, 2.84], { color: '#e8b923', roughness: 0.5, metalness: 0.3 }, { parentId: mover })
      }
      for (const [i, [x, z]] of [[-1, -1], [1, -1], [-1, 1], [1, 1]].entries()) P(`beacon${i}`, 'sphere', 'Luz de posição', [x * 1.4, 0.93, z * 1.4], [0.1, 0.1, 0.1], emissive(glow, lit ? 3 : 1.2), { parentId: mover, collidable: false, geometry: { segments: 10 } })
      P('thruster', 'cylinder', 'Propulsor', [0, 0.45, 0], [1.2, 0.3, 1.2], metal('#2e3339'), { parentId: mover })
      P('exhaust', 'cylinder', 'Brilho do propulsor', [0, 0.28, 0], [0.9, 0.05, 0.9], emissive(glow, lit ? 3 : 1.4, '#d8f8ff'), { parentId: mover, collidable: false, animation: loop('pulse', 'y', 0.8, 0.1) })
      if (lit) P('light', 'light', 'Luz do propulsor', [0, 0.15, 0], [0.12, 0.12, 0.12], undefined, { parentId: mover, light: point(glow, 3, 5) })
      break
    }
    case 'jumpPad': {
      const glow = primary ?? '#3dff9a'
      P('base', 'cylinder', 'Base', [0, 0.1, 0], [1.8, 0.2, 1.8], metal('#3a3f46'), { geometry: { segments: 24 } })
      P('pad', 'cylinder', 'Placa de impulso', [0, 0.24, 0], [1.4, 0.08, 1.4], emissive(glow, lit ? 2.4 : 1.2, '#e6fff2'), { geometry: { segments: 24 }, sound: sound('magic', 0.25, 8) })
      P('ring', 'torus', 'Anel de energia', [0, 0.27, 0], [1.6, 1.6, 0.05], emissive(glow, lit ? 3 : 1.5), { rotation: [90, 0, 0], geometry: { radius: round(0.05 / 3.2) }, collidable: false, animation: loop('pulse', 'y', 1, 0.12) })
      for (let i = 0; i < 3; i++) P(`chevron${i}`, 'torus', 'Onda de impulso', [0, 0.7 + i * 0.5, 0], [1.1 - i * 0.2, 1.1 - i * 0.2, 0.03], { ...emissive(glow, 1.5), opacity: 0.5, transparent: true },
        { rotation: [90, 0, 0], geometry: { radius: round(0.03 / (2.2 - i * 0.4)) }, collidable: false, animation: loop('float', 'y', 1.2, 0.12, i * 120) })
      P('column', 'cylinder', 'Coluna de energia', [0, 1.3, 0], [1.2, 2, 1.2], { ...emissive(glow, 0.8), opacity: 0.12, transparent: true, doubleSided: true }, { collidable: false })
      if (lit) P('light', 'light', 'Brilho do impulso', [0, 0.8, 0], [0.12, 0.12, 0.12], undefined, { light: point(glow, 3, 5) })
      break
    }
    case 'heart': {
      const profile = Array.from({ length: 28 }, (_, i): Pt => { const t = i / 28 * Math.PI * 2; return [round(Math.sin(t) ** 3), round((13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) / 16)] })
      const red = primary ?? '#ff3b5c'
      const bob = G('pickup', 'Coração de vida', [0, 1, 0], { animation: loop('float', 'y', 2.2, 0.12, random(1) * 360),
        ...(interactive ? { interaction: { trigger: 'proximity', key: '', radius: 1.4, action: 'heal', targetId: null, message: '', amount: 35 } } : {}) })
      const spin = G('spinner', 'Giro do coração', [0, 0, 0], { parentId: bob, animation: loop('spin', 'y', 3, 0) })
      P('heart', 'extrude', 'Coração', [0, 0, 0], [0.62, 0.6, 0.22], { color: red, emissive: red, emissiveIntensity: lit ? 1.4 : 0.6, roughness: 0.25, metalness: 0.1, clearcoat: 1 }, { parentId: spin, geometry: { profile, bevel: 0.12 }, collidable: false })
      P('halo', 'sphere', 'Aura', [0, 0, 0], [0.95, 0.95, 0.95], { color: '#ffd0da', emissive: red, emissiveIntensity: 0.6, opacity: 0.12, transparent: true, roughness: 1, metalness: 0 }, { parentId: bob, collidable: false, geometry: { segments: 16 } })
      if (lit) P('light', 'light', 'Brilho do coração', [0, 0, 0], [0.1, 0.1, 0.1], undefined, { parentId: bob, light: point(red, 2, 4) })
      break
    }
    case 'key': {
      const item = required || 'Chave dourada', gold: Material = { color: primary ?? '#f2c14e', metalness: 1, roughness: 0.22, emissive: '#7a5200', emissiveIntensity: lit ? 0.8 : 0.35 }
      const bob = G('pickup', item, [0, 1, 0], { animation: loop('float', 'y', 2.4, 0.1, random(1) * 360),
        ...(interactive ? { interaction: { trigger: 'proximity', key: '', radius: 1.4, action: 'collect', targetId: null, message: `Você pegou: ${item}`, item } } : {}) })
      const spin = G('spinner', 'Giro da chave', [0, 0, 0], { parentId: bob, animation: loop('spin', 'y', 2.6, 0) })
      P('bow', 'torus', 'Argola da chave', [0, 0.25, 0], [0.36, 0.36, 0.07], gold, { parentId: spin, geometry: { radius: round(0.07 / 0.72) }, collidable: false })
      P('gem', 'sphere', 'Joia', [0, 0.25, 0], [0.1, 0.1, 0.05], emissive(secondary ?? '#ff4d6d', 1.5), { parentId: spin, collidable: false, geometry: { segments: 12 } })
      P('collar', 'cylinder', 'Colar', [0, 0.05, 0], [0.1, 0.04, 0.1], gold, { parentId: spin, collidable: false })
      P('shaft', 'cylinder', 'Haste', [0, -0.18, 0], [0.06, 0.54, 0.06], gold, { parentId: spin, collidable: false })
      for (const [i, [y, w]] of [[-0.3, 0.12], [-0.38, 0.09], [-0.44, 0.13]].entries()) P(`tooth${i}`, 'box', 'Dente', [w / 2 + 0.02, y, 0], [w, 0.045, 0.03], gold, { parentId: spin, collidable: false })
      P('sparkle', 'sphere', 'Brilho', [0, 0, 0], [0.8, 0.8, 0.8], { color: '#fff4c4', emissive: '#ffd257', emissiveIntensity: 0.6, opacity: 0.1, transparent: true, roughness: 1, metalness: 0 }, { parentId: bob, collidable: false, geometry: { segments: 16 } })
      if (lit) P('light', 'light', 'Brilho da chave', [0, 0, 0], [0.1, 0.1, 0.1], undefined, { parentId: bob, light: point('#ffd257', 2, 4) })
      break
    }
    case 'powerOrb': {
      const power = orbPower(spec), color = primary ?? powerColors[power]
      P('pedestal', 'lathe', 'Pedestal', [0, 0.25, 0], [0.7, 0.5, 0.7], stone('#8f8a84'), { geometry: { profile: [[0, 0], [0.35, 0], [0.3, 0.08], [0.2, 0.3], [0.28, 0.5], [0, 0.5]], segments: 20 } })
      P('rune', 'torus', 'Runa do pedestal', [0, 0.5, 0], [0.5, 0.5, 0.03], emissive(color, lit ? 2.5 : 1.2), { rotation: [90, 0, 0], geometry: { radius: 0.03 }, collidable: false })
      const bob = G('orb', 'Orbe de poder', [0, 1.25, 0], { animation: loop('float', 'y', 2.6, 0.1, random(1) * 360),
        ...(interactive ? { interaction: { trigger: 'proximity', key: '', radius: 1.4, action: 'powerup', targetId: null, message: `Poder de ${powerNames[power]} por 12 s`, amount: 12, power } } : {}) })
      P('core', 'sphere', 'Núcleo', [0, 0, 0], [0.42, 0.42, 0.42], emissive(color, lit ? 3.5 : 2, '#ffffff'), { parentId: bob, collidable: false, geometry: { segments: 20 }, sound: sound('magic', 0.2, 6), animation: loop('pulse', 'y', 1.1, 0.08) })
      P('shell', 'sphere', 'Casca de energia', [0, 0, 0], [0.62, 0.62, 0.62], { color, emissive: color, emissiveIntensity: 0.6, opacity: 0.25, transparent: true, iridescence: 0.8, roughness: 0.1, metalness: 0 }, { parentId: bob, collidable: false, geometry: { segments: 20 } })
      for (const [i, [rotation, axis]] of ([[[70, 0, 0], 'z'], [[0, 0, 60], 'x']] as const).entries()) {
        const orbit = G(`orbit${i}`, 'Anel orbital', [0, 0, 0], { parentId: bob, rotation: [rotation[0], rotation[1], rotation[2]], animation: loop('spin', axis, 2 + i, 0) })
        P(`ring${i}`, 'torus', 'Anel orbital', [0, 0, 0], [0.85, 0.85, 0.03], emissive(color, 2), { parentId: orbit, rotation: [90, 0, 0], geometry: { radius: round(0.03 / 1.7) }, collidable: false })
      }
      if (lit) P('light', 'light', 'Brilho do orbe', [0, 0, 0], [0.1, 0.1, 0.1], undefined, { parentId: bob, light: point(color, 3, 5) })
      break
    }
  }
  return parts.map((part) => {
    const segments = segmentDefaults[part.kind]
    return segments && part.geometry?.segments === undefined ? { ...part, geometry: { ...part.geometry, segments } } : part
  })
}
