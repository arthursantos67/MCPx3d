/**
 * Plans and commits one user request, continuing in bounded batches when a
 * single ModelPlan does not fit the provider's output budget (Issue #71).
 *
 * The request is first attempted as one ModelPlan, as before. Only when that
 * response is truncated (`ModelPlanTruncatedError`) does this switch to
 * batch mode: each batch asks for at most `SCENE_BATCH_OPERATIONS`
 * operations against the latest committed `ModelSpec`, is validated by
 * `generateModelPlan`, and is committed through the caller's `applyPlan`
 * (the backend's normal schema/domain/overlap/X3D validation) before the
 * next batch is requested. A batch consisting only of `no_change` means the
 * scene is complete. Every committed batch is a real, valid revision, so a
 * later failure or cancellation leaves the last committed batch -- never a
 * partial plan -- as the active scene.
 *
 * Finite limits: one format-repair retry per generated plan (FR-30), up to
 * `MAX_APPLY_REPAIRS` apply-repair rounds per plan when
 * `describeRepairableApplyError` accepts the error, then one final apply
 * with `resolveOverlaps` so the backend separates any parts that still
 * penetrate; at most `MAX_SCENE_BATCHES` batches per request. An apply
 * repair sends the rejected plan back with the backend's diagnostic, so the
 * model corrects it rather than starting over.
 *
 * A batch that still fails validation after those rounds is skipped and
 * reported in `skippedBatches` rather than discarding the rest of the scene;
 * the request stops only after `MAX_CONSECUTIVE_FAILED_BATCHES` failures in
 * a row, or at once for a non-validation error (provider, MCP, session).
 */

import type { ModelPlan } from "../../domain/ts/src/model-plan.ts";
import type { ModelSpec } from "../../domain/ts/src/model-spec.ts";

import {
  ModelPlanGenerationError,
  ModelPlanTruncatedError,
  generateModelPlan,
  type GenerateModelPlanInput,
  type ModelPlanContinuation,
} from "./generate-model-plan.ts";
import type { PlanValidationFailure } from "./plan-diagnostics.ts";
import type { CompletionMetadata } from "./provider.ts";

export const SCENE_BATCH_OPERATIONS = 25;
export const MAX_SCENE_BATCHES = 12;
/** A single plan that reaches the per-plan operation limit (NFR-12) is
 * treated as the first part of a larger scene and continued in batches. */
export const MAX_PLAN_OPERATIONS = 100;
export const MAX_APPLY_REPAIRS = 3;
export const MAX_CONSECUTIVE_FAILED_BATCHES = 2;

export interface ApplyPlanOptions {
  /** Final attempt: ask the backend to separate penetrating parts instead of rejecting. */
  readonly resolveOverlaps: boolean;
}

export interface SkippedBatch {
  readonly batch: number;
  readonly reason: string;
}

/** Content-free counters for one request, accumulated across every provider
 * call it makes. Safe to aggregate per provider/model. */
export interface SceneGenerationCounters {
  completions: number;
  truncations: number;
  localRepairs: number;
  formatRepairs: number;
  applyRepairs: number;
  continued: boolean;
  committedBatches: number;
  skippedBatches: number;
  /** Final applies that asked the backend to separate overlapping parts. */
  overlapResolutions: number;
  /** Rejected plan attempts by content-free category. */
  validationFailures: Partial<Record<PlanValidationFailure, number>>;
}

export function createSceneGenerationCounters(): SceneGenerationCounters {
  return {
    completions: 0,
    truncations: 0,
    localRepairs: 0,
    formatRepairs: 0,
    applyRepairs: 0,
    continued: false,
    committedBatches: 0,
    skippedBatches: 0,
    overlapResolutions: 0,
    validationFailures: {},
  };
}

export interface SceneProgress {
  readonly stage: "generating" | "applying";
  /** 0 for the single full-plan attempt, then 1..maxBatches in batch mode. */
  readonly batch: number;
  readonly maxBatches: number;
  readonly committedBatches: number;
}

