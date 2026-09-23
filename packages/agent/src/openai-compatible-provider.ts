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

import {
  ProviderRequestError,
  type AgentMessage,
  type GenerationOptions,
  type JsonSchema,
  type LLMProvider,
} from "./provider.ts";

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
export type SleepLike = (milliseconds: number, signal: AbortSignal) => Promise<void>;

export type OpenAICompatibleStateListener = (state: OpenAICompatibleProviderState) => void;

function isConfigComplete(config: OpenAICompatibleConfig): boolean {
  return config.baseUrl.trim().length > 0 && config.apiKey.trim().length > 0 && config.model.trim().length > 0;
}

/** A ModelPlan JSON response is at most a few hundred tokens even for a
 * plan with several operations; this default leaves generous headroom
 * without inviting a model's much larger implicit default completion
 * budget to eat into a free-tier tokens-per-minute limit. */
const DEFAULT_MAX_COMPLETION_TOKENS = 2048;
const CHAT_COMPLETIONS_PATH = "/chat/completions";
const MAX_TRANSIENT_RETRIES = 2;
const BASE_RETRY_DELAY_MS = 1000;

function toChatCompletionsUrl(configuredUrl: string): string {
  const normalized = configuredUrl.trim().replace(/\/+$/, "");
  return normalized.endsWith(CHAT_COMPLETIONS_PATH) ? normalized : `${normalized}${CHAT_COMPLETIONS_PATH}`;
}

