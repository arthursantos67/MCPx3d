import { useEffect, useState } from 'react'
import type { CadAssemblyProgress } from '../../../../packages/agent/src/generate-cad-assembly.ts'

export type CadProgressStatus = 'running' | 'paused' | 'failed' | 'complete'

interface Props {
  readonly progress: CadAssemblyProgress | null
  readonly status: CadProgressStatus | null
  readonly updatedAt: number | null
  readonly compact?: boolean
}

function phaseText(progress: CadAssemblyProgress, status: CadProgressStatus): string {
  const current = progress.componentIndex === undefined ? null : progress.components[progress.componentIndex]
  if (status === 'paused') return progress.components.length === 0
    ? 'A cota da IA interrompeu o pedido antes de definir os componentes. Tente novamente quando ela liberar.'
    : `Pausado em ${current?.id ?? 'validação do conjunto'}. Os componentes concluídos podem ser retomados com o mesmo pedido.`
  if (status === 'failed') return `Interrompido em ${current?.id ?? 'validação do conjunto'}. Veja o erro no painel.`
  if (status === 'complete' || progress.phase === 'complete') return 'Conjunto validado. Revise e salve a revisão.'
  if (progress.phase === 'classifying') return 'Identificando se o pedido precisa de um conjunto...'
  if (progress.phase === 'planning') return progress.replanning ? 'Replanejando o conjunto após uma falha geométrica...' :
    progress.resumed ? 'Retomando o plano salvo nesta aba...' : 'Planejando os componentes...'
  if (progress.phase === 'checking-assembly') return 'Validando interferências e movimento do conjunto...'
  if (progress.phase === 'repairing-assembly') return progress.validationAttempt
    ? `Testando folga do conjunto (tentativa ${progress.validationAttempt})...`
    : 'Corrigindo uma interferência e validando o conjunto novamente...'
  if (!current) return 'Preparando a validação final do conjunto...'
  const ordinal = `${progress.componentIndex! + 1}/${progress.components.length}`
  if (progress.phase === 'checking-component') return `Componente ${ordinal}: validando ${current.id} (verificação ${progress.validationAttempt ?? 1})...`
  if (progress.phase === 'repairing-component') return `Componente ${ordinal}: corrigindo ${current.id} após a verificação ${progress.validationAttempt ?? 1}...`
  return `Componente ${ordinal}: ${current.action === 'keep' ? 'reutilizando' : 'gerando'} ${current.id}...`
}

export default function CadAssemblyProgressView({ progress, status, updatedAt, compact = false }: Props) {
  const [, setTick] = useState(0)
  useEffect(() => {
    if (status !== 'running') return
    const timer = window.setInterval(() => setTick((value) => value + 1), 1000)
    return () => window.clearInterval(timer)
  }, [status])
  if (!progress || !status) return null
  const total = progress.components.length
  const steps = total + 1 // one final whole-assembly validation
  const done = status === 'complete' ? steps : progress.completed
  const seconds = status === 'running' && updatedAt ? Math.floor((Date.now() - updatedAt) / 1000) : null
  return <section className={`cad-progress${compact ? ' cad-progress--compact' : ''}`} aria-label="Progresso da geração CAD" aria-live={compact ? 'polite' : 'off'}>
    <strong>{status === 'paused' ? 'Geração pausada' : status === 'failed' ? 'Geração interrompida' : status === 'complete' ? 'Geração concluída' : 'Geração em andamento'}</strong>
    <p>{phaseText(progress, status)}</p>
    {total > 0 ? <>
      <progress max={steps} value={done} aria-label="Etapas CAD concluídas" />
      <p>{done} de {steps} etapas planejadas · {progress.completed} de {total} componentes concluídos · 1 validação final</p>
      {!compact && <ol>{progress.components.map((component, index) =>
        <li key={component.id} className={index < progress.completed ? 'cad-progress__done' : index === progress.componentIndex ? 'cad-progress__active' : ''}>
          {index < progress.completed ? '✓' : index === progress.componentIndex && status === 'running' ? '●' : '○'} {component.id}
          {component.action === 'keep' ? ' (reutilizado)' : ''}
        </li>)}
        <li className={status === 'complete' ? 'cad-progress__done' : progress.phase === 'checking-assembly' || progress.phase === 'repairing-assembly' ? 'cad-progress__active' : ''}>
          {status === 'complete' ? '✓' : progress.phase === 'checking-assembly' || progress.phase === 'repairing-assembly' ? '●' : '○'} Validação final do conjunto
        </li>
      </ol>}
    </> : <p>O total será mostrado assim que o plano de componentes estiver pronto.</p>}
    {seconds !== null && <small>Sem nova etapa há {seconds} s. A IA pode estar gerando ou o CAD pode estar validando.</small>}
    {status === 'running' && <small>Um clique executa todas as etapas. Só é preciso retomar se a cota da IA interromper a geração.</small>}
    {!compact && total > 0 && <small>Correções geométricas podem acrescentar verificações; o total acima conta os componentes e a validação final.</small>}
  </section>
}
