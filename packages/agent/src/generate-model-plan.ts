/**
 * Converts a user request + current `ModelSpec` into a schema-constrained
 * `ModelPlan` (PRD §3.9/§3.10, §10.5, FR-29/FR-30/FR-31, Issue #19).
 *
 * The generation loop here is: compose messages -> ask the provider for
 * structured output -> JSON-parse -> validate against the ModelPlan JSON
 * Schema -> validate domain rules -> heuristically check that every target
 * id is known. Any failure gets exactly one format-repair retry (FR-30);
 * a second failure surfaces an actionable `ModelPlanGenerationError`
 * instead of guessing. This is the ONLY place in this package that turns
 * provider output into something a caller might send toward the backend --
 * nothing here or in `LLMProvider` ever returns/accepts HTML, XML, or code
 * (the ModelPlan schema itself is closed, so no such field can pass
 * validation even if a model emitted one).
 *
 * The unknown-target check below is a heuristic, non-order-sensitive
 * pre-check meant only to give the model a chance to self-correct before a
 * plan is even sent to the backend. It is not the authoritative integrity
 * boundary for §8.4's "same atomic plan first creates it" rule -- that is
 * `apps/api/src/api/mutation.py`'s job (Issue #7), which enforces true
 * creation order and is unaffected by this package.
 *
 * `clarify`/`no_change` pass schema and domain validation as ordinary
 * operations (§8.4's implementation note explicitly leaves "keeping the two
 * apart" as prompt/agent-layer policy, not something the mutation engine
 * enforces). This module is that policy layer (Issue #20, FR-08, UC-05): a
 * plan that combines a `clarify` with any mutating operation is rejected and
 * goes through the same one-shot repair retry as any other invalid output,
 * so a plan that ever reaches a caller either asks a pure clarifying
 * question or proposes a mutation -- never a guess mixed with a question.
 *
 * Truncation (Issue #71) is not a format error: a response that hit its
 * output limit is never repaired into a shorter plan here. It raises
 * `ModelPlanTruncatedError` so a caller can continue in bounded batches
 * (`generate-scene.ts`) instead. Every request carries an explicit
 * completion budget sized from the planned operation count and capped by
 * the provider's own `maxOutputTokens`.
 *
 * Every repair is incremental: when the rejected output parsed as a plan,
 * the model gets that plan back as its own assistant turn plus precise,
 * per-operation diagnostics (`plan-diagnostics.ts`) and is asked to fix only
 * those operations -- the same applies to a plan the backend rejected
 * (`rejectedPlan`). A correction that keeps fewer than
 * `REPAIR_MIN_RETAINED_FRACTION` of the rejected plan's operations is
 * refused rather than silently replacing the requested scene with a much
 * smaller one. Each rejection is reported by category through
 * `onValidationFailure`.
 */

import type { ModelPlan, Operation } from "../../domain/ts/src/model-plan.ts";
import { DIMENSION_KEYS, ModelPlanValidationError, validateModelPlanDomainRules } from "../../domain/ts/src/model-plan.ts";
import type { ModelSpec } from "../../domain/ts/src/model-spec.ts";

import {
  ProviderRequestError,
  StructuredOutputError,
  type AgentMessage,
  type CompletionMetadata,
  type GenerationOptions,
  type LLMProvider,
} from "./provider.ts";
import type { ModelSpecSummaryOptions } from "./model-spec-summary.ts";
import {
  describeDomainViolation,
  describeSchemaViolation,
  operationLabel,
  validateModelPlanSchema,
  type PlanValidationFailure,
} from "./plan-diagnostics.ts";
import { modelPlanJsonSchema } from "./schemas.ts";
import { buildSystemPrompt } from "./system-prompt.ts";

export const DEFAULT_RECENT_MESSAGE_LIMIT = 8;
export const MAX_RECENT_MESSAGE_LIMIT = 32;

/** A correction must keep at least this fraction of the rejected plan's
 * operations, checked only when the rejected plan had at least
 * `REPAIR_RETENTION_MIN_OPERATIONS` operations. */
export const REPAIR_MIN_RETAINED_FRACTION = 0.5;
export const REPAIR_RETENTION_MIN_OPERATIONS = 4;