export interface GenerateSceneInput
  extends Omit<GenerateModelPlanInput, "continuation" | "priorValidationDiagnostics" | "rejectedPlan" | "onValidationFailure"> {
  /** Validates and commits a plan; resolves to the new committed ModelSpec. */
  readonly applyPlan: (plan: ModelPlan, modelSpec: ModelSpec, options: ApplyPlanOptions) => Promise<ModelSpec>;
  /** Returns a diagnostic worth one regeneration, or null to fail immediately. */
  readonly describeRepairableApplyError?: (error: unknown) => string | null;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: SceneProgress) => void;
  readonly counters?: SceneGenerationCounters;
}

export type SceneOutcome =
  | {
      readonly status: "applied";
      readonly modelSpec: ModelSpec;
      /** 0 when the single full plan fit; otherwise committed batch count. */
      readonly batches: number;
      /** False only when `MAX_SCENE_BATCHES` was reached before `no_change`. */
      readonly complete: boolean;
      /** Batches that failed validation and were skipped while the scene continued. */
      readonly skippedBatches: readonly SkippedBatch[];
    }
  | { readonly status: "clarify"; readonly question: string; readonly modelSpec: ModelSpec; readonly batches: number }
  | { readonly status: "cancelled"; readonly modelSpec: ModelSpec; readonly batches: number };

/** Batch `batch` failed; batches before it stay committed. `cause` is the underlying error. */
export class SceneBatchError extends ModelPlanGenerationError {
  readonly batch: number;
  readonly committedBatches: number;

  constructor(batch: number, committedBatches: number, cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    const kept = committedBatches > 0
      ? ` The ${committedBatches} earlier batch${committedBatches === 1 ? "" : "es"} stay committed and previewed.`
      : " The previous revision remains active.";
    super(`Scene batch ${batch} failed: ${detail}${kept}`, { cause });
    this.name = "SceneBatchError";
    this.batch = batch;
    this.committedBatches = committedBatches;
  }
}

type StepResult =
  | { readonly kind: "applied"; readonly modelSpec: ModelSpec; readonly operations: number }
  | { readonly kind: "clarify"; readonly question: string }
  | { readonly kind: "done" }
  | { readonly kind: "cancelled" };

export async function generateScene(input: GenerateSceneInput): Promise<SceneOutcome> {
  const counters = input.counters ?? createSceneGenerationCounters();
  let modelSpec = input.modelSpec;

  try {
    const single = await step(input, counters, modelSpec, undefined);
    if (single.kind === "cancelled") return { status: "cancelled", modelSpec, batches: 0 };
    if (single.kind === "clarify") return { status: "clarify", question: single.question, modelSpec, batches: 0 };
    if (single.kind !== "applied" || single.operations < MAX_PLAN_OPERATIONS) {
      return {
        status: "applied",
        modelSpec: single.kind === "applied" ? single.modelSpec : modelSpec,
        batches: 0,
        complete: true,
        skippedBatches: [],
      };
    }
    modelSpec = single.modelSpec;
  } catch (error) {
    if (!(error instanceof ModelPlanTruncatedError)) throw error;
  }

  counters.continued = true;
  const skippedBatches: SkippedBatch[] = [];
  let consecutiveFailures = 0;
  for (let batch = 1; batch <= MAX_SCENE_BATCHES; batch += 1) {
    const committed = counters.committedBatches;
    let result: StepResult;
    try {
      result = await step(input, counters, modelSpec, { batch, maxOperations: SCENE_BATCH_OPERATIONS });
    } catch (error) {
      if (input.signal?.aborted) return { status: "cancelled", modelSpec, batches: committed };
      consecutiveFailures += 1;
      if (!isSkippable(error, input) || consecutiveFailures >= MAX_CONSECUTIVE_FAILED_BATCHES) {
        throw new SceneBatchError(batch, committed, error);
      }
      skippedBatches.push({ batch, reason: error instanceof Error ? error.message : String(error) });
      counters.skippedBatches += 1;
      continue;
    }
    consecutiveFailures = 0;
    if (result.kind === "cancelled") return { status: "cancelled", modelSpec, batches: committed };
    if (result.kind === "clarify") return { status: "clarify", question: result.question, modelSpec, batches: committed };
    if (result.kind === "done") return { status: "applied", modelSpec, batches: committed, complete: true, skippedBatches };
    modelSpec = result.modelSpec;
    counters.committedBatches += 1;
  }
  return { status: "applied", modelSpec, batches: counters.committedBatches, complete: false, skippedBatches };
}

