import type { SceneEnvironment, SkyPreset } from './sceneDocument.ts'

/** Time of day derived from `environment.dayCycle` and play time; the document is never modified. */
export interface DayState {
  hour: number
  /** Play seconds this state was sampled at; reflection refreshes are throttled on it. */
  elapsed: number
  /** Degrees above the horizon (negative at night) and compass azimuth in degrees. */
  sunElevation: number
  sunAzimuth: number
  /** 0 full day → 1 full night, continuous through dusk and dawn. */
  night: number
  /** Weight of the sunset palette, peaking with the sun near the horizon. */
  twilight: number
  sky: SkyPreset
  /** Overall daylight factor 0.12–1 for systems that only need a scalar. */
  light: number
}

/** Minimum play seconds between two PMREM reflection captures while the clock runs. */
export const REFLECTION_INTERVAL = 3
const MIN_PEAK = 55, MAX_PEAK = 80

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
export const smoothRange = (from: number, to: number, value: number) => {
  const t = clamp((value - from) / (to - from), 0, 1)
  return t * t * (3 - 2 * t)
}
export const wrapHour = (hour: number) => ((hour % 24) + 24) % 24
const wrapDegrees = (degrees: number) => ((degrees % 360) + 360) % 360
/** Signed shortest difference between two hours, in −12…12. */
export const hourDelta = (a: number, b: number) => ((a - b + 36) % 24 + 24) % 24 - 12

/** Pure: sun elevation for an hour, rising at 6 h, peaking at noon and lowest at midnight. */
export function sunElevationAt(hour: number, peak: number): number {
  return peak * Math.sin((wrapHour(hour) - 6) / 12 * Math.PI)
}

/** Pure: null without an enabled cycle or for studio/space skies, which have no physical sun. */
export function dayState(env: SceneEnvironment, elapsed: number): DayState | null {
  const cycle = env.dayCycle, base = env.sky ?? 'studio'
  if (!cycle?.enabled || base === 'studio' || base === 'space') return null
  const duration = clamp(Number.isFinite(cycle.duration) ? cycle.duration : 600, 60, 7200), start = clamp(Number.isFinite(cycle.start) ? cycle.start : 9, 0, 24)
  const time = Number.isFinite(elapsed) ? elapsed : 0, hour = wrapHour(start + time / duration * 24)
  const peak = clamp(Math.max(env.sunElevation ?? 38, MIN_PEAK), MIN_PEAK, MAX_PEAK), sunElevation = sunElevationAt(hour, peak)
  // The authored azimuth is where the sun stands at the starting hour; it then sweeps 15° per hour.
  const sunAzimuth = wrapDegrees((env.sunAzimuth ?? 35) + wrapHour(hour - start) * 15)
  const night = 1 - smoothRange(-8, 4, sunElevation), twilight = 1 - smoothRange(0, 1, Math.abs(sunElevation - 2) / 14)
  const day = base === 'overcast' ? 'overcast' : 'day'
  const sky: SkyPreset = night > 0.6 ? 'night' : twilight > 0.5 && day === 'day' ? 'sunset' : day
  return { hour, elapsed: time, sunElevation, sunAzimuth, night, twilight, sky, light: 0.12 + 0.88 * smoothRange(-6, 25, sunElevation) }
}

/** Pure: intensity multiplier for practical lights (lamp posts, torches, lanterns, windows); 1 without a cycle so authored scenes stay unchanged. */
export function practicalLightFactor(day: DayState | null): number {
  return day ? smoothRange(0.15, 0.65, day.night) : 1
}

/** Pure: night amount for wildlife and ambience, from the cycle when present, otherwise from the static sky. */
export function nightAmount(env: SceneEnvironment, day: DayState | null): number {
  if (day) return day.night
  const sky = env.sky ?? 'studio'
  return sky === 'night' ? 1 : sky === 'sunset' ? 0.3 : 0
}

export interface ReflectionStamp { elapsed: number; hour: number; night: number }
/** Pure: whether the sky reflection should be recaptured. A running clock refreshes at most every `interval` play seconds; an edit (same play time, different hour) or a restart refreshes at once. */
export function reflectionRefresh(last: ReflectionStamp | null, day: DayState, interval = REFLECTION_INTERVAL): boolean {
  if (!last) return true
  const dt = day.elapsed - last.elapsed, change = Math.abs(hourDelta(day.hour, last.hour)), shade = Math.abs(day.night - last.night)
  if (dt < 0) return true
  if (dt < 1e-6) return change > 0.01 || shade > 0.01
  return dt >= interval && (change > 0.02 || shade > 0.005)
}

/** “HH:MM” for the editor’s starting-hour readout. */
export function formatHour(hour: number): string {
  const minutes = Math.round(wrapHour(Number.isFinite(hour) ? hour : 0) * 60) % 1440
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}
