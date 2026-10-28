import type { WeaponKind } from './sceneCombat.ts'
import type { PowerKind } from './sceneDocument.ts'
import type { InputDevice } from './sceneGamepad.ts'
import type { CraftRecipe, GameplayItem } from './sceneGameplay.ts'

/**
 * HUD contract between the play loop (ThreeViewport) and ThreeHud.
 * Angles are radians. World bearings are measured clockwise from north, where north is -Z (the camera forward at yaw 0) and east is +X;
 * `compass.heading` is the camera bearing (`headingFromYaw(player.yaw)`). Screen coordinates are CSS pixels relative to the HUD's top-left corner.
 */
export type HudPhase = 'title' | 'playing' | 'paused' | 'won' | 'lost'
export type MarkerKind = 'objective' | 'enemy' | 'npc' | 'item' | 'goal' | 'checkpoint'
export type DamageKind = 'dealt' | 'taken' | 'crit' | 'heal'
export type AnchorKind = 'enemy' | 'npc' | 'boss'
export type HudIconName = 'fist' | 'sword' | 'axe' | 'blaster' | 'bow' | 'staff' | 'heart' | 'bolt' | 'shield' | 'speed' | 'jump' | 'strength' | 'key' | 'coin' | 'gem' | 'potion' | 'scroll'
  | 'food' | 'herb' | 'relic' | 'gear' | 'bag' | 'star' | 'clock' | 'skull' | 'target' | 'check' | 'pause' | 'exit' | 'settings' | 'volume' | 'mute' | 'eye' | 'wing'
  | 'flag' | 'banner' | 'speech' | 'sparkle' | 'lock' | 'arrow' | 'diamond' | 'restart' | 'play' | 'trophy' | 'controls'

export interface HudPortrait {
  species: 'human' | 'robot' | 'creature' | 'skeleton' | 'beast'
  skin: string; hair: string; outfit: string; accent: string; eyes: string
  hairStyle: 'bald' | 'short' | 'long' | 'bun' | 'ponytail' | 'braids' | 'mohawk'
  beard: 'none' | 'short' | 'long'
  headwear: 'none' | 'hood' | 'helmet' | 'wizard' | 'crown' | 'cap'
  age: 'child' | 'young' | 'adult' | 'elder'
  /** Optional raster portrait; only `data:image/(png|jpeg|webp);base64,` URLs are drawn. */
  image?: string | null
}
export interface HudMarker { id: string; kind: MarkerKind; bearing: number; distance: number; label: string }
export interface HudStats { time: number; score: number; collected: number; total: number; defeated: number; enemyTotal: number; damageTaken: number; falls: number }
export interface HudPrompt { verb: string; target: string; locked: string | null; enemy: boolean; health: { value: number; max: number } | null }
export interface HudDialogue { name: string; line: string; index: number; total: number; portrait: HudPortrait | null; options: string[] }
export interface HudModel {
  phase: HudPhase
  title: { name: string; premise: string; objective: string }
  health: number; maxHealth: number; stamina: number; maxStamina: number
  objective: string; objectiveDone: boolean
  tracker: { label: string; distance: number; bearing: number } | null
  compass: { heading: number; markers: HudMarker[] }
  score: number; collected: number; total: number; defeated: number; enemyTotal: number
  /** Elapsed play seconds; `limit` > 0 shows a countdown. `clock` is an optional in-world time such as "18:40". */
  time: number; limit: number; clock: string | null
  weapon: WeaponKind; weaponLabel: string
  items: { name: string; count: number }[]
  quickbar?: { slots: { item: string | null; name: string; count: number; icon: HudIconName }[]; selected: number }
  itemDefinitions?: GameplayItem[]
  playStyle?: 'directed' | 'sandbox'
  hudStyle?: 'full' | 'minimal'
  discoveries?: number
  placement?: { name: string; valid: boolean; reason: string }
  storage?: { name: string; items: { name: string; count: number }[] }
  recipes?: (CraftRecipe & { available: boolean; missing: string })[]
  questSteps?: { label: string; value: number; count: number }[]
  swimming?: boolean
  submerged?: boolean
  oxygen?: number
  effects: { power: PowerKind; seconds: number; total: number }[]
  prompt: HudPrompt | null
  boss: { name: string; health: number; max: number } | null
  dialogue: HudDialogue | null
  subtitle: { speaker: string; text: string } | null
  stats: HudStats
  fly: boolean; view: 'first' | 'third'; muted: boolean; pointerLocked: boolean; help: boolean; device: InputDevice
  /** Triangles left out of the collider budget. */
  omitted: number
  fps: number | null
  /** Increments on every hit taken; drives the screen-edge flash. */
  hurt: number
}
export interface HudAnchor { id: string; x: number; y: number; distance: number; name: string; kind: AnchorKind; health: number | null; max: number | null; focus: boolean }
export type MenuAction = 'up' | 'down' | 'confirm' | 'back'
/** Imperative per-frame layer: none of these re-render React. */
export interface HudOverlayHandle {
  /** Projected heads of on-screen characters (skip those behind the camera; see `screenFromNdc`). */
  frame(anchors: HudAnchor[]): void
  damage(x: number, y: number, amount: number, kind: DamageKind): void
  hit(kind: 'hit' | 'kill'): void
  pickup(card: { name: string; count: number; icon: string }): void
  /** Angle of the damage source relative to the camera forward: 0 front, +π/2 right (see `hurtAngle`). */
  hurtFrom(angle: number): void
  /** Menu navigation from a gamepad (d-pad/stick, A, B) for pause, outcome screens and dialogue options. */
  menu(action: MenuAction): void
}