/** Completion budget: `COMPLETION_TOKEN_OVERHEAD + COMPLETION_TOKENS_PER_OPERATION`
 * per planned operation, never above the provider's `maxOutputTokens` or
 * `MAX_COMPLETION_TOKEN_BUDGET`. One create_object serializes to roughly
 * 50-60 tokens; the overhead covers the plan envelope, formatting, and some
 * hidden reasoning, which several providers count against the same limit. */
export const COMPLETION_TOKENS_PER_OPERATION = 64;
export const COMPLETION_TOKEN_OVERHEAD = 1024;
export const MAX_COMPLETION_TOKEN_BUDGET = 8192;
/** Planned size of a single, unbatched ModelPlan: the full per-plan operation limit (NFR-12). */
export const SINGLE_PLAN_PLANNED_OPERATIONS = 100;
export const MAX_SINGLE_PLAN_OPERATIONS = 100;

export function completionTokenBudget(plannedOperations: number, providerLimit?: number): number {
  const planned = COMPLETION_TOKEN_OVERHEAD + COMPLETION_TOKENS_PER_OPERATION * Math.max(1, Math.floor(plannedOperations));
  return Math.min(planned, providerLimit ?? MAX_COMPLETION_TOKEN_BUDGET, MAX_COMPLETION_TOKEN_BUDGET);
}

export class ModelPlanGenerationError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ModelPlanGenerationError";
  }
}

/** The provider stopped at its output limit (or mid-JSON) before a complete
 * ModelPlan was produced. Nothing from that response is ever applied. */
export class ModelPlanTruncatedError extends ModelPlanGenerationError {
  readonly completion: CompletionMetadata;

  constructor(completion: CompletionMetadata) {
    super(
      "The AI response reached its output limit before the ModelPlan was complete, so nothing from it was applied. " +
        "Try a smaller request, or a provider/model with a larger output limit.",
    );
    this.name = "ModelPlanTruncatedError";
    this.completion = completion;
  }
}

/** Batch-mode context for one bounded step of a larger scene (Issue #71). */
export interface ModelPlanContinuation {
  /** 1-based batch number. */
  readonly batch: number;
  readonly maxOperations: number;
}

export interface GenerateModelPlanInput {
  readonly provider: LLMProvider;
  /** The user's chat request, e.g. "create a red cube". */
  readonly request: string;
  readonly modelSpec: ModelSpec;
  /** Prior chat turns for context (FR-31); excludes the system prompt and the current request. */
  readonly recentMessages?: readonly AgentMessage[];
  readonly maxRecentMessages?: number;
  readonly summaryOptions?: ModelSpecSummaryOptions;
  /** Diagnostics from a previously failed apply attempt for this same request, if any (FR-31). */
  readonly priorValidationDiagnostics?: string;
  /** The plan those diagnostics rejected; sent back so the model corrects it instead of starting over. */
  readonly rejectedPlan?: ModelPlan;
  /** When set, request only the next bounded batch of a larger scene. */
  readonly continuation?: ModelPlanContinuation;
  readonly options?: GenerationOptions;
  /** Called once per rejected attempt with a content-free category. */
  readonly onValidationFailure?: (failure: PlanValidationFailure) => void;
}

export async function generateModelPlan(input: GenerateModelPlanInput): Promise<ModelPlan> {
  const { provider, modelSpec, continuation } = input;
  const messages = assembleModelPlanMessages(input);
  const plannedOperations = continuation?.maxOperations ?? SINGLE_PLAN_PLANNED_OPERATIONS;
  const options: GenerationOptions = {
    ...input.options,
    maxTokens: input.options?.maxTokens ?? completionTokenBudget(plannedOperations, provider.maxOutputTokens),
  };

  const first = await attempt(provider, messages, options, modelSpec, continuation);
  if (first.ok) return requireRetained(first.plan, input.rejectedPlan?.operations.length, input);
  input.onValidationFailure?.(first.failure);
  if (first.completion) throw new ModelPlanTruncatedError(first.completion);

  const second = await attempt(provider, [...messages, ...repairTurns(first, continuation)], options, modelSpec, continuation);
  if (second.ok) {
    return requireRetained(second.plan, first.candidateOperations ?? input.rejectedPlan?.operations.length, input);
  }
  input.onValidationFailure?.(second.failure);
  if (second.completion) throw new ModelPlanTruncatedError(second.completion);

  throw new ModelPlanGenerationError(
    `ModelPlan generation failed after one repair attempt: ${second.issues.join("; ")}`,
  );
}

