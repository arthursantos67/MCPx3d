/**
 * ModelPlan v1 TypeScript types (PRD §8.3).
 *
 * Mirrors packages/domain/schemas/model-plan.v1.schema.json and
 * packages/domain/python/src/domain/model_plan.py. `Operation` is a
 * discriminated union on `op`; every member is a closed interface (no index
 * signature), so no executable-code field can be attached and still type-check.
 */

import type { PrimitiveKind, Vec3 } from "./model-spec.ts";

export interface CreateObject {
  op: "create_object";
  /** Optional caller-proposed ID, required only when a later operation in the
   * same plan must target this object before it exists. */
  id?: string;
  name: string;
  kind: PrimitiveKind;
  dimensions: Record<string, number>;
  position?: Vec3;
  rotation?: Vec3;
  color?: string;
  tags?: string[];
}

export interface DeleteObject {
  op: "delete_object";
  target: string;
}

export interface DuplicateObject {
  op: "duplicate_object";
  target: string;
  newId: string;
  offset?: Vec3;
}

export interface SetDimensions {
  op: "set_dimensions";
  target: string;
  dimensions: Record<string, number>;
}

/** Moves `target` by `delta`, relative to its current position. */
export interface TranslateObject {
  op: "translate_object";
  target: string;
  delta: Vec3;
}

/** Rotates `target` by `delta` (radians per axis), relative to its current rotation. */
export interface RotateObject {
  op: "rotate_object";
  target: string;
  delta: Vec3;
}

/** Multiplies `target`'s current scale by `factor` per axis. */
export interface ScaleObject {
  op: "scale_object";
  target: string;
  factor: Vec3;
}

export interface SetMaterial {
  op: "set_material";
  target: string;
  color?: string;
  transparency?: number;
}

export interface RenameObject {
  op: "rename_object";
  target: string;
  name: string;
}

export interface SetScene {
  op: "set_scene";
  background?: string;
  displayScale?: number;
}

/** Asks the user for missing/ambiguous information. Never mutates ModelSpec. */
export interface Clarify {
  op: "clarify";
  question: string;
}

/** Responds without modifying geometry. */
export interface NoChange {
  op: "no_change";
  reason?: string;
}

export type Operation =
  | CreateObject
  | DeleteObject
  | DuplicateObject
  | SetDimensions
  | TranslateObject
  | RotateObject
  | ScaleObject
  | SetMaterial
  | RenameObject
  | SetScene
  | Clarify
  | NoChange;

export interface ModelPlan {
  intent: string;
  operations: Operation[];
}

export class ModelPlanValidationError extends Error {}

function fail(message: string): never {
  throw new ModelPlanValidationError(message);
}

const ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const COLOR_PATTERN = /^#[0-9a-f]{6}$/;

function checkId(value: string): void {
  if (!ID_PATTERN.test(value)) fail(`id '${value}' must match ${ID_PATTERN}`);
}

function checkColor(value: string): void {
  if (!COLOR_PATTERN.test(value)) fail(`color '${value}' must be a normalized lowercase 6-digit hex value`);
}

function checkDimensions(dimensions: Record<string, number>): void {
  if (Object.keys(dimensions).length === 0) fail("dimensions must not be empty");
  for (const [key, value] of Object.entries(dimensions)) {
    if (!(value > 0) || !Number.isFinite(value)) fail(`dimension '${key}' must be a positive, finite number`);
  }
}

/** Mirrors `apps/api/src/api/mutation.py`'s `_DIMENSION_KEYS`/`_check_dimension_keys`
 * (packages/domain/README.md "Conventions not obvious from the schema") --
 * that Python engine remains the authoritative boundary (§8.4's
 * implementation note), this is a client-side pre-check so `generateModelPlan`'s
 * one-shot repair retry can catch and correct a wrong key set (e.g. a model
 * emitting `{x,y,z}` for a box) before ever reaching the backend, instead of
 * spending the user's only retry on a request that was always going to be
 * rejected. Only `create_object` is checked here (it is the only operation
 * with `kind` directly on it); `set_dimensions` targets an existing object
 * whose kind isn't known from the plan alone, so it still relies on the
 * backend catching a wrong key set, same as before this check existed. */
const DIMENSION_KEYS: Record<PrimitiveKind, ReadonlySet<string>> = {
  box: new Set(["width", "height", "depth"]),
  sphere: new Set(["radius"]),
  cylinder: new Set(["radius", "height"]),
  cone: new Set(["bottomRadius", "height"]),
};

function checkDimensionKeys(kind: PrimitiveKind, dimensions: Record<string, number>): void {
  const expected = DIMENSION_KEYS[kind];
  const actual = Object.keys(dimensions);
  const matches = actual.length === expected.size && actual.every((key) => expected.has(key));
  if (!matches) {
    fail(`${kind} requires dimensions ${JSON.stringify([...expected].sort())}, got ${JSON.stringify([...actual].sort())}`);
  }
}

/** Assumes `plan` already matches the ModelPlan shape (e.g. schema-validated JSON). */
export function validateModelPlanDomainRules(plan: ModelPlan): void {
  for (const op of plan.operations) {
    switch (op.op) {
      case "create_object":
        if (op.id !== undefined) checkId(op.id);
        checkDimensions(op.dimensions);
        checkDimensionKeys(op.kind, op.dimensions);
        if (op.color !== undefined) checkColor(op.color);
        break;
      case "delete_object":
        checkId(op.target);
        break;
      case "duplicate_object":
        checkId(op.target);
        checkId(op.newId);
        break;
      case "set_dimensions":
        checkId(op.target);
        checkDimensions(op.dimensions);
        break;
      case "translate_object":
      case "rotate_object":
        checkId(op.target);
        break;
      case "scale_object":
        checkId(op.target);
        if (op.factor.some((component) => component === 0)) {
          fail("scale_object factor components must be nonzero");
        }
        break;
      case "set_material":
        checkId(op.target);
        if (op.color === undefined && op.transparency === undefined) {
          fail("set_material requires color and/or transparency");
        }
        if (op.color !== undefined) checkColor(op.color);
        break;
      case "rename_object":
        checkId(op.target);
        break;
      case "set_scene":
        if (op.background === undefined && op.displayScale === undefined) {
          fail("set_scene requires background and/or displayScale");
        }
        break;
      case "clarify":
      case "no_change":
        break;
      default: {
        const exhaustive: never = op;
        fail(`unknown operation: ${JSON.stringify(exhaustive)}`);
      }
    }
  }
}
