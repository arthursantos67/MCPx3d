import type { ApplyPlanRequestBody, ApplyPlanResponse, Recipe } from "../api/client.ts";
import { ApiError } from "../api/client.ts";
import type { AgentMessage } from "../../../../packages/agent/src/provider.ts";
import type { AgentProvider } from "../ai/types.ts";
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

export type { AgentProvider } from "../ai/types.ts";

export interface ChatApi {
  createProject(): Promise<ModelSpec>;
  resumeProject?(): Promise<ApplyPlanResponse | null>;
  applyPlan(projectId: string, body: ApplyPlanRequestBody, signal?: AbortSignal): Promise<ApplyPlanResponse>;
  importManifest?(projectId: string, expectedRevision: number, contents: string): Promise<ApplyPlanResponse>;
  deleteProject(projectId: string): Promise<void>;
  updateSceneTitle?(projectId: string, expectedRevision: number, title: string): Promise<ModelSpec>;
  matchRecipe?(query: string): Promise<Recipe | null>;
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
  const warningNote = warningCount > 0 ? `, com ${warningCount} aviso(s)` : "";
  return `Modelo atualizado para a revisão ${response.revision}${warningNote}.`;
}

function summarizeBatchedResult(outcome: SceneOutcome & { status: "applied" }): string {
  const summary = `Cena construída em ${outcome.batches} etapas validadas; revisão ${outcome.modelSpec.revision} ativa.`;
  const skipped = outcome.skippedBatches.map(({ batch, reason }) => ` Etapa ${batch} ignorada: ${reason}`).join("");
  const limit = outcome.complete
    ? ""
    : " O limite de etapas foi atingido. Peça os componentes restantes em uma nova mensagem.";
  return `${summary}${skipped}${limit}`;
}

function separatedPartCount(response: ApplyPlanResponse): number {
  return response.validation.autofixes.filter((fix) => fix.type === "overlap_separation").length;
}

export interface SceneRequestOptions {
  readonly overlapPolicy?: 'visual' | 'strict';
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

function applyRejectionDiagnostic(error: unknown): string | null {
  if (!isRepairableApplyError(error)) return null;
  const message = `${error.code}: ${error.message}`;
  if (!Array.isArray(error.details)) return message;
  const report = error.details.find((item: unknown) => item && typeof item === 'object' &&
    'check' in item && item.check === 'x3d_layout' && 'schemaVersion' in item && item.schemaVersion === '1.0');
  if (!report || !Array.isArray(report.pairs)) return message;
  const pairs = report.pairs.slice(0, 1000).flatMap((pair: unknown) => {
    if (!pair || typeof pair !== 'object' || !('objects' in pair) || !Array.isArray(pair.objects) || pair.objects.length !== 2 ||
        !pair.objects.every((id: unknown) => typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id))) return [];
    return [pair.objects.join('/')];
  });
  return pairs.length ? `${message}\nBounding-box pairs in the structured diagnostic: ${pairs.join('; ')}` : message;
}

