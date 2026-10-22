import type { ambiencePresets, musicPresets, SceneNode, SceneSound, SoundPreset, ThreeSceneDocument } from './sceneDocument.ts'

export type SfxName = 'step' | 'jump' | 'land' | 'collect' | 'hurt' | 'enemyHit' | 'enemyDefeat' | 'alert' | 'mechanism' | 'checkpoint' | 'victory' | 'defeat'
  | 'swing' | 'shoot' | 'magic' | 'powerup' | 'heal' | 'unlock' | 'locked' | 'launch' | 'talk' | 'splash' | 'respawn'
export type ResolvedAmbience = Exclude<typeof ambiencePresets[number], 'auto'>
export type ResolvedMusic = Exclude<typeof musicPresets[number], 'auto'>
type Ambience = Exclude<ResolvedAmbience, 'none'>
type Mood = Exclude<ResolvedMusic, 'none'>
type Voice = 'pad' | 'lead' | 'bass' | 'pluck'
type Drum = 'kick' | 'snare' | 'hat'
export interface MusicBar { notes: { time: number; midi: number; duration: number; voice: Voice }[]; drums: { time: number; kind: Drum }[]; tempo: number }
export interface AudioListenerPose { position: [number, number, number]; forward: [number, number, number] }
export interface AudioEmitter { id: string; position: [number, number, number]; sound: SceneSound }
export interface AudioEngine {
  readonly muted: boolean
  start(doc: ThreeSceneDocument): void
  stop(): void
  update(listener: AudioListenerPose, emitters: AudioEmitter[], seconds: number): void
  sfx(name: SfxName, position?: [number, number, number]): void
  setIntensity(level: 'calm' | 'danger'): void
  setMuted(muted: boolean): void
  dispose(): void
}

const fold = (text: string) => text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
const ambienceWords: [Ambience, RegExp][] = [
  ['underwater', /\b(subaquatic|underwater|fundo do mar|submarin|recife|reef|aquario|abiss|atlantida|coral)/],
  ['cave', /\b(caverna|gruta|cave|cavern|mina\b|mine\b|tunel|tunnel|estalactite|stalact)/],
  ['dungeon', /\b(masmorra|dungeon|calabouco|cripta|crypt|catacumba|catacomb|prisao|prison)/],
  ['scifi', /\b(nave|spaceship|starship|estacao espacial|space station|laboratorio|laboratory|sci-?fi|futurist|cyber|reator|reactor|robo|robot|hangar)/],
  ['space', /\b(espaco|space|galaxia|galaxy|planeta|planet|asteroid|orbita|orbit|cosmo|nebulosa|nebula|lunar|lua\b|moon\b)/],
  ['city', /\b(cidade|city|rua\b|street|avenida|avenue|urban|metropol|downtown|bairro|transito|traffic|predio|skyscraper|arranha)/],
  ['volcanic', /\b(vulca|volcan|lava|magma|cratera|crater|forja)/],
  ['swamp', /\b(pantano|swamp|brejo|mangue|mangrove|bog\b|marsh|charco)/],
  ['snow', /\b(neve|snow|gelo|ice\b|icy|inverno|winter|artic|arctic|glaci|polar|iglu|igloo|nevad|congelad|frozen)/],
  ['desert', /\b(desert|duna|dune|oasis|piramide|pyramid|cact|canyon|canion|saara|sahara)/],
  ['beach', /\b(praia|beach|oceano|ocean|mar\b|sea\b|ilha|island|litoral|coast|porto|harbou?r|cais|pier|farol|lighthouse)/],
  ['rain', /\b(chuva|chuvos|rain|tempestade|storm|temporal)/],
  ['night', /\b(noite|noturn|night|luar|moonlight|cemiterio|cemetery|graveyard|assombrad|haunted)/],
  ['forest', /\b(floresta|forest|bosque|woods?\b|mata\b|selva|jungle|arvore|tree|pinheiro|pine|carvalho|oak)/],
  ['wind', /\b(vento|wind|montanha|mountain|pico\b|peak|alpin|penhasco|cliff|cume|summit)/],
  ['meadow', /\b(campo|prado|meadow|fazenda|farm|jardim|garden|parque|park|vila\b|village|aldeia|colina|hill|flor|flower)/],
]
const musicWords: [Mood, RegExp][] = [
  ['combat', /\b(arena|batalha|battle|guerra|war\b|combate|combat|boss|chefe|duelo|duel|invas)/],
  ['spooky', /\b(assombrad|haunted|cemiterio|cemetery|graveyard|fantasma|ghost|terror|horror|zumbi|zombie|bruxa|witch|halloween|vampir|caveira|skull)/],
  ['festive', /\b(festa|party|carnaval|carnival|natal|christmas|feira|fair\b|circo|circus|aniversario|birthday|celebra|parque de diversoes|amusement|festival|junina)/],
  ['heroic', /\b(castelo|castle|reino|kingdom|heroi|hero|epic|cavaleiro|knight|fortaleza|fortress|cidadela|citadel|trono|throne)/],
  ['mystery', /\b(misterio|myster|ruina|ruin|templo|temple|segredo|secret|enigma|puzzle|labirinto|maze|antig|ancient|tumba|tomb)/],
  ['space', /\b(espaco|space|galaxia|galaxy|cosmo|nebulosa|nebula|orbita|orbit)/],
  ['calm', /\b(zen|relax|calm|tranquil|paz\b|peace|meditac|spa\b|lago|lake)/],
  ['adventure', /\b(aventura|adventure|explora|expedi|tesouro|treasure|pirat|quest|jornada|journey)/],
]
const biomeAmbience: Record<string, Ambience> = { meadow: 'meadow', alpine: 'wind', desert: 'desert', volcanic: 'volcanic', forest: 'forest', snow: 'snow', tropical: 'forest', swamp: 'swamp', lunar: 'space', alien: 'scifi' }
const weatherAmbience: Record<string, [Ambience, number]> = { rain: ['rain', 6], bubbles: ['underwater', 8], snow: ['snow', 5], ash: ['volcanic', 5], embers: ['volcanic', 2], dust: ['desert', 3], fireflies: ['night', 3], leaves: ['forest', 2] }

function keywordScores<T extends string>(doc: ThreeSceneDocument, table: [T, RegExp][], titleWeight: number, nodeWeight: number, nodeCap: number) {
  const scores = new Map<T, number>(), title = fold(`${doc.name} ${doc.environment.objective?.title ?? ''}`)
  const add = (key: T, value: number) => scores.set(key, (scores.get(key) ?? 0) + value)
  for (const [key, pattern] of table) if (pattern.test(title)) add(key, titleWeight)
  const nodeScores = new Map<T, number>()
  for (const node of doc.nodes.slice(0, 800)) {
    const text = fold(`${node.name} ${node.asset?.type ?? ''}`)
    for (const [key, pattern] of table) if (pattern.test(text)) nodeScores.set(key, Math.min(nodeCap, (nodeScores.get(key) ?? 0) + nodeWeight))
  }
  for (const [key, value] of nodeScores) add(key, value)
  return scores
}
const area = (node: SceneNode) => Math.abs(node.dimensions[0] * node.scale[0] * node.dimensions[2] * node.scale[2])
const best = <T extends string>(scores: Map<T, number>, order: readonly T[], min: number): T | null => {
  let result: T | null = null, top = min
  for (const key of order) { const value = scores.get(key) ?? 0; if (value > top || (result === null && value >= top && value > 0)) { result = key; top = value } }
  return result
}

function inferAmbience(doc: ThreeSceneDocument): ResolvedAmbience {
  const env = doc.environment, sky = env.sky ?? 'studio'
  const scores = keywordScores(doc, ambienceWords, 4, 0.6, 2.4)
  const add = (key: Ambience, value: number) => scores.set(key, (scores.get(key) ?? 0) + value)
  const weather = weatherAmbience[env.weather ?? 'none']
  if (weather) add(weather[0], weather[1])
  if (sky === 'space') add('space', 5)
  else if (sky === 'night') add('night', 2)
  else if (sky === 'overcast') add('wind', 1)
  else if (sky === 'day' || sky === 'sunset') add('meadow', 1)
  let water = false
  for (const node of doc.nodes) {
    if (node.kind === 'terrain' && node.geometry.biome && biomeAmbience[node.geometry.biome]) add(biomeAmbience[node.geometry.biome], node.geometry.biome === 'tropical' ? 3 : 4)
    if (node.visible && node.material.texture === 'water' && area(node) >= 80) water = true
    if (node.visible && node.material.texture === 'sand' && area(node) >= 80) { add('beach', 1); add('desert', 1) }
  }
  if (water) add('beach', 3)
  const order: Ambience[] = ['underwater', 'space', 'scifi', 'cave', 'dungeon', 'volcanic', 'rain', 'city', 'swamp', 'snow', 'desert', 'beach', 'forest', 'night', 'wind', 'meadow']
  const result = best(scores, order, 0)
  if (!result) return sky === 'studio' ? 'none' : sky === 'night' ? 'night' : 'meadow'
  return sky === 'night' && (result === 'forest' || result === 'meadow' || result === 'wind') ? 'night' : result
}

