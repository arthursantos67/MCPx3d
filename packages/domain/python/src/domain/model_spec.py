"""ModelSpec v1 Python types (PRD §8.2).

Mirrors `packages/domain/schemas/model-spec.v1.schema.json`. Rules the JSON
Schema cannot express -- unique object IDs across the model -- are enforced
here as a model validator instead.
"""

from __future__ import annotations

import math
import re
from typing import Annotated, Literal

from pydantic import (
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)

Units = Literal["mm", "cm", "m", "unitless"]
PrimitiveKind = Literal["box", "sphere", "cylinder", "cone"]

_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]+$")
_COLOR_PATTERN = re.compile(r"^#[0-9a-f]{6}$")


def _json_array_to_tuple(value: object) -> object:
    return tuple(value) if isinstance(value, list) else value


Vec3 = Annotated[tuple[float, float, float], BeforeValidator(_json_array_to_tuple)]


class Scene(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    title: str = Field(default="Untitled model", min_length=1, max_length=80)
    titleSource: Literal["default", "agent", "user"] = "default"
    background: str | None = Field(default=None, min_length=1)
    displayScale: float = Field(gt=0, allow_inf_nan=False)


class Transform(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    position: Vec3
    rotation: Vec3
    scale: Vec3

    @field_validator("position", "rotation", "scale")
    @classmethod
    def _components_finite(cls, value: Vec3) -> Vec3:
        if not all(math.isfinite(component) for component in value):
            raise ValueError("components must be finite numbers")
        return value

    @field_validator("scale")
    @classmethod
    def _scale_nonzero(cls, value: Vec3) -> Vec3:
        if any(component == 0 for component in value):
            raise ValueError("scale components must be nonzero")
        return value


class Material(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    color: str
    transparency: float | None = Field(default=None, ge=0, le=1)

    @field_validator("color")
    @classmethod
    def _color_normalized(cls, value: str) -> str:
        if not _COLOR_PATTERN.match(value):
            raise ValueError("color must be a normalized lowercase 6-digit hex value, e.g. #ff0000")
        return value


class ModelObject(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    id: str
    name: str = Field(min_length=1)
    kind: PrimitiveKind
    dimensions: dict[str, float]
    transform: Transform
    material: Material
    tags: list[Annotated[str, Field(min_length=1)]] | None = None

    @field_validator("id")
    @classmethod
    def _id_format(cls, value: str) -> str:
        if not _ID_PATTERN.match(value):
            raise ValueError("id must match ^[A-Za-z0-9_-]+$")
        return value

    @field_validator("dimensions")
    @classmethod
    def _dimensions_positive(cls, value: dict[str, float]) -> dict[str, float]:
        if not value:
            raise ValueError("dimensions must not be empty")
        for key, amount in value.items():
            if not (math.isfinite(amount) and amount > 0):
                raise ValueError(f"dimension '{key}' must be a positive, finite number")
        return value


class ModelSpec(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    schemaVersion: Literal["1.0"]
    projectId: str = Field(min_length=1)
    revision: int = Field(ge=0)
    units: Units
    scene: Scene
    objects: list[ModelObject]

    @model_validator(mode="after")
    def _unique_object_ids(self) -> ModelSpec:
        seen: set[str] = set()
        for obj in self.objects:
            if obj.id in seen:
                raise ValueError(f"duplicate object id: {obj.id}")
            seen.add(obj.id)
        return self