function isTransientStatus(status: number): boolean {
  return status === 408 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function retryAfterMilliseconds(response: Response): number | null {
  const value = response.headers.get("retry-after");
  if (value === null) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

function exponentialDelayMilliseconds(retryIndex: number, random: () => number): number {
  const jitter = 0.8 + random() * 0.4;
  return Math.round(BASE_RETRY_DELAY_MS * 2 ** retryIndex * jitter);
}

function sleepWithAbort(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new DOMException("Request cancelled", "AbortError"));
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    const onAbort = (): void => {
      clearTimeout(timeout);
      reject(new DOMException("Request cancelled", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function providerResponseMessage(status: number, bodyText: string): string {
  if (status === 503) {
    return "The AI model is temporarily unavailable after three attempts (status 503). Try again shortly or choose another model.";
  }
  if (status === 429) {
    return "The AI provider rate limit was reached after three attempts (status 429). Try again shortly or check the provider quota.";
  }
  return `OpenAI-compatible request failed with status ${status}${bodyText ? `: ${bodyText}` : ""}`;
}

export class OpenAICompatibleProvider implements LLMProvider {
  readonly id = "openai-compatible";

  private readonly config: OpenAICompatibleConfig;
  private readonly chatCompletionsUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly sleepImpl: SleepLike;
  private readonly random: () => number;
  private state: OpenAICompatibleProviderState = { phase: "idle" };
  private readonly listeners = new Set<OpenAICompatibleStateListener>();
  private inFlight: AbortController | null = null;

  // `fetch.bind(globalThis)`, not bare `fetch`: native fetch requires its
  // receiver to be `window`/`globalThis`, and storing the bare reference on
  // `this.fetchImpl` then calling it as `this.fetchImpl(...)` rebinds `this`
  // to the provider instance instead, throwing "Illegal invocation" (Chrome)
  // / "'fetch' called on an object that does not implement interface
  // Window" (Firefox) on the very first request.
  constructor(
    config: OpenAICompatibleConfig,
    fetchImpl: FetchLike = fetch.bind(globalThis),
    sleepImpl: SleepLike = sleepWithAbort,
    random: () => number = Math.random,
  ) {
    this.config = { ...config, baseUrl: config.baseUrl.trim() };
    this.chatCompletionsUrl = toChatCompletionsUrl(config.baseUrl);
    this.fetchImpl = fetchImpl;
    this.sleepImpl = sleepImpl;
    this.random = random;
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
   * `response_format: {type: "json_schema", json_schema: {name, schema}}` is
   * the standard OpenAI "Structured Outputs" shape (best-effort, not
   * `strict: true`): `strict` mode requires every property to be listed in
   * `required` with optionality expressed as nullable unions, a stricter
   * shape than `packages/domain`'s schemas use, so this passes the schema as
   * a strong hint without demanding hard compliance. Without this, a model
   * only had this package's natural-language system prompt to go on and
   * regularly produced JSON that didn't match at all (missing `intent`,
   * wrong operation fields) -- `generateModelPlan`'s ajv validation plus its
   * one-shot repair retry remain the actual enforcement boundary either way,
   * this just gives the model a much better chance of passing it the first
   * time. Not every OpenAI-compatible endpoint supports `json_schema` mode
   * (it is however what Groq, this project's documented recommendation,
   * supports for exactly this purpose). */
  async generateStructured<T>(
    messages: readonly AgentMessage[],
    schema: JsonSchema,
    options?: GenerationOptions,
  ): Promise<T> {
    if (this.state.phase !== "ready") {
      throw new Error(`OpenAICompatibleProvider.generateStructured called while not ready (phase: ${this.state.phase})`);
    }

    this.setState({ phase: "generating" });
    const controller = new AbortController();
    this.inFlight = controller;
    try {
      const request: RequestInit = {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: toOpenAiMessages(messages),
          response_format: { type: "json_schema", json_schema: { name: "model_plan", schema: stripDescriptions(schema) } },
          temperature: options?.temperature,
          // Only the current-standard field name: some endpoints (Google's
          // Gemini OpenAI-compat layer, confirmed live) reject a request
          // that sets both `max_tokens` and `max_completion_tokens` at once
          // with a 400, rather than ignoring the one they don't recognize.
          // `max_completion_tokens` is what current OpenAI and Groq expect;
          // capped at a small default rather than left unset, since a
          // ModelPlan response is at most a few hundred tokens but some
          // models reserve a much larger completion budget by default,
          // which can burn through a free-tier tokens-per-minute limit in a
          // single request.
          max_completion_tokens: options?.maxTokens ?? DEFAULT_MAX_COMPLETION_TOKENS,
          // Reasoning-capable models (e.g. Groq's openai/gpt-oss family) can
          // reserve a large hidden token budget for chain-of-thought before
          // ever producing the visible JSON answer, on top of (not capped
          // by) max_completion_tokens above -- a real driver of hitting a
          // free-tier tokens-per-minute limit for a task this simple.
          // Ignored by models/endpoints that don't recognize it.
          reasoning_effort: "low",
        }),
        signal: controller.signal,
      };

      let response: Response | null = null;
      for (let attempt = 0; attempt <= MAX_TRANSIENT_RETRIES; attempt += 1) {
        try {
          response = await this.fetchImpl(this.chatCompletionsUrl, request);
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") throw error;
          throw new ProviderRequestError(
            "Could not reach the configured AI endpoint. Check the Base URL and whether the provider allows browser requests.",
            { cause: error },
          );
        }

        if (response.ok) break;

        const bodyText = await response.text().catch(() => "");
        if (!isTransientStatus(response.status) || attempt === MAX_TRANSIENT_RETRIES) {
          throw new ProviderRequestError(providerResponseMessage(response.status, bodyText));
        }

        const delay = retryAfterMilliseconds(response) ?? exponentialDelayMilliseconds(attempt, this.random);
        await this.sleepImpl(delay, controller.signal);
      }

      if (response === null) throw new ProviderRequestError("The AI provider returned no response.");

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

/** Drops every `description` key from a JSON Schema before it goes into the
 * request -- pure prose for a human reader, no effect on what the schema
 * accepts, and a real chunk of `packages/domain`'s `model-plan.v1.schema.json`
 * (~6.7KB as authored) that a token-metered model has to pay for on every
 * single request regardless of conversation state. This package's own
 * `system-prompt.ts` already explains every operation in natural language
 * separately, so nothing is lost by stripping it from the copy sent here.
 * Local ajv validation (`generate-model-plan.ts`) still uses the original,
 * untouched schema -- only this provider's wire payload is trimmed. */
function stripDescriptions(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripDescriptions);
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (key === "description") continue;
      result[key] = stripDescriptions(entry);
    }
    return result;
  }
  return value;
}
