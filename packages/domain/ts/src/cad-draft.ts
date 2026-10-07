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

export function validateCadDraft(draft: CadDraftSnapshot): void {
  if (!draft || typeof draft.request !== 'string' || !draft.spec || draft.spec.units !== 'mm' ||
      !/^[A-Za-z0-9_-]{1,64}$/.test(draft.spec.partId)) throw new Error('Rascunho CAD inválido')
  if (draft.issue !== undefined && typeof draft.issue !== 'string') throw new Error('Diagnóstico de rascunho inválido')
  if (draft.plannedComponentIds !== undefined && (!Array.isArray(draft.plannedComponentIds) || draft.plannedComponentIds.length > 8 ||
      draft.plannedComponentIds.some((id) => typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(id)))) throw new Error('Plano de rascunho inválido')
  if (draft.spec.schemaVersion === '3.0') { validateCadProgram(draft.spec); return }
  if (draft.spec.schemaVersion !== '4.0' || !Array.isArray(draft.spec.components) ||
      draft.spec.components.length < 1 || draft.spec.components.length > 8) throw new Error('Componentes do rascunho CAD inválidos')
  const ids = new Set<string>()
  for (const component of draft.spec.components) {
    if (ids.has(component.id) || !component.position || !(['x', 'y', 'z'] as const).every((axis) =>
      Number.isFinite(component.position[axis]) && Math.abs(component.position[axis]) <= 10_000)) throw new Error('Posição ou ID de componente inválido')
    ids.add(component.id)
    validateCadProgram({ schemaVersion: '3.0', units: 'mm', partId: component.id, steps: component.steps })
  }
}
