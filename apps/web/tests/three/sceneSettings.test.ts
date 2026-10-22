import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_SETTINGS, loadSettings, masterGain, mouseScale, sanitizeSettings, saveSettings, SETTINGS_KEY, type SettingsStorage } from '../../src/three/sceneSettings.ts'

const memory = (initial: Record<string, string> = {}) => {
  const data: Record<string, string> = { ...initial }
  const storage: SettingsStorage = { getItem: (key) => data[key] ?? null, setItem: (key, value) => { data[key] = value } }
  return { data, storage }
}

test('defaults when storage is missing, empty, corrupt or throwing', () => {
  assert.deepEqual(loadSettings(null), { ...DEFAULT_SETTINGS })
  assert.deepEqual(loadSettings(memory().storage), { ...DEFAULT_SETTINGS })
  assert.deepEqual(loadSettings(memory({ [SETTINGS_KEY]: '{not json' }).storage), { ...DEFAULT_SETTINGS })
  assert.deepEqual(loadSettings(memory({ [SETTINGS_KEY]: '[1,2]' }).storage), { ...DEFAULT_SETTINGS })
  const broken: SettingsStorage = { getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') } }
  assert.deepEqual(loadSettings(broken), { ...DEFAULT_SETTINGS })
  assert.equal(saveSettings(DEFAULT_SETTINGS, broken), false)
  assert.equal(saveSettings(DEFAULT_SETTINGS, null), false)
  assert.deepEqual(loadSettings(), { ...DEFAULT_SETTINGS }, 'Node has no localStorage')
})

test('invalid fields are clamped or replaced field by field', () => {
  assert.deepEqual(sanitizeSettings({ volume: 4, sensitivity: -1, invertY: 'yes', quality: 'ultra', subtitles: false, showFps: true }),
    { volume: 1, sensitivity: 0.25, invertY: false, quality: 'auto', subtitles: false, showFps: true })
  assert.equal(sanitizeSettings({ volume: Number.NaN }).volume, DEFAULT_SETTINGS.volume)
  assert.equal(sanitizeSettings({ quality: 'high' }).quality, 'high')
})

test('saved preferences round-trip through storage', () => {
  const { data, storage } = memory()
  const settings = { volume: 0.35, sensitivity: 1.75, invertY: true, quality: 'low' as const, subtitles: false, showFps: true }
  assert.equal(saveSettings(settings, storage), true)
  assert.deepEqual(JSON.parse(data[SETTINGS_KEY]), settings)
  assert.deepEqual(loadSettings(storage), settings)
})

test('mouse scale and master gain follow the preferences', () => {
  assert.deepEqual(mouseScale({ sensitivity: 1, invertY: false }), { x: 0.0023, y: 0.0023 })
  const inverted = mouseScale({ sensitivity: 2, invertY: true })
  assert.equal(inverted.x, 0.0046); assert.equal(inverted.y, -0.0046)
  assert.equal(masterGain({ volume: 0.6 }, false), 0.6); assert.equal(masterGain({ volume: 0.6 }, true), 0)
})
