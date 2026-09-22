import { useState, type FormEvent } from 'react'

import './ProviderSettings.css'
import {
  clearProviderConfig,
  loadProviderConfig,
  saveProviderConfig,
  type ProviderConfig,
} from './providerConfig.ts'

interface ProviderSettingsProps {
  readonly open: boolean
  readonly onClose: () => void
}

type FormState = {
  readonly mode: ProviderConfig['mode']
  readonly baseUrl: string
  readonly apiKey: string
  readonly model: string
}

function toFormState(config: ProviderConfig): FormState {
  return config.mode === 'byok'
    ? { mode: 'byok', baseUrl: config.baseUrl, apiKey: config.apiKey, model: config.model }
    : { mode: 'local', baseUrl: '', apiKey: '', model: '' }
}

/**
 * BYOK settings panel: pick "Local (WebLLM)" (the default, unchanged
 * behavior) or "Custom (your own API key)" for any OpenAI-compatible
 * endpoint. Settings apply on next reload -- there is no live provider
 * hot-swap in this pass (the chat controller is constructed once).
 */
function ProviderSettings({ open, onClose }: ProviderSettingsProps) {
  const [form, setForm] = useState<FormState>(() => toFormState(loadProviderConfig()))
  const [savedNote, setSavedNote] = useState<string | null>(null)

  if (!open) return null

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const config: ProviderConfig =
      form.mode === 'byok'
        ? { mode: 'byok', baseUrl: form.baseUrl.trim(), apiKey: form.apiKey.trim(), model: form.model.trim() }
        : { mode: 'local' }
    saveProviderConfig(config)
    setSavedNote('Saved. Reload the page to apply.')
  }

  function handleClear(): void {
    clearProviderConfig()
    setForm(toFormState({ mode: 'local' }))
    setSavedNote('Cleared. Reload the page to apply.')
  }

  return (
    <div className="provider-settings" role="dialog" aria-label="AI provider settings">
      <form className="provider-settings__form" onSubmit={handleSubmit}>
        <div className="provider-settings__header">
          <span className="provider-settings__title">AI Provider</span>
          <button type="button" className="provider-settings__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <p className="provider-settings__hint">
          Local (WebLLM) runs entirely in your browser -- no key, no cost, but needs a WebGPU-capable GPU. Custom
          sends your prompts and your API key directly to the endpoint you configure below.
        </p>

        <label className="provider-settings__radio">
          <input
            type="radio"
            name="mode"
            checked={form.mode === 'local'}
            onChange={() => setForm({ ...form, mode: 'local' })}
          />
          Local (WebLLM) -- default
        </label>
        <label className="provider-settings__radio">
          <input
            type="radio"
            name="mode"
            checked={form.mode === 'byok'}
            onChange={() => setForm({ ...form, mode: 'byok' })}
          />
          Custom (your own API key)
        </label>

        {form.mode === 'byok' && (
          <div className="provider-settings__fields">
            <label className="provider-settings__field">
              Base URL
              <input
                type="text"
                value={form.baseUrl}
                onChange={(event) => setForm({ ...form, baseUrl: event.target.value })}
                placeholder="https://api.groq.com/openai/v1"
              />
            </label>
            <label className="provider-settings__field">
              API key
              <input
                type="password"
                value={form.apiKey}
                onChange={(event) => setForm({ ...form, apiKey: event.target.value })}
                placeholder="sk-..."
                autoComplete="off"
              />
            </label>
            <label className="provider-settings__field">
              Model
              <input
                type="text"
                value={form.model}
                onChange={(event) => setForm({ ...form, model: event.target.value })}
                placeholder="llama-3.3-70b-versatile"
              />
            </label>
          </div>
        )}

        <div className="provider-settings__footer">
          {savedNote && <span className="provider-settings__saved-note">{savedNote}</span>}
          <button type="button" className="provider-settings__clear" onClick={handleClear}>
            Clear
          </button>
          <button type="submit" className="provider-settings__submit">
            Save
          </button>
        </div>
      </form>
    </div>
  )
}

export default ProviderSettings
