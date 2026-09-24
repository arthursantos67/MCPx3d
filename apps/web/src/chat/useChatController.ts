/**
 * React wrapper around `ChatController` (Issue #27). Uses
 * `useSyncExternalStore`, the same pattern `apps/web/src/ai/useWebLlmRuntime.ts`
 * already established for externally-mutated status that can change outside
 * a React event (here: `WebLLMProvider`'s worker callbacks and in-flight
 * network calls), and wires the one real `ChatApi` implementation
 * (`apps/web/src/api/client.ts`) plus the production `createWebLLMProvider()`
 * factory (`packages/agent`) -- the concrete instances a test would swap out.
 *
 * `toAgentProvider`/`toOpenAiCompatibleAgentProvider` adapt each real
 * provider's own status shape (`WebLLMProviderState`/
 * `OpenAICompatibleProviderState`) into `ChatController`'s own `AgentStatus`
 * shape; see `ChatController.ts`'s doc comment for why that mapping lives
 * here (this file compiles under `tsconfig.app.json`'s `"bundler"` module
 * resolution, where `packages/agent`'s `@mlc-ai/web-llm` type imports
 * resolve fine) rather than in `ChatController.ts` itself.
 *
 * Which provider gets constructed is decided once here, from
 * `loadProviderConfig()` (`../settings/providerConfig.ts`): `WebLLMProvider`
 * unless the user has explicitly saved a complete BYOK config. There is no
 * live hot-swap -- changing the setting takes effect on next reload, the
 * same way this controller itself is only ever constructed once per page load.
 */
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";

import {
  OpenAICompatibleProvider,
  type OpenAICompatibleProviderState,
} from "../../../../packages/agent/src/openai-compatible-provider.ts";
import {
  createWebLLMProvider,
  type WebLLMProvider,
  type WebLLMProviderState,
} from "../../../../packages/agent/src/webllm-provider.ts";
import * as apiClient from "../api/client.ts";
import { isUsableByokConfig, loadProviderConfig } from "../settings/providerConfig.ts";

import { ChatController, type AgentProvider, type ChatControllerState } from "./ChatController.ts";
import type { AgentStatus, SendGate } from "./types.ts";

function toAgentStatus(state: WebLLMProviderState): AgentStatus {
  switch (state.phase) {
    case "loading":
      return {
        phase: "loading",
        progressText:
          state.progress.text || `Loading local model… ${Math.round(state.progress.progress * 100)}%`,
      };
    case "unsupported":
      return { phase: "unsupported", reason: state.reason };
    case "error":
      return { phase: "error", reason: state.message };
    default:
      return { phase: state.phase };
  }
}

function toAgentProvider(webllm: WebLLMProvider): AgentProvider {
  return {
    id: webllm.id,
    isAvailable: () => webllm.isAvailable(),
    initialize: () => webllm.initialize(),
    generateStructured: (messages, schema, options) => webllm.generateStructured(messages, schema, options),
    cancel: () => webllm.cancel(),
    getState: () => toAgentStatus(webllm.getState()),
    onStateChange: (listener) => webllm.onStateChange((next) => listener(toAgentStatus(next))),
  };
}

function toOpenAiCompatibleStatus(state: OpenAICompatibleProviderState): AgentStatus {
  return state.phase === "error" ? { phase: "error", reason: state.message } : { phase: state.phase };
}

function toOpenAiCompatibleAgentProvider(provider: OpenAICompatibleProvider): AgentProvider {
  return {
    id: provider.id,
    isAvailable: () => provider.isAvailable(),
    initialize: () => provider.initialize(),
    generateStructured: (messages, schema, options) => provider.generateStructured(messages, schema, options),
    cancel: () => provider.cancel(),
    getState: () => toOpenAiCompatibleStatus(provider.getState()),
    onStateChange: (listener) => provider.onStateChange((next) => listener(toOpenAiCompatibleStatus(next))),
  };
}

function createConfiguredProvider(): AgentProvider {
  const config = loadProviderConfig();
  if (isUsableByokConfig(config)) {
    return toOpenAiCompatibleAgentProvider(
      new OpenAICompatibleProvider({ baseUrl: config.baseUrl, apiKey: config.apiKey, model: config.model }),
    );
  }
  return toAgentProvider(createWebLLMProvider());
}

export interface UseChatController {
  readonly state: ChatControllerState;
  readonly canSend: () => SendGate;
  readonly sendMessage: (text: string) => void;
  readonly cancelGeneration: () => void;
  readonly retryProject: () => void;
  readonly resetProject: () => void;
  readonly renameProject: (name: string) => void;
  readonly setViewerStatus: (status: "artifact-generation" | "loading" | "ready" | "failed") => void;
}

export function useChatController(): UseChatController {
  const controller = useMemo(
    () => new ChatController(createConfiguredProvider(), apiClient),
    [],
  );

  useEffect(() => {
    void controller.initialize();
    return () => controller.dispose();
  }, [controller]);

  const subscribe = useCallback(
    (onStoreChange: () => void) => controller.onChange(onStoreChange),
    [controller],
  );
  const getSnapshot = useCallback(() => controller.getState(), [controller]);
  const state = useSyncExternalStore(subscribe, getSnapshot);

  const sendMessage = useCallback(
    (text: string) => {
      void controller.sendMessage(text);
    },
    [controller],
  );
  const canSend = useCallback(() => controller.canSend(), [controller]);
  const cancelGeneration = useCallback(() => controller.cancelGeneration(), [controller]);
  const retryProject = useCallback(() => {
    void controller.retryProject();
  }, [controller]);
  const resetProject = useCallback(() => {
    void controller.resetProject();
  }, [controller]);
  const renameProject = useCallback((name: string) => controller.renameProject(name), [controller]);
  const setViewerStatus = useCallback(
    (status: "artifact-generation" | "loading" | "ready" | "failed") => controller.setViewerStatus(status),
    [controller],
  );

  return { state, sendMessage, cancelGeneration, canSend, retryProject, resetProject, renameProject, setViewerStatus };
}
