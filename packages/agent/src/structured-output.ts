/**
 * Turns one provider completion into a JSON value, classifying why it could
 * not when it fails (Issue #71). Shared by every `LLMProvider` so truncation
 * is recognized the same way everywhere: `finish_reason: "length"` or JSON
 * that ends while an object, array, or string is still open is `truncated`,
 * never a generic parse failure.
 *
 * Local repair is lossless only -- stripping a code fence or surrounding
 * prose and dropping trailing commas. Nothing here closes an unterminated
 * object or drops a trailing operation, so a truncated response is never
 * turned into a shorter plan that looks complete. The repaired value still
 * goes through `generateModelPlan`'s normal schema/domain validation.
 *
 * The raw text never leaves this function: the thrown `StructuredOutputError`
 * and the reported `CompletionMetadata` carry only a classification and sizes.
 */

import {
  StructuredOutputError,
  type CompletionFailure,
  type CompletionMetadata,
  type CompletionUsage,
} from "./provider.ts";

export interface CompletionDetails {
  readonly finishReason?: string | null;
  readonly usage?: CompletionUsage;
}

type ParseResult = { readonly ok: true; readonly value: unknown } | { readonly ok: false };

export function parseStructuredCompletion(
  content: string | null | undefined,
  details: CompletionDetails,
  onCompletion?: (completion: CompletionMetadata) => void,
): unknown {
  const text = content ?? "";
  const base = {
    finishReason: details.finishReason ?? null,
    outputCharacters: text.length,
    ...(details.usage ? { usage: details.usage } : {}),
  };

  let failure: CompletionFailure | null = null;
  let value: unknown;
  let locallyRepaired = false;
  if (base.finishReason === "length") {
    failure = "truncated";
  } else if (text.trim().length === 0) {
    failure = "empty";
  } else {
    const direct = tryParse(text);
    if (direct.ok) {
      value = direct.value;
    } else {
      const repaired = losslessRepair(text);
      const reparsed = repaired === null ? { ok: false as const } : tryParse(repaired);
      if (reparsed.ok) {
        value = reparsed.value;
        locallyRepaired = true;
      } else {
        failure = isUnterminatedJson(text) ? "truncated" : "malformed";
      }
    }
  }

  const completion: CompletionMetadata = { ...base, failure, locallyRepaired };
  onCompletion?.(completion);
  if (failure !== null) throw new StructuredOutputError({ ...completion, failure });
  return value;
}

export function readCompletionUsage(usage: unknown): CompletionUsage | undefined {
  if (!isRecord(usage)) return undefined;
  const details = isRecord(usage.completion_tokens_details) ? usage.completion_tokens_details : {};
  const result: CompletionUsage = {
    ...tokenCount("promptTokens", usage.prompt_tokens),
    ...tokenCount("completionTokens", usage.completion_tokens),
    ...tokenCount("reasoningTokens", details.reasoning_tokens),
  };
  return Object.keys(result).length > 0 ? result : undefined;
}

function tokenCount(key: keyof CompletionUsage, value: unknown): CompletionUsage {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? { [key]: value } : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function tryParse(text: string): ParseResult {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

function withoutCodeFence(text: string): string {
  const fenced = /^\s*```[a-z]*\s*\n?([\s\S]*?)\s*```\s*$/i.exec(text);
  return fenced ? fenced[1] : text.replace(/^\s*```[a-z]*\s*\n?/i, "");
}

function losslessRepair(text: string): string | null {
  const unfenced = withoutCodeFence(text);
  const start = unfenced.search(/[{[]/);
  if (start < 0) return null;
  const scan = scanJsonValue(unfenced, start);
  if (scan.status !== "complete") return null;
  return withoutTrailingCommas(unfenced.slice(start, scan.end));
}

function isUnterminatedJson(text: string): boolean {
  const unfenced = withoutCodeFence(text);
  const start = unfenced.search(/\S/);
  if (start < 0 || (unfenced[start] !== "{" && unfenced[start] !== "[")) return false;
  return scanJsonValue(unfenced, start).status === "unterminated";
}

type ScanResult =
  | { readonly status: "complete"; readonly end: number }
  | { readonly status: "unterminated" }
  | { readonly status: "mismatched" };

/** Bracket/string-aware scan of the JSON value starting at `start`. */
function scanJsonValue(text: string, start: number): ScanResult {
  const closers: string[] = [];
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") closers.push("}");
    else if (char === "[") closers.push("]");
    else if (char === "}" || char === "]") {
      if (closers.pop() !== char) return { status: "mismatched" };
      if (closers.length === 0) return { status: "complete", end: index + 1 };
    }
  }
  return { status: "unterminated" };
}

function withoutTrailingCommas(text: string): string {
  let result = "";
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
    } else if (char === '"') {
      inString = true;
    } else if (char === "," && /^\s*[}\]]/.test(text.slice(index + 1))) {
      continue;
    }
    result += char;
  }
  return result;
}
