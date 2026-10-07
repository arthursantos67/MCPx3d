import { ProviderRequestError } from './provider.ts'

export class CadActionBudgetError extends ProviderRequestError {
  constructor(message: string) { super(`${message} O trabalho foi interrompido com orçamento limitado; o rascunho disponível foi conservado para download.`); this.name = 'CadActionBudgetError' }
}

export interface CadActionLimits { readonly aiCalls: number; readonly cadChecks: number; readonly durationMs: number }
export interface CadActionStats { readonly aiCalls: number; readonly cadChecks: number; readonly aiCallLimit: number; readonly cadCheckLimit: number }

export const CAD_CREATE_LIMITS: CadActionLimits = { aiCalls: 20, cadChecks: 48, durationMs: 1_200_000 }
export const CAD_REPAIR_LIMITS: CadActionLimits = { aiCalls: 5, cadChecks: 16, durationMs: 240_000 }

export class CadActionBudget {
  private aiCalls = 0
  private cadChecks = 0
  private readonly started: number
  readonly limits: CadActionLimits
  private readonly now: () => number
  constructor(limits: CadActionLimits, now = () => Date.now()) {
    this.limits = limits
    this.now = now
    if (!Number.isInteger(limits.aiCalls) || limits.aiCalls < 1 || !Number.isInteger(limits.cadChecks) || limits.cadChecks < 1 ||
      !Number.isFinite(limits.durationMs) || limits.durationMs <= 0) throw new Error('Orçamento CAD inválido')
    this.started = now()
  }
  checkTime(): void {
    if (this.now() - this.started >= this.limits.durationMs) throw this.timeout()
  }
  timeout(): CadActionBudgetError { return new CadActionBudgetError(`A ação atingiu o prazo de ${Math.round(this.limits.durationMs / 1000)} s.`) }
  spend(kind: 'ai' | 'cad'): void {
    this.checkTime()
    if (kind === 'ai') {
      if (this.aiCalls >= this.limits.aiCalls) throw new CadActionBudgetError(`A ação atingiu ${this.limits.aiCalls} chamadas de IA.`)
      this.aiCalls++
    } else {
      if (this.cadChecks >= this.limits.cadChecks) throw new CadActionBudgetError(`A ação atingiu ${this.limits.cadChecks} verificações geométricas distintas.`)
      this.cadChecks++
    }
  }
  stats(): CadActionStats { return { aiCalls: this.aiCalls, cadChecks: this.cadChecks, aiCallLimit: this.limits.aiCalls, cadCheckLimit: this.limits.cadChecks } }
}