/** Pure: chooses ambience from sky, terrain biome, weather, water planes, names/themes; 'none' stays none; explicit presets are kept. */
export function resolveAmbience(doc: ThreeSceneDocument): ResolvedAmbience {
  const chosen = doc.environment.audio?.ambience ?? 'auto'
  return chosen === 'auto' ? inferAmbience(doc) : chosen
}

/** Pure: chooses music mood from objective, enemies (combat/tension), sky (night → mystery/spooky), space, peaceful exploration → calm/adventure. */
export function resolveMusic(doc: ThreeSceneDocument): ResolvedMusic {
  const env = doc.environment, chosen = env.audio?.music ?? 'auto'
  if (chosen !== 'auto') return chosen
  const sky = env.sky ?? 'studio', objective = env.objective?.type, night = sky === 'night'
  const explicit = env.audio?.ambience, place = explicit && explicit !== 'auto' && explicit !== 'none' ? explicit : inferAmbience(doc)
  let enemies = 0, hazards = 0, interactive = 0
  for (const node of doc.nodes) {
    if (node.behavior?.type === 'enemy') enemies++
    else if (node.behavior?.type === 'hazard') hazards++
    if (node.behavior || node.interaction) interactive++
  }
  const words = keywordScores(doc, musicWords, 3, 0.5, 1.5), spooky = (words.get('spooky') ?? 0) > 0
  if (objective === 'defeatEnemies' || (enemies && (words.get('combat') ?? 0) >= 1.5)) return 'combat'
  if (objective === 'survive') return night || spooky ? 'spooky' : 'tension'
  if (enemies >= 3) return night || spooky ? 'spooky' : 'tension'
  const theme = best(words, ['combat', 'spooky', 'festive', 'heroic', 'mystery', 'space', 'adventure', 'calm'], 1.49)
  if (theme && theme !== 'combat') return theme
  if (place === 'space' || place === 'scifi' || sky === 'space') return 'space'
  if (night || place === 'night') return enemies || hazards ? 'spooky' : 'mystery'
  if (place === 'cave' || place === 'dungeon') return enemies || hazards ? 'tension' : 'mystery'
  if (enemies) return 'adventure'
  if (objective === 'collectAll' || objective === 'reachGoal') return env.player?.avatar === 'knight' ? 'heroic' : 'adventure'
  if (!objective && !interactive && place === 'none' && sky === 'studio') return 'none'
  return hazards ? 'adventure' : 'calm'
}

type BassStyle = 'long' | 'pulse' | 'ostinato' | 'oompah'
type DrumStyle = 'none' | 'soft' | 'pulse' | 'beat' | 'drive' | 'march' | 'bounce' | 'heartbeat'
interface MoodSpec { tempo: number; root: number; scale: number[]; prog: number[]; seventh: boolean; pluck: number; lead: number; bass: BassStyle; drums: DrumStyle; drumLevel: number; padTone: number }
const major = [0, 2, 4, 5, 7, 9, 11], minor = [0, 2, 3, 5, 7, 8, 10]
const moods: Record<Mood, MoodSpec> = {
  calm: { tempo: 72, root: 55, scale: [0, 2, 4, 7, 9], prog: [0, 3, 1, 4], seventh: false, pluck: 0.45, lead: 0, bass: 'long', drums: 'none', drumLevel: 0, padTone: 1100 },
  adventure: { tempo: 104, root: 50, scale: major, prog: [0, 4, 5, 3], seventh: false, pluck: 0.6, lead: 0.45, bass: 'pulse', drums: 'beat', drumLevel: 0.7, padTone: 1500 },
  mystery: { tempo: 84, root: 57, scale: [0, 2, 3, 5, 7, 9, 10], prog: [0, 3, 0, 6], seventh: true, pluck: 0.3, lead: 0.15, bass: 'long', drums: 'soft', drumLevel: 0.45, padTone: 900 },
  tension: { tempo: 96, root: 52, scale: minor, prog: [0, 0, 5, 4], seventh: false, pluck: 0.2, lead: 0.15, bass: 'ostinato', drums: 'pulse', drumLevel: 0.55, padTone: 800 },
  combat: { tempo: 132, root: 50, scale: [0, 2, 3, 5, 7, 8, 11], prog: [0, 5, 3, 4], seventh: false, pluck: 0.3, lead: 0.5, bass: 'ostinato', drums: 'drive', drumLevel: 0.8, padTone: 1300 },
  space: { tempo: 60, root: 48, scale: [0, 2, 4, 6, 7, 9, 11], prog: [0, 1, 0, 4], seventh: true, pluck: 0.15, lead: 0, bass: 'long', drums: 'none', drumLevel: 0, padTone: 700 },
  festive: { tempo: 120, root: 53, scale: major, prog: [0, 3, 4, 0], seventh: false, pluck: 0.7, lead: 0.6, bass: 'oompah', drums: 'bounce', drumLevel: 0.65, padTone: 1800 },
  spooky: { tempo: 70, root: 55, scale: [0, 1, 3, 4, 6, 7, 9, 10], prog: [0, 0, 1, 3], seventh: false, pluck: 0.25, lead: 0.12, bass: 'long', drums: 'heartbeat', drumLevel: 0.45, padTone: 700 },
  heroic: { tempo: 96, root: 55, scale: [0, 2, 4, 5, 7, 9, 10], prog: [0, 6, 3, 0], seventh: false, pluck: 0.3, lead: 0.55, bass: 'pulse', drums: 'march', drumLevel: 0.7, padTone: 1600 },
}
const moodList = Object.keys(moods) as Mood[]
const dangerOf: Record<Mood, Mood> = { calm: 'tension', adventure: 'combat', mystery: 'tension', tension: 'combat', combat: 'combat', space: 'tension', festive: 'combat', spooky: 'tension', heroic: 'combat' }
const random = (seed: number) => {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = Math.imul(state ^ (state >>> 15), state | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const hash = (...values: number[]) => values.reduce((h, v) => Math.imul(h ^ (v | 0), 0x01000193) >>> 0, 0x811c9dc5)
const textHash = (text: string) => hash(...Array.from(text.slice(0, 64), (c) => c.charCodeAt(0)))
const pitch = (spec: MoodSpec, degree: number, octave: number) => {
  const n = spec.scale.length
  return spec.root + 12 * octave + spec.scale[((degree % n) + n) % n] + 12 * Math.floor(degree / n)
}

/** Pure, deterministic: the note/drum schedule of one musical bar for a mood (seeded), used by the engine and tests. */
export function musicBar(mood: Mood, bar: number, seed = 1): MusicBar {
  const spec = moods[mood] ?? moods.calm, beat = 60 / spec.tempo, length = beat * 4, step = beat / 2, n = spec.scale.length
  const index = Math.max(0, Math.floor(Number.isFinite(bar) ? bar : 0)), r = random(hash(seed, moodList.indexOf(mood) + 1, index % 16))
  const notes: MusicBar['notes'] = [], drums: MusicBar['drums'] = []
  const note = (time: number, midi: number, duration: number, voice: Voice) => { if (time >= 0 && time < length - 1e-6) notes.push({ time, midi, duration: Math.max(0.02, Math.min(duration, length - time)), voice }) }
  const hit = (time: number, kind: Drum) => { if (time >= 0 && time < length - 1e-6) drums.push({ time, kind }) }
  const degree = spec.prog[index % spec.prog.length], chord = [0, 2, 4, ...(spec.seventh ? [6] : [])].map((o) => pitch(spec, degree + o, 0))
  for (const midi of chord) note(0, midi, length, 'pad')
  const root = pitch(spec, degree % n, -1), fifth = pitch(spec, (degree % n) + 4, -1)
  if (spec.bass === 'long') {
    if (r() < 0.35) { note(0, root, length / 2, 'bass'); note(length / 2, fifth, length / 2, 'bass') } else note(0, root, length, 'bass')
  } else if (spec.bass === 'pulse') for (let b = 0; b < 4; b++) note(b * beat, b === 3 && r() < 0.5 ? fifth : root, beat * 0.8, 'bass')
  else if (spec.bass === 'ostinato') for (let s = 0; s < 8; s++) note(s * step, s % 4 === 2 ? root + 12 : s === 7 && r() < 0.5 ? fifth : root, step * 0.75, 'bass')
  else for (let b = 0; b < 4; b++) note(b * beat, b % 2 ? fifth : root, beat * 0.5, 'bass')
  const arp = [0, 1, 2, 1, 0, 2, 1, 3]
  for (let s = 0; s < 8; s++) if (r() < spec.pluck) note(s * step, chord[arp[s] % chord.length] + (mood === 'space' ? 24 : 12), step * 1.8, 'pluck')
  if (spec.lead > 0) {
    let position = degree + n + [0, 2, 4][Math.floor(r() * 3)]
    for (let b = 0; b < 4; b++) {
      if (index % 4 === 3 && b === 3) { note(b * beat, pitch(spec, degree + n, 0), beat, 'lead'); break }
      if (r() >= spec.lead) continue
      const moves = [-2, -1, -1, 0, 1, 1, 2]
      position = Math.min(degree + n + 6, Math.max(degree + n - 3, position + moves[Math.floor(r() * moves.length)]))
      if (spec.drums !== 'none' && r() < 0.3) {
        note(b * beat, pitch(spec, position, 0), step * 0.9, 'lead')
        position += r() < 0.5 ? 1 : -1
        note(b * beat + step, pitch(spec, position, 0), step * 0.9, 'lead')
      } else note(b * beat, pitch(spec, position, 0), beat * 0.9, 'lead')
    }
  }
  const fill = index % 4 === 3
  const style = spec.drums
  if (style === 'soft') { hit(0, 'kick'); for (let s = 1; s < 8; s += 2) if (r() < 0.5) hit(s * step, 'hat') }
  else if (style === 'pulse') { hit(0, 'kick'); hit(beat * 1.5, 'kick'); hit(beat * 2, 'kick'); for (let s = 0; s < 8; s++) hit(s * step, 'hat'); if (fill) hit(beat * 3, 'snare') }
  else if (style === 'beat') { hit(0, 'kick'); hit(beat * 2, 'kick'); if (r() < 0.4) hit(beat * 2.5, 'kick'); hit(beat, 'snare'); hit(beat * 3, 'snare'); for (let s = 0; s < 8; s++) hit(s * step, 'hat') }
  else if (style === 'drive') {
    for (let b = 0; b < 4; b++) hit(b * beat, 'kick')
    hit(beat, 'snare'); hit(beat * 3, 'snare')
    for (let s = 0; s < 8; s++) hit(s * step, 'hat')
    if (fill) for (let s = 1; s < 4; s++) hit(beat * 3 + s * beat / 4, 'snare')
    else if (r() < 0.5) hit(beat * 3.75, 'hat')
  } else if (style === 'march') { hit(0, 'kick'); hit(beat * 2, 'kick'); hit(beat, 'snare'); hit(beat * 3, 'snare'); if (fill || r() < 0.4) { hit(beat * 3.5, 'snare'); hit(beat * 3.75, 'snare') } }
  else if (style === 'bounce') { hit(0, 'kick'); hit(beat * 2, 'kick'); hit(beat, 'snare'); hit(beat * 3, 'snare'); for (let s = 1; s < 8; s += 2) hit(s * step, 'hat') }
  else if (style === 'heartbeat') { hit(0, 'kick'); hit(beat * 0.3, 'kick'); if (r() < 0.5) { hit(beat * 2, 'kick'); hit(beat * 2.3, 'kick') } }
  notes.sort((a, b) => a.time - b.time); drums.sort((a, b) => a.time - b.time)
  return { notes, drums, tempo: spec.tempo }
}

type NoiseKind = 'white' | 'pink' | 'brown'
type FilterSpec = [BiquadFilterType, number, number?]
interface Shape { at: number; a: number; h?: number; r: number; v: number; dest: AudioNode }
interface ToneSpec extends Shape { type?: OscillatorType; f: number; to?: number; glide?: number; detune?: number; filter?: FilterSpec; vib?: [number, number] }
interface BurstSpec extends Shape { noise?: NoiseKind; filter: FilterSpec; to?: number; pan?: [number, number]; rate?: number }
interface Ev { next: number; fire: (at: number) => number }
interface Patch { out: GainNode; sources: AudioScheduledSourceNode[]; nodes: AudioNode[]; events: Ev[]; dead: boolean; spread: AudioNode[] }
interface Live { patch: Patch; panner: PannerNode; preset: SoundPreset; level: number; position: [number, number, number] }
type Recipe = (p: Patch) => void
const LOOKAHEAD = 0.3, MAX_VOICES = 140, MAX_SFX = 24, MAX_EMITTERS = 12
const midiHz = (midi: number) => 440 * 2 ** ((midi - 69) / 12)
const rnd = (min: number, max: number) => min + Math.random() * (max - min)
const pick = <T,>(items: readonly T[]) => items[Math.floor(Math.random() * items.length)]
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, Number.isFinite(value) ? value : min))
const reverbSend: Partial<Record<ResolvedAmbience, number>> = { cave: 0.9, dungeon: 0.85, underwater: 0.5, space: 0.6, scifi: 0.3, city: 0.25, volcanic: 0.3, rain: 0.12 }
const sfxGap: Partial<Record<SfxName, number>> = { step: 0.07, talk: 0.06 }

