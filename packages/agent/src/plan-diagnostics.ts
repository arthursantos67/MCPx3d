/**
 * Precise, per-operation ModelPlan validation diagnostics for the repair
 * prompt (Issue #71 follow-up). ajv's raw `oneOf` output reports every
 * operation branch's failure ("must have required property 'target'", "must
 * NOT have additional properties" x13) without naming the offending
 * property; a model given that text tends to regenerate a much smaller
 * scene instead of fixing one field. Here each invalid operation is checked
 * against the one branch its own `op` selects, so the diagnostic names the
 * operation index, its op/id, and the actual property at fault.
 *
 * Only schema-derived text and identifier-shaped values (op names, ids,
 * property names) are echoed; free text from the model output (names,
 * questions, intents) never is.
 */

import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";

import type { ModelPlan } from "../../domain/ts/src/model-plan.ts";
import { ModelPlanValidationError, validateModelPlanDomainRules } from "../../domain/ts/src/model-plan.ts";

import { modelPlanJsonSchema } from "./schemas.ts";

export type PlanValidationFailure =
  | "malformed"
  | "truncated"
  | "schema"
  | "domain"
  | "unknown-target"
  | "clarify-mix"
  | "batch-size"
  | "dropped-operations";

export const MAX_REPORTED_ISSUES = 10;

const ajv = new Ajv2020({ allErrors: true });
export const validateModelPlanSchema = ajv.compile(modelPlanJsonSchema);

const schemaId = String(modelPlanJsonSchema.$id);
const definitions = (modelPlanJsonSchema.$defs ?? {}) as Record<string, { properties?: { op?: { const?: unknown } } }>;
const operationValidators = new Map<string, ValidateFunction>(
  Object.entries(definitions).flatMap(([name, definition]) => {
    const op = definition.properties?.op?.const;
    return typeof op === "string" ? [[op, ajv.compile({ $ref: `${schemaId}#/$defs/${name}` })] as const] : [];
  }),
);

const PROPERTY_HINTS: Readonly<Record<string, string>> = {
  transparency: "set transparency with a separate set_material operation",
  material: "use color here, or a separate set_material operation",
  scale: "use a separate scale_object operation",
};

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function safeIdentifier(value: unknown): string | null {
  return typeof value === "string" && IDENTIFIER.test(value) ? value : null;
}

/** `operations[5] (create_object window)` -- op and id only when identifier-shaped. */
export function operationLabel(operation: unknown, index: number): string {
  const op = isRecord(operation) ? safeIdentifier(operation.op) : null;
  const id = isRecord(operation) ? safeIdentifier(operation.id) ?? safeIdentifier(operation.target) : null;
  const details = [op, id].filter((part): part is string => part !== null).join(" ");
  return details ? `operations[${index}] (${details})` : `operations[${index}]`;
}

function describeError(error: ErrorObject): string {
  const location = error.instancePath ? `${error.instancePath.slice(1).replaceAll("/", ".")} ` : "";
  if (error.keyword === "additionalProperties") {
    const property = safeIdentifier(error.params.additionalProperty);
    if (!property) return "has a property that is not allowed";
    const hint = PROPERTY_HINTS[property];
    return `property '${property}' is not allowed${location ? ` in ${location.trim()}` : ""}${hint ? `; ${hint}` : ""}`;
  }
  if (error.keyword === "required") {
    const property = safeIdentifier(error.params.missingProperty);
    return `${location}is missing required property${property ? ` '${property}'` : ""}`;
  }
  if (error.keyword === "pattern" && error.instancePath.endsWith("/color")) {
    return "color must be a 6-digit hexadecimal color such as #8b4513 (lowercase)";
  }
  return `${location}${error.message ?? "is invalid"}`;
}

function describeOperation(operation: unknown, index: number): string[] {
  const label = operationLabel(operation, index);
  if (!isRecord(operation)) return [`${label} must be a JSON object`];
  const op = safeIdentifier(operation.op);
  const validate = op ? operationValidators.get(op) : undefined;
  if (!validate) {
    return [`${label} uses an unknown op; use one of: ${[...operationValidators.keys()].join(", ")}`];
  }
  if (validate(operation)) return [];
  return [...new Set((validate.errors ?? []).map(describeError))].map((issue) => `${label}: ${issue}`);
}

function bounded(issues: readonly string[]): string[] {
  return issues.length <= MAX_REPORTED_ISSUES
    ? [...issues]
    : [...issues.slice(0, MAX_REPORTED_ISSUES), `(and ${issues.length - MAX_REPORTED_ISSUES} more)`];
}

export function describeSchemaViolation(value: unknown): string[] {
  if (!isRecord(value)) return ["the response must be a JSON object with intent and operations"];
  const issues: string[] = [];
  for (const key of Object.keys(value)) {
    if (key !== "intent" && key !== "operations") {
      issues.push(`top-level property ${safeIdentifier(key) ? `'${key}' ` : ""}is not allowed; only intent and operations`);
    }
  }
  if (typeof value.intent !== "string" || value.intent.length === 0) issues.push("intent must be a non-empty string");
  if (!Array.isArray(value.operations)) {
    issues.push("operations must be an array");
  } else {
    value.operations.forEach((operation, index) => issues.push(...describeOperation(operation, index)));
  }
  return bounded(issues.length > 0 ? issues : [ajv.errorsText(validateModelPlanSchema.errors).slice(0, 300)]);
}

/** Locates a domain-rule failure by re-checking each operation alone; falls
 * back to the plan-level message for rules that span several operations. */
export function describeDomainViolation(plan: ModelPlan, error: ModelPlanValidationError): string[] {
  const issues = plan.operations.flatMap((operation, index) => {
    try {
      validateModelPlanDomainRules({ intent: plan.intent, operations: [operation] });
      return [];
    } catch (operationError) {
      if (!(operationError instanceof ModelPlanValidationError)) throw operationError;
      return [`${operationLabel(operation, index)}: ${operationError.message}`];
    }
  });
  return bounded(issues.length > 0 ? issues : [error.message]);
}
