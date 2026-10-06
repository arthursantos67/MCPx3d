import { useRef, useState, type FormEvent } from 'react'
import { createConfiguredProvider } from '../ai/configured-provider.ts'
import type { AgentProvider } from '../ai/types.ts'
import { baseUrl } from '../api/http.ts'
import { LocalCliProvider, type LocalClient } from '../../../../packages/agent/src/local-cli-provider.ts'
import './ProviderSettings.css'
import { clearProviderConfig, loadProviderConfig, saveProviderConfig, type ProviderConfig } from './providerConfig.ts'

interface ProviderSettingsProps {
  readonly open: boolean
  readonly onClose: () => void
  readonly onApply: () => void
  readonly disabled: boolean
}
type FormState = { mode: ProviderConfig['mode']; client: LocalClient; baseUrl: string; apiKey: string; model: string }
type Diagnostic = { kind: 'success' | 'error'; text: string } | null

function toFormState(config: ProviderConfig): FormState {
  const blank = { mode: config.mode, client: 'codex' as const, baseUrl: '', apiKey: '', model: '' }
  return config.mode === 'local' ? blank : { ...blank, ...config }
}
function toConfig(form: FormState): ProviderConfig {
  if (form.mode === 'cli') return { mode: 'cli', client: form.client, model: form.model.trim() }
  if (form.mode === 'byok') return { mode: 'byok', baseUrl: form.baseUrl.trim(), apiKey: form.apiKey.trim(), model: form.model.trim() }
  return { mode: 'local' }
}

