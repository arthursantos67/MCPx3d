import { ProviderRequestError, type AgentMessage, type GenerationOptions, type JsonSchema, type LLMProvider } from '../../../../packages/agent/src/provider.ts'
import { generateCadProgram, type CadProgramOutcome } from '../../../../packages/agent/src/generate-cad-program.ts'
import { generateCadAssembly, type CadAssemblyOutcome, type CadAssemblyProgressListener } from '../../../../packages/agent/src/generate-cad-assembly.ts'
import { classifyCadDesign, isCadClarification, type CadDesignOutcome } from '../../../../packages/agent/src/classify-cad-design.ts'
import type { CadProgramSpec } from '../../../../packages/domain/ts/src/cad-program.ts'
import type { CadAssemblySpec } from '../../../../packages/domain/ts/src/cad-assembly.ts'
import type { CadAssemblyCheckResult } from '../../../../packages/domain/ts/src/cad-assembly-diagnostics.ts'
import type { CadDraftListener, CadDraftSnapshot } from '../../../../packages/domain/ts/src/cad-draft.ts'
import { CadActionBudget, CAD_CREATE_LIMITS, CAD_REPAIR_LIMITS, type CadActionLimits, type CadActionStats } from '../../../../packages/agent/src/cad-action-budget.ts'
import { cadIdentity } from '../../../../packages/agent/src/cad-identity.ts'

export interface CadAgentApi {
  checkCadProgram(spec: CadProgramSpec, signal?: AbortSignal): Promise<string | null>
  checkCadAssembly(spec: CadAssemblySpec, signal?: AbortSignal): Promise<CadAssemblyCheckResult>
}

export class CadAgentController {
  private active: AbortController | null = null
  private provider: LLMProvider
  private guardedProvider: LLMProvider
  private api: CadAgentApi
  private completed: { key: string; outcome: unknown } | null = null
  private draftListener?: CadDraftListener
  private latestDraft: CadDraftSnapshot | null = null
  private budget: CadActionBudget | null = null
  private statsListener?: (stats: CadActionStats) => void
  private readonly geometryCache = new Map<string, Promise<string | null>>()
  private readonly assemblyCache = new Map<string, Promise<CadAssemblyCheckResult>>()
  private readonly limits?: CadActionLimits

  setDraftListener(listener: CadDraftListener): void { this.draftListener = listener }
  setStatsListener(listener: (stats: CadActionStats) => void): void { this.statsListener = listener }
  private reportBudget(): void { if (this.budget) this.statsListener?.(this.budget.stats()) }

  private publishDraft(draft: CadDraftSnapshot): void {
    this.latestDraft = structuredClone(draft)
    this.draftListener?.(this.latestDraft)
  }

  private publishFailure(error: unknown): void {
    if (this.latestDraft) this.publishDraft({ ...this.latestDraft, issue: error instanceof Error ? error.message : String(error) })
  }

  constructor(provider: LLMProvider, api: CadAgentApi, limits?: CadActionLimits) {
    this.limits = limits
    this.provider = provider
    this.api = api
    const getProvider = () => this.provider
    this.guardedProvider = {
      get id() { return getProvider().id },
      get model() { return getProvider().model },
      get maxOutputTokens() { return getProvider().maxOutputTokens },
      get generationPolicy() { return getProvider().generationPolicy },
      isAvailable: () => this.provider.isAvailable(), initialize: () => this.provider.initialize(),
      generateStructured: async <T>(messages: readonly AgentMessage[], schema: JsonSchema, options?: GenerationOptions): Promise<T> => {
        const signal = this.active?.signal
        signal?.throwIfAborted()
        this.budget?.spend('ai'); this.reportBudget()
        const response = await this.provider.generateStructured<T>(messages, schema, options)
        signal?.throwIfAborted()
        return response
      },
    }
  }

  setProvider(provider: LLMProvider): void {
    if (this.active) throw new Error('Aguarde a geração CAD antes de trocar o provedor.')
    this.provider = provider
  }

  cancelGeneration(): void {
    this.active?.abort()
    void this.provider.cancel?.()
  }

  clearCompletedGeneration(): void { this.completed = null }

