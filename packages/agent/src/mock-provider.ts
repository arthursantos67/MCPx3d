/**
 * Deterministic `LLMProvider` for tests (Issue #18's "mock provider is
 * available for deterministic tests"). Scripted responses are consumed in
 * order, one per `generateStructured` call, so a test can simulate a
 * malformed-then-valid sequence to exercise a caller's repair-retry logic
 * (Issue #19, FR-30) without a real model.
 */

import type { AgentMessage, GenerationOptions, JsonSchema, LLMProvider } from "./provider.ts";
import { parseStructuredCompletion } from "./structured-output.ts";

/** Raw completion text plus the provider's `finish_reason`, parsed exactly
 * as a real provider parses it (Issue #71: scripts truncation). */
export class MockCompletion {
  readonly content: string;
  readonly finishReason: string;

  constructor(content: string, finishReason = "stop") {
    this.content = content;
    this.finishReason = finishReason;
  }
}

export function mockCompletion(content: string, finishReason?: string): MockCompletion {
  return new MockCompletion(content, finishReason);
}

/** A JSON-shaped value a mocked call can resolve to. A `string` is re-parsed
 * as JSON (so a test can script malformed JSON, e.g. `"not json{{{"`), a
 * `MockCompletion` is parsed with its scripted `finish_reason`; any other
 * value is returned as-is. */
export type MockResponseValue =
  | MockCompletion
  | string
  | number
  | boolean
  | null
  | Record<string, unknown>
  | unknown[];

/** A scripted response: a value returned as-is/re-parsed (see
 * `MockResponseValue`), or a function of the call's messages/schema for
 * context-dependent scripting. */
export type MockResponse =
  | MockResponseValue
  | ((messages: readonly AgentMessage[], schema: JsonSchema) => MockResponseValue);

export interface MockCall {
  readonly messages: readonly AgentMessage[];
  readonly schema: JsonSchema;
  readonly options?: GenerationOptions;
}

export class MockLLMProvider implements LLMProvider {
  readonly id = "mock";
  readonly model?: string;
  readonly maxOutputTokens?: number;
  readonly calls: MockCall[] = [];

  private readonly responses: readonly MockResponse[];
  private readonly available: boolean;
  private cursor = 0;

  constructor(
    responses: readonly MockResponse[],
    options?: { available?: boolean; model?: string; maxOutputTokens?: number },
  ) {
    this.responses = responses;
    this.available = options?.available ?? true;
    this.model = options?.model;
    this.maxOutputTokens = options?.maxOutputTokens;
  }

  async isAvailable(): Promise<boolean> {
    return this.available;
  }

  async initialize(): Promise<void> {}

  async generateStructured<T>(
    messages: readonly AgentMessage[],
    schema: JsonSchema,
    options?: GenerationOptions,
  ): Promise<T> {
    this.calls.push({ messages, schema, options });

    if (this.cursor >= this.responses.length) {
      throw new Error("MockLLMProvider: no more scripted responses");
    }
    const scripted = this.responses[this.cursor];
    this.cursor += 1;

    const value = typeof scripted === "function" ? scripted(messages, schema) : scripted;
    if (value instanceof MockCompletion) {
      return parseStructuredCompletion(value.content, { finishReason: value.finishReason }, options?.onCompletion) as T;
    }
    if (typeof value === "string") {
      return parseStructuredCompletion(value, { finishReason: "stop" }, options?.onCompletion) as T;
    }
    options?.onCompletion?.({
      finishReason: "stop",
      outputCharacters: JSON.stringify(value)?.length ?? 0,
      failure: null,
      locallyRepaired: false,
    });
    return value as T;
  }

  async cancel(): Promise<void> {}
}
