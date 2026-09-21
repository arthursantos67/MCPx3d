/**
 * `WebLLMProvider`: the required `LLMProvider` implementation (PRD §3.6/§3.7,
 * FR-27/FR-28, Issue #18), running `@mlc-ai/web-llm` in a Web Worker so
 * model download/inference never blocks the caller's thread. JSON-mode
 * structured generation uses WebLLM's own `response_format: { type:
 * "json_object", schema }` (see `@mlc-ai/web-llm`'s
 * `ChatCompletionRequestBase.response_format`) rather than free-text
 * prompting plus hopeful parsing.
 *
 * `detectWebGpu`/`createWorker`/`createEngine` are injected (mirroring
 * `apps/web/src/ai/webllm-runtime.ts`'s Issue #16 DI pattern) so this can be
 * unit-tested without a browser, a GPU, or a network model download.
 * This is intentionally a separate implementation from that Issue #16 spike
 * code, not a reuse of it: `apps/web/src/ai/*` was Phase-0 spike code (PRD
 * §14.1) built before this package existed and is not wired into any UI yet,
 * while FR-27 assigns "the provider package" (this one, per the repository
 * layout table) as the only place allowed to call WebLLM directly. Future
 * chat UI work (Issue #27) should depend on this provider, not on
 * `apps/web/src/ai/webllm-runtime.ts`.
 */

import type { ChatCompletionMessageParam, MLCEngineInterface } from "@mlc-ai/web-llm";

import type { AgentMessage, GenerationOptions, JsonSchema, LLMProvider } from "./provider.ts";
import { DEFAULT_WEBLLM_MODEL_ID } from "./model-config.ts";

export interface WebLlmInitProgress {
  readonly progress: number;
  readonly text: string;
  readonly timeElapsed: number;
}

export type WebLLMProviderState =
  | { readonly phase: "idle" }
  | { readonly phase: "unsupported"; readonly reason: string }
  | { readonly phase: "loading"; readonly progress: WebLlmInitProgress }
  | { readonly phase: "ready" }
  | { readonly phase: "generating" }
  | { readonly phase: "error"; readonly message: string };

export interface WebGpuCapabilityResult {
  readonly available: boolean;
  readonly reason?: string;
}

export type DetectWebGpu = () => Promise<WebGpuCapabilityResult>;
export type CreateWorker = () => unknown;
export type CreateWebLlmEngine = (
  worker: unknown,
  modelId: string,
  options: { initProgressCallback: (report: WebLlmInitProgress) => void },
) => Promise<MLCEngineInterface>;

export type StateListener = (state: WebLLMProviderState) => void;

const NO_WEBGPU_REASON =
  "This browser or device doesn't support WebGPU, so the built-in local AI mode can't run here. The 3D viewer and manual editing are unaffected.";
const NO_ADAPTER_REASON =
  "WebGPU is present but no compatible graphics adapter was found, so the built-in local AI mode can't run here. The 3D viewer and manual editing are unaffected.";

export class WebLLMProvider implements LLMProvider {
  readonly id = "webllm";

  private readonly modelId: string;
  private readonly detectWebGpu: DetectWebGpu;
  private readonly createWorker: CreateWorker;
  private readonly createEngine: CreateWebLlmEngine;
  private state: WebLLMProviderState = { phase: "idle" };
  private readonly listeners = new Set<StateListener>();
  private engine: MLCEngineInterface | null = null;

  constructor(
    modelId: string,
    detectWebGpu: DetectWebGpu,
    createWorker: CreateWorker,
    createEngine: CreateWebLlmEngine,
  ) {
    this.modelId = modelId;
    this.detectWebGpu = detectWebGpu;
    this.createWorker = createWorker;
    this.createEngine = createEngine;
  }

  /** The provider's own richer status, beyond the boolean `LLMProvider.isAvailable()`. */
  getState(): WebLLMProviderState {
    return this.state;
  }

  onStateChange(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async isAvailable(): Promise<boolean> {
    const capability = await this.detectWebGpu();
    return capability.available;
  }

  /** Never throws: failures land in state as `{ phase: "error" }`/`{ phase: "unsupported" }`. */
  async initialize(): Promise<void> {
    const capability = await this.detectWebGpu();
    if (!capability.available) {
      this.setState({ phase: "unsupported", reason: capability.reason ?? NO_WEBGPU_REASON });
      return;
    }

    this.setState({ phase: "loading", progress: { progress: 0, text: "", timeElapsed: 0 } });

    try {
      const worker = this.createWorker();
      this.engine = await this.createEngine(worker, this.modelId, {
        initProgressCallback: (progress) => {
          this.setState({ phase: "loading", progress });
        },
      });
      this.setState({ phase: "ready" });
    } catch (error) {
      this.setState({ phase: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }

  async generateStructured<T>(
    messages: readonly AgentMessage[],
    schema: JsonSchema,
    options?: GenerationOptions,
  ): Promise<T> {
    if (!this.engine || this.state.phase !== "ready") {
      throw new Error(`WebLLMProvider.generateStructured called while not ready (phase: ${this.state.phase})`);
    }

    this.setState({ phase: "generating" });
    try {
      const completion = await this.engine.chat.completions.create({
        messages: toWebLlmMessages(messages),
        response_format: { type: "json_object", schema: JSON.stringify(schema) },
        temperature: options?.temperature,
        max_tokens: options?.maxTokens,
      });
      const content = completion.choices[0]?.message.content;
      if (content == null) {
        throw new Error("WebLLM returned an empty response");
      }
      return JSON.parse(content) as T;
    } finally {
      this.setState({ phase: "ready" });
    }
  }

  async cancel(): Promise<void> {
    this.engine?.interruptGenerate();
  }

  private setState(state: WebLLMProviderState): void {
    this.state = state;
    for (const listener of this.listeners) listener(state);
  }
}

function toWebLlmMessages(messages: readonly AgentMessage[]): ChatCompletionMessageParam[] {
  return messages.map((message): ChatCompletionMessageParam => {
    switch (message.role) {
      case "system":
        return { role: "system", content: message.content };
      case "user":
        return { role: "user", content: message.content };
      case "assistant":
        return { role: "assistant", content: message.content };
    }
  });
}

async function detectWebGpu(): Promise<WebGpuCapabilityResult> {
  const nav = navigator as { gpu?: { requestAdapter(): Promise<unknown | null> } };
  if (!nav.gpu) {
    return { available: false, reason: NO_WEBGPU_REASON };
  }
  try {
    const adapter = await nav.gpu.requestAdapter();
    return adapter ? { available: true } : { available: false, reason: NO_ADAPTER_REASON };
  } catch {
    return { available: false, reason: NO_ADAPTER_REASON };
  }
}

/** Production wiring: real WebGPU detection, a real Worker, real WebLLM. */
export function createWebLLMProvider(modelId: string = DEFAULT_WEBLLM_MODEL_ID): WebLLMProvider {
  return new WebLLMProvider(
    modelId,
    detectWebGpu,
    () => new Worker(new URL("./webllm.worker.ts", import.meta.url), { type: "module" }),
    async (worker, id, options) => {
      const { CreateWebWorkerMLCEngine } = await import("@mlc-ai/web-llm");
      return CreateWebWorkerMLCEngine(worker, id, options);
    },
  );
}