function ProviderSettings({ open, onClose, onApply, disabled }: ProviderSettingsProps) {
  const [form, setForm] = useState<FormState>(() => toFormState(loadProviderConfig()))
  const [diagnostic, setDiagnostic] = useState<Diagnostic>(null)
  const [busy, setBusy] = useState(false)
  const testing = useRef<AgentProvider | null>(null)
  const operation = useRef(0)
  const blocked = disabled || busy
  const complete = form.mode !== 'byok' || !!(form.baseUrl.trim() && form.apiKey.trim() && form.model.trim())
  if (!open) return null

  function update(next: FormState): void { setForm(next); setDiagnostic(null) }
  function select(mode: FormState['mode'], client: LocalClient = form.client): void {
    update({ ...form, mode, client, model: mode === form.mode && client === form.client ? form.model : '' })
  }
  function close(): void {
    operation.current += 1
    void testing.current?.cancel?.()
    testing.current = null
    setBusy(false)
    onClose()
  }
  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    if (blocked || !complete) return
    saveProviderConfig(toConfig(form)); onApply(); close()
  }
  function handleClear(): void {
    if (blocked) return
    clearProviderConfig(); update(toFormState({ mode: 'local' })); onApply(); close()
  }
  async function diagnose(loginOnly: boolean): Promise<void> {
    if (blocked || !complete) return
    const sequence = ++operation.current
    setBusy(true); setDiagnostic(null)
    const started = performance.now()
    try {
      if (loginOnly && form.mode === 'cli') {
        const status = await new LocalCliProvider({ apiBaseUrl: baseUrl(), client: form.client, model: form.model }).checkStatus()
        if (operation.current !== sequence) return
        setDiagnostic({ kind: status.installed && status.authenticated ? 'success' : 'error', text: `${status.message}${status.plan ? ` Plano identificado: ${status.plan}.` : ''}` })
      } else {
        const provider = createConfiguredProvider(toConfig(form))
        testing.current = provider
        await provider.initialize()
        if (operation.current !== sequence) return
        const response = await provider.generateStructured<{ ok: boolean }>([
          { role: 'system', content: 'Return only the requested JSON object. This is a connection diagnostic, not a modeling request.' },
          { role: 'user', content: 'Return {"ok":true}.' },
        ], { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', const: true } }, required: ['ok'] }, { maxTokens: 256 })
        if (response?.ok !== true) throw new Error('O modelo respondeu, mas não devolveu o JSON esperado pelo teste.')
        if (operation.current !== sequence) return
        setDiagnostic({ kind: 'success', text: `Conexão e resposta JSON confirmadas em ${((performance.now() - started) / 1000).toFixed(1)} s. Este teste não avalia a qualidade CAD/X3D. Salve para usar esta configuração.` })
      }
    } catch (error) {
      if (operation.current === sequence) setDiagnostic({ kind: 'error', text: error instanceof Error ? error.message : 'Falha no teste de conexão.' })
    } finally {
      if (operation.current === sequence) { setBusy(false); testing.current = null }
    }
  }
  return (
    <div className="provider-settings" role="dialog" aria-label="Configurações da IA">
      <form className="provider-settings__form" onSubmit={handleSubmit}>
        <div className="provider-settings__header">
          <span className="provider-settings__title">Provedor de IA</span>
          <button type="button" className="provider-settings__close" onClick={close} aria-label={busy ? 'Cancelar teste e fechar' : 'Fechar'}>×</button>
        </div>
        <p className="provider-settings__hint">Escolha o provedor compartilhado pelos agentes CAD e X3D. O teste usa os campos abaixo sem alterar a configuração salva.</p>
        <label className="provider-settings__radio"><input type="radio" name="mode" disabled={blocked} checked={form.mode === 'local'} onChange={() => select('local')} />Local (WebLLM) · navegador</label>
        <label className="provider-settings__radio"><input type="radio" name="mode" disabled={blocked} checked={form.mode === 'byok'} onChange={() => select('byok')} />Provedor externo · sua chave</label>
        <label className="provider-settings__radio"><input type="radio" name="mode" disabled={blocked} checked={form.mode === 'cli' && form.client === 'codex'} onChange={() => select('cli', 'codex')} />Codex · assinatura ChatGPT</label>
        <label className="provider-settings__radio"><input type="radio" name="mode" disabled={blocked} checked={form.mode === 'cli' && form.client === 'claude'} onChange={() => select('cli', 'claude')} />Claude Code · assinatura Claude</label>
        {form.mode === 'local' && <p className="provider-settings__hint">Requer WebGPU. O primeiro teste pode baixar o modelo para o navegador.</p>}
        {form.mode === 'byok' && (
          <div className="provider-settings__fields">
            <label className="provider-settings__field">URL base ou endpoint de chat<input type="text" disabled={blocked} value={form.baseUrl} onChange={(event) => update({ ...form, baseUrl: event.target.value })} placeholder="https://seu-provedor.example/v1" /></label>
            <label className="provider-settings__field">Chave de API<input type="password" disabled={blocked} value={form.apiKey} onChange={(event) => update({ ...form, apiKey: event.target.value })} placeholder="sk-..." autoComplete="off" /></label>
            <label className="provider-settings__field">Modelo<input type="text" disabled={blocked} value={form.model} onChange={(event) => update({ ...form, model: event.target.value })} placeholder="Nome do seu modelo" /></label>
            <p className="provider-settings__hint">A chave é salva neste navegador. A assinatura ChatGPT/Claude não inclui créditos desta API.</p>
          </div>
        )}
        {form.mode === 'cli' && (
          <div className="provider-settings__fields">
            <p className="provider-settings__hint">Usa o cliente oficial instalado no computador do servidor e os limites da conta conectada. Nenhuma chave ou token da assinatura é salvo no navegador.</p>
            <label className="provider-settings__field">Modelo (opcional)<input type="text" disabled={blocked} value={form.model} onChange={(event) => update({ ...form, model: event.target.value })} placeholder="Vazio = padrão do cliente" /></label>
            <p className="provider-settings__hint">Para conectar outra conta, execute <code>{form.client === 'codex' ? 'codex login' : 'claude auth login'}</code> no terminal.</p>
            <button type="button" disabled={blocked} className="provider-settings__clear" onClick={() => void diagnose(true)}>Verificar instalação e login</button>
          </div>
        )}
        <button type="button" disabled={blocked || !complete} className="provider-settings__clear" onClick={() => void diagnose(false)}>{busy ? 'Verificando…' : 'Testar conexão'}</button>
        <p className="provider-settings__hint">O teste de conexão faz uma pequena chamada real e consome o limite do provedor. Falhas aqui ocorrem antes da validação CAD/X3D.</p>
        {diagnostic && <p className={`provider-settings__diagnostic provider-settings__diagnostic--${diagnostic.kind}`} role={diagnostic.kind === 'error' ? 'alert' : 'status'}>{diagnostic.text}</p>}
        <div className="provider-settings__footer">
          <button type="button" disabled={blocked} className="provider-settings__clear" onClick={handleClear}>Usar IA local</button>
          <button type="submit" disabled={blocked || !complete} className="provider-settings__submit">Salvar e aplicar</button>
        </div>
      </form>
    </div>
  )
}
export default ProviderSettings
