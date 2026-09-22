/**
 * React wrapper around `ChatController` (Issue #27). Uses
 * `useSyncExternalStore`, the same pattern `apps/web/src/ai/useWebLlmRuntime.ts`
 * already established for externally-mutated status that can change outside
 * a React event (here: `WebLLMProvider`'s worker callbacks and in-flight
 * network calls), and wires the one real `ChatApi` implementation
 * (`apps/web/src/api/client.ts`) plus the production `createWebLLMProvider()`
 * factory (`packages/agent`) -- the concrete instances a test would swap out.
 *
 * `toAgentProvider` adapts the real `WebLLMProvider`'s status
 * (`WebLLMProviderState`) into `ChatController`'s own `AgentStatus` shape;
 * see `ChatController.ts`'s doc comment for why that mapping lives here
 * (this file compiles under `tsconfig.app.json`'s `"bundler"` module
 * resolution, where `packages/agent`'s `@mlc-ai/web-llm` type imports
 * resolve fine) rather than in `ChatController.ts` itself.
 */
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";

import {
  createWebLLMProvider,
  type WebLLMProvider,
  type WebLLMProviderState,
} from "../../../../packages/agent/src/webllm-provider.ts";
import * as apiClient from "../api/client.ts";

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

export interface UseChatController {
  readonly state: ChatControllerState;
  readonly canSend: () => SendGate;
  readonly sendMessage: (text: string) => void;
}

export function useChatController(): UseChatController {
  const controller = useMemo(
    () => new ChatController(toAgentProvider(createWebLLMProvider()), apiClient),
    [],
  );

  useEffect(() => {
    void controller.initialize();
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

  return { state, sendMessage, canSend };
}
