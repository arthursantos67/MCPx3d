import type { AgentMessage, GenerationOptions, JsonSchema, LLMProvider } from '../../../../packages/agent/src/provider.ts'
import { generateCadProgram, type CadProgramOutcome } from '../../../../packages/agent/src/generate-cad-program.ts'
import { generateCadAssembly, type CadAssemblyOutcome, type CadAssemblyProgressListener } from '../../../../packages/agent/src/generate-cad-assembly.ts'
import { classifyCadDesign, isCadClarification, type CadDesignOutcome } from '../../../../packages/agent/src/classify-cad-design.ts'
import type { CadProgramSpec } from '../../../../packages/domain/ts/src/cad-program.ts'
import type { CadAssemblySpec } from '../../../../packages/domain/ts/src/cad-assembly.ts'
import type { CadAssemblyCheckResult } from '../../../../packages/domain/ts/src/cad-assembly-diagnostics.ts'

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

  constructor(provider: LLMProvider, api: CadAgentApi) {
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
    const guard = () => cancellation.signal.throwIfAborted()
    const api: CadAgentApi = {
      checkCadProgram: async (spec) => {
        guard()
        const result = await this.api.checkCadProgram(spec, cancellation.signal)
        guard()
        return result
      },
      checkCadAssembly: async (spec) => {
        guard()
        const result = await this.api.checkCadAssembly(spec, cancellation.signal)
        guard()
        return result
      },
    }
    try {
      if (this.completed?.key === key) return structuredClone(this.completed.outcome) as T
      const result = await generate(this.guardedProvider, api, cancellation.signal)
      guard()
      if (this.provider.generationPolicy && !isCadClarification(result)) this.completed = { key, outcome: structuredClone(result) }
      return result
    } finally { this.active = null }
  }

  planCadProgram(request: string, previous?: CadProgramSpec): Promise<CadProgramOutcome> {
    return this.run(JSON.stringify(['program', request, previous]), (provider, api) => generateCadProgram(provider, request, previous, api.checkCadProgram, { noQuestions: true }))
  }

  planCadAssembly(request: string, previous?: CadAssemblySpec, onProgress?: CadAssemblyProgressListener, requireMechanics = false): Promise<CadAssemblyOutcome> {
    return this.run(JSON.stringify(['assembly', request, previous, requireMechanics]), (provider, api, signal) => generateCadAssembly(provider, request, api.checkCadProgram,
      api.checkCadAssembly, previous, (progress) => { if (!signal.aborted) onProgress?.(progress) }, 0, { requireMechanics, noQuestions: true }))
  }

  repairCadAssembly(spec: CadAssemblySpec, onProgress?: CadAssemblyProgressListener): Promise<CadAssemblyOutcome> {
    return this.run(JSON.stringify(['assembly-repair', spec]), (provider, api, signal) => generateCadAssembly(provider,
      'Corrija as interferências do conjunto existente. Preserve componentes, roscas, posições e movimentos não afetados.',
      api.checkCadProgram, api.checkCadAssembly, spec, (progress) => { if (!signal.aborted) onProgress?.(progress) },
      0, { repairOnly: true, noQuestions: true }))
  }

  planCadDesign(request: string, previous?: CadProgramSpec, onProgress?: CadAssemblyProgressListener, requireMechanics = false): Promise<CadDesignOutcome> {
    return this.run(JSON.stringify(['design', request, previous, requireMechanics]), async (provider, api, signal) => {
      const mode = previous ? 'part' : await classifyCadDesign(provider, request)
      signal.throwIfAborted()
      if (mode === 'assembly') {
        const outcome = await generateCadAssembly(provider, request, api.checkCadProgram, api.checkCadAssembly,
          undefined, (progress) => { if (!signal.aborted) onProgress?.(progress) }, 0, { requireMechanics, noQuestions: true })
        return { mode, outcome }
      }
      return { mode, outcome: await generateCadProgram(provider, request, previous, api.checkCadProgram, { noQuestions: true }) }
    })
  }
}
