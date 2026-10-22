/** Player preferences for play mode. They live only in this browser and never touch the scene document. */
export type QualityPreference = 'auto' | 'low' | 'medium' | 'high'
export interface PlaySettings { volume: number; sensitivity: number; invertY: boolean; quality: QualityPreference; subtitles: boolean; showFps: boolean }
export interface SettingsStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }

export const SETTINGS_KEY = 'forma:play-settings.v1'
export const DEFAULT_SETTINGS: Readonly<PlaySettings> = Object.freeze({ volume: 0.8, sensitivity: 1, invertY: false, quality: 'auto', subtitles: true, showFps: false })
export const SENSITIVITY_RANGE = [0.25, 3] as const
const qualities: readonly QualityPreference[] = ['auto', 'low', 'medium', 'high']

const number = (value: unknown, fallback: number, min: number, max: number) => typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback
const flag = (value: unknown, fallback: boolean) => typeof value === 'boolean' ? value : fallback
export function sanitizeSettings(value: unknown): PlaySettings {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  return {
    volume: number(source.volume, DEFAULT_SETTINGS.volume, 0, 1),
    sensitivity: number(source.sensitivity, DEFAULT_SETTINGS.sensitivity, ...SENSITIVITY_RANGE),
    invertY: flag(source.invertY, DEFAULT_SETTINGS.invertY),
    quality: qualities.includes(source.quality as QualityPreference) ? source.quality as QualityPreference : DEFAULT_SETTINGS.quality,
    subtitles: flag(source.subtitles, DEFAULT_SETTINGS.subtitles),
    showFps: flag(source.showFps, DEFAULT_SETTINGS.showFps),
  }
}
/** localStorage can be missing or throw (private mode, blocked site data); both fall back to defaults. */
function defaultStorage(): SettingsStorage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null }
}
export function loadSettings(storage: SettingsStorage | null = defaultStorage()): PlaySettings {
  try {
    const raw = storage?.getItem(SETTINGS_KEY)
    return sanitizeSettings(raw ? JSON.parse(raw) : null)
  } catch { return sanitizeSettings(null) }
}
export function saveSettings(settings: PlaySettings, storage: SettingsStorage | null = defaultStorage()): boolean {
  try {
    if (!storage) return false
    storage.setItem(SETTINGS_KEY, JSON.stringify(sanitizeSettings(settings)))
    return true
  } catch { return false }
}
/** Mouse-look radians per pixel; 0.0023 is the 0.5 default. */
export const mouseScale = (settings: Pick<PlaySettings, 'sensitivity' | 'invertY'>) => ({ x: 0.0023 * settings.sensitivity, y: 0.0023 * settings.sensitivity * (settings.invertY ? -1 : 1) })
/** Master gain for the audio engine: 0 mutes. */
export const masterGain = (settings: Pick<PlaySettings, 'volume'>, muted: boolean) => muted ? 0 : settings.volume
