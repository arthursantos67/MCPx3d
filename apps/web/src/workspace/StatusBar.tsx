import { useEffect, useState } from 'react'

import type { EngineHealth } from '../api/health.ts'
import type { ChatControllerState } from '../chat/types.ts'

interface StatusBarProps {
  readonly state: ChatControllerState
  readonly engine: EngineHealth | null
}

function statusLabel(state: ChatControllerState): string {
  if (state.requestStatus === 'session-expired') return 'Sessão expirada'
  if (state.requestStatus === 'failed') return `Falha no último pedido (${state.failureSource ?? 'modeling'})`
  if (state.requestStatus === 'no-change') return 'Nenhuma alteração'
  if (state.isBusy) return 'Gerando'
  return 'Pronto'
}

function stageLabel(stage: ChatControllerState['pipelineStage']): string {
  return {
    idle: 'Aguardando',
    'provider-request': 'Solicitação à IA',
    'plan-validation': 'Validação do plano',
    'api-mcp-build': 'Construção da cena',
    'x3d-validation': 'Validação X3D',
    'artifact-generation': 'Preparação dos arquivos',
    'viewer-loading': 'Carregamento da prévia',
    ready: 'Pronto',
    failed: 'Falha',
  }[stage]
}

function StatusBar({ state, engine }: StatusBarProps) {
  const [now, setNow] = useState(0)
  useEffect(() => {
    if (!state.isBusy) return
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [state.isBusy])

  const revision = state.modelSpec?.revision ?? 0
  const warningCount = state.validation?.warnings.length ?? 0
  const autofixCount = state.validation?.autofixes.length ?? 0
  const errorCount = state.requestStatus === 'failed' || state.requestStatus === 'session-expired' ? 1 : 0
  const elapsed = state.pipelineStartedAt && state.isBusy && now > 0
    ? `${Math.max(0, Math.floor((now - state.pipelineStartedAt) / 1_000))}s`
    : null

  return (
    <footer className="workspace-statusbar" aria-label="Model status">
      <span>{statusLabel(state)}</span>
      <span>IA: {state.agentProvider} ({state.agentPhase})</span>
      <span>Motor X3D: {engine?.available ? engine?.backend ?? 'disponível' : engine ? 'indisponível' : 'verificando'}</span>
      <span>X3D: {state.validation?.schemaValid && state.validation.semanticValid ? 'válido' : 'não validado'}</span>
      <span>Revisão: r{revision}</span>
      <details className="workspace-diagnostics">
        <summary>Diagnóstico</summary>
        <div className="workspace-diagnostics__content">
          <p>Provider/model: {state.agentProvider} ({state.agentPhase})</p>
          <p>Pipeline: {stageLabel(state.pipelineStage)}{elapsed ? ` (${elapsed})` : ''}</p>
          <p>Motor X3D: {engine?.available ? engine?.backend ?? 'disponível' : engine?.detail ?? 'verificando'}</p>
          <p>Autofixes: {autofixCount} · Warnings: {warningCount} · Errors: {errorCount}</p>
          <p>Correlation ID: {state.correlationId ?? 'Not available'}</p>
          {Object.entries(state.generationStats).map(([providerModel, stats]) => (
            <p key={providerModel}>
              {providerModel}: {stats.requests} request(s) · truncated {stats.truncatedRequests} · recovered {stats.recoveredRequests} · continued {stats.continuedRequests} · repairs {stats.localRepairs} local / {stats.formatRepairs} format / {stats.applyRepairs} apply · valid scenes {stats.finalValidScenes} · skipped batches {stats.skippedBatches} · overlap auto-resolves {stats.overlapResolutions}
              {Object.keys(stats.validationFailures).length > 0 &&
                ` · rejected ${Object.entries(stats.validationFailures).map(([category, count]) => `${category} ${count}`).join(', ')}`}
            </p>
          ))}
          {Object.entries(state.timings).length > 0 && (
            <dl className="workspace-diagnostics__timings">
              {Object.entries(state.timings).map(([stage, milliseconds]) => (
                <div key={stage}><dt>{stage.replaceAll('_', ' ')}</dt><dd>{milliseconds} ms</dd></div>
              ))}
            </dl>
          )}
          {state.validation?.warnings.map((warning, index) => (
            <p key={`${warning.check}-${index}`} className="workspace-diagnostics__warning">
              Warning — {warning.check}: {warning.message}
            </p>
          ))}
        </div>
      </details>
    </footer>
  )
}

export default StatusBar
