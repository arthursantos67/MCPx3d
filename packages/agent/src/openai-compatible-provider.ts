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
 * status and, at most, an identifier-shaped provider error code -- never the
 * response body, which can echo request content).
 */

import {
  ProviderRequestError,
  type AgentMessage,
  type GenerationOptions,
  type JsonSchema,
  type LLMProvider,
  type ProviderLimit,
} from "./provider.ts";
import { parseStructuredCompletion, readCompletionUsage } from "./structured-output.ts";

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

/** This provider's declared `maxOutputTokens` ceiling, so
 * `generateModelPlan`'s explicit per-request budget never exceeds it. Raised
 * from 2048 to 8192 (Issue #71 follow-up): a complete multi-part scene with
 * a reasoning model did not fit in 2048 tokens, forcing batch mode for
 * requests the provider could answer in one response. Trade-off: a
 * free-tier endpoint that counts the requested completion budget against a
 * small tokens-per-minute limit (e.g. Groq's 8K TPM) now rejects most
 * requests with 429. */
export const DEFAULT_MAX_COMPLETION_TOKENS = 8192;
const CHAT_COMPLETIONS_PATH = "/chat/completions";
const MAX_TRANSIENT_RETRIES = 4;
const MAX_RATE_LIMIT_WAIT_MS = 15_000;
const BASE_RETRY_DELAY_MS = 1000;

function toChatCompletionsUrl(configuredUrl: string): string {
  const normalized = configuredUrl.trim().replace(/\/+$/, "");
  return normalized.endsWith(CHAT_COMPLETIONS_PATH) ? normalized : `${normalized}${CHAT_COMPLETIONS_PATH}`;
}

function isGeminiEndpoint(configuredUrl: string): boolean {
  try {
    const url = new URL(configuredUrl);
    return url.hostname === "generativelanguage.googleapis.com" && url.pathname.startsWith("/v1beta/openai");
  } catch {
    return false;
  }
}

/** Gemini accepts only a subset of JSON Schema. Keep the original schema for
 * local validation and send this smaller, equivalent-shape generation hint to
 * Google's OpenAI-compatible endpoint. */