const TAU = Math.PI * 2
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
export const normalizeAngle = (angle: number): number => {
  const value = ((angle + Math.PI) % TAU + TAU) % TAU - Math.PI
  return value === -Math.PI ? Math.PI : value
}
export const headingFromYaw = (yaw: number) => normalizeAngle(-yaw)
export const bearingTo = (from: { x: number; z: number }, to: { x: number; z: number }) => normalizeAngle(Math.atan2(to.x - from.x, -(to.z - from.z)))
/** Positive means the target is to the right of where the camera looks. */
export const relativeBearing = (bearing: number, heading: number) => normalizeAngle(bearing - heading)
export const hurtAngle = (player: { x: number; z: number }, source: { x: number; z: number }, heading: number) => relativeBearing(bearingTo(player, source), heading)
export const toDegrees = (radians: number) => radians * 180 / Math.PI

export const COMPASS_SPAN = 150 * Math.PI / 180
export const cardinalLabels = ['N', 'NE', 'L', 'SE', 'S', 'SO', 'O', 'NO'] as const
export interface CompassTick { degrees: number; x: number; label: string | null; major: boolean }
/** Tick marks visible in the compass strip; `x` is 0 (left edge) to 1 (right edge). */
export function compassTicks(heading: number, span = COMPASS_SPAN, step = 15): CompassTick[] {
  const ticks: CompassTick[] = []
  for (let degrees = 0; degrees < 360; degrees += step) {
    const relative = relativeBearing(degrees * Math.PI / 180, heading)
    if (Math.abs(relative) > span / 2) continue
    ticks.push({ degrees, x: 0.5 + relative / span, label: degrees % 45 === 0 ? cardinalLabels[degrees / 45] : null, major: degrees % 90 === 0 })
  }
  return ticks.sort((a, b) => a.x - b.x)
}

export const markerPriority: Record<MarkerKind, number> = { objective: 0, goal: 1, enemy: 2, npc: 3, checkpoint: 4, item: 5 }
export const markerRange: Record<MarkerKind, number> = { objective: Infinity, goal: Infinity, enemy: 45, npc: 60, checkpoint: 150, item: 60 }
export interface PlacedMarker extends HudMarker { x: number; relative: number; pinned: boolean }
/** Markers inside the strip, nearest first by importance. Objectives and goals outside the strip stay pinned to the nearer edge. */
export function placeMarkers(markers: HudMarker[], heading: number, span = COMPASS_SPAN, limit = 8): PlacedMarker[] {
  const placed: PlacedMarker[] = []
  for (const marker of markers) {
    if (!Number.isFinite(marker.bearing) || !(marker.distance <= markerRange[marker.kind])) continue
    const relative = relativeBearing(marker.bearing, heading), inside = Math.abs(relative) <= span / 2
    if (!inside && markerPriority[marker.kind] > 1) continue
    placed.push({ ...marker, relative, x: inside ? 0.5 + relative / span : relative < 0 ? 0 : 1, pinned: !inside })
  }
  return placed.sort((a, b) => markerPriority[a.kind] - markerPriority[b.kind] || a.distance - b.distance).slice(0, limit).sort((a, b) => a.x - b.x)
}
export function compassMarker(id: string, kind: MarkerKind, label: string, player: { x: number; z: number }, target: { x: number; z: number }): HudMarker {
  return { id, kind, label, bearing: bearingTo(player, target), distance: Math.hypot(target.x - player.x, target.z - player.z) }
}
/** Nearest pending target for the quest tracker. */
export function nearestTarget(player: { x: number; z: number }, targets: { label: string; x: number; z: number }[]): { label: string; distance: number; bearing: number } | null {
  let best: { label: string; distance: number; bearing: number } | null = null
  for (const target of targets) {
    const distance = Math.hypot(target.x - player.x, target.z - player.z)
    if (!best || distance < best.distance) best = { label: target.label, distance, bearing: bearingTo(player, target) }
  }
  return best
}

