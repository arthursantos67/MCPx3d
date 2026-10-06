import { useEffect, useState } from 'react'
import type { AgentProvider } from './types.ts'

export function useAgentProvider(provider: AgentProvider) {
  const [status, setStatus] = useState(() => provider.getState())
  useEffect(() => {
    let active = true
    const update = () => { if (active) setStatus(provider.getState()) }
    const unsubscribe = provider.onStateChange(update)
    update()
    void provider.initialize().then(update, update)
    return () => { active = false; unsubscribe() }
  }, [provider])
  return status
}
