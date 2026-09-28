/**
 * Chat state machine wiring a user prompt to local ModelPlan generation and
 * the apply-plan API call (PRD §3.10/§10.2, Issue #27). Framework-agnostic
 * (no React) so it is unit-testable with `node --test` against a fake
 * `AgentProvider` (built on `packages/agent`'s own `MockLLMProvider`, no
 * WebGPU/browser/model download needed) and a fake `ChatApi`, matching this
 * repository's existing testing convention. `useChatController.ts` is the
 * thin React wrapper (`useSyncExternalStore`, mirroring
 * `apps/web/src/ai/useWebLlmRuntime.ts`'s existing pattern for the same kind
 * of externally-mutated status).
 *
 * `AgentProvider` -- `LLMProvider` (PRD §3.7) plus a status pair
 * (`getState()`/`onStateChange()`) reported in this module's own `AgentStatus`
 * shape (`./types.ts`), not `packages/agent`'s `WebLLMProviderState` -- is a
 * structural interface, not the concrete `WebLLMProvider` class, for two
 * reasons: (1) `WebLLMProvider` has private fields, so only a real instance
 * (constructed with a real worker/engine) could otherwise be passed here, and
 * (2) keeping `WebLLMProviderState` (and its transitive `@mlc-ai/web-llm`
 * type imports) out of this file and its tests avoids a real issue under
 * `apps/web/tsconfig.test.json`'s `moduleResolution: "nodenext"`: TS cannot
 * resolve `@mlc-ai/web-llm`'s re-exported `ChatCompletionMessageParam`
 * through `webllm-provider.ts` under `nodenext` (the same problem
 * `packages/agent/tsconfig.json`'s own comment documents, which is why that
 * package uses `"bundler"` instead) -- `useChatController.ts` (compiled under
 * `tsconfig.app.json`'s `"bundler"` resolution, where this already works)
 * is the one place that adapts a real `WebLLMProvider` into this shape.
 * Production wiring still only ever constructs this with
 * `createWebLLMProvider()` (PRD §3.6's one required provider).
 */

import type { ApplyPlanRequestBody, ApplyPlanResponse } from "../api/client.ts";
import { ApiError } from "../api/client.ts";
import type { AgentMessage, LLMProvider } from "../../../../packages/agent/src/provider.ts";
import { ModelPlanGenerationError } from "../../../../packages/agent/src/generate-model-plan.ts";
import {
  SceneBatchError,
  createSceneGenerationCounters,
  generateScene,
  type SceneGenerationCounters,
  type SceneOutcome,
} from "../../../../packages/agent/src/generate-scene.ts";
import type { ModelSpec } from "../../../../packages/domain/ts/src/model-spec.ts";

import type {
  AgentStatus,
  ChatControllerState,
  ChatMessage,
  ChatMessageRole,
  GenerationStats,
  SendGate,
} from "./types.ts";

export interface AgentProvider extends LLMProvider {
  getState(): AgentStatus;
  onStateChange(listener: (state: AgentStatus) => void): () => void;
}

export interface ChatApi {
  createProject(): Promise<ModelSpec>;
  applyPlan(projectId: string, body: ApplyPlanRequestBody, signal?: AbortSignal): Promise<ApplyPlanResponse>;
  deleteProject(projectId: string): Promise<void>;
  updateSceneTitle?(projectId: string, expectedRevision: number, title: string): Promise<ModelSpec>;
  resolveArtifactUrl(relativeUrl: string): string;
}

export type { ChatControllerState };

export interface ChatControllerOptions {
  readonly now?: () => number;
  readonly makeId?: () => string;
}

let anonymousIdCounter = 0;
function defaultMakeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  anonymousIdCounter += 1;
  return `id_${anonymousIdCounter}`;
}

function describeProviderState(state: AgentStatus): string | null {
  return state.progressText ?? state.reason ?? null;
}

