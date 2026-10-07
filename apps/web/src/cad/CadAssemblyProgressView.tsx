import { useEffect, useState } from 'react'
import type { CadAssemblyProgress } from '../../../../packages/agent/src/generate-cad-assembly.ts'

export type CadProgressStatus = 'running' | 'paused' | 'failed' | 'complete' | 'cancelled'

interface Props {
  readonly progress: CadAssemblyProgress | null
  readonly status: CadProgressStatus | null
  readonly updatedAt: number | null
  readonly compact?: boolean
}

function phaseText(progress: CadAssemblyProgress, status: CadProgressStatus): string {
  const current = progress.componentIndex === undefined ? null : progress.components[progress.componentIndex]
  if (status === 'paused') return progress.components.length === 0
    ? 'O pedido foi interrompido antes de definir os componentes. Veja o diagnóstico no painel para retomar.'
    : `Pausado em ${current?.id ?? 'validação do conjunto'}. O plano, os componentes concluídos e o rascunho disponível ficam guardados nesta aba. Veja o diagnóstico no painel e retome o mesmo pedido quando a falha permitir.`
  if (status === 'cancelled') return 'Geração cancelada. A última revisão salva foi preservada.'
  if (status === 'failed') return `Interrompido em ${current?.id ?? 'validação do conjunto'}. Veja o erro no painel.`
  if (status === 'complete' || progress.phase === 'complete') return 'Construção e validação geométrica concluídas.'
  if (progress.activity === 'generating-correction') return 'A IA está gerando a correção de um componente do conjunto...'
  if (progress.activity === 'checking-component') return 'O motor CAD está validando o componente corrigido. Esta verificação não chama a IA.'
  if (progress.activity === 'checking-assembly') return 'O motor CAD está verificando interferências e posições do conjunto corrigido. Esta verificação não chama a IA.'
  if (progress.phase === 'classifying') return 'Identificando se o pedido precisa de um conjunto...'
  if (progress.phase === 'planning') return progress.replanning ? 'Replanejando o conjunto após uma falha geométrica...' :
    progress.resumed ? 'Retomando o plano salvo nesta aba...' : 'Planejando os componentes...'
  if (progress.phase === 'reviewing-plan') return 'Revisando dimensões, encaixes, paredes e acesso aos parafusos antes de construir...'
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
  const [now, setNow] = useState(0)
  useEffect(() => {
    if (status !== 'running') return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [status])
  if (!progress || !status) return null
  const total = progress.components.length
  const steps = total + 1 // one final whole-assembly validation
  const done = status === 'complete' ? steps : progress.completed
  const seconds = status === 'running' && updatedAt && now >= updatedAt ? Math.floor((now - updatedAt) / 1000) : null
  return <section className={`cad-progress${compact ? ' cad-progress--compact' : ''}`} aria-label="Progresso da geração CAD" aria-live={compact ? 'polite' : 'off'}>
    <strong>{status === 'paused' ? 'Geração pausada' : status === 'cancelled' ? 'Geração cancelada' : status === 'failed' ? 'Geração interrompida' : status === 'complete' ? 'Geração concluída' : 'Geração em andamento'}</strong>
    <p>{phaseText(progress, status)}</p>
    {total > 0 ? <>
      <progress max={steps} value={done} aria-label="Etapas CAD concluídas" />
      <p>{done} de {steps} etapas planejadas · {progress.completed} de {total} componentes concluídos · 1 validação final</p>
      {!compact && <ol>{progress.components.map((component, index) => {
        const complete = progress.completedComponentIds?.includes(component.id) ?? index < progress.completed
        const failed = progress.failedComponentIds?.includes(component.id) ?? false
        return <li key={component.id} className={complete ? 'cad-progress__done' : index === progress.componentIndex ? 'cad-progress__active' : ''}>
          {complete ? '✓' : failed ? '!' : index === progress.componentIndex && status === 'running' ? '●' : '○'} {component.id}
          {failed ? ' (pendente de correção)' : ''}
          {component.action === 'keep' ? ' (reutilizado)' : ''}
        </li>})}
        <li className={status === 'complete' ? 'cad-progress__done' : progress.phase === 'checking-assembly' || progress.phase === 'repairing-assembly' ? 'cad-progress__active' : ''}>
          {status === 'complete' ? '✓' : progress.phase === 'checking-assembly' || progress.phase === 'repairing-assembly' ? '●' : '○'} Validação final do conjunto
        </li>
      </ol>}
    </> : status === 'running' ? <p>Aguarde a construção e a validação da geometria.</p> : null}
    {seconds !== null && <small>Sem mudança de etapa há {seconds} s.</small>}
    {status === 'running' && <small>Um clique executa as etapas. Se houver uma interrupção, o painel informa como retomar.</small>}
    {!compact && total > 0 && <small>Correções geométricas podem acrescentar verificações; o total acima conta os componentes e a validação final.</small>}
  </section>
}
