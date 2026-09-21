/**
 * Deterministic `LLMProvider` for tests (Issue #18's "mock provider is
 * available for deterministic tests"). Scripted responses are consumed in
 * order, one per `generateStructured` call, so a test can simulate a
 * malformed-then-valid sequence to exercise a caller's repair-retry logic
 * (Issue #19, FR-30) without a real model.
 */

import type { AgentMessage, GenerationOptions, JsonSchema, LLMProvider } from "./provider.ts";

/** A JSON-shaped value a mocked call can resolve to. A `string` is re-parsed
 * as JSON (so a test can script malformed JSON, e.g. `"not json{{{"`); any
 * other value is returned as-is. */
export type MockResponseValue =
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
  readonly calls: MockCall[] = [];

  private readonly responses: readonly MockResponse[];
  private readonly available: boolean;
  private cursor = 0;

  constructor(responses: readonly MockResponse[], options?: { available?: boolean }) {
    this.responses = responses;
    this.available = options?.available ?? true;
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
    if (typeof value === "string") {
      return JSON.parse(value) as T;
    }
    return value as T;
  }

  async cancel(): Promise<void> {}
}
