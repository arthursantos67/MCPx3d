/**
 * Loads and runs the local WebLLM model in a Web Worker, off the main thread
 * (PRD §3.1, §3.6, FR-28, NFR-04/NFR-05, Issue #16).
 *
 * `WebLlmRuntime` only orchestrates *when* the engine is created and how its
 * status is exposed -- the actual model download/inference always happens
 * inside the worker created by `createWorker` (the real one, in
 * `createWebLlmRuntime` below, points at `webllm.worker.ts`, which hosts
 * `@mlc-ai/web-llm`'s own `WebWorkerMLCEngineHandler`). The main thread never
 * blocks on model init: `CreateWebWorkerMLCEngine` resolves by relaying
 * postMessage progress events, not by running the load itself.
 *
 * `detectCapability`/`createWorker`/`createEngine` are injected so this can
 * be unit-tested without a browser, a GPU, or a network model download --
 * mirroring how `apps/api`'s services take an `X3DMcpClient` rather than
 * reaching for a global one.
 */

import {
  detectWebGpuCapability,
  type WebGpuCapability,
} from "./webgpu-capability.ts";
import { DEFAULT_WEBLLM_MODEL_ID } from "./model-config.ts";

export interface WebLlmInitProgress {
  readonly progress: number;
  readonly text: string;
  readonly timeElapsed: number;
}

export type WebLlmStatus =
  | { readonly phase: "idle" }
  | { readonly phase: "unsupported"; readonly reason: string }
  | { readonly phase: "loading"; readonly progress: WebLlmInitProgress }
  | { readonly phase: "ready" }
  | { readonly phase: "error"; readonly message: string };

/** The subset of `MLCEngineInterface` this module actually calls. */
export interface WebLlmEngineLike {
  interruptGenerate?(): void;
}

export type CreateWebLlmEngine = (
  worker: unknown,
  modelId: string,
  options: { initProgressCallback: (report: WebLlmInitProgress) => void },
) => Promise<WebLlmEngineLike>;

export type DetectCapability = () => Promise<WebGpuCapability>;
export type CreateWorker = () => unknown;
export type StatusListener = (status: WebLlmStatus) => void;

export class WebLlmRuntime {
  private readonly modelId: string;
  private readonly detectCapability: DetectCapability;
  private readonly createWorker: CreateWorker;
  private readonly createEngine: CreateWebLlmEngine;
  private status: WebLlmStatus = { phase: "idle" };
  private readonly listeners = new Set<StatusListener>();
  private engine: WebLlmEngineLike | null = null;

  constructor(
    modelId: string,
    detectCapability: DetectCapability,
    createWorker: CreateWorker,
    createEngine: CreateWebLlmEngine,
  ) {
    this.modelId = modelId;
    this.detectCapability = detectCapability;
    this.createWorker = createWorker;
    this.createEngine = createEngine;
  }

  getStatus(): WebLlmStatus {
    return this.status;
  }

  /** Subscribes to status changes; returns an unsubscribe function. */
  onStatusChange(listener: StatusListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Detects WebGPU capability first (Issue #15) -- if unsupported, the
   * engine/worker are never created, so an unsupported device never
   * triggers a model download. Never throws: failures land in status as
   * `{ phase: "error" }` so a caller reading `getStatus()`/subscribing to
   * `onStatusChange` is the only thing that needs to react.
   */
  async initialize(): Promise<void> {
    const capability = await this.detectCapability();
    if (capability.status === "unsupported") {
      this.setStatus({ phase: "unsupported", reason: capability.reason });
      return;
    }

    this.setStatus({
      phase: "loading",
      progress: { progress: 0, text: "", timeElapsed: 0 },
    });

    try {
      const worker = this.createWorker();
      this.engine = await this.createEngine(worker, this.modelId, {
        initProgressCallback: (progress) => {
          this.setStatus({ phase: "loading", progress });
        },
      });
      this.setStatus({ phase: "ready" });
    } catch (error) {
      this.setStatus({
        phase: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** Cancels in-progress generation, if the loaded engine supports it (FR-33). */
  cancel(): void {
    this.engine?.interruptGenerate?.();
  }

  private setStatus(status: WebLlmStatus): void {
    this.status = status;
    for (const listener of this.listeners) {
      listener(status);
    }
  }
}

/** Production wiring: real WebGPU detection, a real Worker, real WebLLM. */
export function createWebLlmRuntime(
  modelId: string = DEFAULT_WEBLLM_MODEL_ID,
): WebLlmRuntime {
  return new WebLlmRuntime(
    modelId,
    detectWebGpuCapability,
    () => new Worker(new URL("./webllm.worker.ts", import.meta.url), { type: "module" }),
    async (worker, id, options) => {
      const { CreateWebWorkerMLCEngine } = await import("@mlc-ai/web-llm");
      return CreateWebWorkerMLCEngine(worker, id, options);
    },
  );
}
