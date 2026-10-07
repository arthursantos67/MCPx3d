import type { LLMProvider } from './provider.ts'
import type { CadProgramOutcome } from './generate-cad-program.ts'
import type { CadAssemblyOutcome } from './generate-cad-assembly.ts'
import { requestedCadComponentCount } from './cad-component-count.ts'

export type CadDesignOutcome =
  | { readonly mode: 'part'; readonly outcome: CadProgramOutcome }
  | { readonly mode: 'assembly'; readonly outcome: CadAssemblyOutcome }

export function isCadClarification(result: CadProgramOutcome | CadAssemblyOutcome | CadDesignOutcome): boolean {
  return ('outcome' in result ? result.outcome : result).kind === 'clarify'
}

const schema = {
  type: 'object', additionalProperties: false, required: ['kind', 'reason'],
  properties: { kind: { enum: ['part', 'assembly'] }, reason: { type: 'string' } },
}

const decisions = new WeakMap<LLMProvider, Map<string, 'part' | 'assembly'>>()

/** Choose a modeling representation before constructing geometry. */
export async function classifyCadDesign(provider: LLMProvider, request: string): Promise<'part' | 'assembly'> {
  const cached = decisions.get(provider)?.get(request)
  if (cached) return cached
  const response = await provider.generateStructured<unknown>([
    { role: 'system', content: [
      'Classify a mechanical CAD creation request by the physical object it describes, not by a fixed list of product names.',
      'Return assembly when the object needs two or more separately manufacturable bodies, relative motion, a shaft inside a housing, removable covers, or distinct fixed and moving parts.',
      'A short familiar machine name is enough to infer an assembly even if the user did not enumerate components.',
      'Return part for one connected manufactured solid made with additive features and cuts, such as a bracket, flange or plate.',
      'Honor an explicit request for a single simplified solid. Do not answer the design request or ask for dimensions; choose only the representation.',
    ].join(' ') },
    { role: 'user', content: request },
  ], schema, { temperature: 0, maxTokens: 160 })
  if (!response || typeof response !== 'object' || Array.isArray(response) ||
      !['part', 'assembly'].includes((response as Record<string, unknown>).kind as string)) {
    throw new Error('O agente não conseguiu escolher a representação CAD. Tente novamente.')
  }
  const kind = requestedCadComponentCount(request) ? 'assembly' : (response as { kind: 'part' | 'assembly' }).kind
  let store = decisions.get(provider)
  if (!store) { store = new Map(); decisions.set(provider, store) }
  if (store.size >= 20) store.delete(store.keys().next().value!)
  store.set(request, kind)
  return kind
}
