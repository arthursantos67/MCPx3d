import { useEffect, useState } from 'react'

import type { McpHealth } from '../api/client.ts'
import type { ChatControllerState } from '../chat/types.ts'

interface StatusBarProps {
  readonly state: ChatControllerState
  readonly mcpHealth: McpHealth | null
}

function statusLabel(state: ChatControllerState): string {
  if (state.requestStatus === 'session-expired') return 'Session expired'
  if (state.requestStatus === 'failed') return `Latest request failed (${state.failureSource ?? 'modeling'})`
  if (state.requestStatus === 'no-change') return 'No model change'
  if (state.isBusy) return 'Generating'
  return 'Ready'
}

function stageLabel(stage: ChatControllerState['pipelineStage']): string {
  return {
    idle: 'Idle',
    'provider-request': 'AI provider request',
    'plan-validation': 'Plan validation',
    'api-mcp-build': 'API/MCP scene build',
    'x3d-validation': 'X3D validation',
    'artifact-generation': 'Artifact generation',
    'viewer-loading': 'Viewer loading',
    ready: 'Ready',
    failed: 'Failed',
  }[stage]
}

function StatusBar({ state, mcpHealth }: StatusBarProps) {
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
      <span>AI: {state.agentProvider} ({state.agentPhase})</span>
      <span>MCP: {mcpHealth?.reachable ? 'connected' : mcpHealth ? 'unavailable' : 'checking'}</span>
      <span>X3D: {state.validation?.schemaValid && state.validation.semanticValid ? 'valid' : 'not validated'}</span>
      <span>Revision: r{revision}</span>
      <details className="workspace-diagnostics">
        <summary>Diagnostics</summary>
        <div className="workspace-diagnostics__content">
          <p>Provider/model: {state.agentProvider} ({state.agentPhase})</p>
          <p>Pipeline: {stageLabel(state.pipelineStage)}{elapsed ? ` (${elapsed})` : ''}</p>
          <p>MCP: {mcpHealth?.reachable ? 'connected' : mcpHealth?.detail ?? 'checking'}</p>
          <p>Autofixes: {autofixCount} · Warnings: {warningCount} · Errors: {errorCount}</p>
          <p>Correlation ID: {state.correlationId ?? 'Not available'}</p>
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
