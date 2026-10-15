import type { CadAssemblySpec, CadComponent } from './cad-assembly.ts'
import { validateCadProgram, type CadProgramSpec } from './cad-program.ts'

export type CadDraftSpec = CadProgramSpec | {
  readonly schemaVersion: '4.0'; readonly units: 'mm'; readonly partId: string
  readonly components: readonly CadComponent[]
  readonly mechanics?: CadAssemblySpec['mechanics']
}

export interface CadDraftSnapshot {
  readonly spec: CadDraftSpec
  readonly request: string
  readonly plannedComponentIds?: readonly string[]
  readonly pendingComponentId?: string
  readonly issue?: string
}

export type CadDraftListener = (draft: CadDraftSnapshot) => void

const IDENTIFIER = /^[A-Za-z0-9_-]{1,64}$/

function validateDraftMotion(component: CadComponent): void {
  const motion = component.motion
  if (motion === undefined || motion === null) return
  const bounded = (value: unknown, limit: number) => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit
  if (typeof motion !== 'object' || !['slider', 'screw', 'rotary'].includes(motion.kind) || !['x', 'y', 'z'].includes(motion.axis) ||
      ![motion.minimum, motion.maximum, motion.value].every((value) => bounded(value, 10_000)) ||
      motion.minimum >= motion.maximum || motion.value < motion.minimum || motion.value > motion.maximum ||
      (motion.kind === 'screw' ? !(bounded(motion.pitch, 1000) && (motion.pitch as number) > 0) : motion.pitch !== undefined && motion.pitch !== null) ||
      (motion.group !== undefined && motion.group !== null && (typeof motion.group !== 'string' || !IDENTIFIER.test(motion.group)))) {
    throw new Error(`Movimento inválido no componente ${component.id}`)
  }
  if (motion.factor !== undefined && motion.factor !== null && (!bounded(motion.factor, 1000) || motion.factor === 0 || !motion.group ||
      (motion.kind !== 'rotary' && Math.max(Math.abs(motion.minimum * motion.factor), Math.abs(motion.maximum * motion.factor)) > 10_000))) {
    throw new Error(`Fator de movimento inválido no componente ${component.id}`)
  }
}

export function validateCadDraft(draft: CadDraftSnapshot): void {
  if (!draft || typeof draft.request !== 'string' || draft.request.length > 50_000 || !draft.spec || draft.spec.units !== 'mm' ||
      typeof draft.spec.partId !== 'string' || !IDENTIFIER.test(draft.spec.partId)) throw new Error('Rascunho CAD inválido')
  if (draft.issue !== undefined && (typeof draft.issue !== 'string' || draft.issue.length > 120_000)) throw new Error('Diagnóstico de rascunho inválido')
  if (draft.pendingComponentId !== undefined && (typeof draft.pendingComponentId !== 'string' || !IDENTIFIER.test(draft.pendingComponentId))) {
    throw new Error('Componente pendente do rascunho inválido')
  }
  if (draft.plannedComponentIds !== undefined && (!Array.isArray(draft.plannedComponentIds) || draft.plannedComponentIds.length > 8 ||
      draft.plannedComponentIds.some((id) => typeof id !== 'string' || !IDENTIFIER.test(id)))) throw new Error('Plano de rascunho inválido')
  if (draft.spec.schemaVersion === '3.0') { validateCadProgram(draft.spec); return }
  if (draft.spec.schemaVersion !== '4.0' || !Array.isArray(draft.spec.components) ||
      draft.spec.components.length < 1 || draft.spec.components.length > 8) throw new Error('Componentes do rascunho CAD inválidos')
  const ids = new Set<string>()
  let steps = 0
  for (const component of draft.spec.components) {
    if (!component || typeof component.id !== 'string' || !IDENTIFIER.test(component.id) || ids.has(component.id) || !component.position ||
        !(['x', 'y', 'z'] as const).every((axis) => Number.isFinite(component.position[axis]) && Math.abs(component.position[axis]) <= 10_000)) {
      throw new Error('Posição ou ID de componente inválido')
    }
    ids.add(component.id)
    validateCadProgram({ schemaVersion: '3.0', units: 'mm', partId: component.id, steps: component.steps })
    steps += component.steps.length
    if (steps > 128) throw new Error('O rascunho CAD excede 128 etapas de construção')
    validateDraftMotion(component)
  }
}
