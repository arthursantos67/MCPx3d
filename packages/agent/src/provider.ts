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

export type CompletionFailure = "truncated" | "malformed" | "empty";

export interface CompletionUsage {
  readonly promptTokens?: number;
  readonly completionTokens?: number;
  readonly reasoningTokens?: number;
}

/** Safe, content-free facts about one provider completion (Issue #71). Never
 * carries the prompt, the raw response text, or credentials. */
export interface CompletionMetadata {
  readonly finishReason: string | null;
  readonly outputCharacters: number;
  readonly usage?: CompletionUsage;
  readonly failure: CompletionFailure | null;
  readonly locallyRepaired: boolean;
}

export interface GenerationOptions {
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly onCompletion?: (completion: CompletionMetadata) => void;
}

export class ProviderRequestError extends Error {
  readonly limit?: ProviderLimit;

  constructor(message: string, options?: { cause?: unknown; limit?: ProviderLimit }) {
    super(message, options);
    this.name = "ProviderRequestError";
    this.limit = options?.limit ?? (options?.cause instanceof ProviderRequestError ? options.cause.limit : undefined);
  }
}

export interface ProviderLimit {
  readonly kind: 'rate' | 'quota' | 'request-size' | 'unknown';
  readonly retryAt?: number;
  readonly code?: string;
}

/** A completion that could not be turned into a JSON value. The message is a
 * fixed, classified description -- never the provider's raw output. */
export class StructuredOutputError extends Error {
  readonly completion: CompletionMetadata;

  constructor(completion: CompletionMetadata & { readonly failure: CompletionFailure }) {
    super(STRUCTURED_OUTPUT_FAILURE_MESSAGES[completion.failure]);
    this.name = "StructuredOutputError";
    this.completion = completion;
  }
}

const STRUCTURED_OUTPUT_FAILURE_MESSAGES: Record<CompletionFailure, string> = {
  truncated: "the response reached its output limit before the JSON was complete",
  malformed: "the response was not valid JSON",
  empty: "the response was empty",
};

export interface LLMProvider {
  readonly id: string;
  /** Absent keeps the existing HTTP/WebLLM repair behavior. */
  readonly generationPolicy?: {
    readonly retryInvalidStructuredOutput: boolean;
    readonly maxCadRepairAttempts: number;
    readonly maxSceneRepairAttempts?: number;
  };
  /** The configured model, for per-provider/model diagnostics. */
  readonly model?: string;
  /** The provider's own completion-token ceiling, when it has one. */
  readonly maxOutputTokens?: number;
  isAvailable(): Promise<boolean>;
  initialize(): Promise<void>;
  generateStructured<T>(
    messages: readonly AgentMessage[],
    schema: JsonSchema,
    options?: GenerationOptions,
  ): Promise<T>;
  cancel?(): Promise<void>;
}
