/**
 * `LLMProvider` abstraction (PRD §3.7, FR-27, Issue #18).
 *
 * Nothing outside this package may call a specific LLM SDK (`@mlc-ai/web-llm`
 * or otherwise) directly -- callers (the ModelPlan generation service in this
 * package, and eventually the chat UI) depend only on this interface, so a
 * future provider (Puter.js, an OpenAI-compatible BYOK provider) is a new
 * class, never a change to call sites.
 */

export interface AgentMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
}

/** A JSON Schema object, passed through to the provider for structured/JSON-mode generation. */
export type JsonSchema = Record<string, unknown>;

export interface GenerationOptions {
  readonly temperature?: number;
  readonly maxTokens?: number;
}

export class ProviderRequestError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ProviderRequestError";
  }
}

export interface LLMProvider {
  readonly id: string;
  isAvailable(): Promise<boolean>;
  initialize(): Promise<void>;
  generateStructured<T>(
    messages: readonly AgentMessage[],
    schema: JsonSchema,
    options?: GenerationOptions,
  ): Promise<T>;
  cancel?(): Promise<void>;
}
