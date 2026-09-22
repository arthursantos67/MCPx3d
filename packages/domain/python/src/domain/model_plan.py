"""ModelPlan v1 Python types (PRD §8.3).

Mirrors `packages/domain/schemas/model-plan.v1.schema.json`. `operations` is a
discriminated union on `op`: an unrecognized `op` value, or any field not
declared on its variant (`extra="forbid"` everywhere), fails validation --
so no executable-code field can ever reach an accepted ModelPlan.
"""

from __future__ import annotations

import math
import re
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, model_validator

from domain.model_spec import PrimitiveKind

_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]+$")
_COLOR_PATTERN = re.compile(r"^#[0-9a-f]{6}$")


def _check_id(value: str) -> str:
    if not _ID_PATTERN.match(value):
        raise ValueError("id must match ^[A-Za-z0-9_-]+$")
    return value


def _check_color(value: str) -> str:
    if not _COLOR_PATTERN.match(value):
        raise ValueError("color must be a normalized lowercase 6-digit hex value, e.g. #ff0000")
    return value


def _check_dimensions(value: dict[str, float]) -> dict[str, float]:
    if not value:
        raise ValueError("dimensions must not be empty")
    for key, amount in value.items():
        if not (math.isfinite(amount) and amount > 0):
            raise ValueError(f"dimension '{key}' must be a positive, finite number")
    return value


def _check_finite_vec3(value: tuple[float, float, float]) -> tuple[float, float, float]:
    if not all(math.isfinite(component) for component in value):
        raise ValueError("components must be finite numbers")
    return value


def _check_nonzero_vec3(value: tuple[float, float, float]) -> tuple[float, float, float]:
    if any(component == 0 for component in value):
        raise ValueError("factor components must be nonzero")
    return value


Vec3 = Annotated[tuple[float, float, float], AfterValidator(_check_finite_vec3)]
ObjectId = Annotated[str, AfterValidator(_check_id)]
Color = Annotated[str, AfterValidator(_check_color)]
Dimensions = Annotated[dict[str, float], AfterValidator(_check_dimensions)]
NonzeroVec3 = Annotated[Vec3, AfterValidator(_check_nonzero_vec3)]


class CreateObject(BaseModel):
    model_config = ConfigDict(extra="forbid")

    op: Literal["create_object"] = "create_object"
    id: ObjectId | None = None
    name: str = Field(min_length=1)
    kind: PrimitiveKind
    dimensions: Dimensions
    position: Vec3 | None = None
    rotation: Vec3 | None = None
    color: Color | None = None
    tags: list[str] | None = None


class DeleteObject(BaseModel):
    model_config = ConfigDict(extra="forbid")

    op: Literal["delete_object"] = "delete_object"
    target: ObjectId


class DuplicateObject(BaseModel):
    model_config = ConfigDict(extra="forbid")

    op: Literal["duplicate_object"] = "duplicate_object"
    target: ObjectId
    newId: ObjectId
    offset: Vec3 | None = None


class SetDimensions(BaseModel):
    model_config = ConfigDict(extra="forbid")

    op: Literal["set_dimensions"] = "set_dimensions"
    target: ObjectId
    dimensions: Dimensions


class TranslateObject(BaseModel):
    """Moves `target` by `delta`, relative to its current position."""

    model_config = ConfigDict(extra="forbid")

    op: Literal["translate_object"] = "translate_object"
    target: ObjectId
    delta: Vec3


class RotateObject(BaseModel):
    """Rotates `target` by `delta` (radians per axis), relative to its current rotation."""

    model_config = ConfigDict(extra="forbid")

    op: Literal["rotate_object"] = "rotate_object"
    target: ObjectId
    delta: Vec3


class ScaleObject(BaseModel):
    """Multiplies `target`'s current scale by `factor` per axis."""

    model_config = ConfigDict(extra="forbid")

    op: Literal["scale_object"] = "scale_object"
    target: ObjectId
    factor: NonzeroVec3


class SetMaterial(BaseModel):
    model_config = ConfigDict(extra="forbid")

    op: Literal["set_material"] = "set_material"
    target: ObjectId
    color: Color | None = None
    transparency: float | None = Field(default=None, ge=0, le=1)

    @model_validator(mode="after")
    def _at_least_one_field(self) -> SetMaterial:
        if self.color is None and self.transparency is None:
            raise ValueError("set_material requires color and/or transparency")
        return self


class RenameObject(BaseModel):
    model_config = ConfigDict(extra="forbid")

    op: Literal["rename_object"] = "rename_object"
    target: ObjectId
    name: str = Field(min_length=1)


class SetScene(BaseModel):
    model_config = ConfigDict(extra="forbid")

    op: Literal["set_scene"] = "set_scene"
    background: str | None = None
    displayScale: float | None = Field(default=None, gt=0, allow_inf_nan=False)

    @model_validator(mode="after")
    def _at_least_one_field(self) -> SetScene:
        if self.background is None and self.displayScale is None:
            raise ValueError("set_scene requires background and/or displayScale")
        return self


class Clarify(BaseModel):
    """Asks the user for missing/ambiguous information. Never mutates ModelSpec."""

    model_config = ConfigDict(extra="forbid")

    op: Literal["clarify"] = "clarify"
    question: str = Field(min_length=1)


class NoChange(BaseModel):
    """Responds without modifying geometry."""

    model_config = ConfigDict(extra="forbid")

    op: Literal["no_change"] = "no_change"
    reason: str | None = None


Operation = Annotated[
    CreateObject
    | DeleteObject
    | DuplicateObject
    | SetDimensions
    | TranslateObject
    | RotateObject
    | ScaleObject
    | SetMaterial
    | RenameObject
    | SetScene
    | Clarify
    | NoChange,
    Field(discriminator="op"),
]


class ModelPlan(BaseModel):
    model_config = ConfigDict(extra="forbid")

    intent: str = Field(min_length=1)
    operations: list[Operation]
