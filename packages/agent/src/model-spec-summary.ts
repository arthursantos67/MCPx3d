/**
 * Minimal `ModelSpec` -> text summary for agent prompt context (PRD §10.5,
 * FR-31 "summarized current ModelSpec"). Deliberately small: this exists so
 * Issue #19's generation loop can give the model existing object
 * ids/names/kinds/dimensions/transforms/colors to target, which is as far as
 * this issue's scope goes. Issue #34 ("Implement ModelSpec summarizer for
 * agent context") replaces this with a bounded, more complete summarizer;
 * callers should not depend on this exact text format remaining stable.
 */

import type { ModelSpec } from "../../domain/ts/src/model-spec.ts";

export const DEFAULT_MODEL_SPEC_SUMMARY_MAX_CHARACTERS = 4_000;
export const DEFAULT_MODEL_SPEC_SUMMARY_MAX_OBJECTS = 32;
export const MAX_MODEL_SPEC_SUMMARY_CHARACTERS = 8_000;
export const MAX_MODEL_SPEC_SUMMARY_OBJECTS = 40;

export interface ModelSpecSummaryOptions {
  readonly maxCharacters?: number;
  readonly maxObjects?: number;
}

function boundedPositiveInteger(value: number | undefined, fallback: number, maximum: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0
    ? Math.min(Math.floor(value), maximum)
    : fallback;
}

function describeObject(object: ModelSpec["objects"][number]): string {
  const dimensions = Object.entries(object.dimensions)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join(", ");
  const [x, y, z] = object.transform.position;
  const [rx, ry, rz] = object.transform.rotation;
  const [sx, sy, sz] = object.transform.scale;
  return `- id=${object.id} name=${JSON.stringify(object.name)} kind=${object.kind} dimensions={${dimensions}} position=(${x}, ${y}, ${z}) rotation=(${rx}, ${ry}, ${rz}) scale=(${sx}, ${sy}, ${sz}) color=${object.material.color}`;
}

function omissionNotice(count: number): string {
  return `(${count} additional object${count === 1 ? "" : "s"} omitted from this bounded summary)`;
}

export function summarizeModelSpec(spec: ModelSpec, options?: ModelSpecSummaryOptions): string {
  const title = spec.scene.title ?? "Untitled model";
  if (spec.objects.length === 0) return `Scene title: ${JSON.stringify(title)}\n(empty scene -- no objects yet)`;

  const maxCharacters = boundedPositiveInteger(
    options?.maxCharacters,
    DEFAULT_MODEL_SPEC_SUMMARY_MAX_CHARACTERS,
    MAX_MODEL_SPEC_SUMMARY_CHARACTERS,
  );
  const maxObjects = boundedPositiveInteger(
    options?.maxObjects,
    DEFAULT_MODEL_SPEC_SUMMARY_MAX_OBJECTS,
    MAX_MODEL_SPEC_SUMMARY_OBJECTS,
  );
  const lines: string[] = [];
  let omitted = Math.max(0, spec.objects.length - maxObjects);

  for (const [index, object] of spec.objects.slice(0, maxObjects).entries()) {
    const line = describeObject(object);
    const remaining = spec.objects.length - index - 1;
    const notice = remaining > 0 ? omissionNotice(remaining) : "";
    const candidate = [...lines, line, ...(notice ? [notice] : [])].join("\n");
    if (candidate.length > maxCharacters) {
      omitted = spec.objects.length - index;
      break;
    }
    lines.push(line);
  }

  const summary = [`Scene title: ${JSON.stringify(title)}`, ...lines, ...(omitted > 0 ? [omissionNotice(omitted)] : [])].join("\n");
  return summary.length <= maxCharacters ? summary : summary.slice(0, maxCharacters);
}