  private async run<T extends CadProgramOutcome | CadAssemblyOutcome | CadDesignOutcome>(key: string, generate: (provider: LLMProvider, api: CadAgentApi, signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.active) throw new Error('Aguarde a geração CAD em andamento.')
    const cancellation = new AbortController()
    this.active = cancellation
    this.latestDraft = null
    this.budget = new CadActionBudget(this.limits ?? (key.startsWith('["assembly-repair",') ? CAD_REPAIR_LIMITS : CAD_CREATE_LIMITS))
    this.reportBudget()
    const budget = this.budget
    const pendingChecks = new Map<Promise<unknown>, () => void>()
    const timer = setTimeout(() => { cancellation.abort(budget.timeout()); void this.provider.cancel?.() }, budget.limits.durationMs)
    const guard = () => { cancellation.signal.throwIfAborted(); budget.checkTime() }
    const inspect = async <T,>(cache: Map<string, Promise<T>>, spec: unknown, check: () => Promise<T>): Promise<T> => {
      guard()
      const identity = cadIdentity(spec)
      if (!cache.has(identity)) {
        budget.spend('cad'); this.reportBudget()
        const pending = check().catch((error: unknown) => {
          if (cache.get(identity) === pending) cache.delete(identity)
          guard()
          if (error instanceof ProviderRequestError || error instanceof DOMException && error.name === 'AbortError') throw error
          throw new ProviderRequestError(`A verificação CAD foi interrompida; nenhuma correção com IA foi solicitada para esta falha. ${error instanceof Error ? error.message : String(error)}`, { cause: error })
        })
        cache.set(identity, pending)
        pendingChecks.set(pending, () => { if (cache.get(identity) === pending) cache.delete(identity) })
        void pending.then(() => pendingChecks.delete(pending), () => pendingChecks.delete(pending))
        if (cache.size > 64) cache.delete(cache.keys().next().value!)
      }
      const result = await cache.get(identity)!
      guard(); return result
    }
    const api: CadAgentApi = {
      checkCadProgram: (spec) => inspect(this.geometryCache, spec, () => this.api.checkCadProgram(spec, cancellation.signal)),
      checkCadAssembly: (spec) => inspect(this.assemblyCache, spec, () => this.api.checkCadAssembly(spec, cancellation.signal)),
    }
    let rejectAborted: (() => void) | undefined
    const aborted = new Promise<never>((_, reject) => {
      rejectAborted = () => reject(cancellation.signal.reason)
      cancellation.signal.addEventListener('abort', rejectAborted, { once: true })
    })
    try {
      if (this.completed?.key === key) return structuredClone(this.completed.outcome) as T
      const result = await Promise.race([generate(this.guardedProvider, api, cancellation.signal), aborted])
      guard()
      if (this.provider.generationPolicy && !isCadClarification(result)) this.completed = { key, outcome: structuredClone(result) }
      return result
    } catch (error) {
      this.publishFailure(error)
      throw error
    } finally {
      clearTimeout(timer)
      if (cancellation.signal.aborted) for (const remove of pendingChecks.values()) remove()
      if (rejectAborted) cancellation.signal.removeEventListener('abort', rejectAborted)
      this.reportBudget(); this.budget = null; this.active = null
    }
  }

  planCadProgram(request: string, previous?: CadProgramSpec): Promise<CadProgramOutcome> {
    return this.run(JSON.stringify(['program', request, previous]), (provider, api) => generateCadProgram(provider, request, previous, api.checkCadProgram,
      { noQuestions: true, maxRepairAttempts: 3, prepareDesign: true, onDraft: (spec, issue) => this.publishDraft({ spec, request, issue }) }))
  }

  planCadAssembly(request: string, previous?: CadAssemblySpec, onProgress?: CadAssemblyProgressListener, requireMechanics = false): Promise<CadAssemblyOutcome> {
    return this.run(JSON.stringify(['assembly', request, previous, requireMechanics]), (provider, api, signal) => generateCadAssembly(provider, request, api.checkCadProgram,
      api.checkCadAssembly, previous, (progress) => { if (!signal.aborted) onProgress?.(progress) }, 0,
      { requireMechanics, noQuestions: true, maxRepairAttempts: 3, allowUnverifiedDrafts: true, prepareDesign: true, reviewPlan: true,
        repairLimits: { steps: 6, validations: 16 }, onDraft: (draft) => this.publishDraft({ ...draft, request }) }))
  }

  repairCadAssembly(spec: CadAssemblySpec, onProgress?: CadAssemblyProgressListener): Promise<CadAssemblyOutcome> {
    return this.run(JSON.stringify(['assembly-repair', spec]), (provider, api, signal) => generateCadAssembly(provider,
      'Corrija as interferências do conjunto existente. Preserve componentes, roscas, posições e movimentos não afetados.',
      api.checkCadProgram, api.checkCadAssembly, spec, (progress) => { if (!signal.aborted) onProgress?.(progress) },
      0, { repairOnly: true, noQuestions: true, maxRepairAttempts: 2, repairLimits: { steps: 6, validations: 16 }, onDraft: (draft) => this.publishDraft(draft) }))
  }

  planCadDesign(request: string, previous?: CadProgramSpec, onProgress?: CadAssemblyProgressListener, requireMechanics = false): Promise<CadDesignOutcome> {
    return this.run(JSON.stringify(['design', request, previous, requireMechanics]), async (provider, api, signal) => {
      const mode = previous ? 'part' : await classifyCadDesign(provider, request)
      signal.throwIfAborted()
      if (mode === 'assembly') {
        const outcome = await generateCadAssembly(provider, request, api.checkCadProgram, api.checkCadAssembly,
          undefined, (progress) => { if (!signal.aborted) onProgress?.(progress) }, 0,
          { requireMechanics, noQuestions: true, maxRepairAttempts: 3, allowUnverifiedDrafts: true, prepareDesign: true, reviewPlan: true,
            repairLimits: { steps: 6, validations: 16 }, onDraft: (draft) => this.publishDraft({ ...draft, request }) })
        return { mode, outcome }
      }
      return { mode, outcome: await generateCadProgram(provider, request, previous, api.checkCadProgram,
        { noQuestions: true, maxRepairAttempts: 3, prepareDesign: true, onDraft: (spec, issue) => this.publishDraft({ spec, request, issue }) }) }
    })
  }
}
