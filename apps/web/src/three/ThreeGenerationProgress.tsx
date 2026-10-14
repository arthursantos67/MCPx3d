import { useEffect, useState } from 'react'
import { generationStageLabels, type SceneGenerationEvent, type SceneGenerationStage } from './sceneGeneration.ts'

export interface SceneGenerationRun {
  startedAt: number
  finishedAt?: number
  budgetSeconds: number
  events: (SceneGenerationEvent & { at: number })[]
  outcome: 'running' | 'success' | 'timeout' | 'cancelled' | 'error'
}
const stages: SceneGenerationStage[] = ['prepare', 'waiting', 'validation', 'expansion', 'inspection', 'application']
const outcomes = { running: 'Geração em andamento', success: 'Cena concluída', timeout: 'Tempo esgotado', cancelled: 'Geração cancelada', error: 'Geração interrompida' }
function clock(seconds: number) { return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}` }

export default function ThreeGenerationProgress({ run, model }: { run: SceneGenerationRun; model: string }) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (run.outcome !== 'running') return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [run.startedAt, run.outcome])
  const elapsed = Math.max(0, ((run.finishedAt ?? now) - run.startedAt) / 1000)
  const last = run.events.at(-1)
  const current = last?.stage ?? 'prepare'
  const currentIndex = stages.indexOf(current)
  return <section className="three-generation" aria-label="Progresso da geração Three.js">
    <div className="three-generation__heading"><strong role="status">{outcomes[run.outcome]}</strong>
      <span>Tempo <output role="timer" aria-live="off" aria-label="Tempo decorrido">{clock(elapsed)}</output> / limite {clock(run.budgetSeconds)}</span>
      <span>{model} · {last?.attempt === 0 ? 'sem chamada de IA nesta etapa' : `chamada ${last?.attempt ?? 1} de até 2`}</span></div>
    <ol className="three-generation__steps" aria-label="Etapas da geração">{stages.map((stage, index) => {
      const state = run.outcome === 'success' || index < currentIndex ? 'complete' : index > currentIndex ? 'pending' : run.outcome === 'running' ? 'active' : 'stopped'
      return <li key={stage} data-state={state} aria-current={stage === current && run.outcome === 'running' ? 'step' : undefined}>
        <span aria-hidden="true">{state === 'complete' ? '✓' : index + 1}</span>{stage === 'waiting' && (last?.attempt ?? 1) > 1 ? 'Correção pela IA' : generationStageLabels[stage]}
        {state === 'stopped' && <small>Interrompida</small>}</li>
    })}</ol>
    <p>{last?.detail ?? 'Preparando o pedido…'}</p>
    {current === 'waiting' && <p className="three-generation__hint">O provedor não transmite as etapas internas do planejamento. Aguardamos a resposta JSON completa; não há percentual de conclusão disponível.</p>}
    {run.outcome === 'running' && current === 'waiting' && elapsed >= 60 && <p className="three-generation__hint">A espera continua na IA. Você pode aguardar até o limite escolhido ou cancelar; a cena atual permanece preservada.</p>}
    <details><summary>Histórico desta tentativa</summary><ol className="three-generation__history">{run.events.map((event, index) =>
      <li key={index}><time>{clock(Math.max(0, (event.at - run.startedAt) / 1000))}</time><span>{event.detail}</span></li>)}</ol></details>
    {run.outcome === 'timeout' && <p className="three-generation__hint">Selecione um prazo maior ou simplifique o pedido e clique em Criar cena com IA. Isso inicia uma nova tentativa; não recupera a resposta interrompida.</p>}
  </section>
}