/** Returns null when Web Audio is unavailable (tests/node, old browsers). Must be called from a user gesture path to be allowed to start. */
export function createAudioEngine(): AudioEngine | null {
  const scope = globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }
  const Context = scope.AudioContext ?? scope.webkitAudioContext
  if (typeof Context !== 'function') return null
  try { return audioEngine(new Context({ latencyHint: 'interactive' })) } catch { return null }
}

function audioEngine(ctx: AudioContext): AudioEngine {
  const now = () => ctx.currentTime
  const gain = (value: number) => { const node = ctx.createGain(); node.gain.value = value; return node }
  const filter = ([type, frequency, q]: FilterSpec) => { const node = ctx.createBiquadFilter(); node.type = type; node.frequency.value = frequency; node.Q.value = q ?? 0.7; return node }
  const master = gain(0)
  try {
    const compressor = ctx.createDynamicsCompressor()
    compressor.threshold.value = -16; compressor.knee.value = 16; compressor.ratio.value = 4; compressor.attack.value = 0.006; compressor.release.value = 0.25
    master.connect(compressor).connect(ctx.destination)
  } catch { master.connect(ctx.destination) }
  const bus = (level: number) => { const node = gain(level); node.connect(master); return node }
  const ambienceBus = bus(0.5), musicBus = bus(0.24), worldBus = bus(0.75), sfxBus = bus(0.85)
  let reverb: ConvolverNode | null = null
  try {
    reverb = ctx.createConvolver()
    const seconds = 2.6, length = Math.floor(ctx.sampleRate * seconds), impulse = ctx.createBuffer(2, length, ctx.sampleRate)
    for (let c = 0; c < 2; c++) { const data = impulse.getChannelData(c); for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 3.2 }
    reverb.buffer = impulse
    reverb.connect(bus(0.8))
  } catch { reverb = null }
  const send = (from: AudioNode, amount: number) => { const node = gain(amount); if (reverb) from.connect(node).connect(reverb); return node }
  const ambienceSend = send(ambienceBus, 0.15)
  send(musicBus, 0.35); send(worldBus, 0.2); send(sfxBus, 0.12)

  const noises = new Map<NoiseKind, AudioBuffer>()
  const noise = (kind: NoiseKind) => {
    const cached = noises.get(kind)
    if (cached) return cached
    const length = Math.floor(ctx.sampleRate * 4), buffer = ctx.createBuffer(1, length, ctx.sampleRate), data = buffer.getChannelData(0)
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0, peak = 1e-6
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1
      if (kind === 'white') data[i] = white
      else if (kind === 'pink') {
        b0 = 0.99886 * b0 + white * 0.0555179; b1 = 0.99332 * b1 + white * 0.0750759; b2 = 0.969 * b2 + white * 0.153852
        b3 = 0.8665 * b3 + white * 0.3104856; b4 = 0.55 * b4 + white * 0.5329522; b5 = -0.7616 * b5 - white * 0.016898
        data[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362; b6 = white * 0.115926
      } else { last = (last + 0.02 * white) / 1.02; data[i] = last }
      peak = Math.max(peak, Math.abs(data[i]))
    }
    for (let i = 0; i < length; i++) data[i] *= 0.9 / peak
    noises.set(kind, buffer)
    return buffer
  }

  let voices = 0, disposed = false
  const finish = (source: AudioScheduledSourceNode, nodes: AudioNode[], end: number) => {
    voices++
    source.onended = () => { voices--; for (const node of nodes) node.disconnect() }
    source.stop(end)
  }
  const envelope = (param: AudioParam, { at, a, h = 0, r, v }: Shape) => {
    param.setValueAtTime(0, at); param.linearRampToValueAtTime(v, at + a); param.setValueAtTime(v, at + a + h); param.setTargetAtTime(0, at + a + h, Math.max(0.005, r / 5))
    return at + a + h + r + 0.05
  }
  const tone = (o: ToneSpec) => {
    if (voices >= MAX_VOICES || !(o.f > 0) || o.at < now() - 0.05) return
    const osc = ctx.createOscillator(), env = ctx.createGain(), nodes: AudioNode[] = [osc, env]
    osc.type = o.type ?? 'sine'
    osc.frequency.setValueAtTime(o.f, o.at)
    if (o.to && o.to > 0) osc.frequency.exponentialRampToValueAtTime(o.to, o.at + (o.glide ?? o.a + (o.h ?? 0) + o.r))
    if (o.detune) osc.detune.value = o.detune
    let tail: AudioNode = osc
    if (o.filter) { const node = filter(o.filter); tail.connect(node); tail = node; nodes.push(node) }
    tail.connect(env); env.connect(o.dest)
    const end = envelope(env.gain, o)
    if (o.vib) {
      const mod = ctx.createOscillator(), depth = gain(o.vib[1])
      mod.frequency.value = o.vib[0]; mod.connect(depth).connect(osc.frequency); mod.start(o.at); mod.stop(end); nodes.push(mod, depth)
    }
    osc.start(o.at); finish(osc, nodes, end)
  }
  const burst = (o: BurstSpec) => {
    if (voices >= MAX_VOICES || o.at < now() - 0.05) return
    const source = ctx.createBufferSource(), shape = filter(o.filter), env = ctx.createGain(), nodes: AudioNode[] = [source, shape, env]
    source.buffer = noise(o.noise ?? 'white'); source.loop = true
    if (o.rate) source.playbackRate.value = o.rate
    const end = envelope(env.gain, o)
    shape.frequency.setValueAtTime(o.filter[1], o.at)
    if (o.to && o.to > 0) shape.frequency.exponentialRampToValueAtTime(o.to, end - 0.05)
    source.connect(shape).connect(env)
    if (o.pan && ctx.createStereoPanner) {
      const panner = ctx.createStereoPanner()
      panner.pan.setValueAtTime(o.pan[0], o.at); panner.pan.linearRampToValueAtTime(o.pan[1], end); env.connect(panner).connect(o.dest); nodes.push(panner)
    } else env.connect(o.dest)
    source.start(o.at, Math.random() * 3); finish(source, nodes, end)
  }
  const pulses = (dest: AudioNode, at: number, type: OscillatorType, frequency: number, count: number, spacing: number, width: number, level: number, shape?: FilterSpec) => {
    if (voices >= MAX_VOICES || at < now() - 0.05) return
    const osc = ctx.createOscillator(), env = ctx.createGain(), nodes: AudioNode[] = [osc, env]
    osc.type = type; osc.frequency.value = frequency
    let tail: AudioNode = osc
    if (shape) { const node = filter(shape); tail.connect(node); tail = node; nodes.push(node) }
    tail.connect(env).connect(dest)
    env.gain.setValueAtTime(0, at)
    for (let k = 0; k < count; k++) { const t = at + k * spacing; env.gain.setValueAtTime(0, t); env.gain.linearRampToValueAtTime(level, t + width * 0.3); env.gain.linearRampToValueAtTime(0, t + width) }
    osc.start(at); finish(osc, nodes, at + count * spacing + 0.05)
  }

  const patch = (dest: AudioNode, level: number, fadeIn: number, spread = false): Patch => {
    const out = ctx.createGain(), t = now()
    out.gain.setValueAtTime(0, t)
    if (fadeIn > 0) out.gain.linearRampToValueAtTime(level, t + fadeIn)
    out.connect(dest)
    const p: Patch = { out, sources: [], nodes: [], events: [], dead: false, spread: [] }
    if (spread && ctx.createStereoPanner) for (const value of [-0.75, -0.25, 0.25, 0.75]) { const panner = ctx.createStereoPanner(); panner.pan.value = value; panner.connect(out); p.spread.push(panner); p.nodes.push(panner) }
    return p
  }
  const release = (p: Patch, fade: number) => {
    if (p.dead) return
    p.dead = true; p.events.length = 0
    const t = now()
    p.out.gain.cancelScheduledValues(t); p.out.gain.setValueAtTime(p.out.gain.value, t); p.out.gain.linearRampToValueAtTime(0, t + fade)
    setTimeout(() => {
      for (const source of p.sources) try { source.stop() } catch { continue }
      for (const node of [...p.nodes, p.out]) node.disconnect()
    }, (fade + 0.25) * 1000)
  }
  const spot = (p: Patch): AudioNode => p.spread.length ? pick(p.spread) : p.out
  const noiseLoop = (p: Patch, kind: NoiseKind, shape: FilterSpec, level: number) => {
    const source = ctx.createBufferSource(), node = filter(shape), amp = gain(level)
    source.buffer = noise(kind); source.loop = true; source.connect(node).connect(amp).connect(p.out); source.start(now(), Math.random() * 3)
    p.sources.push(source); p.nodes.push(source, node, amp)
    return { filter: node, gain: amp }
  }
  const drone = (p: Patch, type: OscillatorType, frequency: number, level: number, shape?: FilterSpec, detune = 0) => {
    const osc = ctx.createOscillator(), amp = gain(level)
    osc.type = type; osc.frequency.value = frequency; osc.detune.value = detune
    if (shape) { const node = filter(shape); osc.connect(node).connect(amp); p.nodes.push(node) } else osc.connect(amp)
    amp.connect(p.out); osc.start(); p.sources.push(osc); p.nodes.push(osc, amp)
    return { osc, gain: amp }
  }
  const lfo = (p: Patch, param: AudioParam, rate: number, depth: number, type: OscillatorType = 'sine') => {
    const osc = ctx.createOscillator(), amount = gain(depth)
    osc.type = type; osc.frequency.value = rate; osc.connect(amount).connect(param); osc.start(now() + Math.random() * 0.1)
    p.sources.push(osc); p.nodes.push(osc, amount)
  }
  const every = (p: Patch, min: number, max: number, fire: (dest: AudioNode, at: number) => void) => p.events.push({ next: now() + rnd(0.2, max), fire: (at) => { fire(spot(p), at); return rnd(min, max) } })

  const wind = (p: Patch, level: number, center: number, gust: number) => {
    const w = noiseLoop(p, 'pink', ['bandpass', center, 0.7], level)
    lfo(p, w.filter.frequency, 0.04 + gust * 0.3, center * 0.45); lfo(p, w.gain.gain, gust, level * 0.4); lfo(p, w.gain.gain, gust * 0.37, level * 0.25)
  }
  const whistle = (p: Patch, level: number, center: number) => { const w = noiseLoop(p, 'white', ['bandpass', center, 9], level); lfo(p, w.filter.frequency, 0.07, center * 0.3); lfo(p, w.gain.gain, 0.09, level * 0.8) }
  const rumble = (p: Patch, level: number, center: number) => { const r = noiseLoop(p, 'brown', ['lowpass', center, 0.7], level); lfo(p, r.gain.gain, 0.05, level * 0.3) }
  const waves = (p: Patch, level: number) => {
    const body = noiseLoop(p, 'brown', ['lowpass', 500, 0.6], level * 0.2), foam = noiseLoop(p, 'white', ['highpass', 2500, 0.5], level * 0.01)
    p.events.push({ next: now() + 0.5, fire: (at) => {
      const peak = rnd(0.7, 1) * level, crest = at + rnd(1.8, 2.6)
      body.gain.gain.setTargetAtTime(peak, at, 0.8); body.gain.gain.setTargetAtTime(level * 0.18, crest, 1.4)
      body.filter.frequency.setTargetAtTime(1400, at, 0.8); body.filter.frequency.setTargetAtTime(480, crest, 1.5)
      foam.gain.gain.setTargetAtTime(peak * 0.09, crest - 0.4, 0.3); foam.gain.gain.setTargetAtTime(level * 0.01, crest + 0.4, 1.1)
      return rnd(4.5, 8)
    } })
  }
  const chirp = (dest: AudioNode, at: number) => {
    const base = rnd(2200, 3800), up = Math.random() < 0.6, count = 2 + Math.floor(Math.random() * 4), gap = rnd(0.07, 0.14)
    for (let i = 0; i < count; i++) tone({ dest, at: at + i * gap, f: base * rnd(0.92, 1.08), to: base * (up ? rnd(1.2, 1.6) : rnd(0.6, 0.8)), glide: 0.07, a: 0.008, h: 0.02, r: 0.06, v: 0.05, vib: Math.random() < 0.3 ? [40, 120] : undefined })
  }
  const cricket = (dest: AudioNode, at: number, level = 0.025) => { const f = rnd(4200, 5200); for (let k = 0; k < 2 + Math.floor(Math.random() * 2); k++) pulses(dest, at + k * 0.45, 'sine', f, 4 + Math.floor(Math.random() * 4), 0.045, 0.03, level) }
  const frog = (dest: AudioNode, at: number) => { const f = rnd(90, 160); for (let k = 0; k < 1 + Math.floor(Math.random() * 2); k++) pulses(dest, at + k * 0.42, 'sawtooth', f, 7 + Math.floor(Math.random() * 4), 0.03, 0.026, 0.1, ['bandpass', rnd(450, 700), 2]) }
  const owl = (dest: AudioNode, at: number) => { for (const [delay, f] of [[0, 392], [0.55, 370], [0.85, 370]]) tone({ dest, at: at + delay, f, to: f * 0.94, a: 0.06, h: delay ? 0.12 : 0.28, r: 0.2, v: 0.03, filter: ['lowpass', 900] }) }
  const gull = (dest: AudioNode, at: number) => { for (let k = 0; k < 2 + Math.floor(Math.random() * 2); k++) tone({ dest, at: at + k * 0.32, type: 'sawtooth', f: rnd(1250, 1450), to: rnd(850, 950), glide: 0.25, a: 0.02, h: 0.08, r: 0.15, v: 0.012, filter: ['lowpass', 2200], vib: [14, 30] }) }
  const drip = (dest: AudioNode, at: number, level = 0.07) => { const f = rnd(900, 1800); tone({ dest, at, f, to: f * 1.9, glide: 0.04, a: 0.002, r: 0.18, v: level }) }
  const crackle = (dest: AudioNode, at: number, level = 0.08) => burst({ dest, at, filter: ['bandpass', rnd(1500, 5000), 1], a: 0.001, r: rnd(0.008, 0.03), v: level * rnd(0.4, 1) })
  const bubble = (dest: AudioNode, at: number, level = 0.04, low = 250, high = 600) => { for (let k = 0; k < 1 + Math.floor(Math.random() * 4); k++) { const f = rnd(low, high); tone({ dest, at: at + k * rnd(0.03, 0.12), f, to: f * rnd(1.8, 2.6), glide: rnd(0.03, 0.08), a: 0.003, r: 0.06, v: level }) } }
  const beep = (dest: AudioNode, at: number) => { for (let k = 0; k < 1 + Math.floor(Math.random() * 3); k++) tone({ dest, at: at + k * 0.12, f: midiHz(pick([72, 76, 79, 83, 84, 88])), a: 0.005, h: 0.05, r: 0.08, v: 0.025 }) }
  const horn = (dest: AudioNode, at: number) => { const hold = rnd(0.15, 0.5), [x, y] = pick([[330, 415], [294, 370], [262, 330]]); for (const f of [x, y]) tone({ dest, at, type: 'sawtooth', f, a: 0.03, h: hold, r: 0.1, v: 0.012, filter: ['lowpass', 900] }) }
  const car = (dest: AudioNode, at: number) => { const d = rnd(2.5, 4.5), side = Math.random() < 0.5 ? 1 : -1; burst({ dest, at, noise: 'pink', filter: ['lowpass', 450, 0.8], to: 300, a: d * 0.5, r: d * 0.5, v: 0.25, pan: [-side, side] }) }
  const chime = (dest: AudioNode, at: number) => { for (let k = 0; k < 1 + Math.floor(Math.random() * 3); k++) { const f = midiHz(pick([84, 86, 88, 91, 93, 96])); tone({ dest, at: at + k * rnd(0.12, 0.35), f, a: 0.002, r: 1.8, v: 0.04 }); tone({ dest, at: at + k * rnd(0.12, 0.35), f: f * 2.76, a: 0.002, r: 0.6, v: 0.012 }) } }
  const sparkle = (dest: AudioNode, at: number, level = 0.02) => { for (let k = 0; k < 3; k++) tone({ dest, at: at + k * 0.06, f: midiHz(pick([88, 91, 93, 96, 98, 100])), a: 0.005, h: 0.02, r: 0.6, v: level, vib: [6, 6] }) }
  const thunder = (dest: AudioNode, at: number) => { burst({ dest, at, noise: 'brown', filter: ['lowpass', 180, 0.7], to: 90, a: 0.4, h: 0.4, r: 3, v: 0.6 }); tone({ dest, at, f: 52, to: 32, glide: 2, a: 0.3, h: 0.3, r: 2, v: 0.12 }) }
  const boom = (dest: AudioNode, at: number) => { tone({ dest, at, f: 60, to: 30, glide: 1.5, a: 0.05, h: 0.3, r: 1.6, v: 0.22 }); burst({ dest, at, noise: 'brown', filter: ['lowpass', 220, 0.7], a: 0.05, h: 0.2, r: 1.2, v: 0.5 }) }
  const clank = (dest: AudioNode, at: number, level = 0.06) => { for (let k = 0; k < 2 + Math.floor(Math.random() * 3); k++) burst({ dest, at: at + k * rnd(0.08, 0.2), filter: ['bandpass', rnd(900, 1800), 9], a: 0.001, r: 0.25, v: level }) }
  const moan = (dest: AudioNode, at: number) => tone({ dest, at, f: rnd(160, 200), to: rnd(240, 300), glide: 2.2, a: 1, h: 1, r: 1.5, v: 0.02, filter: ['lowpass', 500], vib: [3, 6] })

  const ambiences: Record<Ambience, Recipe> = {
    forest: (p) => { wind(p, 0.35, 500, 0.1); const leaves = noiseLoop(p, 'pink', ['bandpass', 2400, 0.6], 0.05); lfo(p, leaves.gain.gain, 0.17, 0.04); every(p, 0.6, 3.5, chirp) },
    meadow: (p) => { wind(p, 0.3, 380, 0.08); every(p, 1.5, 6, chirp) },
    beach: (p) => { waves(p, 1); wind(p, 0.18, 600, 0.1); every(p, 7, 18, gull) },
    desert: (p) => { wind(p, 0.45, 650, 0.18); whistle(p, 0.03, 1400); const sand = noiseLoop(p, 'white', ['highpass', 4000, 0.5], 0.02); lfo(p, sand.gain.gain, 0.2, 0.018) },
    snow: (p) => { wind(p, 0.35, 300, 0.07); whistle(p, 0.025, 900) },
    swamp: (p) => { wind(p, 0.12, 300, 0.05); every(p, 0.7, 2.5, frog); every(p, 1.2, 3, (d, t) => cricket(d, t, 0.012)) },
    cave: (p) => { rumble(p, 0.25, 90); const air = noiseLoop(p, 'pink', ['bandpass', 220, 0.9], 0.15); lfo(p, air.gain.gain, 0.06, 0.08); every(p, 0.8, 3.2, (d, t) => drip(d, t)) },
    city: (p) => { const traffic = noiseLoop(p, 'brown', ['lowpass', 280, 0.7], 0.35); lfo(p, traffic.gain.gain, 0.04, 0.12); noiseLoop(p, 'pink', ['bandpass', 900, 0.5], 0.03); every(p, 3, 9, car); every(p, 8, 20, horn) },
    night: (p) => { wind(p, 0.1, 350, 0.05); every(p, 0.25, 1.2, (d, t) => cricket(d, t)); every(p, 10, 25, owl) },
    space: (p) => {
      for (const [f, detune] of [[55, -6], [82.5, 5], [110, 3]]) drone(p, 'sawtooth', f, 0.035, ['lowpass', 380, 0.8], detune)
      const shimmer = noiseLoop(p, 'pink', ['highpass', 3000, 0.5], 0.008); lfo(p, shimmer.gain.gain, 0.05, 0.006); every(p, 6, 14, (d, t) => sparkle(d, t, 0.012))
    },
    underwater: (p) => { const water = noiseLoop(p, 'brown', ['lowpass', 300, 0.8], 0.45); lfo(p, water.filter.frequency, 0.08, 120); lfo(p, water.gain.gain, 0.06, 0.12); every(p, 0.3, 2, (d, t) => bubble(d, t)); every(p, 12, 30, moan) },
    volcanic: (p) => { rumble(p, 0.4, 80); const lava = noiseLoop(p, 'brown', ['bandpass', 400, 0.6], 0.12); lfo(p, lava.gain.gain, 0.13, 0.06); every(p, 0.03, 0.35, (d, t) => crackle(d, t, 0.05)); every(p, 8, 20, boom) },
    scifi: (p) => { drone(p, 'sawtooth', 60, 0.035, ['lowpass', 250, 0.7]); drone(p, 'sawtooth', 120, 0.015, ['lowpass', 300, 0.7], 4); const vent = noiseLoop(p, 'pink', ['lowpass', 1400, 0.6], 0.06); lfo(p, vent.gain.gain, 0.11, 0.02); every(p, 2.5, 7, beep) },
    dungeon: (p) => { rumble(p, 0.2, 70); const air = noiseLoop(p, 'pink', ['bandpass', 180, 1], 0.12); lfo(p, air.gain.gain, 0.04, 0.06); every(p, 1.5, 4.5, (d, t) => drip(d, t, 0.06)); every(p, 9, 22, (d, t) => clank(d, t, 0.03)); every(p, 0.08, 0.5, (d, t) => crackle(d, t, 0.012)) },
    rain: (p) => { noiseLoop(p, 'white', ['bandpass', 3500, 0.4], 0.2); noiseLoop(p, 'pink', ['lowpass', 600, 0.7], 0.2); every(p, 0.02, 0.09, (d, t) => burst({ dest: d, at: t, filter: ['bandpass', rnd(2500, 6000), 3], a: 0.001, r: 0.02, v: rnd(0.02, 0.05) })); every(p, 15, 40, thunder) },
    wind: (p) => { wind(p, 0.55, 450, 0.2); wind(p, 0.2, 220, 0.09); whistle(p, 0.05, 1000) },
  }
  const sounds: Record<SoundPreset, Recipe> = {
    fire: (p) => { const roar = noiseLoop(p, 'brown', ['lowpass', 500, 0.7], 0.35); lfo(p, roar.gain.gain, 0.9, 0.1); const flame = noiseLoop(p, 'pink', ['bandpass', 1100, 0.6], 0.12); lfo(p, flame.gain.gain, 1.7, 0.08); every(p, 0.03, 0.25, crackle) },
    water: (p) => { const stream = noiseLoop(p, 'white', ['bandpass', 1600, 0.5], 0.14); lfo(p, stream.filter.frequency, 0.6, 400); noiseLoop(p, 'pink', ['lowpass', 700, 0.7], 0.25); every(p, 0.08, 0.4, (d, t) => bubble(d, t, 0.02, 800, 1500)) },
    waves: (p) => waves(p, 1),
    wind: (p) => { wind(p, 0.5, 500, 0.15); whistle(p, 0.04, 1100) },
    machine: (p) => { drone(p, 'sawtooth', 55, 0.08, ['lowpass', 400, 0.8]); drone(p, 'square', 110, 0.04, ['lowpass', 400, 0.8]); const chug = noiseLoop(p, 'white', ['bandpass', 1200, 1.5], 0.1); lfo(p, chug.gain.gain, 4, 0.1, 'square'); every(p, 1.2, 3.5, (d, t) => clank(d, t)) },
    engine: (p) => { const low = drone(p, 'sawtooth', 42, 0.1, ['lowpass', 260, 0.9]); drone(p, 'sawtooth', 84.5, 0.06, ['lowpass', 260, 0.9]); lfo(p, low.gain.gain, 9, 0.06); noiseLoop(p, 'brown', ['lowpass', 200, 0.7], 0.15) },
    magic: (p) => { const a = drone(p, 'sine', 660, 0.025), b = drone(p, 'sine', 990, 0.015, undefined, 7); lfo(p, a.gain.gain, 3, 0.015); lfo(p, b.gain.gain, 4.3, 0.01); every(p, 0.25, 0.9, (d, t) => sparkle(d, t, 0.03)) },
    birds: (p) => every(p, 0.5, 2.5, chirp),
    insects: (p) => every(p, 0.2, 0.9, (d, t) => cricket(d, t, 0.035)),
    drip: (p) => every(p, 0.5, 2, (d, t) => drip(d, t, 0.1)),
    chimes: (p) => { wind(p, 0.08, 500, 0.12); every(p, 0.6, 2.6, chime) },
    alarm: (p) => p.events.push({ next: now() + 0.1, fire: (at) => { for (const [delay, f] of [[0, 880], [0.4, 660]]) tone({ dest: p.out, at: at + delay, type: 'square', f, a: 0.01, h: 0.3, r: 0.06, v: 0.06, filter: ['lowpass', 2200] }); return 0.85 } }),
    portal: (p) => {
      drone(p, 'sawtooth', 110, 0.04, ['lowpass', 600, 1]); drone(p, 'sawtooth', 164.8, 0.03, ['lowpass', 600, 1], 6)
      const swirl = noiseLoop(p, 'pink', ['bandpass', 800, 3], 0.15); lfo(p, swirl.filter.frequency, 0.25, 600); every(p, 0.4, 1.5, (d, t) => sparkle(d, t, 0.025))
    },
    crowd: (p) => { for (const [f, rate] of [[500, 3.1], [1100, 4.3], [2400, 5.7]]) { const voice = noiseLoop(p, 'pink', ['bandpass', f, 2.5], 0.12); lfo(p, voice.gain.gain, rate, 0.07) } },
  }

  const sfxRecipes: Record<SfxName, (out: AudioNode, t: number, k: number) => number> = {
    step: (dest, at, k) => { burst({ dest, at, noise: 'pink', filter: ['lowpass', 700 * k, 0.8], a: 0.003, h: 0.015, r: 0.07, v: 0.35 }); tone({ dest, at, f: 110 * k, to: 60 * k, glide: 0.08, a: 0.002, r: 0.08, v: 0.18 }); return 0.15 },
    jump: (dest, at, k) => { tone({ dest, at, type: 'triangle', f: 260 * k, to: 520 * k, glide: 0.16, a: 0.01, h: 0.06, r: 0.12, v: 0.12 }); burst({ dest, at, filter: ['bandpass', 600, 1.2], to: 2400, a: 0.03, h: 0.04, r: 0.1, v: 0.12 }); return 0.3 },
    land: (dest, at, k) => { tone({ dest, at, f: 130 * k, to: 48, glide: 0.12, a: 0.002, r: 0.18, v: 0.35 }); burst({ dest, at, noise: 'pink', filter: ['lowpass', 500 * k, 0.7], a: 0.002, h: 0.02, r: 0.12, v: 0.3 }); return 0.3 },
    collect: (dest, at, k) => { tone({ dest, at, type: 'triangle', f: midiHz(88) * k, a: 0.004, h: 0.03, r: 0.25, v: 0.12 }); tone({ dest, at: at + 0.07, type: 'triangle', f: midiHz(95) * k, a: 0.004, h: 0.03, r: 0.45, v: 0.12 }); tone({ dest, at: at + 0.07, f: midiHz(100) * k, a: 0.004, r: 0.5, v: 0.04 }); return 0.6 },
    hurt: (dest, at, k) => { tone({ dest, at, type: 'sawtooth', f: 420 * k, to: 140 * k, glide: 0.22, a: 0.005, h: 0.08, r: 0.15, v: 0.16, filter: ['lowpass', 1400] }); burst({ dest, at, filter: ['bandpass', 900, 1], a: 0.002, r: 0.1, v: 0.18 }); return 0.35 },
    enemyHit: (dest, at, k) => { tone({ dest, at, f: 220 * k, to: 80 * k, glide: 0.1, a: 0.002, r: 0.14, v: 0.3 }); burst({ dest, at, filter: ['bandpass', 1800 * k, 0.9], a: 0.001, h: 0.01, r: 0.07, v: 0.25 }); return 0.25 },
    enemyDefeat: (dest, at, k) => { tone({ dest, at, type: 'sawtooth', f: 520 * k, to: 70, glide: 0.5, a: 0.005, h: 0.2, r: 0.3, v: 0.14, filter: ['lowpass', 1800] }); burst({ dest, at, noise: 'pink', filter: ['lowpass', 1200, 0.7], to: 200, a: 0.02, h: 0.1, r: 0.35, v: 0.25 }); return 0.8 },
    alert: (dest, at, k) => { tone({ dest, at, type: 'square', f: 880 * k, a: 0.005, h: 0.06, r: 0.06, v: 0.06, filter: ['lowpass', 3000] }); tone({ dest, at: at + 0.1, type: 'square', f: 1320 * k, a: 0.005, h: 0.1, r: 0.12, v: 0.06, filter: ['lowpass', 3000] }); return 0.45 },
    mechanism: (dest, at, k) => { for (let i = 0; i < 5; i++) burst({ dest, at: at + i * 0.07, filter: ['bandpass', 2200 * k, 4], a: 0.001, r: 0.03, v: 0.15 }); tone({ dest, at, type: 'square', f: 65 * k, a: 0.03, h: 0.35, r: 0.15, v: 0.12, filter: ['lowpass', 260] }); return 0.65 },
    checkpoint: (dest, at, k) => { [72, 76, 79, 84].forEach((m, i) => { tone({ dest, at: at + i * 0.09, f: midiHz(m) * k, a: 0.005, h: 0.04, r: 0.9, v: 0.1 }); tone({ dest, at: at + i * 0.09, type: 'triangle', f: midiHz(m - 12) * k, a: 0.005, h: 0.04, r: 0.6, v: 0.05 }) }); return 1.4 },
    victory: (dest, at) => {
      for (const [time, m, hold] of [[0, 67, 0.08], [0.13, 72, 0.08], [0.26, 76, 0.08], [0.39, 79, 0.3], [0.78, 76, 0.08], [0.91, 84, 0.8]]) {
        tone({ dest, at: at + time, type: 'square', f: midiHz(m), a: 0.01, h: hold, r: 0.2, v: 0.05, filter: ['lowpass', 2400] }); tone({ dest, at: at + time, type: 'triangle', f: midiHz(m), a: 0.01, h: hold, r: 0.3, v: 0.08 })
      }
      for (const m of [60, 64, 67]) tone({ dest, at: at + 0.91, type: 'triangle', f: midiHz(m), a: 0.05, h: 0.6, r: 1, v: 0.05 })
      return 2.6
    },
    defeat: (dest, at) => { for (const [time, m, hold] of [[0, 67, 0.25], [0.35, 63, 0.25], [0.7, 60, 0.25], [1.05, 55, 0.7]]) { tone({ dest, at: at + time, type: 'triangle', f: midiHz(m), to: time > 1 ? midiHz(m - 1) : undefined, a: 0.02, h: hold, r: 0.4, v: 0.1 }); tone({ dest, at: at + time, type: 'sawtooth', f: midiHz(m - 12), a: 0.02, h: hold, r: 0.4, v: 0.04, filter: ['lowpass', 1000] }) } return 2.4 },
    swing: (dest, at, k) => { burst({ dest, at, filter: ['bandpass', 500 * k, 1.5], to: 3000 * k, a: 0.06, h: 0.02, r: 0.1, v: 0.3 }); return 0.25 },
    shoot: (dest, at, k) => { tone({ dest, at, type: 'square', f: 1500 * k, to: 220, glide: 0.16, a: 0.002, h: 0.02, r: 0.14, v: 0.07, filter: ['lowpass', 4000] }); tone({ dest, at, f: 900 * k, to: 150, glide: 0.15, a: 0.002, r: 0.15, v: 0.08 }); burst({ dest, at, filter: ['highpass', 3000, 0.7], a: 0.001, r: 0.03, v: 0.1 }); return 0.3 },
    magic: (dest, at, k) => { [0, 4, 7, 11, 14, 19].forEach((step, i) => tone({ dest, at: at + i * 0.045, f: midiHz(84 + step) * k, a: 0.005, h: 0.02, r: 0.5, v: 0.045, vib: [6, 8] })); burst({ dest, at, filter: ['bandpass', 3000, 1], to: 8000, a: 0.15, h: 0.05, r: 0.3, v: 0.06 }); return 1 },
    powerup: (dest, at, k) => { [0, 4, 7, 12, 16, 19, 24, 28].forEach((step, i) => tone({ dest, at: at + i * 0.05, type: 'square', f: midiHz(60 + step) * k, a: 0.003, h: 0.025, r: 0.06, v: 0.04, filter: ['lowpass', 3500] })); tone({ dest, at, type: 'triangle', f: 300 * k, to: 1200 * k, glide: 0.45, a: 0.01, h: 0.3, r: 0.2, v: 0.06 }); return 0.8 },
    heal: (dest, at, k) => { [72, 76, 79, 84].forEach((m, i) => tone({ dest, at: at + i * 0.08, f: midiHz(m) * k, a: 0.08, h: 0.25, r: 0.8, v: 0.06, vib: [5, 3] })); return 1.6 },
    unlock: (dest, at, k) => { burst({ dest, at, filter: ['bandpass', 3000, 3], a: 0.001, r: 0.03, v: 0.2 }); burst({ dest, at: at + 0.05, filter: ['bandpass', 1800, 3], a: 0.001, r: 0.04, v: 0.2 }); tone({ dest, at: at + 0.1, f: midiHz(81) * k, a: 0.004, h: 0.05, r: 0.5, v: 0.1 }); tone({ dest, at: at + 0.18, f: midiHz(88) * k, a: 0.004, r: 0.7, v: 0.08 }); return 1 },
    locked: (dest, at, k) => { for (const delay of [0, 0.13]) { tone({ dest, at: at + delay, type: 'square', f: 140 * k, a: 0.003, h: 0.05, r: 0.06, v: 0.12, filter: ['lowpass', 500] }); burst({ dest, at: at + delay, noise: 'pink', filter: ['bandpass', 900, 2], a: 0.001, r: 0.04, v: 0.2 }) } return 0.4 },
    launch: (dest, at, k) => { tone({ dest, at, f: 180 * k, to: 900 * k, glide: 0.35, a: 0.01, h: 0.2, r: 0.2, v: 0.14, vib: [18, 30] }); burst({ dest, at, filter: ['bandpass', 400, 1], to: 3000, a: 0.2, h: 0.05, r: 0.3, v: 0.2 }); return 0.7 },
    talk: (dest, at, k) => { const count = 3 + Math.floor(Math.random() * 3); for (let i = 0; i < count; i++) tone({ dest, at: at + i * 0.085, type: 'triangle', f: rnd(240, 420) * k, a: 0.01, h: 0.04, r: 0.04, v: 0.1, filter: ['lowpass', 1800] }); return count * 0.09 + 0.1 },
    splash: (dest, at, k) => { burst({ dest, at, filter: ['lowpass', 4000 * k, 0.7], to: 500, a: 0.005, h: 0.08, r: 0.4, v: 0.35 }); for (let i = 0; i < 4; i++) { const f = rnd(400, 900) * k; tone({ dest, at: at + 0.05 + i * 0.06, f, to: f * 2, glide: 0.05, a: 0.003, r: 0.06, v: 0.04 }) } return 0.7 },
    respawn: (dest, at, k) => { burst({ dest, at, filter: ['bandpass', 800, 1], to: 5000, a: 0.5, h: 0.05, r: 0.3, v: 0.12 }); [60, 67, 72, 79].forEach((m, i) => tone({ dest, at: at + i * 0.1, f: midiHz(m) * k, a: 0.2, h: 0.2, r: 0.6, v: 0.04 })); return 1.4 },
  }

  let playing = false, muted = false, volume = 0.7, timer: ReturnType<typeof setInterval> | null = null, idle: ReturnType<typeof setTimeout> | null = null
  let ambience: Patch | null = null, mood: Mood | null = null, intensity: 'calm' | 'danger' = 'calm', layer: GainNode | null = null, seed = 1, barIndex = 0, barStart = 0, sfxActive = 0
  let queue: { at: number; play: (at: number) => void }[] = []
  const live = new Map<string, Live>(), lastSfx = new Map<SfxName, number>()
  const resume = () => { if (ctx.state !== 'running') void ctx.resume?.()?.catch(() => undefined) }
  const applyMaster = () => { const t = now(); master.gain.cancelScheduledValues(t); master.gain.setTargetAtTime(muted ? 0 : volume, t, 0.08) }
  const safe = <A extends unknown[]>(run: (...args: A) => void) => (...args: A) => { if (disposed) return; try { run(...args) } catch { return } }
  const makePanner = (ref: number, max: number) => {
    const panner = ctx.createPanner()
    try { panner.panningModel = 'HRTF' } catch { panner.panningModel = 'equalpower' }
    panner.distanceModel = 'inverse'; panner.refDistance = ref; panner.maxDistance = max; panner.rolloffFactor = 1
    return panner
  }
  const place = (panner: PannerNode, [x, y, z]: [number, number, number], smoothing: number) => {
    if (![x, y, z].every(Number.isFinite)) return
    if (panner.positionX) { const t = now(); if (smoothing > 0) { panner.positionX.setTargetAtTime(x, t, smoothing); panner.positionY.setTargetAtTime(y, t, smoothing); panner.positionZ.setTargetAtTime(z, t, smoothing) } else { panner.positionX.setValueAtTime(x, t); panner.positionY.setValueAtTime(y, t); panner.positionZ.setValueAtTime(z, t) } }
    else panner.setPosition(x, y, z)
  }
  const voice = (kind: Voice | Drum, midi: number, at: number, duration: number) => {
    const dest = layer, spec = moods[mood && intensity === 'danger' ? dangerOf[mood] : mood ?? 'calm']
    if (!dest) return
    const f = midiHz(midi), drums = spec.drumLevel
    if (kind === 'pad') for (const detune of [-8, 8]) tone({ dest, at, type: 'sawtooth', f, detune, a: Math.min(0.6, duration * 0.4), h: duration * 0.6, r: 1.2, v: 0.03, filter: ['lowpass', spec.padTone, 0.6] })
    else if (kind === 'pluck') tone({ dest, at, type: 'triangle', f, a: 0.004, r: Math.min(0.9, duration * 2), v: 0.08, filter: ['lowpass', 3000] })
    else if (kind === 'bass') tone({ dest, at, type: 'triangle', f, a: 0.01, h: duration * 0.8, r: 0.12, v: 0.16, filter: ['lowpass', 700] })
    else if (kind === 'lead') tone({ dest, at, type: 'square', f, a: 0.02, h: duration * 0.7, r: 0.25, v: 0.026, filter: ['lowpass', 1600, 0.5], vib: [5, f * 0.006] })
    else if (kind === 'kick') tone({ dest, at, f: 140, to: 45, glide: 0.12, a: 0.002, h: 0.02, r: 0.3, v: 0.45 * drums })
    else if (kind === 'snare') { burst({ dest, at, filter: ['bandpass', 1800, 0.7], a: 0.001, r: 0.14, v: 0.16 * drums }); tone({ dest, at, type: 'triangle', f: 190, to: 150, a: 0.001, r: 0.06, v: 0.08 * drums }) }
    else burst({ dest, at, filter: ['highpass', 7000, 0.7], a: 0.001, r: 0.04, v: 0.05 * drums })
  }
  const scheduleBar = () => {
    if (!mood) return
    const current = intensity === 'danger' ? dangerOf[mood] : mood, bar = musicBar(current, barIndex, seed), start = barStart
    const shift = ((moods[mood].root - moods[current].root) % 12 + 18) % 12 - 6
    for (const n of bar.notes) queue.push({ at: start + n.time, play: (at) => voice(n.voice, n.midi + shift, at, n.duration) })
    for (const d of bar.drums) queue.push({ at: start + d.time, play: (at) => voice(d.kind, 0, at, 0) })
    queue.sort((a, b) => a.at - b.at)
    barStart += 240 / bar.tempo; barIndex++
  }
  const newLayer = (fadeIn: number, fadeOut: number) => {
    const old = layer, t = now()
    if (old) { old.gain.cancelScheduledValues(t); old.gain.setValueAtTime(old.gain.value, t); old.gain.linearRampToValueAtTime(0, t + fadeOut); setTimeout(() => old.disconnect(), (fadeOut + 1.6) * 1000) }
    layer = null
    if (!mood) return
    layer = ctx.createGain(); layer.gain.setValueAtTime(0, t); layer.gain.linearRampToValueAtTime(1, t + fadeIn); layer.connect(musicBus)
  }
  const runEvents = (p: Patch, t: number) => {
    for (const ev of p.events) {
      if (ev.next < t - 1) ev.next = t + Math.random() * 0.3
      for (let guard = 0; ev.next < t + LOOKAHEAD && guard < 32; guard++) { const at = Math.max(ev.next, t); ev.next = at + Math.max(0.01, ev.fire(at)) }
    }
  }
  const tick = safe(() => {
    if (!playing) return
    const t = now()
    if (ambience) runEvents(ambience, t)
    for (const entry of live.values()) runEvents(entry.patch, t)
    if (!mood || !layer) return
    if (barStart < t - 0.2 && !queue.length) barStart = t + 0.05
    for (let guard = 0; guard < 256; guard++) {
      if (!queue.length) { if (barStart < t + LOOKAHEAD + 0.05) { scheduleBar(); continue } break }
      if (queue[0].at > t + LOOKAHEAD) break
      const event = queue.shift()!
      if (event.at > t - 0.05) event.play(Math.max(event.at, t))
    }
  })
  const releaseEmitters = (fade: number) => { for (const entry of live.values()) release(entry.patch, fade); live.clear() }
  const halt = (fade: number) => {
    playing = false
    if (timer) clearInterval(timer)
    timer = null
    if (ambience) release(ambience, fade)
    ambience = null; queue = []
    releaseEmitters(fade)
    mood = null
    newLayer(0, fade)
  }

  return {
    get muted() { return muted },
    start: safe((doc: ThreeSceneDocument) => {
      resume()
      if (idle) clearTimeout(idle)
      idle = null
      halt(0.8)
      volume = clamp(doc.environment.audio?.volume ?? 0.7, 0, 1); applyMaster()
      const kind = resolveAmbience(doc), music = resolveMusic(doc)
      ambienceSend.gain.value = reverbSend[kind] ?? 0.15
      if (kind !== 'none') { ambience = patch(ambienceBus, 1, 2.5, true); ambiences[kind](ambience) }
      intensity = 'calm'; mood = music === 'none' ? null : music; seed = textHash(doc.name || 'forma'); barIndex = 0; barStart = now() + 0.2
      newLayer(1.5, 0.8)
      playing = true
      timer = setInterval(tick, 100)
      tick()
    }),
    stop: safe(() => {
      halt(1)
      idle = setTimeout(() => { if (!playing && !disposed && sfxActive === 0) void ctx.suspend?.()?.catch(() => undefined) }, 4000)
    }),
    update: safe((listener: AudioListenerPose, emitters: AudioEmitter[], seconds: number) => {
      if (!playing) return
      const t = now(), smoothing = clamp(seconds, 0.02, 0.1), [lx, ly, lz] = listener.position, [fx, fy, fz] = listener.forward
      const length = Math.hypot(fx, fy, fz), forward = length > 1e-6 ? [fx / length, fy / length, fz / length] : [0, 0, -1]
      const l = ctx.listener
      if ([lx, ly, lz].every(Number.isFinite)) {
        if (l.positionX) {
          l.positionX.setTargetAtTime(lx, t, smoothing); l.positionY.setTargetAtTime(ly, t, smoothing); l.positionZ.setTargetAtTime(lz, t, smoothing)
          l.forwardX.setTargetAtTime(forward[0], t, smoothing); l.forwardY.setTargetAtTime(forward[1], t, smoothing); l.forwardZ.setTargetAtTime(forward[2], t, smoothing)
          l.upX.setValueAtTime(0, t); l.upY.setValueAtTime(1, t); l.upZ.setValueAtTime(0, t)
        } else { l.setPosition(lx, ly, lz); l.setOrientation(forward[0], forward[1], forward[2], 0, 1, 0) }
      }
      const ranked = emitters.flatMap((emitter) => {
        const [x, y, z] = emitter.position, reach = clamp(emitter.sound.radius, 1, 200) * 1.5, distance = Math.hypot(x - lx, y - ly, z - lz)
        return Number.isFinite(distance) && distance <= reach * (live.has(emitter.id) ? 1.1 : 1) ? [{ emitter, distance, reach }] : []
      }).sort((a, b) => a.distance / a.reach - b.distance / b.reach).slice(0, MAX_EMITTERS)
      const keep = new Set(ranked.map((item) => item.emitter.id))
      for (const [id, entry] of live) if (!keep.has(id)) { release(entry.patch, 0.6); live.delete(id) }
      for (const { emitter, distance, reach } of ranked) {
        let entry = live.get(emitter.id)
        if (entry && entry.preset !== emitter.sound.preset) { release(entry.patch, 0.4); live.delete(emitter.id); entry = undefined }
        if (!entry) {
          const radius = clamp(emitter.sound.radius, 1, 200), panner = makePanner(Math.max(1, radius * 0.2), reach)
          panner.connect(worldBus)
          const p = patch(panner, 0, 0)
          p.nodes.push(panner)
          sounds[emitter.sound.preset]?.(p)
          place(panner, emitter.position, 0)
          entry = { patch: p, panner, preset: emitter.sound.preset, level: -1, position: [...emitter.position] }
          live.set(emitter.id, entry)
        } else if (Math.hypot(...entry.position.map((v, i) => v - emitter.position[i]) as [number, number, number]) > 0.01) { place(entry.panner, emitter.position, smoothing); entry.position = [...emitter.position] }
        const edge = clamp((reach - distance) / (reach * 0.25), 0, 1), level = clamp(emitter.sound.volume, 0, 1) * edge
        if (Math.abs(level - entry.level) > 0.01) { entry.patch.out.gain.setTargetAtTime(level, t, entry.level < 0 ? 0.3 : 0.15); entry.level = level }
      }
    }),
    sfx: safe((name: SfxName, position?: [number, number, number]) => {
      const recipe = sfxRecipes[name]
      if (!recipe || sfxActive >= MAX_SFX) return
      resume()
      const t = now(), last = lastSfx.get(name) ?? -1
      if (t - last < (sfxGap[name] ?? 0.03)) return
      lastSfx.set(name, t)
      const out = ctx.createGain()
      let panner: PannerNode | null = null
      if (position && position.every(Number.isFinite)) { panner = makePanner(3, 80); place(panner, position, 0); out.connect(panner).connect(sfxBus) } else out.connect(sfxBus)
      const duration = recipe(out, t + 0.005, 1 + (Math.random() - 0.5) * 0.1)
      sfxActive++
      setTimeout(() => { sfxActive--; out.disconnect(); panner?.disconnect() }, (duration + 0.5) * 1000)
    }),
    setIntensity: safe((level: 'calm' | 'danger') => {
      if (level === intensity) return
      const before = mood ? (intensity === 'danger' ? dangerOf[mood] : mood) : null
      intensity = level
      if (!mood || !playing || before === (level === 'danger' ? dangerOf[mood] : mood)) return
      queue = []; barStart = now() + 0.08
      newLayer(level === 'danger' ? 0.6 : 2, level === 'danger' ? 1.2 : 2.5)
    }),
    setMuted: safe((value: boolean) => { muted = value; applyMaster(); if (!value) resume() }),
    dispose: safe(() => {
      halt(0.05)
      if (idle) clearTimeout(idle)
      disposed = true
      void ctx.close?.()?.catch(() => undefined)
    }),
  }
}
