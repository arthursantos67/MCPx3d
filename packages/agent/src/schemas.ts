/**
 * Loads the shared ModelPlan v1 JSON Schema from `packages/domain/schemas`
 * at runtime (a plain `readFileSync` + `JSON.parse`, not a JSON module
 * import -- matching `packages/domain/ts/tests/support.ts`'s approach) so
 * this package's structured-generation request/response validation and
 * `packages/domain`'s own schema stay one source of truth instead of a
 * second copy that can drift.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import type { JsonSchema } from "./provider.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DOMAIN_SCHEMAS_DIR = path.join(HERE, "..", "..", "domain", "schemas");

function loadSchema(filename: string): JsonSchema {
  return JSON.parse(readFileSync(path.join(DOMAIN_SCHEMAS_DIR, filename), "utf-8")) as JsonSchema;
}

export const modelPlanJsonSchema: JsonSchema = loadSchema("model-plan.v1.schema.json");
