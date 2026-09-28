import assert from "node:assert/strict";
import { test } from "node:test";

import { StructuredOutputError, type CompletionMetadata } from "../src/provider.ts";
import { parseStructuredCompletion, readCompletionUsage } from "../src/structured-output.ts";

function parse(content: string | null, finishReason: string | null = "stop"): { value?: unknown; error?: unknown; completion: CompletionMetadata } {
  let completion: CompletionMetadata | undefined;
  try {
    const value = parseStructuredCompletion(content, { finishReason }, (c) => { completion = c; });
    return { value, completion: completion! };
  } catch (error) {
    return { error, completion: completion! };
  }
}

test("valid JSON parses without repair", () => {
  const result = parse('{"intent":"x","operations":[]}');
  assert.deepEqual(result.value, { intent: "x", operations: [] });
  assert.deepEqual(result.completion, { finishReason: "stop", outputCharacters: 30, failure: null, locallyRepaired: false });
});

test("a code fence and trailing commas are repaired losslessly", () => {
  const result = parse('```json\n{"intent":"x","operations":[{"op":"no_change","reason":"a, ]"},],}\n```');
  assert.deepEqual(result.value, { intent: "x", operations: [{ op: "no_change", reason: "a, ]" }] });
  assert.equal(result.completion.locallyRepaired, true);
  assert.equal(result.completion.failure, null);
});

test("prose around one complete JSON object is repaired losslessly", () => {
  const result = parse('Here is the plan: {"intent":"x","operations":[]} Hope this helps!');
  assert.deepEqual(result.value, { intent: "x", operations: [] });
  assert.equal(result.completion.locallyRepaired, true);
});

test("unterminated JSON is classified as truncation, not a generic parse failure", () => {
  for (const content of [
    '{"intent":"create_model","operations":[{"op":"create_object","name":"Cab',
    '{"intent":"create_model","operations":[{"op":"create_object"},',
    '```json\n{"intent":"create_model","operations":[',
  ]) {
    const result = parse(content);
    assert.ok(result.error instanceof StructuredOutputError, content);
    assert.equal(result.completion.failure, "truncated", content);
    assert.equal(result.completion.locallyRepaired, false);
  }
});

test("finish_reason length is truncation even when the text happens to parse", () => {
  const result = parse('{"intent":"x","operations":[]}', "length");
  assert.ok(result.error instanceof StructuredOutputError);
  assert.equal(result.completion.failure, "truncated");
  assert.equal(result.value, undefined);
});

test("no content with finish_reason length (budget spent before any output) is truncation", () => {
  const result = parse(null, "length");
  assert.equal(result.completion.failure, "truncated");
  assert.equal(result.completion.outputCharacters, 0);
});

test("non-JSON text is malformed and empty text is empty", () => {
  assert.equal(parse("not json{{{").completion.failure, "malformed");
  assert.equal(parse('{"a":1}}').completion.failure, null);
  assert.equal(parse("{\"a\":1]").completion.failure, "malformed");
  assert.equal(parse("   ").completion.failure, "empty");
});

test("errors and metadata never carry the raw response text", () => {
  const secret = '{"intent":"SECRET_INTENT","operations":[{"op":"create_object","name":"SECRET_NAME';
  const result = parse(secret);
  assert.ok(result.error instanceof StructuredOutputError);
  assert.doesNotMatch(result.error.message, /SECRET/);
  assert.doesNotMatch(JSON.stringify(result.completion), /SECRET/);
  assert.doesNotMatch(JSON.stringify(result.error.completion), /SECRET/);
});

test("usage is read from OpenAI-shaped fields and ignores anything unsafe", () => {
  assert.deepEqual(
    readCompletionUsage({ prompt_tokens: 10, completion_tokens: 20, completion_tokens_details: { reasoning_tokens: 5 }, extra: "x" }),
    { promptTokens: 10, completionTokens: 20, reasoningTokens: 5 },
  );
  assert.equal(readCompletionUsage({ prompt_tokens: "10" }), undefined);
  assert.equal(readCompletionUsage(null), undefined);
});
