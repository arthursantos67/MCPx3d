import * as THREE from 'three'
import { DEFAULT_MOTION, hasSurface, type SceneEnvironment, type SceneNode, type ThreeSceneDocument, type Vector3Tuple } from './sceneDocument.ts'
import { sceneMatrices } from './scenePlacement.ts'
import { resolveAmbience } from './sceneAudio.ts'
import type { GroundSampler, QualityLevel } from './sceneRuntimeTypes.ts'

export type FaunaDensity = 'auto' | 'none' | 'rich'
export type FaunaHabitat = 'none' | 'forest' | 'meadow' | 'tropical' | 'beach' | 'desert' | 'snow' | 'alpine' | 'swamp' | 'city' | 'volcanic' | 'underwater'
export type BirdKind = 'songbird' | 'parrot' | 'pigeon' | 'crow' | 'gull' | 'raptor'
/** `center.y` is the ground level the flock circles above; `altitude` is metres above it. */
export interface BirdFlock { center: Vector3Tuple; radius: number; altitude: number; count: number; kind: BirdKind }
/** `center.y` is the water surface; fish swim `depth` metres below it. */
export interface FishSchool { center: Vector3Tuple; radius: number; depth: number; count: number; color: string }
/** Insects flutter over `center` (ground level); `glow` is the share that become fireflies at night. */
export interface InsectSwarm { center: Vector3Tuple; radius: number; count: number; glow: number; kind: 'butterfly' | 'dragonfly' }
export interface FaunaPlan { habitat: FaunaHabitat; seed: number; birds: BirdFlock[]; fish: FishSchool[]; butterflies: InsectSwarm[] }
export interface FaunaSystem {
  object: THREE.Object3D
  update(camera: THREE.Camera, seconds: number, dt: number, player: THREE.Vector3 | null, night: number): void
  /** Startles wildlife near an attack, shot or impact; birds take off and flee, fish scatter, insects disperse. */
  scare(position: THREE.Vector3, radius: number): void
  setQuality(quality: QualityLevel): void
  dispose(): void
}

/** Instances drawn per quality level (one draw call per kind: birds, fish, insects, fireflies). */
export const FAUNA_BUDGET: Record<QualityLevel, { birds: number; fish: number; insects: number }> = {
  low: { birds: 16, fish: 24, insects: 16 }, medium: { birds: 36, fish: 56, insects: 36 }, high: { birds: 64, fish: 96, insects: 64 },
}

interface HabitatProfile { bird: BirdKind | null; flocks: number; flock: [number, number]; altitude: number; fish: boolean; insects: number; glow: number; fishColor: string }
const habitats: Record<FaunaHabitat, HabitatProfile> = {
  none: { bird: null, flocks: 0, flock: [0, 0], altitude: 0, fish: false, insects: 0, glow: 0, fishColor: '#7d8f99' },
  forest: { bird: 'songbird', flocks: 2, flock: [8, 14], altitude: 6, fish: true, insects: 1, glow: 0.6, fishColor: '#7d8f86' },
  meadow: { bird: 'songbird', flocks: 2, flock: [10, 16], altitude: 6, fish: true, insects: 1.2, glow: 0.5, fishColor: '#8a9a8c' },
  tropical: { bird: 'parrot', flocks: 2, flock: [6, 10], altitude: 7, fish: true, insects: 1.4, glow: 0.8, fishColor: '#f08a3c' },
  beach: { bird: 'gull', flocks: 2, flock: [5, 9], altitude: 8, fish: true, insects: 0.25, glow: 0.2, fishColor: '#9fb4c4' },
  desert: { bird: 'raptor', flocks: 1, flock: [2, 4], altitude: 24, fish: true, insects: 0, glow: 0, fishColor: '#a39274' },
  snow: { bird: 'crow', flocks: 1, flock: [4, 7], altitude: 8, fish: false, insects: 0, glow: 0, fishColor: '#7d8f99' },
  alpine: { bird: 'raptor', flocks: 1, flock: [2, 3], altitude: 20, fish: true, insects: 0.5, glow: 0.2, fishColor: '#7f949c' },
  swamp: { bird: 'crow', flocks: 1, flock: [3, 6], altitude: 6, fish: true, insects: 1.6, glow: 1, fishColor: '#6f7a55' },
  city: { bird: 'pigeon', flocks: 1, flock: [6, 10], altitude: 5, fish: true, insects: 0.3, glow: 0, fishColor: '#8b8f99' },
  volcanic: { bird: null, flocks: 0, flock: [0, 0], altitude: 0, fish: false, insects: 0, glow: 0, fishColor: '#7d8f99' },
  underwater: { bird: null, flocks: 0, flock: [0, 0], altitude: 0, fish: true, insects: 0, glow: 0, fishColor: '#ffb347' },
}
const biomeHabitat: Record<string, FaunaHabitat> = { meadow: 'meadow', alpine: 'alpine', desert: 'desert', volcanic: 'volcanic', forest: 'forest', snow: 'snow', tropical: 'tropical', swamp: 'swamp', lunar: 'none', alien: 'none' }
const placeHabitat: Record<string, FaunaHabitat> = { forest: 'forest', meadow: 'meadow', beach: 'beach', desert: 'desert', snow: 'snow', swamp: 'swamp', city: 'city', volcanic: 'volcanic',
  night: 'meadow', wind: 'alpine', rain: 'meadow', underwater: 'underwater', cave: 'none', dungeon: 'none', space: 'none', scifi: 'none' }
const trees = new Set(['tree', 'pine', 'palm']), shrubs = new Set(['bush', 'mushroom', 'stump', 'log', 'cactus']), reef = new Set(['coral', 'seaweed'])

