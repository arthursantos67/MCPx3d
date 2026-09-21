/**
 * The recommended default WebLLM model (FR-28, Issue #16).
 *
 * Provisional: Issue #17 benchmarks candidate models against actual
 * ModelPlan quality and picks the real default (plus a documented smaller
 * fallback). This id only has to be a real, WebLLM-prebuilt, instruction-tuned
 * model so Issue #16's worker/engine wiring has something concrete to load;
 * it is read from one place, not hardcoded across the UI, so #17 can replace
 * it here without touching call sites.
 */
export const DEFAULT_WEBLLM_MODEL_ID = "Llama-3.2-3B-Instruct-q4f16_1-MLC";
