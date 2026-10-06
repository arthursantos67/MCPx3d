import { ProviderRequestError, type AgentMessage, type GenerationOptions, type JsonSchema, type LLMProvider } from './provider.ts'

export const CAD_AUTONOMY_INSTRUCTIONS = 'The user delegates CAD design decisions and does not want questions or permission requests. Choose compatible dimensions, fits, wall thicknesses and fastening positions autonomously. Prefer adjusting the current component and retaining validated mating geometry. If an inferred height or mounting pattern intersects a cavity, revise those dimensions while preserving the global mating axis and necessary clearance from other parts. Preserve requested functions and real threads; document decisions, approximations and any unavoidable requirement conflicts in assumptions. Never claim unsupported functionality or bypass geometry/mechanical validation. Return a construction decision with question empty, not clarification.'

export class CadAutonomyError extends ProviderRequestError {
  constructor() {
    super('O agente não conseguiu concluir uma decisão de projeto automaticamente dentro do limite de tentativas. O progresso disponível foi conservado; nenhuma aprovação foi solicitada.')
    this.name = 'CadAutonomyError'
  }
}

const pendingDecisions = new WeakMap<LLMProvider, Map<string, readonly string[]>>()

export async function generateCadDecision(
  provider: LLMProvider, messages: readonly AgentMessage[], schema: JsonSchema,
  options: GenerationOptions, noQuestions = false,
): Promise<unknown> {
  if (!noQuestions) return provider.generateStructured<unknown>(messages, schema, options)
  const properties = schema.properties as Record<string, JsonSchema>
  const decisions = (properties.decision.enum as string[]).filter((value) => value !== 'clarify')
  const autonomousSchema = { ...schema, properties: { ...properties,
    decision: { ...properties.decision, enum: decisions }, question: { type: 'string', const: '' } } }
  const base: AgentMessage[] = [...messages, { role: 'system', content: CAD_AUTONOMY_INSTRUCTIONS }]
  const key = JSON.stringify([messages, autonomousSchema, options.maxTokens])
  let store = pendingDecisions.get(provider)
  if (!store) { store = new Map(); pendingDecisions.set(provider, store) }
  let questions = store.get(key) ?? []
  const resolve = () => provider.generateStructured<unknown>([...base,
    ...questions.map((question): AgentMessage => ({ role: 'assistant', content: JSON.stringify({ decision: 'clarify', question }) })),
    { role: 'user', content: 'Resolve these design decisions internally. Choose the least disruptive working alternative, record its dimensions and rationale in assumptions, and return the complete construction JSON. Do not ask the user to choose or authorize anything. Keep validated components and mating axes whenever possible; geometry and mechanical checks remain mandatory.' },
  ], autonomousSchema, options)
  let response = questions.length ? await resolve() : await provider.generateStructured<unknown>(base, autonomousSchema, options)
  for (let attempt = 0; ; attempt++) {
    if (!response || typeof response !== 'object' || (response as Record<string, unknown>).decision !== 'clarify') {
      store.delete(key)
      return response
    }
    const question = (response as Record<string, unknown>).question
    questions = [...questions, typeof question === 'string' ? question : 'No construction decision supplied.'].slice(-3)
    store.set(key, questions)
    if (store.size > 8) store.delete(store.keys().next().value!)
    if (attempt >= 2) throw new CadAutonomyError()
    response = await resolve()
  }
}