const JSON_ONLY = "Respond with ONLY a single JSON object that strictly matches the ModelPlan schema -- no explanation, no markdown, no code fences.";
const FIX_ONLY =
  "Return the complete corrected ModelPlan. Fix only the problems listed above and keep every other operation exactly " +
  "as it was -- do not remove, merge, or simplify parts.";

function bulletList(issues: readonly string[]): string {
  return issues.map((issue) => `- ${issue}`).join("\n");
}

function repairTurns(failure: AttemptFailure, continuation: ModelPlanContinuation | undefined): AgentMessage[] {
  if (failure.candidate === undefined) {
    return [{
      role: "user",
      content: `Your previous response was invalid:\n${bulletList(failure.issues)}\n\n${JSON_ONLY}`,
    }];
  }
  const instruction = failure.failure === "batch-size"
    ? `Return this plan with at most ${continuation?.maxOperations ?? MAX_SINGLE_PLAN_OPERATIONS} operations, keeping the rest for the next request.`
    : FIX_ONLY;
  return [
    { role: "assistant", content: JSON.stringify(failure.candidate) },
    { role: "user", content: `That ModelPlan was rejected:\n${bulletList(failure.issues)}\n\n${instruction} ${JSON_ONLY}` },
  ];
}

function isPureClarify(plan: ModelPlan): boolean {
  return plan.operations.length === 1 && plan.operations[0]?.op === "clarify";
}

function requireRetained(plan: ModelPlan, rejectedOperations: number | undefined, input: GenerateModelPlanInput): ModelPlan {
  if (rejectedOperations === undefined || rejectedOperations < REPAIR_RETENTION_MIN_OPERATIONS || isPureClarify(plan)) return plan;
  if (plan.operations.length >= Math.ceil(rejectedOperations * REPAIR_MIN_RETAINED_FRACTION)) return plan;
  input.onValidationFailure?.("dropped-operations");
  throw new ModelPlanGenerationError(
    `The corrected plan kept only ${plan.operations.length} of ${rejectedOperations} operations, so it was not applied ` +
      "instead of replacing the requested scene with a much smaller one. The previous revision remains active; try again " +
      "or split the request into smaller steps.",
  );
}

export function assembleModelPlanMessages(input: Omit<GenerateModelPlanInput, "provider" | "options">): AgentMessage[] {
  const maxRecentMessages = boundedRecentMessageLimit(input.maxRecentMessages);
  const recentMessages = input.recentMessages
    ?.filter((message) => message.role === "user" || message.role === "assistant")
    .slice(-maxRecentMessages) ?? [];
  const lastMessage = recentMessages.at(-1);
  const history = lastMessage?.role === "user" && lastMessage.content.trim() === input.request.trim()
    ? recentMessages.slice(0, -1)
    : recentMessages;
  const request = `${input.request}${continuationNote(input.continuation)}`;
  const messages: AgentMessage[] = [
    { role: "system", content: buildSystemPrompt(input.modelSpec, input.summaryOptions) },
    ...history,
  ];
  if (input.priorValidationDiagnostics && input.rejectedPlan) {
    return [
      ...messages,
      { role: "user", content: request },
      { role: "assistant", content: JSON.stringify(input.rejectedPlan) },
      {
        role: "user",
        content: `That ModelPlan failed validation: ${input.priorValidationDiagnostics}\n\n${FIX_ONLY} ${JSON_ONLY}`,
      },
    ];
  }
  const diagnosticsNote = input.priorValidationDiagnostics
    ? `\n\n(The previous attempt for this request failed validation: ${input.priorValidationDiagnostics}. Take this into account.)`
    : "";
  return [...messages, { role: "user", content: `${input.request}${diagnosticsNote}${continuationNote(input.continuation)}` }];
}

function continuationNote(continuation: ModelPlanContinuation | undefined): string {
  if (!continuation) return "";
  return (
    "\n\n(This scene is too large for one response, so it is being built in several steps. " +
    "Every part already listed in the current model was committed by earlier steps -- do not recreate or repeat it. " +
    `Emit the next group of missing parts: up to ${continuation.maxOperations} operations, and use all ${continuation.maxOperations} ` +
    "while parts of the requested scene are still missing. Place every new part so it does not intersect any part already listed. " +
    "Do not change the scene title, and never mention steps or batches in any name or title. " +
    "If every requested part already exists, respond with exactly one no_change operation.)"
  );
}