function toGeminiSchema(schema: JsonSchema): unknown {
  const definitions = (schema as Record<string, unknown>).$defs;
  const defs = definitions && typeof definitions === "object" ? definitions as Record<string, unknown> : {};
  const supported = new Set(["type", "properties", "required", "additionalProperties", "items", "enum", "minimum", "maximum", "minItems", "maxItems", "anyOf"]);

  function visit(value: unknown, depth = 0): unknown {
    if (depth > 40) throw new Error("JSON schema references are too deep for Gemini.");
    if (Array.isArray(value)) return value.map((entry) => visit(entry, depth + 1));
    if (value === null || typeof value !== "object") return value;
    const source = value as Record<string, unknown>;
    if (typeof source.$ref === "string") {
      const name = source.$ref.match(/^#\/\$defs\/([A-Za-z0-9_-]+)$/)?.[1];
      if (!name || !(name in defs)) throw new Error("Unsupported JSON schema reference for Gemini.");
      return visit(defs[name], depth + 1);
    }
    const output: Record<string, unknown> = {};
    if ("const" in source) output.enum = [source.const];
    const values = Array.isArray(source.enum) ? source.enum : "const" in source ? [source.const] : [];
    if (!source.type && values.length && values.every((entry) => typeof entry === "string")) output.type = "string";
    if (!source.type && values.length && values.every((entry) => typeof entry === "number")) output.type = "number";
    for (const [key, entry] of Object.entries(source)) {
      if (key === "properties" && entry && typeof entry === "object" && !Array.isArray(entry)) {
        output.properties = Object.fromEntries(Object.entries(entry as Record<string, unknown>).map(([name, child]) => [name, visit(child, depth + 1)]));
      } else if (key === "oneOf" && Array.isArray(entry)) {
        output.anyOf = visit(entry, depth + 1);
      } else if (key === "anyOf" && Array.isArray(entry)) {
        const nullable = entry.length === 2 && entry.some((branch) => (branch as Record<string, unknown> | null)?.type === "null");
        if (nullable) {
          const other = entry.find((branch) => (branch as Record<string, unknown> | null)?.type !== "null");
          const converted = visit(other, depth + 1) as Record<string, unknown>;
          if (typeof converted.type === "string") {
            Object.assign(output, converted, { type: [converted.type, "null"] });
            continue;
          }
        }
        output.anyOf = visit(entry, depth + 1);
      } else if (key === "items" || key === "additionalProperties") {
        output[key] = visit(entry, depth + 1);
      } else if (supported.has(key)) {
        output[key] = entry;
      }
    }
    return output;
  }

  return visit(schema);
}

function isTransientStatus(status: number): boolean {
  return status === 408 || status === 500 || status === 502 || status === 503 || status === 504;
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

/** Only an identifier-shaped provider error code (e.g. `INVALID_ARGUMENT`,
 * `model_not_found`) is ever surfaced -- never the response body itself,
 * which can echo request content. */
function safeProviderErrorCode(bodyText: string): string | null {
  let body: unknown;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return null;
  }
  const error = (body as { error?: { status?: unknown; code?: unknown; type?: unknown } } | null)?.error;
  for (const candidate of [error?.status, error?.code, error?.type]) {
    if (typeof candidate === "string" && /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(candidate)) return candidate;
  }
  return null;
}

function providerLimit(response: Response, bodyText: string): ProviderLimit {
  let body: { error?: { message?: unknown; details?: unknown } } = {};
  try { body = JSON.parse(bodyText) ?? {}; } catch { body = {}; }
  const error = body.error;
  const details = Array.isArray(error?.details) ? error.details : [];
  let retryMs = retryAfterMilliseconds(response);
  const metrics: string[] = [];
  let zeroAllowance = false;
  for (const detail of details) {
    if (!detail || typeof detail !== 'object') continue;
    if (detail['@type'] === 'type.googleapis.com/google.rpc.RetryInfo' && typeof detail.retryDelay === 'string') {
      const seconds = /^(\d+(?:\.\d+)?)s$/.exec(detail.retryDelay);
      if (seconds && Number.isFinite(Number(seconds[1]))) retryMs ??= Number(seconds[1]) * 1000;
    }
    if (detail['@type'] === 'type.googleapis.com/google.rpc.QuotaFailure' && Array.isArray(detail.violations)) {
      for (const violation of detail.violations) {
        if (violation?.quotaValue === '0' || violation?.quotaValue === 0) zeroAllowance = true;
        for (const value of [violation?.quotaMetric, violation?.quotaId]) {
          if (typeof value === 'string' && /^[A-Za-z0-9_./-]{1,200}$/.test(value)) metrics.push(value);
        }
      }
    }
  }
  const code = safeProviderErrorCode(bodyText) ?? undefined;
  const message = typeof error?.message === 'string' ? error.message : '';
  const daily = metrics.some((metric) => /per.?day|daily/i.test(metric));
  const quota = daily || zeroAllowance || code === 'insufficient_quota' || code === 'billing_hard_limit_reached';
  const oversized = /request too large|requested\s+\d+.*(?:exceeds|larger than)|reduce.*(?:input|prompt|token).*size/i.test(message);
  const kind = quota ? 'quota' : oversized ? 'request-size' : retryMs !== null || metrics.some((metric) => /per.?minute/i.test(metric)) ? 'rate' : 'unknown';
  return { kind, ...(code ? { code } : {}),
    ...(retryMs !== null && Number.isFinite(retryMs) ? { retryAt: Date.now() + retryMs } : {}) };
}

function limitMessage(limit: ProviderLimit, attempts: number): string {
  const status = `(status 429, ${attempts} ${attempts === 1 ? 'attempt' : 'attempts'})`;
  const code = limit.code ? ` Código do provedor: ${limit.code}.` : '';
  const wait = limit.retryAt !== undefined ? ` Aguarde cerca de ${Math.max(1, Math.ceil((limit.retryAt - Date.now()) / 1000))} segundos antes de retomar.` : '';
  if (limit.kind === 'quota') return `A quota de uso ou faturamento do provedor foi esgotada ${status}.${code} Retentativas imediatas não liberam a quota; confira os limites da conta ou use outro modelo/provedor.${wait}`;
  if (limit.kind === 'request-size') return `Esta requisição excede o limite de tokens do provedor ${status}.${code} Aguardar não reduz seu tamanho; use um modelo/provedor com capacidade maior.`;
  return `The AI provider rate limit or quota was reached ${status}.${code}${wait || ' O provedor não informou quando o limite libera; confira a quota da conta antes de repetir.'}`;
}

function providerResponseMessage(status: number, bodyText: string): string {
  if (status === 503) {
    return "The AI model is temporarily unavailable after five attempts (status 503). Try again shortly or choose another model.";
  }
  const code = safeProviderErrorCode(bodyText);
  const suffix = code ? ` (provider code: ${code})` : "";
  if (status === 401 || status === 403) {
    return `The AI provider rejected the credentials (status ${status})${suffix}. Check the API key in the AI provider settings.`;
  }
  if (status === 404) {
    return `The AI endpoint or model was not found (status 404)${suffix}. Check the Base URL and model name.`;
  }
  if (status === 400) {
    return `The AI provider rejected the request (status 400)${suffix}. Check the model access and request format; the output schema may contain unsupported rules.`;
  }
  return `The AI provider request failed with status ${status}${suffix}.`;
}

export class OpenAICompatibleProvider implements LLMProvider {
  readonly id = "openai-compatible";
  readonly model: string;
  readonly maxOutputTokens = DEFAULT_MAX_COMPLETION_TOKENS;

  private readonly config: OpenAICompatibleConfig;
  private readonly chatCompletionsUrl: string;
  private readonly geminiEndpoint: boolean;
  private readonly fetchImpl: FetchLike;
  private readonly sleepImpl: SleepLike;
  private readonly random: () => number;
  private state: OpenAICompatibleProviderState = { phase: "idle" };
  private readonly listeners = new Set<OpenAICompatibleStateListener>();
  private inFlight: AbortController | null = null;
  private limit: ProviderLimit | null = null;

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
    this.model = config.model.trim();
    this.chatCompletionsUrl = toChatCompletionsUrl(config.baseUrl);
    this.geminiEndpoint = isGeminiEndpoint(config.baseUrl);
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
    if (this.limit?.retryAt !== undefined && this.limit.retryAt > Date.now()) {
      throw new ProviderRequestError(limitMessage(this.limit, 0), { limit: this.limit });
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
          response_format: { type: "json_schema", json_schema: { name: "model_plan", schema: this.geminiEndpoint ? toGeminiSchema(schema) : stripDescriptions(schema) } },
          // Gemini 3 models are tuned for their default sampling temperature.
          // In particular, CAD generation requests used to send temperature 0.
          temperature: this.geminiEndpoint ? undefined : options?.temperature,
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
          max_completion_tokens: Math.min(options?.maxTokens ?? DEFAULT_MAX_COMPLETION_TOKENS, this.maxOutputTokens),
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

        if (response.ok) { this.limit = null; break; }

        const bodyText = await response.text().catch(() => "");
        if (response.status === 429) {
          const limit = providerLimit(response, bodyText);
          const retryAfter = limit.retryAt === undefined ? null : Math.max(0, limit.retryAt - Date.now());
          if (limit.kind === 'rate' && attempt === 0 && retryAfter !== null && retryAfter <= MAX_RATE_LIMIT_WAIT_MS) {
            await this.sleepImpl(retryAfter, controller.signal);
            continue;
          }
          this.limit = limit;
          throw new ProviderRequestError(limitMessage(limit, attempt + 1), { limit });
        }
        if (!isTransientStatus(response.status) || attempt === MAX_TRANSIENT_RETRIES) {
          throw new ProviderRequestError(providerResponseMessage(response.status, bodyText));
        }

        const delay = retryAfterMilliseconds(response) ?? exponentialDelayMilliseconds(attempt, this.random);
        await this.sleepImpl(delay, controller.signal);
      }

      if (response === null) throw new ProviderRequestError("The AI provider returned no response.");

      const body = (await response.json()) as {
        choices?: { message?: { content?: string | null }; finish_reason?: string | null }[];
        usage?: unknown;
      };
      const choice = body.choices?.[0];
      return parseStructuredCompletion(
        choice?.message?.content,
        { finishReason: choice?.finish_reason, usage: readCompletionUsage(body.usage) },
        options?.onCompletion,
      ) as T;
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
