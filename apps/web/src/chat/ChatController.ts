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
import {
  ModelPlanGenerationError,
  buildClarificationFollowUp,
  generateModelPlan,
} from "../../../../packages/agent/src/generate-model-plan.ts";
import type { ModelPlan } from "../../../../packages/domain/ts/src/model-plan.ts";
import type { ModelSpec } from "../../../../packages/domain/ts/src/model-spec.ts";

import type {
  AgentStatus,
  ChatControllerState,
  ChatMessage,
  ChatMessageRole,
  SendGate,
} from "./types.ts";

export interface AgentProvider extends LLMProvider {
  getState(): AgentStatus;
  onStateChange(listener: (state: AgentStatus) => void): () => void;
}

export interface ChatApi {
  createProject(): Promise<ModelSpec>;
  applyPlan(projectId: string, body: ApplyPlanRequestBody): Promise<ApplyPlanResponse>;
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
  if (error instanceof ModelPlanGenerationError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}

function isPureClarify(plan: ModelPlan): plan is ModelPlan & { operations: [{ op: "clarify"; question: string }] } {
  return plan.operations.length === 1 && plan.operations[0]?.op === "clarify";
}

function summarizeApplyResult(response: ApplyPlanResponse): string {
  const warningCount = response.validation.warnings.length;
  const warningNote = warningCount > 0 ? ` with ${warningCount} warning(s)` : "";
  return `Updated the model to revision ${response.revision}${warningNote}.`;
}

export class ChatController {
  private state: ChatControllerState;
  private readonly listeners = new Set<() => void>();
  private readonly provider: AgentProvider;
  private readonly api: ChatApi;
  private readonly now: () => number;
  private readonly makeId: () => string;
  private pendingClarifyQuestion: string | null = null;

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
      agentDetail: describeProviderState(initial),
      isBusy: false,
      projectId: null,
      projectError: null,
    };

    provider.onStateChange((next) => {
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
    this.provider.initialize().catch(() => {
      // WebLLMProvider's own contract is "never throws: failures land in state"
      // (see its onStateChange subscription above); this catch only guards
      // against an unhandled-rejection warning if that contract is ever broken.
    });

    try {
      const modelSpec = await this.api.createProject();
      this.patch({ modelSpec, projectId: modelSpec.projectId, projectError: null });
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

    this.appendMessage("user", trimmed);

    const recentMessages: readonly AgentMessage[] = this.pendingClarifyQuestion
      ? buildClarificationFollowUp(this.pendingClarifyQuestion, trimmed)
      : [];
    this.pendingClarifyQuestion = null;

    this.patch({ isBusy: true });

    let plan: ModelPlan;
    try {
      plan = await generateModelPlan({ provider: this.provider, request: trimmed, modelSpec, recentMessages });
    } catch (error) {
      this.patch({ isBusy: false });
      this.appendMessage("error", describeError(error));
      return;
    }

    if (isPureClarify(plan)) {
      this.pendingClarifyQuestion = plan.operations[0].question;
      this.patch({ isBusy: false });
      this.appendMessage("assistant", plan.operations[0].question);
      return;
    }

    try {
      const response = await this.api.applyPlan(projectId, {
        expectedRevision: modelSpec.revision,
        requestId: this.makeId(),
        plan,
      });
      this.patch({
        isBusy: false,
        modelSpec: response.modelSpec,
        previewUrl: this.api.resolveArtifactUrl(response.preview.url),
      });
      this.appendMessage("assistant", summarizeApplyResult(response));
    } catch (error) {
      this.patch({ isBusy: false });
      this.appendMessage("error", describeError(error));
    }
  }

  private appendMessage(role: ChatMessageRole, text: string): void {
    const message: ChatMessage = { id: this.makeId(), role, text, createdAt: this.now() };
    this.patch({ messages: [...this.state.messages, message] });
  }

  private patch(partial: Partial<ChatControllerState>): void {
    this.state = { ...this.state, ...partial };
    for (const listener of this.listeners) listener();
  }
}
