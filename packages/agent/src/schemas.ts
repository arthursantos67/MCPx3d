/**
 * Loads the shared ModelPlan v1 JSON Schema from `packages/domain/schemas`
 * via a static JSON import (not `readFileSync`) so this package's
 * structured-generation request/response validation and `packages/domain`'s
 * own schema stay one source of truth instead of a second copy that can
 * drift. A static import (rather than `node:fs`) is required so this module
 * -- and therefore `generateModelPlan`, which imports it -- can be bundled
 * for the browser by Vite (Issue #27, `apps/web`) as well as run under
 * `node --test`; `node:fs`/`node:path`/`node:url` have no browser
 * implementation.
 */

import modelPlanSchema from "../../domain/schemas/model-plan.v1.schema.json" with { type: "json" };

import type { JsonSchema } from "./provider.ts";

export const modelPlanJsonSchema: JsonSchema = modelPlanSchema as JsonSchema;