function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    return error.correlationId ? `${error.message} (ref ${error.correlationId})` : error.message;
  }
  if (error instanceof SceneBatchError && error.cause instanceof ApiError && error.cause.correlationId) {
    return `${error.message} (ref ${error.cause.correlationId})`;
  }
  if (error instanceof ModelPlanGenerationError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}

function summarizeApplyResult(response: ApplyPlanResponse): string {
  const warningCount = response.validation.warnings.length;
  const warningNote = warningCount > 0 ? ` with ${warningCount} warning(s)` : "";
  return `Updated the model to revision ${response.revision}${warningNote}.`;
}

function summarizeBatchedResult(outcome: SceneOutcome & { status: "applied" }): string {
  const summary = `Built the scene in ${outcome.batches} validated batches; revision ${outcome.modelSpec.revision} is active.`;
  const skipped = outcome.skippedBatches.map(({ batch, reason }) => ` Batch ${batch} was skipped: ${reason}`).join("");
  const limit = outcome.complete
    ? ""
    : " The batch limit was reached before the scene was finished -- ask for the remaining parts in a follow-up request.";
  return `${summary}${skipped}${limit}`;
}

function separatedPartCount(response: ApplyPlanResponse): number {
  return response.validation.autofixes.filter((fix) => fix.type === "overlap_separation").length;
}

const EMPTY_GENERATION_STATS: GenerationStats = {
  requests: 0,
  truncatedRequests: 0,
  recoveredRequests: 0,
  continuedRequests: 0,
  localRepairs: 0,
  formatRepairs: 0,
  applyRepairs: 0,
  finalValidScenes: 0,
  skippedBatches: 0,
  overlapResolutions: 0,
  validationFailures: {},
};

function failureSource(error: unknown): "provider" | "modeling" | "mcp" | "session" {
  if (error instanceof ModelPlanGenerationError) return "provider";
  if (error instanceof ApiError && error.code === "MCP_UNAVAILABLE") return "mcp";
  if (error instanceof ApiError && error.code === "PROJECT_NOT_FOUND") return "session";
  return "modeling";
}

const REPAIRABLE_APPLY_ERROR_CODES = new Set([
  "DOMAIN_VALIDATION_FAILED",
  "UNKNOWN_TARGET",
  "UNINTENDED_OVERLAP",
  "X3D_VALIDATION_FAILED",
]);

function isRepairableApplyError(error: unknown): error is ApiError {
  return error instanceof ApiError && error.status === 422 && REPAIRABLE_APPLY_ERROR_CODES.has(error.code);
}

export class ChatController {
  private state: ChatControllerState;
  private readonly listeners = new Set<() => void>();
  private readonly provider: AgentProvider;
  private readonly api: ChatApi;
  private readonly now: () => number;
  private readonly makeId: () => string;
  private initialization: Promise<void> | null = null;
  private readonly unsubscribeProvider: () => void;
  private activeCancellation: AbortController | null = null;

  constructor(provider: AgentProvider, api: ChatApi, options?: ChatControllerOptions) {
    this.provider = provider;
    this.api = api;
    this.now = options?.now ?? (() => Date.now());
    this.makeId = options?.makeId ?? defaultMakeId;

    const initial = provider.getState();
    this.state = {
      messages: [],
      modelSpec: null,
      previewUrl: null,
      agentPhase: initial.phase,
      agentProvider: provider.id,
      agentDetail: describeProviderState(initial),
      isBusy: false,
      projectId: null,
      projectError: null,
      projectName: "Untitled model",
      artifacts: [],
      validation: null,
      correlationId: null,
      requestStatus: "idle",
      failureSource: null,
      pipelineStage: "idle",
      pipelineStartedAt: null,
      timings: {},
      sceneBatch: null,
      generationStats: {},
    };

    this.unsubscribeProvider = provider.onStateChange((next) => {
      this.patch({ agentPhase: next.phase, agentDetail: describeProviderState(next) });
    });
  }

