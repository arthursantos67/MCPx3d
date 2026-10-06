import type { CadProgramSpec } from '../../domain/ts/src/cad-program.ts'

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

export function cadStepRemovalRequested(request: string): boolean {
  return request.split(/[\n.!?;]/).some((clause) => {
    const removal = /\b(?:remov|exclu|apag|delet|substitu|replace|remove|delete|rebuild|refa[çc])/i.exec(clause)
    return removal !== null && !/\b(?:n[aã]o|sem|not|never|without|don['’]t)\b/i.test(clause.slice(0, removal.index))
  })
}

export function applyCadProgramPatch(raw: unknown, previous: CadProgramSpec): unknown {
  if (!record(raw) || (raw.decision !== 'edit' && !(raw.decision === 'clarify' && 'replaceSteps' in raw))) return raw
  const fields = new Set(['decision', 'partId', 'replaceSteps', 'insertSteps', 'removeStepIds', 'question', 'assumptions'])
  if (Object.keys(raw).some((key) => !fields.has(key))) throw new Error('Unexpected CAD edit field')
  if (raw.partId !== previous.partId) throw new Error('Part ID cannot change')
  for (const key of ['replaceSteps', 'insertSteps', 'removeStepIds'] as const) {
    if (!Array.isArray(raw[key]) || raw[key].length > 32) throw new Error(`CAD edit needs ${key} with at most 32 items`)
  }
  if (raw.decision === 'clarify') {
    if (['replaceSteps', 'insertSteps', 'removeStepIds'].some((key) => (raw[key] as unknown[]).length)) {
      throw new Error('A CAD clarification cannot also modify geometry')
    }
    return { decision: 'clarify', spec: null, question: raw.question, assumptions: raw.assumptions }
  }
  const replacements = new Map<string, Record<string, unknown>>()
  const originalIds = new Set(previous.steps.map((step) => step.id))
  for (const step of raw.replaceSteps as unknown[]) {
    if (!record(step) || typeof step.id !== 'string' || !originalIds.has(step.id)) throw new Error('CAD replacement must reference an existing step ID')
    if (replacements.has(step.id)) throw new Error(`Duplicate CAD replacement: ${step.id}`)
    replacements.set(step.id, step)
  }
  const removals = new Set<string>()
  for (const id of raw.removeStepIds as unknown[]) {
    if (typeof id !== 'string' || !originalIds.has(id)) throw new Error('CAD removal must reference an existing step ID')
    if (removals.has(id) || replacements.has(id)) throw new Error(`Conflicting CAD edit: ${id}`)
    removals.add(id)
  }
  const steps: Record<string, unknown>[] = previous.steps.filter((step) => !removals.has(step.id))
    .map((step) => replacements.get(step.id) ?? { ...step })
  const usedIds = new Set(originalIds)
  const tails = new Map<string, string>()
  for (const insertion of raw.insertSteps as unknown[]) {
    if (!record(insertion) || Object.keys(insertion).some((key) => !['afterStepId', 'step'].includes(key)) ||
        typeof insertion.afterStepId !== 'string' || !record(insertion.step) || typeof insertion.step.id !== 'string') {
      throw new Error('CAD insertion needs afterStepId and a complete step')
    }
    const anchor = tails.get(insertion.afterStepId) ?? insertion.afterStepId
    const index = steps.findIndex((step) => step.id === anchor)
    if (index < 0) throw new Error(`Unknown CAD insertion anchor: ${insertion.afterStepId}`)
    if (usedIds.has(insertion.step.id)) throw new Error(`Duplicate CAD insertion: ${insertion.step.id}`)
    steps.splice(index + 1, 0, insertion.step)
    usedIds.add(insertion.step.id)
    tails.set(insertion.afterStepId, insertion.step.id)
  }
  return { decision: 'create', spec: { ...previous, steps }, question: raw.question, assumptions: raw.assumptions }
}
