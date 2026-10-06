import {
  OpenAICompatibleProvider,
  type OpenAICompatibleProviderState,
} from "../../../../packages/agent/src/openai-compatible-provider.ts";
import {
  createWebLLMProvider,
  type WebLLMProvider,
  type WebLLMProviderState,
} from "../../../../packages/agent/src/webllm-provider.ts";
import { isUsableByokConfig, loadProviderConfig } from "../settings/providerConfig.ts";
import type { AgentProvider, AgentStatus } from "./types.ts";
import { LocalCliProvider } from "../../../../packages/agent/src/local-cli-provider.ts";
import { baseUrl } from "../api/http.ts";
import type { ProviderConfig } from "../settings/providerConfig.ts";

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
    model: webllm.model,
    maxOutputTokens: webllm.maxOutputTokens,
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

function toOpenAiCompatibleAgentProvider(provider: OpenAICompatibleProvider | LocalCliProvider): AgentProvider {
  return {
    id: provider.id,
    model: provider.model,
    maxOutputTokens: provider.maxOutputTokens,
    generationPolicy: 'generationPolicy' in provider ? provider.generationPolicy : undefined,
    isAvailable: () => provider.isAvailable(),
    initialize: () => provider.initialize(),
    generateStructured: (messages, schema, options) => provider.generateStructured(messages, schema, options),
    cancel: () => provider.cancel(),
    getState: () => toOpenAiCompatibleStatus(provider.getState()),
    onStateChange: (listener) => provider.onStateChange((next) => listener(toOpenAiCompatibleStatus(next))),
  };
}

export function createConfiguredProvider(config: ProviderConfig = loadProviderConfig()): AgentProvider {
  if (config.mode === 'cli') {
    return toOpenAiCompatibleAgentProvider(new LocalCliProvider({ apiBaseUrl: baseUrl(), client: config.client, model: config.model }));
  }
  if (isUsableByokConfig(config)) {
    return toOpenAiCompatibleAgentProvider(
      new OpenAICompatibleProvider({ baseUrl: config.baseUrl, apiKey: config.apiKey, model: config.model }),
    );
  }
  return toAgentProvider(createWebLLMProvider());
}

