import { noised, smoothstep, type NoiseSample } from './worldNoise.ts'
import { sampleMacro, type WorldMacro } from './worldMacro.ts'
import type { ThreeWorldDocument } from './worldDocument.ts'

/**
 * Elevation in metres for any world point. One pure function serves rendering tiles, collision, placement and
 * tests; workers and the main thread evaluate the same code with the same float64 arithmetic.
 */
export interface HeightSource {
  readonly key: string
  readonly size: [number, number]
  readonly range: [number, number]
  readonly seaLevel: number | null
  heightAt(x: number, z: number): number
}

/**
 * Smallest geometric wavelength in metres. Finer relief comes from ground textures and normal maps: geometry this
 * fine would force full-resolution patches hundreds of metres away to stay within 1 px.
 */
export const MIN_WAVELENGTH = 64
export const TERRAIN_GENERATOR = 'synthetic-v5'
/** Smooth |x|: ridges keep a rounded crest instead of a crease of unbounded curvature. */
const softAbs = (value: number, round: number) => Math.sqrt(value * value + round * round) - round
const softPlus = (value: number, width: number) => value > 20 * width ? value : width * Math.log1p(Math.exp(value / width))
/** Keeps the elevation fraction inside (0, 1) without the crease a hard clamp leaves on summits and sea floors. */
const softClamp = (value: number, width = 0.04) => value - softPlus(value - 1, width) + softPlus(-value, width)

/** The part of a WorldMacro needed for heights; workers receive only this. */
export type MacroRelief = Pick<WorldMacro, 'delta' | 'cell' | 'points' | 'origin' | 'pads'>

/** Relief before erosion and rivers (also the input of the macro pass). With `macro`, its smooth delta is added. */
export function createHeightSource(world: Pick<ThreeWorldDocument, 'seed' | 'terrain'>, macro?: MacroRelief | null): HeightSource {
  const { seed, terrain } = world, [low, high] = terrain.heightRange, span = high - low, rugged = terrain.ruggedness
  const halfX = terrain.size[0] / 2, halfZ = terrain.size[1] / 2, coast = terrain.seaLevel !== null
  const seaFraction = terrain.seaLevel === null ? 0 : (terrain.seaLevel - low) / span
  const scale = 1400, octaves = Math.max(1, Math.floor(Math.log2(scale / MIN_WAVELENGTH)))
  const sample: NoiseSample = { value: 0, dx: 0, dz: 0 }
  const baseAt = (x: number, z: number) => {
    // Derivative-damped fBm: slopes accumulated from coarser octaves soften finer ones, as erosion would.
    let px = x / scale, pz = z / scale, sum = 0, amplitude = 0.5, dx = 0, dz = 0
    for (let octave = 0; octave < octaves; octave++) {
      noised(px, pz, seed + octave * 1013, sample)
      dx += sample.dx; dz += sample.dz
      sum += amplitude * sample.value / (1 + dx * dx + dz * dz)
      amplitude *= 0.5
      const nx = 1.6 * px - 1.2 * pz, nz = 1.2 * px + 1.6 * pz
      px = nx + 3.17; pz = nz - 1.91
    }
    let fraction = 0.3 + 0.32 * sum
    const mask = smoothstep(0.1, 0.55, noised(x / 2600 + 7.3, z / 2600 - 2.1, seed + 77, sample).value * 0.5 + 0.5) * rugged
    // Plateaus with steep scarps on the rolling base, away from mountains: terraces whose risers take 20% of a step.
    // Applied before the ranges, so a riser never sits on a steep mountain side where it would become a sharp band.
    const plateau = smoothstep(0.35, 0.6, noised(x / 1800 - 5.2, z / 1800 + 1.7, seed + 911, sample).value * 0.5 + 0.5) * Math.min(1, rugged * 1.5) * (1 - mask)
    if (plateau > 0) {
      const steps = 6, level = fraction * steps, base = Math.floor(level)
      fraction += plateau * ((base + smoothstep(0.4, 0.6, level - base)) / steps - fraction)
    }
    // Ridged ranges where a broad mask allows mountains.
    if (mask > 0) {
      let ridge = 0, weight = 0.5, rx = x / 900, rz = z / 900
      for (let octave = 0; octave < 4; octave++) {
        const value = 1 - softAbs(noised(rx, rz, seed + 4001 + octave * 31, sample).value * 0.7, 0.08 * 2 ** octave)
        ridge += weight * value * value
        weight *= 0.5; rx *= 2.07; rz *= 2.07
      }
      fraction += mask * ridge * 0.75
    }
    if (coast) {
      // Soft minimum of the distances to the four borders: a rounded coast without a crease along the diagonals.
      const width = 0.04, unit = Math.min(halfX, halfZ), sides = [(halfX - x) / unit, (halfX + x) / unit, (halfZ - z) / unit, (halfZ + z) / unit]
      const edge = -width * Math.log(sides.reduce((sum, side) => sum + Math.exp(-side / width), 0))
      const land = smoothstep(0.02, 0.22, edge)
      fraction = seaFraction * 0.4 + (fraction - seaFraction * 0.4) * land
    }
    return low + softClamp(fraction) * span
  }
  const heightAt = macro ? (x: number, z: number) => {
    let height = baseAt(x, z) + sampleMacro(macro.delta, macro, x, z)
    for (let i = 0; i < (macro.pads?.length ?? 0); i += 4) {
      const pads = macro.pads!, radius = pads[i + 2], dx = x - pads[i], dz = z - pads[i + 1]
      if (Math.abs(dx) > radius * 1.6 || Math.abs(dz) > radius * 1.6) continue
      const distance = Math.hypot(dx, dz)
      const amount = 1 - smoothstep(radius, radius * 1.6, distance)
      if (amount > 0) height += (pads[i + 3] - height) * amount
    }
    return height
  } : baseAt
  return { key: `${TERRAIN_GENERATOR}:${seed}:${terrain.size.join('x')}:${terrain.heightRange.join(':')}:${terrain.seaLevel}:${rugged}${macro ? ':macro' : ''}`, size: terrain.size, range: terrain.heightRange, seaLevel: terrain.seaLevel, heightAt }
}
