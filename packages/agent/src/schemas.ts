/** Shared schema loading for Node tests and browser bundles. */

import modelPlanSchema from "../../domain/schemas/model-plan.v1.schema.json" with { type: "json" };

import type { JsonSchema } from "./provider.ts";

export const modelPlanJsonSchema: JsonSchema = modelPlanSchema as JsonSchema;
