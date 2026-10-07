import type { CadAssemblySpec } from '../../domain/ts/src/cad-assembly.ts'
import type { CadProgramSpec } from '../../domain/ts/src/cad-program.ts'
import { assemblyIssueMessage, type CadAssemblyCheckResult, type CadAssemblyIssue, type CadCollision } from '../../domain/ts/src/cad-assembly-diagnostics.ts'
import { cadIdentity } from './cad-identity.ts'

type Check = (spec: CadAssemblySpec) => Promise<CadAssemblyCheckResult>
type PartCheck = (spec: CadProgramSpec) => Promise<string | null>
export interface AssemblyRepairStrategy {
  readonly assumption: string
  readonly propose: (spec: CadAssemblySpec, message: string, checkPart: PartCheck,
    assessCandidate: (spec: CadAssemblySpec) => Promise<string | null>, collision?: CadCollision) => Promise<CadAssemblySpec | null>
}

interface AssemblyRepairProgress {
  readonly spec: CadAssemblySpec
  readonly issue: CadAssemblyCheckResult
  readonly assumptions: string[]
}

function overlaps(issue: CadAssemblyIssue): Map<string, number> {
  return new Map(issue.collisions.map((collision) => [
    JSON.stringify([[...collision.components].sort(), collision.pose]), collision.overlapVolumeMm3,
  ]))
}

export function reducesInterference(before: CadAssemblyCheckResult, after: CadAssemblyCheckResult): boolean {
  if (after === null) return true
  if (!before || typeof before === 'string' || typeof after === 'string') return false
  const priorMechanical = new Set((before.mechanicalIssues ?? []).map((issue) => JSON.stringify(issue)))
  if ((after.mechanicalIssues ?? []).some((issue) => !priorMechanical.has(JSON.stringify(issue)))) return false
  const previous = overlaps(before)
  const next = overlaps(after)
  let improved = previous.size > next.size || (before.mechanicalIssues?.length ?? 0) > (after.mechanicalIssues?.length ?? 0)
  for (const [key, volume] of next) {
    const old = previous.get(key)
    if (old === undefined) return false
    const tolerance = Math.max(0.001, old * 1e-6)
    if (volume > old + tolerance) return false
    if (volume < old - tolerance) improved = true
  }
  return improved
}

class RepairBudgetExhausted extends Error {}

export async function repairAssemblyLocally(
  initial: CadAssemblySpec, initialIssue: Exclude<CadAssemblyCheckResult, null>,
  strategies: readonly AssemblyRepairStrategy[], checkPart: PartCheck, checkAssembly: Check,
  onAttempt?: (attempt: number) => void,
  limits = { steps: 16, validations: 48 },
  onAccepted?: (progress: AssemblyRepairProgress) => void,
): Promise<AssemblyRepairProgress> {
  let spec = initial
  let issue: CadAssemblyCheckResult = initialIssue
  let validations = 0
  const assumptions: string[] = []
  const seen = new Set([cadIdentity(initial)])
  const partResults = new Map<string, Promise<string | null>>()
  const spend = () => {
    if (validations >= limits.validations) throw new RepairBudgetExhausted()
    validations++
    onAttempt?.(validations)
  }
  const inspectPart: PartCheck = async (part) => {
    const identity = cadIdentity(part)
    if (!partResults.has(identity)) {
      spend(); const pending = checkPart(part); partResults.set(identity, pending)
      void pending.catch(() => partResults.delete(identity))
    }
    return await partResults.get(identity)!
  }
  for (let step = 0; issue && step < limits.steps; step++) {
    const messages = typeof issue === 'string' ? [issue] : [...new Set([...issue.collisions, ...issue.mechanicalIssues ?? []].map((item) => item.message))]
    let accepted = false
    for (const message of messages) {
      const collision = typeof issue === 'string' ? undefined : issue.collisions.find((item) => item.message === message)
      for (const strategy of strategies) {
        let candidateIssue: CadAssemblyCheckResult = issue
        let verifiedCandidate: string | null = null
        const assessCandidate = async (candidate: CadAssemblySpec): Promise<string | null> => {
          const serialized = cadIdentity(candidate)
          if (seen.has(serialized)) return 'Candidato já avaliado sem progresso.'
          spend()
          seen.add(serialized)
          const result = await checkAssembly(candidate)
          if (!reducesInterference(issue, result)) return assemblyIssueMessage(result) ?? 'Sem progresso comprovado.'
          candidateIssue = result
          verifiedCandidate = serialized
          return null
        }
        let candidate: CadAssemblySpec | null
        try { candidate = await strategy.propose(spec, message, inspectPart, assessCandidate, collision) }
        catch (error) {
          if (error instanceof RepairBudgetExhausted) return { spec, issue, assumptions }
          throw error
        }
        if (!candidate || cadIdentity(candidate) !== verifiedCandidate) continue
        spec = candidate
        issue = candidateIssue
        assumptions.push(strategy.assumption)
        onAccepted?.({ spec, issue, assumptions: [...assumptions] })
        accepted = true
        break
      }
      if (accepted) break
    }
    if (!accepted) break
  }
  return { spec, issue, assumptions }
}
