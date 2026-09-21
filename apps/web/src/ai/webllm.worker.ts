/**
 * WebLLM Web Worker entry point (Issue #16). Runs model load/inference off
 * the main thread; `WebLlmRuntime` (webllm-runtime.ts) talks to it through
 * `@mlc-ai/web-llm`'s own worker protocol via `CreateWebWorkerMLCEngine`.
 */
import { WebWorkerMLCEngineHandler } from "@mlc-ai/web-llm";

const handler = new WebWorkerMLCEngineHandler();

self.onmessage = (event: MessageEvent) => {
  handler.onmessage(event);
};