/** Validation failures are worth skipping past; provider/MCP/session failures are not. */
function isSkippable(error: unknown, input: GenerateSceneInput): boolean {
  return error instanceof ModelPlanGenerationError || (input.describeRepairableApplyError?.(error) ?? null) !== null;
}

async function step(
  input: GenerateSceneInput,
  counters: SceneGenerationCounters,
  modelSpec: ModelSpec,
  continuation: ModelPlanContinuation | undefined,
): Promise<StepResult> {
  const batch = continuation?.batch ?? 0;
  const progress = (stage: SceneProgress["stage"]): void =>
    input.onProgress?.({ stage, batch, maxBatches: MAX_SCENE_BATCHES, committedBatches: counters.committedBatches });

  progress("generating");
  let plan = await planStep(input, counters, modelSpec, continuation);
  if (input.signal?.aborted) return { kind: "cancelled" };

  for (let applyAttempt = 0; ; applyAttempt += 1) {
    if (isPureClarify(plan)) return { kind: "clarify", question: plan.operations[0].question };
    if (continuation && isPureNoChange(plan)) return { kind: "done" };

    const resolveOverlaps = applyAttempt === MAX_APPLY_REPAIRS;
    progress("applying");
    try {
      const committed = await input.applyPlan(plan, modelSpec, { resolveOverlaps });
      if (resolveOverlaps) counters.overlapResolutions += 1;
      return { kind: "applied", modelSpec: committed, operations: plan.operations.length };
    } catch (error) {
      if (input.signal?.aborted) return { kind: "cancelled" };
      const diagnostics = applyAttempt < MAX_APPLY_REPAIRS ? input.describeRepairableApplyError?.(error) ?? null : null;
      if (diagnostics === null) throw error;
      counters.applyRepairs += 1;
      progress("generating");
      plan = await planStep(input, counters, modelSpec, continuation, { diagnostics, rejectedPlan: plan });
      if (input.signal?.aborted) return { kind: "cancelled" };
    }
  }
}

async function planStep(
  input: GenerateSceneInput,
  counters: SceneGenerationCounters,
  modelSpec: ModelSpec,
  continuation: ModelPlanContinuation | undefined,
  applyRejection?: { readonly diagnostics: string; readonly rejectedPlan: ModelPlan },
): Promise<ModelPlan> {
  let completions = 0;
  const onCompletion = (completion: CompletionMetadata): void => {
    completions += 1;
    counters.completions += 1;
    if (completion.failure === "truncated") counters.truncations += 1;
    if (completion.locallyRepaired) counters.localRepairs += 1;
    input.options?.onCompletion?.(completion);
  };
  try {
    return await generateModelPlan({
      provider: input.provider,
      request: input.request,
      modelSpec,
      recentMessages: input.recentMessages,
      maxRecentMessages: input.maxRecentMessages,
      summaryOptions: input.summaryOptions,
      priorValidationDiagnostics: applyRejection?.diagnostics,
      rejectedPlan: applyRejection?.rejectedPlan,
      continuation,
      options: { ...input.options, onCompletion },
      onValidationFailure: (failure) => {
        counters.validationFailures[failure] = (counters.validationFailures[failure] ?? 0) + 1;
      },
    });
  } finally {
    if (completions > 1) counters.formatRepairs += completions - 1;
  }
}

function isPureClarify(plan: ModelPlan): plan is ModelPlan & { operations: [{ op: "clarify"; question: string }] } {
  return plan.operations.length === 1 && plan.operations[0]?.op === "clarify";
}

function isPureNoChange(plan: ModelPlan): boolean {
  return plan.operations.length > 0 && plan.operations.every((operation) => operation.op === "no_change");
}
