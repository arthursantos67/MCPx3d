import assert from "node:assert/strict";
import { test } from "node:test";

import {
  clearProviderConfig,
  isUsableByokConfig,
  loadProviderConfig,
  saveProviderConfig,
  type KeyValueStore,
} from "../../src/settings/providerConfig.ts";

function fakeStore(initial: Record<string, string> = {}): KeyValueStore {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}

function throwingStore(): KeyValueStore {
  return {
    getItem: () => {
      throw new Error("storage blocked");
    },
    setItem: () => {
      throw new Error("storage blocked");
    },
    removeItem: () => {
      throw new Error("storage blocked");
    },
  };
}

test("loadProviderConfig defaults to local mode when nothing is stored", () => {
  const store = fakeStore();

  assert.deepEqual(loadProviderConfig(store), { mode: "local" });
});

test("saveProviderConfig then loadProviderConfig round-trips a byok config", () => {
  const store = fakeStore();
  const config = { mode: "byok" as const, baseUrl: "https://api.example.com/v1", apiKey: "sk-test", model: "test-model" };

  saveProviderConfig(config, store);

  assert.deepEqual(loadProviderConfig(store), config);
});

test("clearProviderConfig resets back to the local default", () => {
  const store = fakeStore();
  saveProviderConfig({ mode: "byok", baseUrl: "https://api.example.com/v1", apiKey: "sk-test", model: "test-model" }, store);

  clearProviderConfig(store);

  assert.deepEqual(loadProviderConfig(store), { mode: "local" });
});

test("malformed stored JSON falls back to local mode instead of throwing", () => {
  const store = fakeStore({ "ai-web3d-modeler.provider-config.v1": "not json{{{" });

  assert.deepEqual(loadProviderConfig(store), { mode: "local" });
});

test("a stored object missing required byok fields falls back to local mode", () => {
  const store = fakeStore({ "ai-web3d-modeler.provider-config.v1": JSON.stringify({ mode: "byok", baseUrl: "x" }) });

  assert.deepEqual(loadProviderConfig(store), { mode: "local" });
});

test("a throwing storage backend does not crash load/save/clear", () => {
  const store = throwingStore();

  assert.deepEqual(loadProviderConfig(store), { mode: "local" });
  assert.doesNotThrow(() => saveProviderConfig({ mode: "local" }, store));
  assert.doesNotThrow(() => clearProviderConfig(store));
});

test("isUsableByokConfig requires every field to be non-empty", () => {
  assert.equal(isUsableByokConfig({ mode: "local" }), false);
  assert.equal(isUsableByokConfig({ mode: "byok", baseUrl: "", apiKey: "sk", model: "m" }), false);
  assert.equal(isUsableByokConfig({ mode: "byok", baseUrl: "  ", apiKey: "sk", model: "m" }), false);
  assert.equal(
    isUsableByokConfig({ mode: "byok", baseUrl: "https://api.example.com/v1", apiKey: "sk", model: "m" }),
    true,
  );
});
