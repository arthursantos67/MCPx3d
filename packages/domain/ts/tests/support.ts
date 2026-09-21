import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const DOMAIN_ROOT = path.resolve(fileURLToPath(import.meta.url), "..", "..", "..");

export const SCHEMAS_DIR = path.join(DOMAIN_ROOT, "schemas");
export const FIXTURES_DIR = path.join(DOMAIN_ROOT, "fixtures");

export function loadJson<T = unknown>(...parts: string[]): T {
  return JSON.parse(readFileSync(path.join(...parts), "utf-8")) as T;
}
