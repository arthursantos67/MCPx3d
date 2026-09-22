/**
 * BYOK provider configuration, persisted in the browser (PRD §3.12's "UI
 * preferences" browser persistence). `mode: "local"` (the default, when
 * nothing is saved yet) leaves today's behavior unchanged -- `WebLLMProvider`
 * is still what `useChatController.ts` constructs. `mode: "byok"` is only
 * ever chosen explicitly, via `ProviderSettings`.
 *
 * `KeyValueStore` is injected (same DI convention as this codebase's other
 * browser-only integrations, e.g. `viewer/objectUrl.ts`'s `ObjectUrlFactory`)
 * so this is unit-tested without a real `localStorage`. `load`/`save`/`clear`
 * each wrap their storage call in `try`/`catch` themselves (not just the
 * default `localStorage` factory below), so a *throwing* store -- the real
 * `localStorage` in private browsing/blocked-storage, or any other backend a
 * caller injects -- degrades to "the config simply won't persist" instead of
 * crashing the app either way.
 */

export type ProviderConfig =
  | { readonly mode: "local" }
  | { readonly mode: "byok"; readonly baseUrl: string; readonly apiKey: string; readonly model: string };

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const STORAGE_KEY = "ai-web3d-modeler.provider-config.v1";
const LOCAL_CONFIG: ProviderConfig = { mode: "local" };

function defaultStorage(): KeyValueStore {
  return window.localStorage;
}

function isByokConfig(value: unknown): value is Extract<ProviderConfig, { mode: "byok" }> {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    record.mode === "byok" &&
    typeof record.baseUrl === "string" &&
    typeof record.apiKey === "string" &&
    typeof record.model === "string"
  );
}

export function loadProviderConfig(storage: KeyValueStore = defaultStorage()): ProviderConfig {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return LOCAL_CONFIG;
    const parsed: unknown = JSON.parse(raw);
    return isByokConfig(parsed) ? parsed : LOCAL_CONFIG;
  } catch {
    return LOCAL_CONFIG;
  }
}

export function saveProviderConfig(config: ProviderConfig, storage: KeyValueStore = defaultStorage()): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // Storage unavailable (private browsing, quota, blocked) -- the config
    // simply won't persist across reloads; not fatal.
  }
}

export function clearProviderConfig(storage: KeyValueStore = defaultStorage()): void {
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    // See saveProviderConfig: best-effort only.
  }
}

/** A BYOK config only takes effect once every field is actually filled in;
 * an in-progress/partial form falls back to the local default. */
export function isUsableByokConfig(config: ProviderConfig): config is Extract<ProviderConfig, { mode: "byok" }> {
  return (
    config.mode === "byok" &&
    config.baseUrl.trim().length > 0 &&
    config.apiKey.trim().length > 0 &&
    config.model.trim().length > 0
  );
}
