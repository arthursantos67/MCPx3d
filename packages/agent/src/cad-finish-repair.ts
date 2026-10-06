import { type CadProgramSpec, type CadProgramStep, validateCadProgram } from '../../domain/ts/src/cad-program.ts'
import { CAD_EDGE_SELECTORS, CAD_FEATURE_GUIDANCE } from '../../domain/ts/src/cad-features.ts'
import type { LLMProvider } from './provider.ts'

export interface FailedCadCandidate { readonly spec: CadProgramSpec; readonly issue: string }
type FinishStep = Extract<CadProgramStep, { shape: 'fillet' | 'chamfer' }>

export function failedFinish(spec: CadProgramSpec, issue: string): FinishStep | undefined {
  const id = /^CAD step ([A-Za-z0-9_-]+)/.exec(issue)?.[1]
  const step = spec.steps.find((candidate) => candidate.id === id)
  return step?.shape === 'fillet' || step?.shape === 'chamfer' ? step : undefined
}

function explicitFinishSize(request: string, step: FinishStep): boolean {
  const original = request.includes('Overall request: ')
    ? request.split('Overall request: ')[1].split('. Component construction: ')[0]
    : request.split('\n\nThe CAD engine')[0]
  const feature = step.shape === 'chamfer' ? 'chamfer|chanfr' : 'fillet|arredond|filete|raio'
  return new RegExp(`(?:${feature})[^\\n.;!?]{0,60}\\d|\\d[^\\n.;!?]{0,30}(?:${feature})|["']?(?:radius|distance)["']?\\s*[:=]\\s*\\d`, 'i').test(original)
}

export function finishRepairHistory(history: readonly FailedCadCandidate[]): string {
  return history.slice(-8).map(({ spec, issue }) => {
    const finish = failedFinish(spec, issue)
    return finish ? `${JSON.stringify(finish)} at ordered step ${spec.steps.indexOf(finish) + 1}: ${issue}` : issue
  }).join('\n')
}

export async function repairFinishLocally(
  spec: CadProgramSpec, request: string, issue: string,
  inspect: (candidate: CadProgramSpec) => Promise<string | null>,
): Promise<{ spec: CadProgramSpec; issue: string | null; assumption: string } | null> {
  const step = failedFinish(spec, issue)
  if (!step || explicitFinishSize(request, step) || !/cannot apply selector|must retain one valid connected solid/.test(issue)) return null
  const index = spec.steps.indexOf(step)
  const size = step.shape === 'chamfer' ? step.distance : step.radius
  for (const factor of [0.5, 0.25, 0.125]) {
    const reduced = Number((size * factor).toFixed(6))
    if (reduced < 0.1) break
    const replacement = step.shape === 'chamfer' ? { ...step, distance: reduced } : { ...step, radius: reduced }
    const candidate = { ...spec, steps: spec.steps.map((current) => current.id === step.id ? replacement : current) }
    const nextIssue = await inspect(candidate)
    const nextIndex = candidate.steps.findIndex((current) => current.id === /^CAD step ([A-Za-z0-9_-]+)/.exec(nextIssue ?? '')?.[1])
    if (nextIssue && nextIndex <= index) continue
    return { spec: candidate, issue: nextIssue,
      assumption: `O acabamento ${step.id} foi conservado; sua medida inferida foi ajustada de ${size} para ${reduced} mm e verificada pelo motor CAD.` }
  }
  return null
}

export async function repairFinishWithProvider(
  provider: LLMProvider, spec: CadProgramSpec, request: string, issue: string,
  history: readonly FailedCadCandidate[],
): Promise<{ spec: CadProgramSpec; assumption: string } | null> {
  const step = failedFinish(spec, issue)
  if (!step) return null
  const fixedSize = explicitFinishSize(request, step)
  const size = step.shape === 'chamfer' ? step.distance : step.radius
  const schema = { type: 'object', additionalProperties: false, required: ['selector', 'size', 'beforeStepId'], properties: {
    selector: { enum: Object.keys(CAD_EDGE_SELECTORS) },
    size: fixedSize ? { const: size } : { type: 'number', minimum: 0.1, maximum: 1000 },
    beforeStepId: { enum: ['', ...spec.steps.slice(1, spec.steps.indexOf(step)).map((current) => current.id)] },
  } }
  const raw = await provider.generateStructured<unknown>([
    { role: 'system', content: `Repair only the named CAD chamfer or fillet. Return selector, size in mm, and beforeStepId (empty keeps its current execution order). No questions or permission requests; decide autonomously and preserve explicit user constraints. Keep the finish, its ID and shape, real threads, and every other step unchanged. A circular selector selects ALL circular edges including small shoulders, bore rims and thread transitions; repeating it at the same size/order cannot solve a kernel failure. Choose suitable directional edges in COMPONENT coordinates or place this finish before a thread/cut introduces fragile edges, after the solid it must finish has been built. Moving a finish before another step does not move any primitive or thread. Preserve explicitly requested finish location/size; never replace a thread with a smooth primitive or remove the finish. ${fixedSize ? `Size is explicitly constrained: retain ${size} mm.` : 'Size is inferred: a smaller positive size is allowed.'} ${CAD_FEATURE_GUIDANCE}` },
    { role: 'user', content: `Original request: ${request}\nCAD engine error: ${issue}\nComplete ordered program: ${JSON.stringify(spec)}\nFailed candidates (do not repeat these combinations):\n${finishRepairHistory(history)}\nRepair finish ${step.id}.` },
  ], schema, { temperature: 0, maxTokens: 700 })
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const patch = raw as Record<string, unknown>
  if (Object.keys(patch).some((key) => !['selector', 'size', 'beforeStepId'].includes(key)) ||
      !Object.keys(CAD_EDGE_SELECTORS).includes(String(patch.selector)) || typeof patch.size !== 'number' ||
      !Number.isFinite(patch.size) || (fixedSize && patch.size !== size) || typeof patch.beforeStepId !== 'string') return null
  const updated = step.shape === 'chamfer' ? { ...step, selector: patch.selector, distance: patch.size }
    : { ...step, selector: patch.selector, radius: patch.size }
  const steps = spec.steps.map((current) => current.id === step.id ? updated as FinishStep : current)
  if (patch.beforeStepId) {
    const target = steps.findIndex((current) => current.id === patch.beforeStepId)
    if (target < 1 || target >= spec.steps.indexOf(step)) return null
    steps.splice(spec.steps.indexOf(step), 1)
    steps.splice(target, 0, updated as FinishStep)
  }
  const candidate = { ...spec, steps }
  try { validateCadProgram(candidate) } catch { return null }
  if (JSON.stringify(candidate) === JSON.stringify(spec)) return null
  if (history.some((failed) => JSON.stringify(failed.spec) === JSON.stringify(candidate))) return null
  return { spec: candidate,
    assumption: `O acabamento ${step.id} foi reparado com seleção ${patch.selector}, medida ${patch.size} mm${patch.beforeStepId ? ` e execução antes de ${patch.beforeStepId}` : ''}; as demais etapas foram conservadas.` }
}
