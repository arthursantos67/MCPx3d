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

export function summarizeModelSpec(spec: ModelSpec): string {
  if (spec.objects.length === 0) {
    return "(empty scene -- no objects yet)";
  }

  return spec.objects
    .map((object) => {
      const dimensions = Object.entries(object.dimensions)
        .map(([key, value]) => `${key}=${value}`)
        .join(", ");
      const [x, y, z] = object.transform.position;
      const [rx, ry, rz] = object.transform.rotation;
      const [sx, sy, sz] = object.transform.scale;
      return (
        `- id=${object.id} name="${object.name}" kind=${object.kind} ` +
        `dimensions={${dimensions}} position=(${x}, ${y}, ${z}) ` +
        `rotation=(${rx}, ${ry}, ${rz}) scale=(${sx}, ${sy}, ${sz}) ` +
        `color=${object.material.color}`
      );
    })
    .join("\n");
}
