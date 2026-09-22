/**
 * `OpenAICompatibleProvider`: the optional BYOK `LLMProvider` implementation
 * (PRD §3.7's "future BYOK provider for testing/advanced users"), for users
 * whose device can't run WebLLM (no WebGPU/GPU adapter) and who supply their
 * own API key for any OpenAI-`/chat/completions`-compatible endpoint (e.g. a
 * free tier such as Groq). `WebLLMProvider` remains the required default
 * (PRD §3.6); this is a user-selected alternative, never on by default.
 *
 * `fetchImpl` is injected (mirroring `webllm-provider.ts`'s
 * `detectWebGpu`/`createWorker`/`createEngine` DI pattern) so this is
 * unit-tested without a real network call.
 *
 * The call goes directly from the browser to the configured `baseUrl` --
 * the same client-side pattern WebLLM already uses, just against a remote
 * model instead of a local one. The API key is only ever placed in this
 * request's `Authorization` header; it is never sent to `apps/api` and never
 * included in a thrown error message (error messages include the response
 * status/body text only).
 */

import type { AgentMessage, GenerationOptions, JsonSchema, LLMProvider } from "./provider.ts";

export interface OpenAICompatibleConfig {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
}

export type OpenAICompatibleProviderState =
  | { readonly phase: "idle" }
  | { readonly phase: "ready" }
  | { readonly phase: "generating" }
  | { readonly phase: "error"; readonly message: string };

export type FetchLike = typeof fetch;

export type OpenAICompatibleStateListener = (state: OpenAICompatibleProviderState) => void;

function isConfigComplete(config: OpenAICompatibleConfig): boolean {
  return config.baseUrl.trim().length > 0 && config.apiKey.trim().length > 0 && config.model.trim().length > 0;
}

export class OpenAICompatibleProvider implements LLMProvider {
  readonly id = "openai-compatible";

  private readonly config: OpenAICompatibleConfig;
  private readonly fetchImpl: FetchLike;
  private state: OpenAICompatibleProviderState = { phase: "idle" };
  private readonly listeners = new Set<OpenAICompatibleStateListener>();
  private inFlight: AbortController | null = null;

  constructor(config: OpenAICompatibleConfig, fetchImpl: FetchLike = fetch) {
    this.config = config;
    this.fetchImpl = fetchImpl;
  }

  getState(): OpenAICompatibleProviderState {
    return this.state;
  }

  onStateChange(listener: OpenAICompatibleStateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async isAvailable(): Promise<boolean> {
    return isConfigComplete(this.config);
  }

  /** Never throws: an incomplete config lands in state as `{ phase: "error" }`,
   * mirroring `WebLLMProvider.initialize()`'s "never throws" contract. No
   * test network call is made here -- a real connectivity/auth failure
   * surfaces on the first `generateStructured` call instead, the same place
   * a WebGPU/model-load failure would. */
  async initialize(): Promise<void> {
    if (!isConfigComplete(this.config)) {
      this.setState({ phase: "error", message: "Missing base URL, API key, or model." });
      return;
    }
    this.setState({ phase: "ready" });
  }

  /** `_schema` is part of the `LLMProvider` contract but unused here: unlike
   * `WebLLMProvider`'s JSON mode, this provider's `response_format: {type:
   * "json_object"}` isn't schema-aware (broader OpenAI-compatible-endpoint
   * support than the newer `json_schema` mode, which not every provider
   * implements). `generateModelPlan`'s own ajv validation against this same
   * schema, plus its one-shot repair retry, is what actually enforces shape
   * here. */
  async generateStructured<T>(
    messages: readonly AgentMessage[],
    _schema: JsonSchema,
    options?: GenerationOptions,
  ): Promise<T> {
    if (this.state.phase !== "ready") {
      throw new Error(`OpenAICompatibleProvider.generateStructured called while not ready (phase: ${this.state.phase})`);
    }

    this.setState({ phase: "generating" });
    const controller = new AbortController();
    this.inFlight = controller;
    try {
      const response = await this.fetchImpl(`${this.config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: toOpenAiMessages(messages),
          response_format: { type: "json_object" },
          temperature: options?.temperature,
          max_tokens: options?.maxTokens,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const bodyText = await response.text().catch(() => "");
        throw new Error(
          `OpenAI-compatible request failed with status ${response.status}${bodyText ? `: ${bodyText}` : ""}`,
        );
      }

      const body = (await response.json()) as { choices?: { message?: { content?: string | null } }[] };
      const content = body.choices?.[0]?.message?.content;
      if (content == null) {
        throw new Error("OpenAI-compatible response had no message content");
      }
      return JSON.parse(content) as T;
    } finally {
      this.inFlight = null;
      this.setState({ phase: "ready" });
    }
  }

  async cancel(): Promise<void> {
    this.inFlight?.abort();
  }

  private setState(state: OpenAICompatibleProviderState): void {
    this.state = state;
    for (const listener of this.listeners) listener(state);
  }
}

function toOpenAiMessages(messages: readonly AgentMessage[]): { role: string; content: string }[] {
  return messages.map((message) => ({ role: message.role, content: message.content }));
}
