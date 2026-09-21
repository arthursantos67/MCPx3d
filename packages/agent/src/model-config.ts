/**
 * The recommended default WebLLM model (FR-28).
 *
 * Provisional, same id apps/web's Issue #16 spike already used
 * (`apps/web/src/ai/model-config.ts`): a real, WebLLM-prebuilt,
 * instruction-tuned model, chosen only so this package's provider has
 * something concrete to load. Issue #17 (benchmark candidate models against
 * actual ModelPlan quality and pick a real default plus a documented smaller
 * fallback) was explicitly skipped for this pass at the user's request --
 * that benchmark, and any resulting change to this id, remain open work.
 */
export const DEFAULT_WEBLLM_MODEL_ID = "Llama-3.2-3B-Instruct-q4f16_1-MLC";
