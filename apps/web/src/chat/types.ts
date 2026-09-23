/** Chat UI state (PRD §10.2, Issue #26/#27). Not itself authoritative geometry
 * state -- `modelSpec`/`revision` as returned by the server determine the
 * model (PRD §10.2's "Chat UI state is not itself authoritative geometry
 * state"). Lives here (not in `ChatController.ts`) so presentational
 * components (`ChatPanel` and friends, Issue #26) depend only on this shared
 * shape, not on the controller implementation (Issue #27) that produces it. */

import type { ModelSpec } from "../../../../packages/domain/ts/src/model-spec.ts";
import type { ArtifactDescriptor, ValidationSummary } from "../api/client.ts";

export type ChatMessageRole = "user" | "assistant" | "error";

export interface ChatMessage {
  readonly id: string;
  readonly role: ChatMessageRole;
  readonly text: string;
  readonly createdAt: number;
}

export type AgentPhase = "idle" | "unsupported" | "loading" | "ready" | "generating" | "error";
export type RequestStatus = "idle" | "working" | "succeeded" | "no-change" | "failed" | "session-expired";
export type PipelineStage =
  | "idle"
  | "provider-request"
  | "plan-validation"
  | "api-mcp-build"
  | "x3d-validation"
  | "artifact-generation"
  | "viewer-loading"
  | "ready"
  | "failed";
export type FailureSource = "provider" | "modeling" | "mcp" | "session" | null;

export interface AgentStatus {
  readonly phase: AgentPhase;
  /** Set when `phase` is `"loading"` (WebLLM model download/init progress). */
  readonly progressText?: string;
  /** Set when `phase` is `"unsupported"` or `"error"`. */
  readonly reason?: string;
}

/** What the composer/chat panel needs to know before it may accept a submit. */
export type SendGate =
  | { readonly canSend: true }
  | { readonly canSend: false; readonly reason: string };

export interface ChatControllerState {
  readonly messages: readonly ChatMessage[];
  readonly modelSpec: ModelSpec | null;
  readonly previewUrl: string | null;
  readonly agentPhase: AgentPhase;
  readonly agentDetail: string | null;
  readonly isBusy: boolean;
  readonly projectId: string | null;
  readonly projectError: string | null;
  readonly projectName: string;
  readonly artifacts: readonly ArtifactDescriptor[];
  readonly validation: ValidationSummary | null;
  readonly correlationId: string | null;
  readonly requestStatus: RequestStatus;
  readonly failureSource: FailureSource;
  readonly pipelineStage: PipelineStage;
  readonly pipelineStartedAt: number | null;
}
