import assert from "node:assert/strict";
import { test } from "node:test";

import { MockLLMProvider } from "../src/mock-provider.ts";

test("returns scripted responses in order", async () => {
  const provider = new MockLLMProvider([{ a: 1 }, { a: 2 }]);

  assert.deepEqual(await provider.generateStructured([], {}), { a: 1 });
  assert.deepEqual(await provider.generateStructured([], {}), { a: 2 });
  assert.equal(provider.calls.length, 2);
});

test("a scripted string is re-parsed as JSON, malformed strings throw", async () => {
  const provider = new MockLLMProvider(['{"a":1}', "not json{{{"]);

  assert.deepEqual(await provider.generateStructured([], {}), { a: 1 });
  await assert.rejects(() => provider.generateStructured([], {}));
});

test("a scripted function receives the call's messages and schema", async () => {
  const schema = { type: "object" };
  const provider = new MockLLMProvider([
    (messages, receivedSchema) => ({ messageCount: messages.length, schema: receivedSchema }),
  ]);

  const result = await provider.generateStructured(
    [{ role: "user", content: "hi" }],
    schema,
  );

  assert.deepEqual(result, { messageCount: 1, schema });
});

test("exhausting scripted responses throws instead of returning undefined", async () => {
  const provider = new MockLLMProvider([{ a: 1 }]);
  await provider.generateStructured([], {});

  await assert.rejects(() => provider.generateStructured([], {}), /no more scripted responses/);
});

test("isAvailable reflects the constructor option, defaulting to true", async () => {
  assert.equal(await new MockLLMProvider([]).isAvailable(), true);
  assert.equal(await new MockLLMProvider([], { available: false }).isAvailable(), false);
});
