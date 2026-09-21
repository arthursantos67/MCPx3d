/**
 * ModelSpec v1 TypeScript types (PRD §8.2).
 *
 * Mirrors packages/domain/schemas/model-spec.v1.schema.json and
 * packages/domain/python/src/domain/model_spec.py. Rules the type system and
 * JSON Schema cannot express -- unique object IDs, positive dimensions,
 * normalized color format -- are enforced by validateModelSpecDomainRules.
 */

export type Units = "mm" | "cm" | "m" | "unitless";
export type PrimitiveKind = "box" | "sphere" | "cylinder" | "cone";
export type Vec3 = [number, number, number];

export interface Scene {
  background?: string;
  displayScale: number;
}

export interface Transform {
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
}

export interface Material {
  color: string;
  transparency?: number;
}

export interface ModelObject {
  id: string;
  name: string;
  kind: PrimitiveKind;
  dimensions: Record<string, number>;
  transform: Transform;
  material: Material;
  tags?: string[];
}

export interface ModelSpec {
  schemaVersion: "1.0";
  projectId: string;
  revision: number;
  units: Units;
  scene: Scene;
  objects: ModelObject[];
}

export const ID_PATTERN = /^[A-Za-z0-9_-]+$/;
export const COLOR_PATTERN = /^#[0-9a-f]{6}$/;

export class ModelSpecValidationError extends Error {}

function fail(message: string): never {
  throw new ModelSpecValidationError(message);
}

/** Assumes `spec` already matches the ModelSpec shape (e.g. schema-validated JSON). */
export function validateModelSpecDomainRules(spec: ModelSpec): void {
  if (!(spec.scene.displayScale > 0) || !Number.isFinite(spec.scene.displayScale)) {
    fail("scene.displayScale must be a positive, finite number");
  }

  const seenIds = new Set<string>();
  for (const obj of spec.objects) {
    if (!ID_PATTERN.test(obj.id)) {
      fail(`object id '${obj.id}' must match ${ID_PATTERN}`);
    }
    if (seenIds.has(obj.id)) {
      fail(`duplicate object id: ${obj.id}`);
    }
    seenIds.add(obj.id);

    const dimensionEntries = Object.entries(obj.dimensions);
    if (dimensionEntries.length === 0) {
      fail(`object '${obj.id}' dimensions must not be empty`);
    }
    for (const [key, value] of dimensionEntries) {
      if (!(value > 0) || !Number.isFinite(value)) {
        fail(`object '${obj.id}' dimension '${key}' must be a positive, finite number`);
      }
    }

    if (obj.transform.scale.some((component) => component === 0)) {
      fail(`object '${obj.id}' scale components must be nonzero`);
    }

    if (!COLOR_PATTERN.test(obj.material.color)) {
      fail(`object '${obj.id}' color must be a normalized lowercase 6-digit hex value, e.g. #ff0000`);
    }
    if (
      obj.material.transparency !== undefined &&
      (obj.material.transparency < 0 || obj.material.transparency > 1)
    ) {
      fail(`object '${obj.id}' transparency must be between 0 and 1`);
    }
  }
}