export const formatDistance = (metres: number) => !Number.isFinite(metres) ? '' : metres < 1000 ? `${Math.max(0, Math.round(metres))} m` : `${(metres / 1000).toFixed(1).replace('.', ',')} km`
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0)), hours = Math.floor(total / 3600), minutes = Math.floor(total / 60) % 60, rest = String(total % 60).padStart(2, '0')
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`
}
/** Countdown when there is a limit, elapsed time otherwise. */
export function timerText(time: number, limit: number): { text: string; countdown: boolean; urgent: boolean } {
  if (limit > 0) { const remaining = Math.max(0, limit - time); return { text: formatClock(Math.ceil(remaining)), countdown: true, urgent: remaining <= 10 } }
  return { text: formatClock(time), countdown: false, urgent: false }
}
export const formatScore = (score: number) => Math.round(score).toLocaleString('pt-BR')
export const promptText = (prompt: Pick<HudPrompt, 'verb' | 'target'>) => `${prompt.verb} · ${prompt.target}`

export interface BarState { value: number; ghost: number; hold: number; flash: number }
export const GHOST_HOLD = 0.45
export const createBar = (value: number): BarState => ({ value, ghost: value, hold: 0, flash: 0 })
/** Damage trail: the ghost waits GHOST_HOLD seconds at the previous value, then drains; healing moves both at once. */
export function stepBar(bar: BarState, target: number, max: number, dt: number): BarState {
  let { ghost, hold, flash } = bar
  if (target < bar.value) { ghost = Math.max(ghost, bar.value); hold = GHOST_HOLD; flash = 1 }
  else { hold = Math.max(0, hold - dt) }
  if (ghost < target) ghost = target
  if (!hold && ghost > target) ghost = Math.max(target, ghost - Math.max(max * 0.35, (ghost - target) * 3) * dt)
  return { value: target, ghost, hold, flash: Math.max(0, flash - dt * 4) }
}
export const barFraction = (value: number, max: number) => max > 0 ? clamp(value / max, 0, 1) : 0
export const vitalTone = (value: number, max: number): 'full' | 'ok' | 'low' | 'critical' => {
  const fraction = barFraction(value, max)
  return fraction <= 0.25 ? 'critical' : fraction <= 0.5 ? 'low' : fraction < 1 ? 'ok' : 'full'
}
export const lowHealth = (health: number, max: number) => max > 0 && health > 0 && health / max <= 0.3

export interface BossCandidate { id: string; name: string; health: number; max: number; distance: number; boss: boolean; active: boolean; engaged?: boolean }
export const BOSS_RANGE = 45, BOSS_HEALTH = 8
/** Explicit bosses (dragon, `boss` behavior) or tanky enemies nearby; engaged ones win, then the nearest. */
export function selectBoss(candidates: BossCandidate[], range = BOSS_RANGE): { id: string; name: string; health: number; max: number } | null {
  const pool = candidates.filter((item) => item.active && item.health > 0 && item.distance <= range && (item.boss || item.max >= BOSS_HEALTH))
  pool.sort((a, b) => Number(!!b.engaged) - Number(!!a.engaged) || Number(b.boss) - Number(a.boss) || a.distance - b.distance)
  const best = pool[0]
  return best ? { id: best.id, name: best.name, health: best.health, max: best.max } : null
}
/** Phase thresholds (fractions of max health) drawn as notches on the boss bar. */
export const bossPhases = (max: number): number[] => max >= 12 ? [0.75, 0.5, 0.25] : max >= 4 ? [0.66, 0.33] : [0.5]
export const bossPhase = (health: number, max: number) => bossPhases(max).filter((threshold) => barFraction(health, max) <= threshold).length

export interface DamageEntry { id: number; x: number; y: number; amount: number; kind: DamageKind; at: number; offset: number }
export const DAMAGE_LIFE = 900, DAMAGE_MAX = 24
/** Adds a floating number, stacking it above recent numbers at the same spot and dropping the oldest past DAMAGE_MAX. */
export function pushDamage(list: DamageEntry[], entry: Pick<DamageEntry, 'x' | 'y' | 'amount' | 'kind'>, now: number, id: number): DamageEntry[] {
  const live = list.filter((item) => now - item.at < DAMAGE_LIFE)
  const near = live.filter((item) => now - item.at < 350 && Math.abs(item.x - entry.x) < 36 && Math.abs(item.y - entry.y) < 26)
  const offset = near.length ? Math.max(...near.map((item) => item.offset)) + 18 : 0
  return [...live, { ...entry, id, at: now, offset: Math.min(offset, 90) }].slice(-DAMAGE_MAX)
}
export function damageText(amount: number, kind: DamageKind): string {
  const value = Math.abs(amount), text = value < 10 && !Number.isInteger(value) ? value.toFixed(1).replace('.', ',') : String(Math.round(value))
  return kind === 'heal' ? `+${text}` : kind === 'taken' ? `−${text}` : kind === 'crit' ? `${text}!` : text
}
/** CPU mirror of the CSS float: rises 46 px (plus stacking), pops on crits and fades over the last 40 %. */
export function damageMotion(entry: DamageEntry, now: number): { progress: number; dy: number; opacity: number; scale: number } {
  const progress = clamp((now - entry.at) / DAMAGE_LIFE, 0, 1), ease = 1 - (1 - progress) ** 3
  const pop = entry.kind === 'crit' ? 1.35 - 0.35 * Math.min(1, progress * 4) : 1
  return { progress, dy: -(entry.offset + 46 * ease), opacity: progress < 0.6 ? 1 : 1 - (progress - 0.6) / 0.4, scale: pop }
}

export const anchorRange: Record<AnchorKind, number> = { enemy: 32, npc: 22, boss: 60 }
export const ANCHOR_LIMIT = 14
export interface AnchorView { id: string; x: number; y: number; name: string; kind: AnchorKind; showName: boolean; showBar: boolean; fraction: number; scale: number; opacity: number; focus: boolean }
/** Which overhead plates to draw this frame: on screen, in range (focus is always shown), nearest ones last so they paint on top. */
export function layoutAnchors(anchors: HudAnchor[], width: number, height: number, margin = 24): AnchorView[] {
  const views: AnchorView[] = []
  for (const anchor of anchors) {
    if (!Number.isFinite(anchor.x) || !Number.isFinite(anchor.y) || anchor.x < -margin || anchor.y < -margin || anchor.x > width + margin || anchor.y > height + margin) continue
    const range = anchorRange[anchor.kind]
    if (!anchor.focus && anchor.distance > range) continue
    const max = anchor.max ?? 0, health = anchor.health ?? max, damaged = max > 1 && health < max
    views.push({ id: anchor.id, x: anchor.x, y: anchor.y, name: anchor.name, kind: anchor.kind, focus: anchor.focus,
      showName: anchor.kind === 'npc' || anchor.focus || (anchor.kind === 'enemy' && anchor.distance < 14),
      showBar: anchor.kind === 'enemy' && max > 1 && (damaged || anchor.focus || anchor.distance < 12),
      fraction: barFraction(health, max || 1), scale: clamp(1.12 - anchor.distance / 40, 0.72, 1.08),
      opacity: anchor.focus ? 1 : clamp((range - anchor.distance) / (range * 0.25), 0, 1) })
  }
  return views.sort((a, b) => b.scale - a.scale).slice(0, ANCHOR_LIMIT).reverse()
}
/** NDC (from `vector.project(camera)`) to HUD pixels; null behind the camera or outside the frustum depth. */
export function screenFromNdc(x: number, y: number, z: number, width: number, height: number): { x: number; y: number } | null {
  if (!(z > -1 && z < 1)) return null
  return { x: (x + 1) / 2 * width, y: (1 - y) / 2 * height }
}

export const weaponIcon: Record<WeaponKind, HudIconName> = { none: 'fist', sword: 'sword', axe: 'axe', blaster: 'blaster', bow: 'bow', staff: 'staff' }
export const powerIcon: Record<PowerKind, HudIconName> = { speed: 'speed', jump: 'jump', shield: 'shield', strength: 'strength' }
export const markerIcon: Record<MarkerKind, HudIconName> = { objective: 'diamond', goal: 'flag', enemy: 'skull', npc: 'speech', item: 'sparkle', checkpoint: 'banner' }
const iconWords: [RegExp, HudIconName][] = [
  [/chave|key/, 'key'], [/moeda|ouro|coin|dinheiro|tesouro/, 'coin'], [/cristal|gema|joia|rubi|diamante|esmeralda|safira|ametista|perola/, 'gem'],
  [/pocao|elixir|frasco|garrafa|antidoto/, 'potion'], [/mapa|carta|pergaminho|livro|nota|diario|bilhete|runa/, 'scroll'],
  [/maca|pao|comida|fruta|queijo|carne|bolo|doce|peixe|cenoura/, 'food'], [/flor|erva|planta|cogumelo|folha|semente|raiz/, 'herb'],
  [/amuleto|anel|coroa|reliquia|idolo|estatueta|calice|medalh|talisma|orbe/, 'relic'], [/bateria|celula|chip|peca|engrenagem|circuito|modulo|nucleo|fusivel/, 'gear'],
  [/coracao|vida/, 'heart'], [/estrela/, 'star'],
]
const plain = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
export function itemIcon(name: string): HudIconName {
  const text = plain(name)
  return iconWords.find(([pattern]) => pattern.test(text))?.[1] ?? 'bag'
}
export const isHudIcon = (name: string): name is HudIconName => hudIconNames.has(name as HudIconName)
export const hudIconNames = new Set<HudIconName>(['fist', 'sword', 'axe', 'blaster', 'bow', 'staff', 'heart', 'bolt', 'shield', 'speed', 'jump', 'strength', 'key', 'coin', 'gem', 'potion', 'scroll',
  'food', 'herb', 'relic', 'gear', 'bag', 'star', 'clock', 'skull', 'target', 'check', 'pause', 'exit', 'settings', 'volume', 'mute', 'eye', 'wing', 'flag', 'banner', 'speech', 'sparkle',
  'lock', 'arrow', 'diamond', 'restart', 'play', 'trophy', 'controls'])

export const HOTBAR_ITEMS = 5
/** Inventory slots for the hotbar plus how many did not fit. */
export function hotbarItems(items: HudModel['items'], limit = HOTBAR_ITEMS): { slots: { name: string; count: number; icon: HudIconName }[]; overflow: number } {
  const visible = items.filter((item) => item.count > 0)
  return { slots: visible.slice(0, limit).map((item) => ({ ...item, icon: itemIcon(item.name) })), overflow: Math.max(0, visible.length - limit) }
}
/** Stroke offset for a remaining-time ring of the given circumference. */
export const ringOffset = (seconds: number, total: number, circumference: number) => circumference * (1 - (total > 0 ? clamp(seconds / total, 0, 1) : 0))

export const TITLE_SECONDS = 3.6
/** Screen state: unresolved outcomes first, then pause, then the title card until it times out or the player acts. */
export function hudPhase(input: { outcome: 'playing' | 'won' | 'lost'; paused: boolean; elapsed: number; interacted: boolean; dismissed: boolean }): HudPhase {
  if (input.outcome !== 'playing' && !input.dismissed) return input.outcome
  if (input.paused) return 'paused'
  return input.elapsed < TITLE_SECONDS && !input.interacted ? 'title' : 'playing'
}

export const TYPE_CPS = 45
export const typedLength = (line: string, elapsedMs: number, cps = TYPE_CPS) => clamp(Math.floor(elapsedMs * cps / 1000), 0, line.length)

export interface OutcomeSummary { stars: number; rows: { label: string; value: string }[] }
export function outcomeSummary(stats: HudStats, won: boolean): OutcomeSummary {
  const rows = [{ label: 'Tempo', value: formatClock(stats.time) }, { label: 'Pontuação', value: formatScore(stats.score) }]
  if (stats.total > 0) rows.push({ label: 'Itens', value: `${stats.collected}/${stats.total}` })
  if (stats.enemyTotal > 0) rows.push({ label: 'Inimigos', value: `${stats.defeated}/${stats.enemyTotal}` })
  rows.push({ label: 'Dano sofrido', value: String(Math.round(stats.damageTaken)) }, { label: 'Quedas', value: String(stats.falls) })
  const thorough = (stats.total === 0 || stats.collected >= stats.total) && (stats.enemyTotal === 0 || stats.defeated >= stats.enemyTotal)
  const clean = stats.damageTaken <= 25 && stats.falls === 0
  return { stars: won ? 1 + Number(thorough) + Number(clean) : 0, rows }
}

export const qualityOptions = [['auto', 'Automática'], ['low', 'Baixa'], ['medium', 'Média'], ['high', 'Alta']] as const
export const safePortraitImage = (image: string | null | undefined) => typeof image === 'string' && /^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=\s]+$/i.test(image) ? image : null

const portraitPalette = { skin: ['#f1c7a5', '#d9a47c', '#b77b55', '#8a5a3c', '#5e3b28'], hair: ['#2b1d16', '#5a3a22', '#a86b32', '#d8b26a', '#7a7f87', '#e8e2d6', '#9b3b2a'] }
/** Portrait style for a character prefab type, varied by seed; overrides come from the character archetype. */
export function portraitFor(type: string, seed = 1, overrides: Partial<HudPortrait> = {}): HudPortrait {
  const pick = <T>(list: readonly T[], salt: number) => list[Math.abs(Math.floor(seed * 7919 + salt * 104729)) % list.length]
  const base: HudPortrait = { species: 'human', skin: pick(portraitPalette.skin, 1), hair: pick(portraitPalette.hair, 2), outfit: '#3d6a8a', accent: '#f2c46d', eyes: '#3b2a20',
    hairStyle: pick(['short', 'long', 'bun', 'ponytail', 'braids'] as const, 3), beard: 'none', headwear: 'none', age: 'adult' }
  const styles: Record<string, Partial<HudPortrait>> = {
    villager: { outfit: pick(['#7a5a3a', '#4f7a4a', '#8a3f3f', '#3d5a8a'], 4), beard: pick(['none', 'none', 'short'] as const, 5) },
    explorer: { outfit: '#6b5a3a', accent: '#d9a441', headwear: 'cap' },
    knight: { outfit: '#8d99a6', accent: '#c9a03b', headwear: 'helmet', hairStyle: 'short', beard: 'short' },
    wizard: { outfit: '#4a3a8a', accent: '#b57bff', headwear: 'wizard', beard: 'long', age: 'elder', hair: '#e8e2d6' },
    astronaut: { outfit: '#e9edf2', accent: '#ff8a3c', headwear: 'helmet', hairStyle: 'short' },
    robot: { species: 'robot', skin: '#9aa7b4', outfit: '#4b5866', accent: '#5ff2ff', eyes: '#5ff2ff', hairStyle: 'bald' },
    drone: { species: 'robot', skin: '#5b6673', outfit: '#2c333b', accent: '#ff5a3c', eyes: '#ff5a3c', hairStyle: 'bald' },
    golem: { species: 'robot', skin: '#7c7469', outfit: '#4f4a43', accent: '#f2a93b', eyes: '#f2a93b', hairStyle: 'bald' },
    goblin: { species: 'creature', skin: '#6f9a3c', outfit: '#5a4630', accent: '#e0c04a', eyes: '#f7d64a', hairStyle: 'mohawk', hair: '#2b1d16' },
    orc: { species: 'creature', skin: '#5f7d4a', outfit: '#4a3b2c', accent: '#c94a3a', eyes: '#f2c46d', hairStyle: 'ponytail', hair: '#1d1712' },
    skeleton: { species: 'skeleton', skin: '#e6dfcf', outfit: '#3f3a44', accent: '#7fd7ff', eyes: '#7fd7ff', hairStyle: 'bald' },
    wolf: { species: 'beast', skin: '#7b7f86', hair: '#5a5e65', outfit: '#3b3f45', accent: '#f2c46d', eyes: '#f2c46d', hairStyle: 'bald' },
    deer: { species: 'beast', skin: '#a8743f', hair: '#7a5228', outfit: '#5b4a33', accent: '#e8d7b0', eyes: '#2b1d16', hairStyle: 'bald' },
    spider: { species: 'beast', skin: '#3b2f3f', hair: '#2a2130', outfit: '#1e1922', accent: '#c94a6a', eyes: '#ff4d5e', hairStyle: 'bald' },
    dragon: { species: 'beast', skin: '#9a3b2a', hair: '#6a2418', outfit: '#3a1a14', accent: '#ffb347', eyes: '#ffd24a', hairStyle: 'bald' },
  }
  return { ...base, ...styles[type], ...overrides }
}