function boundedRecentMessageLimit(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value > 0
    ? Math.min(Math.floor(value), MAX_RECENT_MESSAGE_LIMIT)
    : DEFAULT_RECENT_MESSAGE_LIMIT;
}

/**
 * Builds the `recentMessages` entries a caller should append after a
 * `clarify` operation, so the next `generateModelPlan` call for the user's
 * answer sees its own question and that answer as context (Issue #20's
 * "next user answer is provided with prior clarification context"). The
 * clarify question becomes an `assistant` turn -- what the agent actually
 * "said" -- even though it was produced as ModelPlan JSON, not free text.
 */
export function buildClarificationFollowUp(clarifyQuestion: string, userAnswer: string): AgentMessage[] {
  return [
    { role: "assistant", content: clarifyQuestion },
    { role: "user", content: userAnswer },
  ];
}

interface AttemptFailure {
  readonly ok: false;
  readonly failure: PlanValidationFailure;
  readonly issues: readonly string[];
  /** The normalized rejected plan, when the output parsed into one. */
  readonly candidate?: unknown;
  readonly candidateOperations?: number;
  /** Set only for truncation. */
  readonly completion?: CompletionMetadata;
}

type AttemptResult = { readonly ok: true; readonly plan: ModelPlan } | AttemptFailure;

function rejected(failure: PlanValidationFailure, issues: readonly string[], candidate: unknown): AttemptFailure {
  const operations = isRecord(candidate) && Array.isArray(candidate.operations) ? candidate.operations.length : undefined;
  return operations === undefined
    ? { ok: false, failure, issues }
    : { ok: false, failure, issues, candidate, candidateOperations: operations };
}

async function attempt(
  provider: LLMProvider,
  messages: readonly AgentMessage[],
  options: GenerationOptions,
  modelSpec: ModelSpec,
  continuation: ModelPlanContinuation | undefined,
): Promise<AttemptResult> {
  let raw: unknown;
  try {
    raw = await provider.generateStructured<unknown>(messages, modelPlanJsonSchema, options);
  } catch (error) {
    if (error instanceof ProviderRequestError) throw error;
    if (error instanceof StructuredOutputError && error.completion.failure === "truncated") {
      return { ok: false, failure: "truncated", issues: [error.message], completion: error.completion };
    }
    return { ok: false, failure: "malformed", issues: [`malformed or unparsable output (${describeError(error)})`] };
  }

  raw = normalizeModelPlanCandidate(raw);

  if (!validateModelPlanSchema(raw)) {
    return rejected("schema", describeSchemaViolation(raw), raw);
  }
  const plan = raw as ModelPlan;

  try {
    validateModelPlanDomainRules(plan);
  } catch (error) {
    if (error instanceof ModelPlanValidationError) {
      return rejected("domain", describeDomainViolation(plan, error), plan);
    }
    throw error;
  }

  const unknownTargets = findUnknownTargets(modelSpec, plan.operations);
  if (unknownTargets.length > 0) {
    return rejected(
      "unknown-target",
      unknownTargets.map(({ index, target }) => `${operationLabel(plan.operations[index], index)} targets unknown object id '${target}'`),
      plan,
    );
  }

  if (!continuation && plan.operations.length > MAX_SINGLE_PLAN_OPERATIONS) {
    return rejected(
      "batch-size",
      [`this plan has ${plan.operations.length} operations; emit at most ${MAX_SINGLE_PLAN_OPERATIONS}, structural parts first -- the remaining parts will be requested next`],
      plan,
    );
  }

  if (continuation && plan.operations.length > continuation.maxOperations) {
    return rejected(
      "batch-size",
      [`this batch has ${plan.operations.length} operations; emit at most ${continuation.maxOperations} and leave the rest for the next batch`],
      plan,
    );
  }

  if (hasMixedClarify(plan.operations)) {
    return rejected(
      "clarify-mix",
      ["a clarify operation must not be combined with any other operation in the same plan"],
      plan,
    );
  }

  return { ok: true, plan };
}