const random = (seed: number) => {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = Math.imul(state ^ (state >>> 15), state | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const textHash = (text: string) => { let h = 0x811c9dc5; for (let i = 0; i < Math.min(128, text.length); i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0; return h }
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const smooth = (from: number, to: number, value: number) => { const t = clamp((value - from) / (to - from), 0, 1); return t * t * (3 - 2 * t) }

export const faunaDensity = (env: SceneEnvironment): FaunaDensity => env.motion?.fauna ?? DEFAULT_MOTION.fauna

/** Pure: where wildlife could live, from sky, explicit or inferred ambience (names, weather, water) and the largest terrain biome. Space, caves, dungeons, sci-fi interiors and the moon have none. */
export function faunaHabitat(doc: ThreeSceneDocument): FaunaHabitat {
  const env = doc.environment, sky = env.sky ?? 'studio'
  if (sky === 'space') return 'none'
  const explicit = env.audio?.ambience
  const place = explicit && explicit !== 'auto' && explicit !== 'none' ? explicit
    : resolveAmbience({ ...doc, environment: { ...env, audio: { ambience: 'auto', music: env.audio?.music ?? 'auto', volume: env.audio?.volume ?? 0.7 } } })
  if (place === 'space' || place === 'scifi' || place === 'cave' || place === 'dungeon') return 'none'
  if (place === 'underwater') return 'underwater'
  let biome: string | null = null, largest = 0
  for (const node of doc.nodes) {
    if (node.kind !== 'terrain' || !node.visible || !node.geometry.biome || node.geometry.biome === 'none') continue
    const area = Math.abs(node.dimensions[0] * node.scale[0] * node.dimensions[2] * node.scale[2])
    if (area > largest) { largest = area; biome = node.geometry.biome }
  }
  if (biome) return biomeHabitat[biome] ?? 'meadow'
  if (place === 'none') return sky === 'studio' ? 'none' : 'meadow'
  return placeHabitat[place] ?? 'meadow'
}

interface Item { x: number; z: number; base: number; top: number; weight: number; area: number }
interface Cluster { x: number; z: number; base: number; top: number; weight: number; spread: number }
function cluster(items: Item[], cell: number): Cluster[] {
  const cells = new Map<string, Item[]>()
  for (const item of items) { const key = `${Math.floor(item.x / cell)},${Math.floor(item.z / cell)}`; const list = cells.get(key); if (list) list.push(item); else cells.set(key, [item]) }
  const result: (Cluster & { key: string })[] = []
  for (const [key, list] of cells) {
    let weight = 0, x = 0, z = 0, base = Infinity, top = -Infinity
    for (const item of list) { weight += item.weight; x += item.x * item.weight; z += item.z * item.weight; base = Math.min(base, item.base); top = Math.max(top, item.top) }
    x /= weight; z /= weight
    const spread = Math.max(0, ...list.map((item) => Math.hypot(item.x - x, item.z - z)))
    result.push({ key, x, z, base, top, weight, spread })
  }
  return result.sort((a, b) => b.weight - a.weight || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
}

interface Anchors { trees: Item[]; shrubs: Item[]; flowers: Item[]; reef: Item[]; fields: Item[]; water: (Item & { depth: number })[]; structures: Item[] }
function anchors(doc: ThreeSceneDocument): Anchors {
  const matrices = sceneMatrices(doc), byId = new Map(doc.nodes.map((node) => [node.id, node])), rootCache = new Map<string, SceneNode | null>()
  const rootOf = (node: SceneNode): SceneNode | null => {
    if (rootCache.has(node.id)) return rootCache.get(node.id)!
    const parent = node.parentId ? byId.get(node.parentId) : undefined
    const root = node.asset ? node : parent ? rootOf(parent) : null
    rootCache.set(node.id, root)
    return root
  }
  const hidden = new Set<string>()
  for (const node of doc.nodes) if (!node.visible) hidden.add(node.id)
  const roots = new Map<string, THREE.Box3>(), result: Anchors = { trees: [], shrubs: [], flowers: [], reef: [], fields: [], water: [], structures: [] }
  const unit = new THREE.Box3(), half = new THREE.Vector3()
  const item = (box: THREE.Box3, weight = 1): Item => ({ x: (box.min.x + box.max.x) / 2, z: (box.min.z + box.max.z) / 2, base: box.min.y, top: box.max.y, weight, area: (box.max.x - box.min.x) * (box.max.z - box.min.z) })
  for (const node of doc.nodes) {
    if (!hasSurface(node.kind) || hidden.has(node.id) || (node.parentId && hidden.has(node.parentId))) continue
    half.fromArray(node.dimensions).multiplyScalar(0.5)
    const box = unit.set(half.clone().negate(), half).clone().applyMatrix4(matrices.get(node.id)!)
    if (![box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z].every(Number.isFinite)) continue
    if (node.kind === 'terrain') { result.fields.push(item(box)); continue }
    if (node.material.texture === 'water' && !node.asset && !rootOf(node)?.asset?.type.match(/^(fountain|well)$/)) {
      const water = item(box)
      if (water.area >= 9) result.water.push({ ...water, base: box.max.y, depth: box.max.y - box.min.y })
      continue
    }
    const root = rootOf(node)
    if (root) { const current = roots.get(root.id); if (current) current.union(box); else roots.set(root.id, box) }
    else if (node.role === 'vegetation') (box.max.y - box.min.y > 2.5 ? result.trees : result.shrubs).push(item(box))
    else if (node.role === 'structure') result.structures.push(item(box))
  }
  for (const [id, box] of roots) {
    const type = byId.get(id)!.asset!.type
    if (trees.has(type)) result.trees.push(item(box))
    else if (shrubs.has(type)) result.shrubs.push(item(box))
    else if (type === 'flowerBed') result.flowers.push(item(box, 3))
    else if (reef.has(type)) result.reef.push(item(box))
    else result.structures.push(item(box))
  }
  return result
}

function trim<T extends { count: number }>(groups: T[], cap: number): T[] {
  let left = cap
  return groups.flatMap((group) => { const count = Math.min(group.count, left); left -= count; return count > 0 ? [{ ...group, count }] : [] })
}

/** Pure, deterministic: wildlife groups for a scene from its habitat, vegetation, flower beds, terrain and water. 'none' (or a studio/space/enclosed scene under 'auto') yields nothing; 'rich' adds groups and individuals. Totals never exceed the high-quality budget. */
export function planFauna(doc: ThreeSceneDocument, density: FaunaDensity = faunaDensity(doc.environment)): FaunaPlan {
  const env = doc.environment, seed = textHash(`${doc.name}:${doc.nodes.length}`), empty: FaunaPlan = { habitat: 'none', seed, birds: [], fish: [], butterflies: [] }
  if (density === 'none') return empty
  const habitat = faunaHabitat(doc)
  if (habitat === 'none' || ((env.sky ?? 'studio') === 'studio' && density === 'auto')) return { ...empty, habitat: (env.sky ?? 'studio') === 'studio' ? 'none' : habitat }
  const profile = habitats[habitat], rich = density === 'rich', r = random(seed), found = anchors(doc), weather = env.weather ?? 'none'
  const birdWeather = weather === 'rain' ? 0.5 : weather === 'snow' ? 0.6 : weather === 'ash' || weather === 'embers' ? 0 : 1
  const insectWeather = weather === 'rain' || weather === 'snow' || weather === 'ash' || weather === 'embers' || weather === 'bubbles' ? 0 : 1
  const fields = [...found.fields].sort((a, b) => b.area - a.area), waters = [...found.water].sort((a, b) => b.area - a.area)
  const fieldAnchor = (field: Item) => ({ x: field.x, z: field.z, base: field.base + (field.top - field.base) * 0.4, top: field.base + (field.top - field.base) * 0.4, spread: Math.min(field.top - field.base + Math.sqrt(field.area) / 3, 30), weight: 1 })
  const everything = [...found.structures, ...found.trees, ...found.shrubs]
  const bounds = everything.length ? (() => {
    const xs = everything.map((i) => i.x), zs = everything.map((i) => i.z), x = (Math.min(...xs) + Math.max(...xs)) / 2, z = (Math.min(...zs) + Math.max(...zs)) / 2
    return { x, z, base: Math.min(...everything.map((i) => i.base)), top: Math.min(...everything.map((i) => i.base)), spread: Math.min(30, Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)) / 2, weight: 1 }
  })() : null

  const birds: BirdFlock[] = []
  if (profile.bird && birdWeather > 0) {
    const woods = cluster(found.trees, 36).filter((c) => c.weight >= 2)
    const waterAnchors = waters.map((w) => ({ x: w.x, z: w.z, base: w.base, top: w.base, spread: Math.sqrt(w.area) / 3, weight: 1 }))
    let candidates: { x: number; z: number; base: number; top: number; spread: number }[] =
      profile.bird === 'gull' ? [...waterAnchors, ...woods] : profile.bird === 'pigeon' ? [...(bounds ? [bounds] : []), ...woods] : profile.bird === 'raptor' ? [...fields.map(fieldAnchor), ...woods] : woods
    if (!candidates.length) candidates = fields.map(fieldAnchor)
    if (!candidates.length && rich && bounds) candidates = [bounds]
    const flocks = Math.min(candidates.length, profile.flocks + (rich ? 1 : 0))
    for (let i = 0; i < flocks; i++) {
      const anchor = candidates[i], [low, high] = profile.flock
      const count = Math.max(2, Math.round((low + r() * (high - low)) * (rich ? 1.6 : 1) * birdWeather))
      const ceiling = profile.bird === 'raptor' ? 60 : 40
      birds.push({ center: [anchor.x, anchor.base, anchor.z], radius: clamp(anchor.spread + 10, 12, ceiling), altitude: Math.max(0, anchor.top - anchor.base) + profile.altitude * (0.8 + r() * 0.4), count, kind: profile.bird })
    }
  }

  const fish: FishSchool[] = []
  if (profile.fish) {
    const schools = rich ? 5 : 3
    for (const water of waters.slice(0, schools)) {
      const size = Math.sqrt(water.area)
      fish.push({ center: [water.x, water.base, water.z], radius: clamp(size * 0.35, 1.5, 18), depth: water.depth > 0.3 ? clamp(water.depth * 0.5, 0.3, 1.4) : 0.55,
        count: Math.round(clamp(size * 0.9, 4, 18) * (rich ? 1.5 : 1)), color: profile.fishColor })
    }
    if (habitat === 'underwater' && fish.length < schools) {
      const reefs: { x: number; z: number; base: number; spread: number }[] = cluster(found.reef, 20)
      if (!reefs.length && bounds) reefs.push(bounds)
      for (const spot of reefs.slice(0, schools - fish.length))
        fish.push({ center: [spot.x, spot.base + 3.5, spot.z], radius: clamp(spot.spread + 5, 5, 14), depth: 1.6, count: Math.round((10 + r() * 6) * (rich ? 1.5 : 1)), color: profile.fishColor })
    }
  }

  const butterflies: InsectSwarm[] = []
  if (profile.insects > 0 && insectWeather > 0) {
    const swarms = rich ? 6 : 3, dragonfly = habitat === 'swamp'
    let spots: { x: number; z: number; base: number; spread: number; weight: number }[] = cluster([...found.flowers, ...found.shrubs], 18).filter((c) => c.weight >= 2)
    if (dragonfly) spots = [...waters.map((w) => ({ x: w.x, z: w.z, base: w.base, spread: Math.min(6, Math.sqrt(w.area) / 3), weight: 3 })), ...spots]
    if (!spots.length && habitat !== 'beach' && habitat !== 'city') spots = fields.slice(0, 1).map((field) => { const a = fieldAnchor(field); return { ...a, spread: Math.min(a.spread, 8), weight: 2 } })
    for (const spot of spots.slice(0, swarms))
      butterflies.push({ center: [spot.x, spot.base, spot.z], radius: clamp(spot.spread + 2.5, 2.5, 9), count: Math.round(clamp((3 + spot.weight * 1.5) * profile.insects * (rich ? 1.6 : 1), 3, 14)), glow: profile.glow, kind: dragonfly ? 'dragonfly' : 'butterfly' })
  }
  const cap = FAUNA_BUDGET.high
  return { habitat, seed, birds: trim(birds, cap.birds), fish: trim(fish, cap.fish), butterflies: trim(butterflies, cap.insects) }
}

/** Pure: active individuals per group for a quality level, proportional to the plan and within `FAUNA_BUDGET`. */
export function faunaCounts(plan: FaunaPlan, quality: QualityLevel): { birds: number[]; fish: number[]; butterflies: number[] } {
  const budget = FAUNA_BUDGET[quality] ?? FAUNA_BUDGET.medium
  const share = (groups: { count: number }[], cap: number) => {
    const total = groups.reduce((sum, group) => sum + group.count, 0), scale = total > cap ? cap / total : 1
    const counts = groups.map((group) => Math.min(group.count, Math.floor(group.count * scale)))
    let left = Math.min(cap, total) - counts.reduce((sum, value) => sum + value, 0)
    for (let i = 0; left > 0 && i < counts.length; i++) if (counts[i] < groups[i].count) { counts[i]++; left-- }
    return counts
  }
  return { birds: share(plan.birds, budget.birds), fish: share(plan.fish, budget.fish), butterflies: share(plan.butterflies, budget.insects) }
}
export const faunaTotals = (plan: FaunaPlan) => ({ birds: plan.birds.reduce((s, g) => s + g.count, 0), fish: plan.fish.reduce((s, g) => s + g.count, 0), butterflies: plan.butterflies.reduce((s, g) => s + g.count, 0) })

export interface FlockBoid { position: THREE.Vector3; velocity: THREE.Vector3 }
export interface FlockRules {
  center: THREE.Vector3; radius: number; minY: number; maxY: number
  target: THREE.Vector3 | null; seek: number
  cohesion: number; alignment: number; separation: number; spacing: number; view: number
  minSpeed: number; maxSpeed: number; maxAccel: number
  threat: THREE.Vector3 | null; threatRadius: number; threatStrength: number
  /** Scales vertical steering: 1 for birds, below 1 keeps fish level. */
  vertical: number
}
const acc = new THREE.Vector3(), centroid = new THREE.Vector3(), heading = new THREE.Vector3(), push = new THREE.Vector3(), delta = new THREE.Vector3()
/** Pure boids step (cohesion, alignment, separation, seek, threat avoidance, soft and hard bounds) with fixed sub-steps; positions always stay inside the bounds and finite. */
export function stepFlock(boids: FlockBoid[], rules: FlockRules, dt: number, active = boids.length): void {
  const count = Math.min(active, boids.length), duration = Number.isFinite(dt) ? clamp(dt, 0, 0.25) : 0
  if (!count || duration <= 0) return
  const steps = Math.ceil(duration / (1 / 30)), h = duration / steps, view2 = rules.view * rules.view, space2 = rules.spacing * rules.spacing, hard = rules.radius * 1.25, soft = rules.radius * 0.85
  const low = Math.min(rules.minY, rules.maxY), high = Math.max(rules.minY, rules.maxY)
  for (let step = 0; step < steps; step++) for (let i = 0; i < count; i++) {
    const { position: p, velocity: v } = boids[i]
    acc.set(0, 0, 0); centroid.set(0, 0, 0); heading.set(0, 0, 0); push.set(0, 0, 0)
    let neighbours = 0
    for (let j = 0; j < count; j++) {
      if (j === i) continue
      delta.subVectors(boids[j].position, p)
      const d2 = delta.lengthSq()
      if (d2 > view2) continue
      neighbours++; centroid.add(boids[j].position); heading.add(boids[j].velocity)
      if (d2 < space2 && d2 > 1e-8) push.addScaledVector(delta, -rules.spacing / d2)
    }
    if (neighbours) {
      acc.addScaledVector(centroid.divideScalar(neighbours).sub(p), rules.cohesion)
      acc.addScaledVector(heading.divideScalar(neighbours).sub(v), rules.alignment)
    }
    acc.addScaledVector(push, rules.separation)
    if (rules.target) {
      delta.subVectors(rules.target, p)
      if (delta.lengthSq() > 1e-8) acc.addScaledVector(delta.normalize().multiplyScalar(rules.maxSpeed).sub(v), rules.seek)
    }
    if (rules.threat) {
      delta.subVectors(p, rules.threat)
      const d = delta.length()
      if (d < rules.threatRadius) acc.addScaledVector(d > 1e-6 ? delta.divideScalar(d) : delta.set(1, 0.3, 0), rules.threatStrength * (1 - d / rules.threatRadius))
    }
    const dx = p.x - rules.center.x, dz = p.z - rules.center.z, reach = Math.hypot(dx, dz)
    if (reach > soft) { acc.x -= dx / reach * (reach - soft) * 2; acc.z -= dz / reach * (reach - soft) * 2 }
    if (p.y < low + 1) acc.y += (low + 1 - p.y) * 3
    if (p.y > high - 1) acc.y -= (p.y - high + 1) * 3
    acc.y *= rules.vertical
    if (acc.lengthSq() > rules.maxAccel * rules.maxAccel) acc.setLength(rules.maxAccel)
    v.addScaledVector(acc, h)
    const speed = v.length()
    if (speed < 1e-6) v.set(1, 0, 0).multiplyScalar(rules.minSpeed)
    else if (speed > rules.maxSpeed) v.multiplyScalar(rules.maxSpeed / speed)
    else if (speed < rules.minSpeed) v.multiplyScalar(rules.minSpeed / speed)
    p.addScaledVector(v, h)
    const ox = p.x - rules.center.x, oz = p.z - rules.center.z, out = Math.hypot(ox, oz)
    if (out > hard) {
      p.x = rules.center.x + ox / out * hard; p.z = rules.center.z + oz / out * hard
      const radial = (v.x * ox + v.z * oz) / out
      if (radial > 0) { v.x -= ox / out * radial * 1.5; v.z -= oz / out * radial * 1.5 }
    }
    if (p.y < low) { p.y = low; if (v.y < 0) v.y = 0 }
    if (p.y > high) { p.y = high; if (v.y > 0) v.y = 0 }
    if (![p.x, p.y, p.z, v.x, v.y, v.z].every(Number.isFinite)) {
      p.set(rules.center.x + Math.cos(i) * 0.5, (low + high) / 2, rules.center.z + Math.sin(i) * 0.5)
      v.set(Math.cos(i * 1.7), 0, Math.sin(i * 1.7)).multiplyScalar(Math.max(rules.minSpeed, 0.1))
    }
  }
}

interface BirdSpec { span: number; speed: number; flap: number; angle: number; glide: number; colors: string[] }
const birdSpecs: Record<BirdKind, BirdSpec> = {
  songbird: { span: 0.32, speed: 6, flap: 9, angle: 1, glide: 0.15, colors: ['#7a5a3c', '#8c6b48', '#5f4a36', '#9a7b55'] },
  parrot: { span: 0.55, speed: 7, flap: 6, angle: 0.9, glide: 0.2, colors: ['#d8322f', '#2f8f46', '#f2b632', '#2c6fd1'] },
  pigeon: { span: 0.62, speed: 7, flap: 6, angle: 0.9, glide: 0.25, colors: ['#8b8f99', '#9a9ea8', '#767a84'] },
  crow: { span: 0.85, speed: 7, flap: 4, angle: 0.8, glide: 0.35, colors: ['#24262b', '#2e3036'] },
  gull: { span: 1.15, speed: 6, flap: 3, angle: 0.6, glide: 0.65, colors: ['#eef1f4', '#e3e8ec', '#d7dde2'] },
  raptor: { span: 1.8, speed: 8, flap: 2, angle: 0.45, glide: 0.85, colors: ['#5a4230', '#4b3828', '#6b5038'] },
}
const butterflyColors = ['#f2a33a', '#f5e15b', '#7fb6ff', '#ffffff', '#e86a92', '#b48bff'], dragonflyColors = ['#3fb6a8', '#4d8fd6', '#78c25a']

type Tri = [number, number, number][]
/** Unit model facing +Z with wings along ±X; `aPart` weights how much each vertex follows the wing (or tail) motion. */
function creatureGeometry(triangles: Tri[], part: (p: [number, number, number]) => number, shade: (p: [number, number, number]) => number): THREE.BufferGeometry {
  const positions: number[] = [], parts: number[] = [], colors: number[] = []
  for (const triangle of triangles) for (const p of triangle) { positions.push(...p); parts.push(part(p)); const s = shade(p); colors.push(s, s, s) }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('aPart', new THREE.Float32BufferAttribute(parts, 1))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geometry.computeVertexNormals()
  return geometry
}
function diamond(length: number, back: number, width: number, height: number): Tri[] {
  const nose: [number, number, number] = [0, 0, length], tail: [number, number, number] = [0, 0, -back]
  const ring: [number, number, number][] = [[width, 0, 0], [0, height, 0], [-width, 0, 0], [0, -height * 0.8, 0]]
  return ring.flatMap((a, i) => { const b = ring[(i + 1) % 4]; return [[nose, b, a], [tail, a, b]] as Tri[] })
}
const birdGeometry = () => creatureGeometry([
  ...diamond(0.26, 0.22, 0.05, 0.06),
  [[0, 0.01, -0.18], [-0.1, 0.01, -0.36], [0.1, 0.01, -0.36]],
  ...[1, -1].flatMap((s) => [[[s * 0.04, 0.02, 0.1], [s * 0.5, 0.02, 0.0], [s * 0.42, 0.02, -0.12]], [[s * 0.04, 0.02, 0.1], [s * 0.42, 0.02, -0.12], [s * 0.04, 0.02, -0.1]]] as Tri[]),
], (p) => Math.abs(p[0]) > 0.045 ? clamp(Math.abs(p[0]) / 0.5, 0, 1) : 0, (p) => Math.abs(p[0]) > 0.35 ? 0.72 : p[1] < -0.01 ? 1.12 : 1)
const fishGeometry = () => creatureGeometry([
  ...diamond(0.24, 0.26, 0.045, 0.1),
  [[0, 0, -0.2], [0, 0.11, -0.42], [0, -0.11, -0.42]],
  [[0, 0.09, 0.04], [0, 0.15, -0.06], [0, 0.07, -0.12]],
], (p) => clamp((0.12 - p[2]) / 0.54, 0, 1), (p) => p[1] > 0.04 ? 0.7 : p[1] < -0.03 ? 1.25 : 1)
const insectGeometry = () => creatureGeometry([
  ...diamond(0.12, 0.2, 0.025, 0.025),
  ...[1, -1].flatMap((s) => [[[s * 0.02, 0, 0.06], [s * 0.5, 0, 0.32], [s * 0.46, 0, -0.04]], [[s * 0.02, 0, 0.02], [s * 0.4, 0, -0.08], [s * 0.3, 0, -0.38]]] as Tri[]),
], (p) => Math.abs(p[0]) > 0.021 ? 1 : 0, (p) => Math.abs(p[0]) > 0.3 ? 0.8 : Math.abs(p[0]) < 0.03 ? 0.35 : 1)

function creatureMaterial(time: { value: number }, tail: boolean): THREE.MeshLambertMaterial {
  const material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uFaunaTime = time
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec3 aFlap;
attribute float aPart;
uniform float uFaunaTime;
void faunaBend(inout vec3 p, inout vec3 n) {
  float phase = aFlap.x + uFaunaTime * aFlap.y, amp = max(aFlap.z, 0.0), fold = clamp(-aFlap.z, 0.0, 1.0);
  ${tail ? `float a = sin(phase - aPart * 2.2) * amp * aPart * 0.6, c = cos(a), s = sin(a);
  p.xz = vec2(p.x * c + p.z * s, -p.x * s + p.z * c);
  n.xz = vec2(n.x * c + n.z * s, -n.x * s + n.z * c);` : `float side = p.x < 0.0 ? -1.0 : 1.0, a = (sin(phase) + 0.2) * amp * aPart * side, c = cos(a), s = sin(a);
  p.xy = vec2(p.x * c - p.y * s, p.x * s + p.y * c);
  n.xy = vec2(n.x * c - n.y * s, n.x * s + n.y * c);
  p.x *= 1.0 - fold * 0.72 * step(0.001, aPart);
  p.y -= sin(phase) * amp * 0.03 * (1.0 - aPart);`}
}`)
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nvec3 faunaPosition = position;\nfaunaBend(faunaPosition, objectNormal);')
      .replace('#include <begin_vertex>', 'vec3 transformed = faunaPosition;')
  }
  material.customProgramCacheKey = () => tail ? 'fauna-tail' : 'fauna-wing'
  return material
}

const glowVertex = /* glsl */`
attribute vec4 aGlow;
uniform float uTime, uPresence, uSize, uPixel;
varying vec2 vUv;
varying float vAlpha;
#include <fog_pars_vertex>
void main() {
  vec4 mv = viewMatrix * vec4(aGlow.xyz, 1.0);
  float dist = -mv.z, width = max(uSize, dist * uPixel * 2.0);
  float blink = pow(max(0.0, sin(uTime * (0.6 + fract(aGlow.w * 7.31) * 0.9) + aGlow.w * 6.2831853)), 2.0);
  vAlpha = uPresence * blink * (uSize / width) * smoothstep(0.2, 1.0, dist);
  mv.xy += position.xy * width * 3.0;
  gl_Position = projectionMatrix * mv;
  vUv = position.xy;
  #ifdef USE_FOG
  vFogDepth = dist;
  #endif
}`
const glowFragment = /* glsl */`
uniform vec3 uColor;
varying vec2 vUv;
varying float vAlpha;
#include <fog_pars_fragment>
void main() {
  float r2 = dot(vUv, vUv), a = (exp(-r2 * 40.0) + exp(-r2 * 6.0) * 0.35) * vAlpha;
  if (a < 0.003) discard;
  vec3 col = uColor * 5.0;
  #ifdef USE_FOG
  #ifdef FOG_EXP2
  float fogF = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
  #else
  float fogF = smoothstep(fogNear, fogFar, vFogDepth);
  #endif
  col *= 1.0 - fogF;
  #endif
  gl_FragColor = vec4(col, a);
}`

type BirdMode = 'fly' | 'descend' | 'ground'
interface BirdState { spec: BirdFlock; kind: BirdSpec; boids: FlockBoid[]; slot: number; active: number; center: THREE.Vector3; mode: BirdMode; timer: number; angle: number; turn: number; alarm: number; threat: THREE.Vector3; presence: number
  landing: THREE.Vector3; spots: THREE.Vector3[]; grounded: boolean[]; phase: number[]; yaw: number[]; roll: number[]; floor: number[]; probe: number; climb: number }
interface FishState { spec: FishSchool; boids: FlockBoid[]; slot: number; active: number; center: THREE.Vector3; angle: number; turn: number; alarm: number; threat: THREE.Vector3; phase: number[] }
interface SwarmState { spec: InsectSwarm; slot: number; active: number; homes: THREE.Vector3[]; phase: number[]; last: THREE.Vector3[]; alarm: number; away: THREE.Vector3 }

const hide = new THREE.Matrix4().makeScale(0, 0, 0), matrix = new THREE.Matrix4(), rotation = new THREE.Quaternion(), euler = new THREE.Euler(0, 0, 0, 'YXZ'), scale = new THREE.Vector3(), point = new THREE.Vector3()
const angleDelta = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b))

/** Ambient wildlife from a plan: CPU boids for birds and fish (a few dozen each), parametric insects, wing/tail motion in the vertex shader. Up to four draw calls; materials take scene fog and lights. */
export function createFauna(plan: FaunaPlan, ground: GroundSampler | null, quality: QualityLevel = 'medium'): FaunaSystem {
  const object = new THREE.Group()
  object.name = 'fauna'
  const r = random(plan.seed ^ 0x5bd1e995), time = { value: 0 }, TAU = Math.PI * 2
  const sample = (x: number, z: number, from: number) => { if (!ground) return null; const y = ground(x, z, from); return y !== null && Number.isFinite(y) ? y : null }
  const instanced = (geometry: THREE.BufferGeometry, material: THREE.Material, count: number, name: string) => {
    geometry.setAttribute('aFlap', new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage))
    const mesh = new THREE.InstancedMesh(geometry, material, count)
    mesh.name = name
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    mesh.frustumCulled = false
    mesh.castShadow = false
    mesh.raycast = () => {}
    for (let i = 0; i < count; i++) mesh.setMatrixAt(i, hide)
    object.add(mesh)
    return mesh
  }

  let birdSlots = 0
  const flocks: BirdState[] = plan.birds.map((spec) => {
    const kind = birdSpecs[spec.kind] ?? birdSpecs.songbird, center = new THREE.Vector3(...spec.center)
    const floor = sample(center.x, center.z, center.y + spec.altitude + 40)
    if (floor !== null) center.y = floor
    const boids = Array.from({ length: spec.count }, (_, i) => {
      const a = r() * TAU, d = spec.radius * (0.2 + r() * 0.5)
      return { position: new THREE.Vector3(center.x + Math.cos(a) * d, center.y + spec.altitude + (r() - 0.5) * 3, center.z + Math.sin(a) * d), velocity: new THREE.Vector3(Math.cos(a + 1.6), 0, Math.sin(a + 1.6)).multiplyScalar(kind.speed * (0.6 + 0.1 * (i % 3))) }
    })
    const state: BirdState = { spec, kind, boids, slot: birdSlots, active: spec.count, center, mode: 'fly', timer: 20 + r() * 30, angle: r() * TAU, turn: r() < 0.5 ? 1 : -1, alarm: 0, threat: new THREE.Vector3(), presence: 1,
      landing: new THREE.Vector3(), spots: boids.map(() => new THREE.Vector3()), grounded: boids.map(() => false), phase: boids.map(() => r() * TAU), yaw: boids.map(() => 0), roll: boids.map(() => 0), floor: boids.map(() => center.y), probe: 0, climb: 0 }
    birdSlots += spec.count
    return state
  })
  let fishSlots = 0
  const schools: FishState[] = plan.fish.map((spec) => {
    const center = new THREE.Vector3(...spec.center), boids = Array.from({ length: spec.count }, () => {
      const a = r() * TAU, d = spec.radius * (0.1 + r() * 0.5)
      return { position: new THREE.Vector3(center.x + Math.cos(a) * d, center.y - spec.depth + (r() - 0.5) * 0.2, center.z + Math.sin(a) * d), velocity: new THREE.Vector3(Math.cos(a + 1.6), 0, Math.sin(a + 1.6)).multiplyScalar(0.6) }
    })
    const state: FishState = { spec, boids, slot: fishSlots, active: spec.count, center, angle: r() * TAU, turn: r() < 0.5 ? 1 : -1, alarm: 0, threat: new THREE.Vector3(), phase: boids.map(() => r() * TAU) }
    fishSlots += spec.count
    return state
  })
  let insectSlots = 0
  const swarms: SwarmState[] = plan.butterflies.map((spec) => {
    const homes = Array.from({ length: spec.count }, () => {
      const a = r() * TAU, d = spec.radius * Math.sqrt(r()) * 0.7, x = spec.center[0] + Math.cos(a) * d, z = spec.center[2] + Math.sin(a) * d
      return new THREE.Vector3(x, sample(x, z, spec.center[1] + 20) ?? spec.center[1], z)
    })
    const state: SwarmState = { spec, slot: insectSlots, active: spec.count, homes, phase: homes.map(() => r()), last: homes.map((home) => home.clone()), alarm: 0, away: new THREE.Vector3() }
    insectSlots += spec.count
    return state
  })

  const birdMesh = birdSlots ? instanced(birdGeometry(), creatureMaterial(time, false), birdSlots, 'fauna-birds') : null
  const fishMesh = fishSlots ? instanced(fishGeometry(), creatureMaterial(time, true), fishSlots, 'fauna-fish') : null
  const insectMesh = insectSlots ? instanced(insectGeometry(), creatureMaterial(time, false), insectSlots, 'fauna-insects') : null
  const color = new THREE.Color()
  for (const flock of flocks) for (let i = 0; i < flock.boids.length; i++) birdMesh!.setColorAt(flock.slot + i, color.set(flock.kind.colors[Math.floor(r() * flock.kind.colors.length)]).multiplyScalar(0.9 + r() * 0.2))
  for (const school of schools) for (let i = 0; i < school.boids.length; i++) fishMesh!.setColorAt(school.slot + i, color.set(school.spec.color).multiplyScalar(0.85 + r() * 0.3))
  for (const swarm of swarms) { const colors = swarm.spec.kind === 'dragonfly' ? dragonflyColors : butterflyColors; for (let i = 0; i < swarm.spec.count; i++) insectMesh!.setColorAt(swarm.slot + i, color.set(colors[Math.floor(r() * colors.length)])) }

  const glowCount = swarms.reduce((sum, swarm) => sum + Math.round(swarm.spec.count * swarm.spec.glow), 0)
  let glowMesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial> | null = null, glowData: Float32Array | null = null
  if (glowCount) {
    const geometry = new THREE.InstancedBufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3))
    geometry.setIndex([0, 1, 2, 0, 2, 3])
    glowData = new Float32Array(glowCount * 4)
    geometry.setAttribute('aGlow', new THREE.InstancedBufferAttribute(glowData, 4).setUsage(THREE.DynamicDrawUsage))
    geometry.instanceCount = 0
    const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uPresence: { value: 0 }, uSize: { value: 0.035 }, uPixel: { value: 0.001 }, uColor: { value: new THREE.Color('#d8ff7a') } }])
    glowMesh = new THREE.Mesh(geometry, new THREE.ShaderMaterial({ uniforms, vertexShader: glowVertex, fragmentShader: glowFragment, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true }))
    glowMesh.name = 'fauna-fireflies'
    glowMesh.frustumCulled = false
    glowMesh.renderOrder = 9
    glowMesh.visible = false
    glowMesh.raycast = () => {}
    object.add(glowMesh)
  }

  const applyQuality = (level: QualityLevel) => {
    const counts = faunaCounts(plan, level)
    flocks.forEach((flock, i) => { flock.active = counts.birds[i] ?? 0 })
    schools.forEach((school, i) => { school.active = counts.fish[i] ?? 0 })
    swarms.forEach((swarm, i) => { swarm.active = counts.butterflies[i] ?? 0 })
    for (const mesh of [birdMesh, fishMesh, insectMesh]) if (mesh) { for (let i = 0; i < mesh.count; i++) mesh.setMatrixAt(i, hide); mesh.instanceMatrix.needsUpdate = true }
  }
  applyQuality(quality)

  const place = (mesh: THREE.InstancedMesh, slot: number, position: THREE.Vector3, yaw: number, pitch: number, roll: number, size: number) => {
    euler.set(pitch, yaw, roll, 'YXZ'); rotation.setFromEuler(euler)
    mesh.setMatrixAt(slot, size > 1e-4 ? matrix.compose(position, rotation, scale.setScalar(size)) : hide)
  }
  const takeOff = (flock: BirdState, alarmed: boolean) => {
    if (flock.mode !== 'fly') flock.boids.forEach((boid, i) => {
      flock.grounded[i] = false
      flock.floor[i] = Math.min(flock.floor[i], flock.spots[i].y)
      const a = r() * TAU
      boid.velocity.set(Math.cos(a) * 2, 3 + r() * 1.5, Math.sin(a) * 2)
    })
    flock.mode = 'fly'; flock.timer = 25 + r() * 30; flock.climb = 3
    if (alarmed) flock.alarm = 1
  }
  const birdRules: FlockRules = { center: new THREE.Vector3(), radius: 20, minY: 0, maxY: 20, target: new THREE.Vector3(), seek: 1.2, cohesion: 0.6, alignment: 1.4, separation: 2.5, spacing: 1.2, view: 6,
    minSpeed: 2, maxSpeed: 6, maxAccel: 12, threat: null, threatRadius: 12, threatStrength: 30, vertical: 1 }
  const fishRules: FlockRules = { center: new THREE.Vector3(), radius: 6, minY: -1, maxY: 0, target: new THREE.Vector3(), seek: 0.8, cohesion: 0.8, alignment: 1.6, separation: 3, spacing: 0.35, view: 1.6,
    minSpeed: 0.3, maxSpeed: 1.4, maxAccel: 6, threat: null, threatRadius: 5, threatStrength: 16, vertical: 0.3 }

  const updateBirds = (seconds: number, dt: number, player: THREE.Vector3 | null, night: number) => {
    if (!birdMesh) return
    const flapData = birdMesh.geometry.getAttribute('aFlap') as THREE.InstancedBufferAttribute
    for (const flock of flocks) {
      const kind = flock.kind, spec = flock.spec
      flock.presence += (1 - smooth(0.55, 0.8, night) - flock.presence) * Math.min(1, dt * 0.4)
      flock.alarm = Math.max(0, flock.alarm - dt * 0.25)
      if (flock.presence < 0.01 || !flock.active) { for (let i = 0; i < flock.boids.length; i++) birdMesh.setMatrixAt(flock.slot + i, hide); continue }
      const near = player && player.distanceTo(flock.mode === 'fly' ? flock.boids[0].position : flock.landing) < (flock.mode === 'fly' ? 10 : 7)
      if (near && flock.mode !== 'fly') takeOff(flock, true)
      if (near) { flock.threat.copy(player!); flock.alarm = Math.max(flock.alarm, 0.6) }
      if (flock.mode === 'fly') {
        flock.timer -= dt
        if (flock.timer < 0 && flock.alarm < 0.05 && night < 0.5 && ground) {
          const a = r() * TAU, d = spec.radius * 0.4 * r(), x = flock.center.x + Math.cos(a) * d, z = flock.center.z + Math.sin(a) * d, y = sample(x, z, flock.center.y + spec.altitude + 40)
          if (y !== null && y < flock.center.y + spec.altitude) {
            flock.mode = 'descend'; flock.timer = 20; flock.landing.set(x, y, z)
            flock.spots.forEach((spot, i) => { const b = r() * TAU, e = 0.4 + r() * 2.2, sx = x + Math.cos(b) * e, sz = z + Math.sin(b) * e; spot.set(sx, sample(sx, sz, y + 4) ?? y, sz); flock.grounded[i] = false })
          } else flock.timer = 10 + r() * 10
        }
        flock.angle += dt * kind.speed * 0.5 / Math.max(4, spec.radius * 0.6) * flock.turn
        const rules = birdRules, alarm = flock.alarm
        rules.center.copy(flock.center); rules.radius = spec.radius * (1 + alarm * 0.6)
        flock.climb = Math.max(0, flock.climb - dt)
        rules.minY = flock.climb > 0 ? Math.min(flock.center.y + 2.5, flock.landing.y) : flock.center.y + 2.5; rules.maxY = flock.center.y + spec.altitude + 10 + alarm * 12
        rules.target!.set(flock.center.x + Math.cos(flock.angle) * spec.radius * 0.6, flock.center.y + spec.altitude + Math.sin(seconds * 0.3 + spec.radius) * 2 + alarm * 8, flock.center.z + Math.sin(flock.angle) * spec.radius * 0.6)
        rules.minSpeed = kind.speed * 0.45; rules.maxSpeed = kind.speed * (1 + alarm * 0.7); rules.spacing = Math.max(0.8, kind.span * 2.5); rules.view = rules.spacing * 5
        rules.threat = alarm > 0.02 ? flock.threat : null; rules.threatRadius = 14
        stepFlock(flock.boids, rules, dt, flock.active)
        for (let k = 0; k < 2 && ground; k++) {
          flock.probe = (flock.probe + 1) % flock.active
          const p = flock.boids[flock.probe].position, y = sample(p.x, p.z, p.y + 30)
          if (y !== null) flock.floor[flock.probe] = y
        }
        if (flock.climb <= 0) for (let i = 0; i < flock.active; i++) { const p = flock.boids[i].position, v = flock.boids[i].velocity; if (p.y < flock.floor[i] + 1.5) { p.y = flock.floor[i] + 1.5; if (v.y < 0) v.y = 0 } }
      } else if (flock.mode === 'descend') {
        let landed = 0
        for (let i = 0; i < flock.active; i++) {
          const boid = flock.boids[i], spot = flock.spots[i]
          if (flock.grounded[i]) { landed++; continue }
          point.subVectors(spot, boid.position)
          const distance = point.length()
          if (distance < 0.3) { flock.grounded[i] = true; boid.position.copy(spot); boid.velocity.set(0, 0, 0); flock.yaw[i] = r() * TAU; landed++; continue }
          point.multiplyScalar(Math.min(kind.speed * 0.7, distance * 1.5 + 0.4) / distance)
          boid.velocity.lerp(point, 1 - Math.exp(-dt * 3))
          boid.position.addScaledVector(boid.velocity, dt)
        }
        flock.timer -= dt
        if (landed >= flock.active || flock.timer < 0) { flock.mode = 'ground'; flock.timer = 8 + r() * 12; flock.spots.forEach((spot, i) => { if (i < flock.active) { flock.boids[i].position.copy(spot); flock.boids[i].velocity.set(0, 0, 0); flock.grounded[i] = true } }) }
      } else {
        flock.timer -= dt
        if (flock.timer < 0 && night < 0.5) takeOff(flock, false)
      }
      for (let i = 0; i < flock.boids.length; i++) {
        const slot = flock.slot + i, boid = flock.boids[i]
        if (i >= flock.active) { birdMesh.setMatrixAt(slot, hide); continue }
        if (flock.grounded[i] && flock.mode === 'ground') {
          const hop = Math.max(0, Math.sin(seconds * 3 + flock.phase[i] * 5)) ** 8
          if (hop > 0.9 && r() < dt * 2) flock.yaw[i] += (r() - 0.5) * 1.5
          point.copy(flock.spots[i]); point.y += hop * 0.05 * kind.span * 3
          place(birdMesh, slot, point, flock.yaw[i], 0.25 * hop, 0, kind.span * flock.presence)
          flapData.setXYZ(slot, flock.phase[i], 0, -1)
          continue
        }
        const v = boid.velocity, horizontal = Math.hypot(v.x, v.z), yaw = horizontal > 1e-3 ? Math.atan2(v.x, v.z) : flock.yaw[i]
        const turn = dt > 0 ? angleDelta(yaw, flock.yaw[i]) / dt : 0
        flock.yaw[i] = yaw
        flock.roll[i] += (clamp(-turn * 0.35, -0.8, 0.8) - flock.roll[i]) * Math.min(1, dt * 4)
        place(birdMesh, slot, boid.position, yaw, -Math.atan2(v.y, Math.max(horizontal, 1e-3)) * 0.8, flock.roll[i], kind.span * flock.presence)
        const gliding = v.y < 0.3 && flock.alarm < 0.2 && Math.sin(seconds * 0.4 + flock.phase[i] * 3) < kind.glide * 2 - 1
        flapData.setXYZ(slot, flock.phase[i], kind.flap * TAU, kind.angle * (gliding ? 0.12 : 1))
      }
    }
    birdMesh.instanceMatrix.needsUpdate = true
    flapData.needsUpdate = true
  }

  const updateFish = (dt: number, player: THREE.Vector3 | null) => {
    if (!fishMesh) return
    const flapData = fishMesh.geometry.getAttribute('aFlap') as THREE.InstancedBufferAttribute
    for (const school of schools) {
      const spec = school.spec, surface = school.center.y, swim = surface - spec.depth
      school.alarm = Math.max(0, school.alarm - dt * 0.3)
      if (player && player.y < surface + 2.5 && Math.hypot(player.x - school.center.x, player.z - school.center.z) < spec.radius + 3) {
        school.threat.set(player.x, swim, player.z); school.alarm = Math.max(school.alarm, 0.7)
      }
      school.angle += dt * 0.6 / Math.max(1, spec.radius * 0.5) * school.turn
      const rules = fishRules, alarm = school.alarm
      rules.center.copy(school.center); rules.radius = spec.radius
      rules.maxY = surface - 0.15; rules.minY = Math.min(rules.maxY - 0.2, swim - 0.35)
      rules.target!.set(school.center.x + Math.cos(school.angle) * spec.radius * 0.5, swim, school.center.z + Math.sin(school.angle) * spec.radius * 0.5)
      rules.maxSpeed = 1.4 * (1 + alarm * 1.5); rules.spacing = 0.35 * (1 + alarm * 2.5); rules.cohesion = 0.8 * (1 - alarm * 0.8)
      rules.threat = alarm > 0.02 ? school.threat : null
      if (school.active) stepFlock(school.boids, rules, dt, school.active)
      for (let i = 0; i < school.boids.length; i++) {
        const slot = school.slot + i
        if (i >= school.active) { fishMesh.setMatrixAt(slot, hide); continue }
        const v = school.boids[i].velocity, horizontal = Math.hypot(v.x, v.z)
        place(fishMesh, slot, school.boids[i].position, Math.atan2(v.x, v.z), -Math.atan2(v.y, Math.max(horizontal, 1e-3)) * 0.5, 0, 0.32 + 0.12 * ((i * 7) % 5) / 4)
        flapData.setXYZ(slot, school.phase[i], TAU * (1.6 + alarm * 2.5), 0.45 + alarm * 0.5)
      }
    }
    fishMesh.instanceMatrix.needsUpdate = true
    flapData.needsUpdate = true
  }

  const updateInsects = (camera: THREE.Camera, seconds: number, dt: number, player: THREE.Vector3 | null, night: number) => {
    const day = 1 - smooth(0.3, 0.6, night), glow = smooth(0.4, 0.75, night)
    const flapData = insectMesh?.geometry.getAttribute('aFlap') as THREE.InstancedBufferAttribute | undefined
    let lit = 0
    for (const swarm of swarms) {
      const spec = swarm.spec, dragonfly = spec.kind === 'dragonfly', glowing = Math.round(spec.count * spec.glow)
      swarm.alarm = Math.max(0, swarm.alarm - dt * 0.4)
      if (player && Math.hypot(player.x - spec.center[0], player.z - spec.center[2]) < spec.radius * 0.6 && Math.abs(player.y - spec.center[1]) < 3 && swarm.alarm < 0.4) {
        swarm.away.set(spec.center[0] - player.x, 0, spec.center[2] - player.z).normalize(); swarm.alarm = 0.6
      }
      for (let i = 0; i < spec.count; i++) {
        const home = swarm.homes[i], phase = swarm.phase[i], slow = 0.35 + 0.65 * day, t = seconds * slow, active = i < swarm.active
        const a = phase * TAU + t * (dragonfly ? 0.5 : 0.3) * (phase > 0.5 ? 1 : -1), reach = spec.radius * (0.15 + 0.35 * ((phase * 13) % 1))
        point.set(home.x + Math.cos(a) * reach + Math.sin(t * 1.9 + phase * 11) * 0.5 + swarm.away.x * swarm.alarm * 3,
          home.y + (dragonfly ? 0.9 : 0.45) + 0.55 * (0.5 + 0.5 * Math.sin(t * 2.3 + phase * 5)) + swarm.alarm * 1.4 + (1 - day) * 0.6,
          home.z + Math.sin(a * 1.3) * reach * 0.8 + Math.cos(t * 1.7 + phase * 7) * 0.5 + swarm.away.z * swarm.alarm * 3)
        const last = swarm.last[i], dx = point.x - last.x, dz = point.z - last.z
        if (insectMesh && flapData) {
          const slot = swarm.slot + i, size = active ? (dragonfly ? 0.11 : 0.09) * day : 0
          place(insectMesh, slot, point, Math.hypot(dx, dz) > 1e-5 ? Math.atan2(dx, dz) : 0, 0, 0, size)
          flapData.setXYZ(slot, phase * TAU, TAU * (dragonfly ? 14 : 7), dragonfly ? 0.35 : 1.15)
        }
        last.copy(point)
        if (glowData && active && i < glowing && lit < glowCount) { const k = lit * 4; glowData[k] = point.x; glowData[k + 1] = point.y; glowData[k + 2] = point.z; glowData[k + 3] = phase; lit++ }
      }
    }
    if (insectMesh && flapData) { insectMesh.instanceMatrix.needsUpdate = true; flapData.needsUpdate = true }
    if (glowMesh) {
      glowMesh.visible = glow > 0.01 && lit > 0
      glowMesh.geometry.instanceCount = lit
      glowMesh.geometry.getAttribute('aGlow').needsUpdate = true
      const uniforms = glowMesh.material.uniforms
      uniforms.uPresence.value = glow; uniforms.uTime.value = seconds % 600
      if (camera instanceof THREE.PerspectiveCamera) uniforms.uPixel.value = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) / (1000 * camera.zoom)
    }
  }

  return {
    object,
    update(camera, seconds, dt, player, night) {
      const step = Number.isFinite(dt) ? clamp(dt, 0, 0.1) : 0, dark = Number.isFinite(night) ? clamp(night, 0, 1) : 0, now = Number.isFinite(seconds) ? seconds : 0
      time.value = now % 600
      updateBirds(now, step, player, dark)
      updateFish(step, player)
      if (swarms.length) updateInsects(camera, now, step, player, dark)
    },
    scare(position, radius) {
      const reach = Math.max(0, Number.isFinite(radius) ? radius : 0)
      for (const flock of flocks) {
        const close = flock.boids.some((boid, i) => i < flock.active && boid.position.distanceTo(position) < reach + 4)
        if (!close) continue
        flock.threat.copy(position)
        if (flock.mode === 'fly') flock.alarm = 1
        else takeOff(flock, true)
      }
      for (const school of schools) if (Math.hypot(position.x - school.center.x, position.z - school.center.z) < reach + school.spec.radius && position.y < school.center.y + reach) { school.threat.set(position.x, school.center.y - school.spec.depth, position.z); school.alarm = 1 }
      for (const swarm of swarms) {
        const dx = swarm.spec.center[0] - position.x, dz = swarm.spec.center[2] - position.z
        if (Math.hypot(dx, dz) < reach + swarm.spec.radius) { swarm.away.set(dx, 0, dz); if (swarm.away.lengthSq() < 1e-6) swarm.away.set(1, 0, 0); swarm.away.normalize(); swarm.alarm = 1 }
      }
    },
    setQuality: applyQuality,
    dispose() {
      object.removeFromParent()
      for (const mesh of [birdMesh, fishMesh, insectMesh]) if (mesh) { mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose(); mesh.dispose() }
      if (glowMesh) { glowMesh.geometry.dispose(); glowMesh.material.dispose() }
    },
  }
}
