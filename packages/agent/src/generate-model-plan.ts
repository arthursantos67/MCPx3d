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
 */

import { Ajv2020 } from "ajv/dist/2020.js";

import type { ModelPlan, Operation } from "../../domain/ts/src/model-plan.ts";
import { ModelPlanValidationError, validateModelPlanDomainRules } from "../../domain/ts/src/model-plan.ts";
import type { ModelSpec } from "../../domain/ts/src/model-spec.ts";

import type { AgentMessage, GenerationOptions, LLMProvider } from "./provider.ts";
import { modelPlanJsonSchema } from "./schemas.ts";
import { buildSystemPrompt } from "./system-prompt.ts";

const ajv = new Ajv2020({ allErrors: true });
const validateModelPlanSchema = ajv.compile(modelPlanJsonSchema);

export class ModelPlanGenerationError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ModelPlanGenerationError";
  }
}

export interface GenerateModelPlanInput {
  readonly provider: LLMProvider;
  /** The user's chat request, e.g. "create a red cube". */
  readonly request: string;
  readonly modelSpec: ModelSpec;
  /** Prior chat turns for context (FR-31); excludes the system prompt and the current request. */
  readonly recentMessages?: readonly AgentMessage[];
  /** Diagnostics from a previously failed apply attempt for this same request, if any (FR-31). */
  readonly priorValidationDiagnostics?: string;
  readonly options?: GenerationOptions;
}

export async function generateModelPlan(input: GenerateModelPlanInput): Promise<ModelPlan> {
  const { provider, request, modelSpec, recentMessages = [], priorValidationDiagnostics, options } = input;

  const systemMessage: AgentMessage = { role: "system", content: buildSystemPrompt(modelSpec) };
  const userContent = priorValidationDiagnostics
    ? `${request}\n\n(The previous attempt for this request failed validation: ${priorValidationDiagnostics}. Take this into account.)`
    : request;
  const messages: AgentMessage[] = [systemMessage, ...recentMessages, { role: "user", content: userContent }];

  const first = await attempt(provider, messages, options, modelSpec);
  if (first.ok) return first.plan;

  const repairMessages: AgentMessage[] = [
    ...messages,
    {
      role: "user",
      content:
        `Your previous response was invalid: ${first.reason}. Respond again with ONLY a single JSON ` +
        "object that strictly matches the ModelPlan schema already provided -- no explanation, no markdown, no code fences.",
    },
  ];

  const second = await attempt(provider, repairMessages, options, modelSpec);
  if (second.ok) return second.plan;

  throw new ModelPlanGenerationError(
    `ModelPlan generation failed after one repair attempt: ${second.reason}`,
  );
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

type AttemptResult = { readonly ok: true; readonly plan: ModelPlan } | { readonly ok: false; readonly reason: string };

async function attempt(
  provider: LLMProvider,
  messages: readonly AgentMessage[],
  options: GenerationOptions | undefined,
  modelSpec: ModelSpec,
): Promise<AttemptResult> {
  let raw: unknown;
  try {
    raw = await provider.generateStructured<unknown>(messages, modelPlanJsonSchema, options);
  } catch (error) {
    return { ok: false, reason: `malformed or unparsable output (${describeError(error)})` };
  }

  if (!validateModelPlanSchema(raw)) {
    return { ok: false, reason: `schema violation: ${ajv.errorsText(validateModelPlanSchema.errors)}` };
  }
  const plan = raw as ModelPlan;

  try {
    validateModelPlanDomainRules(plan);
  } catch (error) {
    if (error instanceof ModelPlanValidationError) {
      return { ok: false, reason: `domain rule violation: ${error.message}` };
    }
    throw error;
  }

  const unknownTargets = findUnknownTargets(modelSpec, plan.operations);
  if (unknownTargets.length > 0) {
    return { ok: false, reason: `operation(s) target unknown object id(s): ${unknownTargets.join(", ")}` };
  }

  if (hasMixedClarify(plan.operations)) {
    return {
      ok: false,
      reason: "a clarify operation must not be combined with any other operation in the same plan",
    };
  }

  return { ok: true, plan };
}

function hasMixedClarify(operations: readonly Operation[]): boolean {
  return operations.some((op) => op.op === "clarify") && operations.length > 1;
}

function collectKnownIds(modelSpec: ModelSpec, operations: readonly Operation[]): Set<string> {
  const ids = new Set(modelSpec.objects.map((object) => object.id));
  for (const op of operations) {
    if (op.op === "create_object" && op.id !== undefined) ids.add(op.id);
    if (op.op === "duplicate_object") ids.add(op.newId);
  }
  return ids;
}

function findUnknownTargets(modelSpec: ModelSpec, operations: readonly Operation[]): string[] {
  const known = collectKnownIds(modelSpec, operations);
  const unknown = new Set<string>();
  for (const op of operations) {
    if ("target" in op && !known.has(op.target)) unknown.add(op.target);
  }
  return [...unknown];
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
