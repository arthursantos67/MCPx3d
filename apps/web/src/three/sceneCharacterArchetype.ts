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