function hasMixedClarify(operations: readonly Operation[]): boolean {
  return operations.some((op) => op.op === "clarify") && operations.length > 1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeHexColor(value: string): string {
  const digits = value.trim().replace(/^#/, "");
  if (/^[0-9a-f]{6}$/i.test(digits)) return `#${digits.toLowerCase()}`;
  if (/^[0-9a-f]{3}$/i.test(digits)) {
    return `#${[...digits.toLowerCase()].map((digit) => digit.repeat(2)).join("")}`;
  }
  return value;
}

const DIMENSION_ALIASES: Readonly<Record<string, string>> = { x: "width", y: "height", z: "depth", length: "depth" };
const RECOGNIZED_DIMENSIONS = new Set(["width", "height", "depth", "radius", "bottomRadius", "topRadius", "diameter"]);

function isPositiveFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * Re-expresses a `create_object`'s dimensions in the key set its `kind`
 * requires, when the model used aliases (`x`/`y`/`z`, `length`, `diameter`)
 * or another primitive's keys (e.g. a sphere given `width`/`height`/`depth`).
 * The given dimensions are read as the part's bounding box and the kind's
 * primitive is inscribed in it, so the part never grows beyond the space the
 * model laid out for it. Unrecognized keys are left for the normal repair path.
 */
function normalizeDimensions(kind: unknown, dimensions: unknown): Record<string, number> | null {
  if (typeof kind !== "string" || !(kind in DIMENSION_KEYS) || !isRecord(dimensions)) return null;
  const entries = Object.entries(dimensions);
  const expected = DIMENSION_KEYS[kind as keyof typeof DIMENSION_KEYS];
  if (entries.length === expected.size && entries.every(([key]) => expected.has(key))) return null;
  const given: Record<string, number> = {};
  for (const [rawKey, value] of entries) {
    const key = DIMENSION_ALIASES[rawKey] ?? rawKey;
    if (!RECOGNIZED_DIMENSIONS.has(key) || !isPositiveFinite(value)) return null;
    given[key] = value;
  }
  const radius = given.radius ?? given.bottomRadius ?? (given.diameter !== undefined ? given.diameter / 2 : undefined);
  const width = given.width ?? given.depth ?? (radius !== undefined ? radius * 2 : undefined);
  const depth = given.depth ?? given.width ?? (radius !== undefined ? radius * 2 : undefined);
  const height = given.height ?? (radius !== undefined ? radius * 2 : undefined);
  if (width === undefined || depth === undefined || height === undefined) return null;
  const baseRadius = Math.min(width, depth) / 2;
  switch (kind) {
    case "box":
      return { width, height, depth };
    case "sphere":
      return { radius: Math.min(width, height, depth) / 2 };
    case "cylinder":
      return { radius: baseRadius, height };
    default:
      return { bottomRadius: baseRadius, height };
  }
}

function normalizeModelPlanCandidate(value: unknown): unknown {
  if (!isRecord(value) || !Array.isArray(value.operations)) return value;
  let changed = false;
  const operations = value.operations.map((operation) => {
    if (!isRecord(operation)) return operation;
    let normalized = operation;
    if (typeof operation.color === "string") {
      const color = normalizeHexColor(operation.color);
      if (color !== operation.color) normalized = { ...normalized, color };
    }
    if (operation.op === "create_object") {
      const dimensions = normalizeDimensions(operation.kind, operation.dimensions);
      if (dimensions !== null) normalized = { ...normalized, dimensions };
    }
    if (normalized !== operation) changed = true;
    return normalized;
  });
  return changed ? { ...value, operations } : value;
}

function collectKnownIds(modelSpec: ModelSpec, operations: readonly Operation[]): Set<string> {
  const ids = new Set(modelSpec.objects.map((object) => object.id));
  for (const op of operations) {
    if (op.op === "create_object" && op.id !== undefined) ids.add(op.id);
    if (op.op === "duplicate_object") ids.add(op.newId);
  }
  return ids;
}

function findUnknownTargets(
  modelSpec: ModelSpec,
  operations: readonly Operation[],
): { readonly index: number; readonly target: string }[] {
  const known = collectKnownIds(modelSpec, operations);
  return operations.flatMap((op, index) => ("target" in op && !known.has(op.target) ? [{ index, target: op.target }] : []));
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