  getState(): ChatControllerState {
    return this.state;
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Starts WebLLM initialization and creates a project session; both run independently. */
  async initialize(): Promise<void> {
    this.initialization ??= this.startInitialization();
    await this.initialization;
  }

  dispose(): void {
    this.unsubscribeProvider();
    this.cancelGeneration();
  }

  cancelGeneration(): void {
    const cancellation = this.activeCancellation;
    if (cancellation === null) return;
    cancellation.abort();
    this.activeCancellation = null;
    void this.provider.cancel?.();
    this.patch({
      isBusy: false,
      requestStatus: "cancelled",
      failureSource: null,
      pipelineStage: "ready",
      pipelineStartedAt: null,
      sceneBatch: null,
    });
  }

  async retryProject(): Promise<void> {
    try {
      const modelSpec = await this.api.createProject();
      const recreatingExpiredProject = this.state.requestStatus === "session-expired";
      this.patch({
        modelSpec,
        projectName: modelSpec.scene.title ?? "Untitled model",
        projectId: modelSpec.projectId,
        projectError: null,
        messages: recreatingExpiredProject ? [] : this.state.messages,
        previewUrl: recreatingExpiredProject ? null : this.state.previewUrl,
        artifacts: recreatingExpiredProject ? [] : this.state.artifacts,
        validation: recreatingExpiredProject ? null : this.state.validation,
        correlationId: recreatingExpiredProject ? null : this.state.correlationId,
        requestStatus: "idle",
        failureSource: null,
        pipelineStage: "idle",
        pipelineStartedAt: null,
        timings: recreatingExpiredProject ? {} : this.state.timings,
      });
    } catch (error) {
      this.patch({ projectError: describeError(error) });
    }
  }

  renameProject(name: string): void {
    this.patch({ projectName: name.trim().slice(0, 80) || "Untitled model" });
  }

  async persistProjectName(): Promise<void> {
    const modelSpec = this.state.modelSpec;
    const projectId = this.state.projectId;
    if (!modelSpec || !projectId || !this.api.updateSceneTitle) return;
    try {
      const updated = await this.api.updateSceneTitle(projectId, modelSpec.revision, this.state.projectName);
      this.patch({ modelSpec: updated, projectName: updated.scene.title ?? "Untitled model" });
    } catch (error) {
      this.appendMessage("error", describeError(error));
    }
  }

  async resetProject(): Promise<void> {
    const projectId = this.state.projectId;
    this.patch({
      messages: [],
      modelSpec: null,
      previewUrl: null,
      projectId: null,
      projectError: null,
      artifacts: [],
      validation: null,
      correlationId: null,
      requestStatus: "idle",
      failureSource: null,
      pipelineStage: "idle",
      pipelineStartedAt: null,
      timings: {},
      projectName: "Untitled model",
    });
    if (projectId) {
      try {
        await this.api.deleteProject(projectId);
      } catch (error) {
        if (!(error instanceof ApiError && error.code === "PROJECT_NOT_FOUND")) {
          this.appendMessage("error", describeError(error));
        }
      }
    }
    await this.retryProject();
  }

  setViewerStatus(status: "artifact-generation" | "loading" | "ready" | "failed"): void {
    if (status === "artifact-generation") {
      this.patch({ pipelineStage: "artifact-generation" });
      return;
    }
    if (status === "loading") {
      this.patch({ pipelineStage: "viewer-loading" });
      return;
    }
    this.patch({ pipelineStage: status === "ready" ? "ready" : "failed" });
  }

  private async startInitialization(): Promise<void> {
    this.provider.initialize().catch(() => {
      // WebLLMProvider's own contract is "never throws: failures land in state"
      // (see its onStateChange subscription above); this catch only guards
      // against an unhandled-rejection warning if that contract is ever broken.
    });

    try {
      await this.retryProject();
    } catch (error) {
      this.patch({ projectError: describeError(error) });
    }
  }

  canSend(): SendGate {
    if (this.state.isBusy) {
      return { canSend: false, reason: "A request is already in progress." };
    }
    if (this.state.projectError) {
      return { canSend: false, reason: "No project session is available." };
    }
    if (!this.state.modelSpec || !this.state.projectId) {
      return { canSend: false, reason: "Starting a new project…" };
    }
    if (this.state.agentPhase !== "ready") {
      return { canSend: false, reason: this.state.agentDetail ?? "Local AI is still starting up." };
    }
    return { canSend: true };
  }

  async sendMessage(text: string): Promise<void> {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    if (!this.canSend().canSend) return;

    const modelSpec = this.state.modelSpec;
    const projectId = this.state.projectId;
    if (!modelSpec || !projectId) return;

    const recentMessages = this.recentAgentMessages();
    this.appendMessage("user", trimmed);

    const startedAt = this.now();
    this.patch({
      isBusy: true,
      requestStatus: "working",
      failureSource: null,
      pipelineStage: "provider-request",
      pipelineStartedAt: startedAt,
      timings: {},
      sceneBatch: null,
    });
    const cancellation = new AbortController();
    this.activeCancellation = cancellation;

    const counters = createSceneGenerationCounters();
    let finalValidScene = false;
    let applyMs = 0;
    let separatedParts = 0;
    let lastResponse: ApplyPlanResponse | null = null;
    const providerRequestMs = (): number => Math.max(0, this.now() - startedAt - applyMs);

    try {
      const outcome = await generateScene({
        provider: this.provider,
        request: trimmed,
        modelSpec,
        recentMessages,
        signal: cancellation.signal,
        counters,
        describeRepairableApplyError: (error) =>
          isRepairableApplyError(error) ? `${error.code}: ${error.message}` : null,
        onProgress: (progress) => {
          if (cancellation.signal.aborted) return;
          this.patch({
            pipelineStage: progress.stage === "generating" ? "provider-request" : "plan-validation",
            sceneBatch: progress.batch > 0
              ? { batch: progress.batch, maxBatches: progress.maxBatches, committedBatches: progress.committedBatches }
              : null,
          });
        },
        applyPlan: async (plan, current, { resolveOverlaps }) => {
          this.patch({ pipelineStage: "api-mcp-build" });
          const applyStartedAt = this.now();
          try {
            const response = await this.api.applyPlan(projectId, {
              expectedRevision: current.revision,
              requestId: this.makeId(),
              plan,
              ...(resolveOverlaps ? { resolveOverlaps } : {}),
            }, cancellation.signal);
            lastResponse = response;
            separatedParts += separatedPartCount(response);
            this.commitApplyResponse(response, current);
            return response.modelSpec;
          } finally {
            applyMs += Math.max(0, this.now() - applyStartedAt);
          }
        },
      });

      if (cancellation.signal.aborted || outcome.status === "cancelled") return;

      if (outcome.status === "clarify") {
        this.patch({
          isBusy: false,
          requestStatus: "succeeded",
          pipelineStage: "ready",
          sceneBatch: null,
          timings: { provider_request: providerRequestMs() },
        });
        this.appendMessage("assistant", outcome.question);
        return;
      }

      finalValidScene = outcome.complete && outcome.skippedBatches.length === 0;
      const response = lastResponse as ApplyPlanResponse | null;
      const unchanged = outcome.modelSpec.revision === modelSpec.revision;
      this.patch({
        isBusy: false,
        sceneBatch: null,
        timings: { provider_request: providerRequestMs(), ...response?.timings },
        requestStatus: unchanged ? "no-change" : "succeeded",
        pipelineStage: unchanged ? "ready" : "x3d-validation",
      });
      const separatedNote = separatedParts > 0
        ? ` ${separatedParts} part(s) were moved automatically so no parts overlap.`
        : "";
      this.appendMessage(
        "assistant",
        unchanged
          ? "No model changes were needed; the current revision remains active."
          : `${outcome.batches > 0 || response === null ? summarizeBatchedResult(outcome) : summarizeApplyResult(response)}${separatedNote}`,
      );
    } catch (error) {
      if (cancellation.signal.aborted) return;
      const cause = error instanceof SceneBatchError ? error.cause : error;
      const source = failureSource(cause);
      this.patch({
        isBusy: false,
        projectError: source === "session" ? describeError(cause) : this.state.projectError,
        correlationId: cause instanceof ApiError ? cause.correlationId : this.state.correlationId,
        requestStatus: source === "session" ? "session-expired" : "failed",
        failureSource: source,
        pipelineStage: "failed",
        sceneBatch: null,
        timings: { provider_request: providerRequestMs() },
      });
      this.appendMessage("error", describeError(error));
    } finally {
      if (this.activeCancellation === cancellation) this.activeCancellation = null;
      this.recordGenerationStats(counters, finalValidScene);
    }
  }

  /** Every successful apply is a committed, validated revision -- including an
   * earlier batch of a request that later fails or is cancelled -- so the
   * model and preview always follow the server's last valid revision. */
  private commitApplyResponse(response: ApplyPlanResponse, base: ModelSpec): void {
    const unchanged = response.revision === base.revision;
    this.patch({
      modelSpec: unchanged ? this.state.modelSpec : response.modelSpec,
      projectName: response.modelSpec.scene.title ?? this.state.projectName,
      previewUrl: unchanged
        ? this.state.previewUrl
        : response.preview
          ? this.api.resolveArtifactUrl(response.preview.url)
          : this.state.previewUrl,
      artifacts: response.artifacts,
      validation: response.validation,
      correlationId: response.correlationId,
    });
  }

  private recordGenerationStats(counters: SceneGenerationCounters, finalValidScene: boolean): void {
    const key = `${this.provider.id}/${this.provider.model ?? "default"}`;
    const current = this.state.generationStats[key] ?? EMPTY_GENERATION_STATS;
    const truncated = counters.truncations > 0;
    this.patch({
      generationStats: {
        ...this.state.generationStats,
        [key]: {
          requests: current.requests + 1,
          truncatedRequests: current.truncatedRequests + (truncated ? 1 : 0),
          recoveredRequests: current.recoveredRequests + (truncated && finalValidScene ? 1 : 0),
          continuedRequests: current.continuedRequests + (counters.continued ? 1 : 0),
          localRepairs: current.localRepairs + counters.localRepairs,
          formatRepairs: current.formatRepairs + counters.formatRepairs,
          applyRepairs: current.applyRepairs + counters.applyRepairs,
          finalValidScenes: current.finalValidScenes + (finalValidScene ? 1 : 0),
          skippedBatches: current.skippedBatches + counters.skippedBatches,
          overlapResolutions: current.overlapResolutions + counters.overlapResolutions,
          validationFailures: Object.fromEntries(
            [...new Set([...Object.keys(current.validationFailures), ...Object.keys(counters.validationFailures)])].map((category) => [
              category,
              (current.validationFailures[category] ?? 0) +
                (counters.validationFailures[category as keyof typeof counters.validationFailures] ?? 0),
            ]),
          ),
        },
      },
    });
  }

  private appendMessage(role: ChatMessageRole, text: string): void {
    const message: ChatMessage = { id: this.makeId(), role, text, createdAt: this.now() };
    this.patch({ messages: [...this.state.messages, message] });
  }

  private recentAgentMessages(): readonly AgentMessage[] {
    return this.state.messages
      .filter(
        (message): message is ChatMessage & { role: "user" | "assistant" } =>
          message.role === "user" || message.role === "assistant",
      )
      .slice(-12)
      .map((message) => ({ role: message.role, content: message.text }));
  }

  private patch(partial: Partial<ChatControllerState>): void {
    this.state = { ...this.state, ...partial };
    for (const listener of this.listeners) listener();
  }
}