export class ChatController {
  private state: ChatControllerState;
  private readonly listeners = new Set<() => void>();
  private provider: AgentProvider;
  private readonly api: ChatApi;
  private readonly now: () => number;
  private readonly makeId: () => string;
  private initialization: Promise<void> | null = null;
  private initialProjectLookup = true;
  private unsubscribeProvider: (() => void) | null = null;
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
      projectName: "Novo modelo",
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


  }

  getState(): ChatControllerState {
    return this.state;
  }

  setProvider(provider: AgentProvider): void {
    if (provider === this.provider) return;
    if (this.state.isBusy) throw new Error('Aguarde a geração X3D antes de trocar o provedor.');
    const subscribed = this.unsubscribeProvider !== null;
    this.unsubscribeProvider?.();
    this.unsubscribeProvider = null;
    this.provider = provider;
    const current = provider.getState();
    this.patch({ agentProvider: provider.id, agentPhase: current.phase, agentDetail: describeProviderState(current) });
    if (subscribed) this.unsubscribeProvider = provider.onStateChange((next) => {
      this.patch({ agentPhase: next.phase, agentDetail: describeProviderState(next) });
    });
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Starts WebLLM initialization and creates a project session; both run independently. */
  async initialize(): Promise<void> {
    this.unsubscribeProvider ??= this.provider.onStateChange((next) => {
      this.patch({ agentPhase: next.phase, agentDetail: describeProviderState(next) });
    });
    const current = this.provider.getState();
    this.patch({ agentPhase: current.phase, agentDetail: describeProviderState(current) });
    this.initialization ??= this.startInitialization();
    await this.initialization;
  }

  dispose(): void {
    this.unsubscribeProvider?.();
    this.unsubscribeProvider = null;
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
      const resumed = this.initialProjectLookup ? await this.api.resumeProject?.() ?? null : null;
      const modelSpec = resumed?.modelSpec ?? await this.api.createProject();
      this.initialProjectLookup = false;
      const recreatingExpiredProject = this.state.requestStatus === "session-expired";
      this.patch({
        modelSpec,
        projectName: modelSpec.scene.title ?? "Novo modelo",
        projectId: modelSpec.projectId,
        projectError: null,
        messages: resumed
          ? [{ id: this.makeId(), role: "assistant", text: `Projeto “${modelSpec.scene.title}” recuperado na revisão ${modelSpec.revision}.`, createdAt: this.now() }]
          : recreatingExpiredProject ? [] : this.state.messages,
        previewUrl: resumed?.preview
          ? this.api.resolveArtifactUrl(resumed.preview.url)
          : recreatingExpiredProject ? null : this.state.previewUrl,
        artifacts: resumed?.artifacts ?? (recreatingExpiredProject ? [] : this.state.artifacts),
        validation: resumed?.validation ?? (recreatingExpiredProject ? null : this.state.validation),
        correlationId: resumed?.correlationId ?? (recreatingExpiredProject ? null : this.state.correlationId),
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
    this.patch({ projectName: name.trim().slice(0, 80) || "Novo modelo" });
  }

  async persistProjectName(): Promise<void> {
    const modelSpec = this.state.modelSpec;
    const projectId = this.state.projectId;
    if (!modelSpec || !projectId || !this.api.updateSceneTitle) return;
    try {
      const updated = await this.api.updateSceneTitle(projectId, modelSpec.revision, this.state.projectName);
      this.patch({ modelSpec: updated, projectName: updated.scene.title ?? "Novo modelo" });
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
      projectName: "Novo modelo",
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
    if (this.state.agentPhase !== "ready" && !(
      this.state.modelSpec.objects.length === 0 &&
      this.api.matchRecipe &&
      (this.state.agentPhase === "unsupported" || this.state.agentPhase === "error")
    )) {
      return { canSend: false, reason: this.state.agentDetail ?? "Local AI is still starting up." };
    }
    return { canSend: true };
  }

  async applyRecipe(recipe: Recipe): Promise<void> {
    const spec = this.state.modelSpec;
    const projectId = this.state.projectId;
    if (!spec || !projectId || this.state.isBusy || spec.objects.length > 0) return;
    this.patch({ isBusy: true, requestStatus: "working", pipelineStage: "api-mcp-build", pipelineStartedAt: this.now() });
    try {
      await this.commitRecipe(recipe, spec, projectId);
    } catch (error) {
      this.patch({ requestStatus: "failed", pipelineStage: "failed", failureSource: failureSource(error) });
      this.appendMessage("error", describeError(error));
    } finally {
      this.patch({ isBusy: false });
    }
  }

  async importManifest(contents: string): Promise<void> {
    const spec = this.state.modelSpec;
    const projectId = this.state.projectId;
    if (!spec || !projectId || this.state.isBusy || !this.api.importManifest) return;
    this.patch({ isBusy: true, requestStatus: "working", pipelineStage: "api-mcp-build", pipelineStartedAt: this.now() });
    try {
      const response = await this.api.importManifest(projectId, spec.revision, contents);
      this.commitApplyResponse(response, spec);
      this.patch({
        messages: [],
        requestStatus: "succeeded",
        pipelineStage: "x3d-validation",
        failureSource: null,
        timings: response.timings ?? {},
      });
      this.appendMessage("assistant", `Projeto “${response.modelSpec.scene.title}” importado e validado na revisão ${response.revision}.`);
    } catch (error) {
      this.patch({ requestStatus: "failed", pipelineStage: "failed", failureSource: failureSource(error) });
      this.appendMessage("error", describeError(error));
    } finally {
      this.patch({ isBusy: false });
    }
  }

  private async commitRecipe(recipe: Recipe, spec: ModelSpec, projectId: string, signal?: AbortSignal): Promise<void> {
    if (recipe.units !== spec.units || recipe.displayScale !== spec.scene.displayScale) {
      throw new Error("Recipe units or display scale differ from this project.");
    }
    const response = await this.api.applyPlan(projectId, {
      expectedRevision: spec.revision,
      requestId: this.makeId(),
      plan: recipe.plan,
    }, signal);
    if (signal?.aborted) return;
    this.commitApplyResponse(response, spec);
    this.patch({ requestStatus: "succeeded", pipelineStage: "x3d-validation", failureSource: null, timings: response.timings ?? {} });
    this.appendMessage("assistant", `Modelo “${recipe.name}” aplicado e validado na revisão ${response.revision}.`);
  }

  async sendMessage(text: string, options: SceneRequestOptions = {}): Promise<void> {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    if (!this.canSend().canSend) return;

    const modelSpec = this.state.modelSpec;
    const projectId = this.state.projectId;
    if (!modelSpec || !projectId) return;

    const recentMessages = this.recentAgentMessages();
    const strictNoOverlap = options.overlapPolicy === 'strict';
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
    let attemptedProvider = false;
    const providerRequestMs = (): number => Math.max(0, this.now() - startedAt - applyMs);

    try {
      if (modelSpec.objects.length === 0 && this.api.matchRecipe && !strictNoOverlap) {
        let recipe: Recipe | null = null;
        try {
          recipe = await this.api.matchRecipe(trimmed);
        } catch {
          recipe = null;
        }
        if (cancellation.signal.aborted) return;
        if (recipe) {
          this.patch({ pipelineStage: "api-mcp-build" });
          await this.commitRecipe(recipe, modelSpec, projectId, cancellation.signal);
          if (!cancellation.signal.aborted) this.patch({ isBusy: false, pipelineStage: "ready", pipelineStartedAt: null });
          return;
        }
      }
      if (this.state.agentPhase !== "ready") {
        this.patch({ requestStatus: "failed", failureSource: "provider", pipelineStage: "failed" });
        this.appendMessage("error", "No matching recipe was found. Configure an AI provider to create this model.");
        return;
      }
      attemptedProvider = true;
      const outcome = await generateScene({
        provider: this.provider,
        request: strictNoOverlap ? `${trimmed}\n\nExigir separação global: nenhum par de objetos pode ter caixas delimitadoras sobrepostas. Preserve folga entre todos os objetos, incluindo partes estruturais.` : trimmed,
        modelSpec,
        recentMessages,
        signal: cancellation.signal,
        allowOverlapResolution: false,
        counters,
        describeRepairableApplyError: applyRejectionDiagnostic,
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
            const guardedPlan = strictNoOverlap
              ? { ...plan, operations: plan.operations.map((operation) =>
                "allowOverlap" in operation ? { ...operation, allowOverlap: false } : operation) }
              : plan;
            const response = await this.api.applyPlan(projectId, {
              expectedRevision: current.revision,
              requestId: this.makeId(),
              plan: guardedPlan,
              overlapPolicy: strictNoOverlap ? 'strict' : 'visual',
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
          ? "Nenhuma alteração necessária. A revisão atual continua ativa."
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
      if (attemptedProvider) this.recordGenerationStats(counters, finalValidScene);
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
