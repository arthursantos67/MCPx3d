import type { LLMProvider } from '../../../../packages/agent/src/provider.ts'

export type AgentPhase = 'idle' | 'unsupported' | 'loading' | 'ready' | 'generating' | 'error'

export interface AgentStatus {
  readonly phase: AgentPhase
  readonly progressText?: string
  readonly reason?: string
}

export interface AgentProvider extends LLMProvider {
  getState(): AgentStatus
  onStateChange(listener: (state: AgentStatus) => void): () => void
}
