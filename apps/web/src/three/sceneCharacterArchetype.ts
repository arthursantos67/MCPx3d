export const characterAges = ['child', 'young', 'adult', 'elder'] as const
export const characterBuilds = ['slim', 'average', 'athletic', 'heavy'] as const
export const characterStyles = ['stylized', 'realistic'] as const
export const hairStyles = ['auto', 'bald', 'short', 'long', 'bun', 'ponytail', 'braids', 'mohawk'] as const
export const beardStyles = ['auto', 'none', 'short', 'long'] as const
/**
 * Archetype of a procedural character. `height` multiplies the body length (0.85–1.15); colors are optional overrides of the seeded palette.
 * Absent fields keep the 0.5 proportions, so older documents rebuild the same skeleton.
 */
export interface CharacterSpec {
  age: typeof characterAges[number]; build: typeof characterBuilds[number]; height: number; style: typeof characterStyles[number]
  skin: string | null; hair: string | null; hairStyle: typeof hairStyles[number]; beard: typeof beardStyles[number]
}
export const defaultCharacterSpec = (): CharacterSpec => ({ age: 'adult', build: 'average', height: 1, style: 'stylized', skin: null, hair: null, hairStyle: 'auto', beard: 'auto' })

/** Reads an archetype; `fix` either throws (strict) or records an adjustment (lenient). */
export function readCharacter(source: Record<string, unknown>, fix: (label: string) => void): CharacterSpec {
  const out = defaultCharacterSpec()
  const pick = <K extends 'age' | 'build' | 'style' | 'hairStyle' | 'beard'>(key: K, options: readonly CharacterSpec[K][], label: string) => {
    const value = source[key]
    if (value == null) return
    if (options.includes(value as CharacterSpec[K])) out[key] = value as CharacterSpec[K]
    else fix(label)
  }
  pick('age', characterAges, 'idade do personagem'); pick('build', characterBuilds, 'porte do personagem'); pick('style', characterStyles, 'estilo do personagem')
  pick('hairStyle', hairStyles, 'penteado'); pick('beard', beardStyles, 'barba')
  if (source.height != null) {
    if (typeof source.height !== 'number' || !Number.isFinite(source.height)) fix('altura do personagem')
    else { out.height = Math.min(1.15, Math.max(0.85, source.height)); if (out.height !== source.height) fix('altura do personagem') }
  }
  for (const key of ['skin', 'hair'] as const) {
    const value = source[key]
    if (value == null) continue
    if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)) out[key] = value
    else fix(key === 'skin' ? 'tom de pele' : 'cor do cabelo')
  }
  return out
}

/** Proportions accepted by the biped skeleton (sceneCharacters.ts bipedFrame). */
export interface FrameShape { L?: number; A?: number; bulk?: number; head?: number; hunch?: number }
const AGE: Record<CharacterSpec['age'], { scale: number; L: number; A: number; bulk: number; head: number; hunch: number }> = {
  child: { scale: 0.64, L: 0.9, A: 0.92, bulk: 0.9, head: 1.24, hunch: 0 }, young: { scale: 0.97, L: 1, A: 1, bulk: 0.94, head: 1.02, hunch: 0 },
  adult: { scale: 1, L: 1, A: 1, bulk: 1, head: 1, hunch: 0 }, elder: { scale: 0.96, L: 0.97, A: 1, bulk: 0.95, head: 1, hunch: 12 },
}
const BUILD: Record<CharacterSpec['build'], number> = { slim: 0.86, average: 1, athletic: 1.1, heavy: 1.3 }
/**
 * Applies an archetype to the base proportions of a biped type. Without an archetype (or with the default one) the shape is
 * returned unchanged and `scale` is 1, so documents from 1.3 rebuild the very same parts.
 */
export function archetypeShape(character: CharacterSpec | undefined, base: FrameShape): { shape: FrameShape; scale: number } {
  if (!character) return { shape: base, scale: 1 }
  const age = AGE[character.age], realistic = character.style === 'realistic', bulk = BUILD[character.build] * age.bulk
  const shape: FrameShape = { ...base }
  const times = (key: keyof FrameShape, factor: number) => { if (factor !== 1) shape[key] = (base[key] ?? 1) * factor }
  times('L', age.L * (realistic ? 1.04 : 1)); times('A', age.A * (character.build === 'athletic' ? 1.02 : 1)); times('bulk', bulk); times('head', age.head * (realistic ? 0.88 : 1))
  if (age.hunch) shape.hunch = (base.hunch ?? 0) + age.hunch
  return { shape, scale: age.scale * character.height }
}
const mixHex = (a: string, b: string, t: number) => {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16)
  return '#' + [16, 8, 0].map((shift) => Math.round(((pa >> shift) & 255) * (1 - t) + ((pb >> shift) & 255) * t).toString(16).padStart(2, '0')).join('')
}
/** Skin tone of the archetype, or the seeded fallback. */
export const archetypeSkin = (character: CharacterSpec | undefined, fallback: string) => character?.skin ?? fallback
/** Hair colour of the archetype: explicit colour, otherwise the seeded one (greyed for elders). */
export const archetypeHair = (character: CharacterSpec | undefined, fallback: string) => character?.hair ?? (character?.age === 'elder' ? mixHex(fallback, '#c4c0ba', 0.72) : fallback)
const HAIR_INDEX: readonly string[] = ['bald', 'short', 'bun', 'long', 'quiff', 'ponytail', 'braids', 'mohawk']
/** Index of the hair proxy style (0 bald, 1 short, 2 bun, 3 long, 4 tuft, 5 ponytail, 6 braids, 7 mohawk); `auto` keeps the seeded index. */
export function archetypeHairIndex(character: CharacterSpec | undefined, seeded: number): number {
  const style = character?.hairStyle ?? 'auto'
  return style === 'auto' ? seeded : HAIR_INDEX.indexOf(style)
}
/** Beard: `auto` keeps the seeded decision. */
export const archetypeBeard = (character: CharacterSpec | undefined, seeded: 'none' | 'short' | 'long') => !character || character.beard === 'auto' ? seeded : character.beard
