from __future__ import annotations

import re
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


class Vector3(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    x: float = Field(ge=-10_000, le=10_000, allow_inf_nan=False)
    y: float = Field(ge=-10_000, le=10_000, allow_inf_nan=False)
    z: float = Field(ge=-10_000, le=10_000, allow_inf_nan=False)


class Rotation3(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    x: float = Field(ge=-360, le=360, allow_inf_nan=False)
    y: float = Field(ge=-360, le=360, allow_inf_nan=False)
    z: float = Field(ge=-360, le=360, allow_inf_nan=False)


class CircularPattern(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    kind: Literal["circular"]
    count: int = Field(ge=2, le=64)
    axis: Literal["x", "y", "z"] = "z"
    center: Vector3 = Field(default_factory=lambda: Vector3(x=0, y=0, z=0))
    sweepAngle: float = Field(default=360, gt=0, le=360, allow_inf_nan=False)


class LinearPattern(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    kind: Literal["linear"]
    count: int = Field(ge=2, le=64)
    offset: Vector3

    @model_validator(mode="after")
    def _nonzero_offset(self) -> LinearPattern:
        if self.offset.x == self.offset.y == self.offset.z == 0:
            raise ValueError("linear pattern offset must be nonzero")
        return self


Pattern = Annotated[CircularPattern | LinearPattern, Field(discriminator="kind")]


class StepBase(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    id: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    op: Literal["base", "union", "cut"]
    position: Vector3
    rotation: Rotation3
    pattern: Pattern | None = None


class BoxStep(StepBase):
    shape: Literal["box"]
    width: float = Field(ge=0.1, le=10_000, allow_inf_nan=False)
    depth: float = Field(ge=0.1, le=10_000, allow_inf_nan=False)
    height: float = Field(ge=0.1, le=10_000, allow_inf_nan=False)


class CylinderStep(StepBase):
    shape: Literal["cylinder"]
    diameter: float = Field(ge=0.1, le=10_000, allow_inf_nan=False)
    height: float = Field(ge=0.1, le=10_000, allow_inf_nan=False)


class SphereStep(StepBase):
    shape: Literal["sphere"]
    diameter: float = Field(ge=0.1, le=10_000, allow_inf_nan=False)


class ConeStep(StepBase):
    shape: Literal["cone"]
    bottomDiameter: float = Field(ge=0.1, le=10_000, allow_inf_nan=False)
    topDiameter: float = Field(ge=0, le=10_000, allow_inf_nan=False)
    height: float = Field(ge=0.1, le=10_000, allow_inf_nan=False)


class Point2(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    x: float = Field(ge=-10_000, le=10_000, allow_inf_nan=False)
    y: float = Field(ge=-10_000, le=10_000, allow_inf_nan=False)


class PolygonStep(StepBase):
    shape: Literal["polygon_prism"]
    points: list[Point2] = Field(min_length=3, max_length=32)
    height: float = Field(ge=0.1, le=10_000, allow_inf_nan=False)

    @model_validator(mode="after")
    def _valid_outline(self) -> PolygonStep:
        area = sum(a.x * b.y - b.x * a.y for a, b in zip(self.points, self.points[1:] + self.points[:1])) / 2
        if abs(area) < 0.01:
            raise ValueError("polygon profile must enclose an area")
        return self


class RevolveStep(StepBase):
    shape: Literal["revolve_profile"]
    points: list[Point2] = Field(min_length=3, max_length=32)

    @model_validator(mode="after")
    def _valid_profile(self) -> RevolveStep:
        if any(point.x < 0 for point in self.points):
            raise ValueError("revolved profile radius cannot be negative")
        area = sum(a.x * b.y - b.x * a.y for a, b in zip(self.points, self.points[1:] + self.points[:1])) / 2
        if abs(area) < 0.01:
            raise ValueError("revolved profile must enclose an area")
        return self


CadStep = Annotated[BoxStep | CylinderStep | SphereStep | ConeStep | PolygonStep | RevolveStep, Field(discriminator="shape")]


class CadProgramSpec(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    schemaVersion: Literal["3.0"]
    units: Literal["mm"]
    partId: str = Field(min_length=1, max_length=64)
    steps: list[CadStep] = Field(min_length=1, max_length=32)

    @model_validator(mode="after")
    def _valid_program(self) -> CadProgramSpec:
        if not _ID.fullmatch(self.partId):
            raise ValueError("partId must use letters, digits, underscores or hyphens")
        if self.steps[0].op != "base" or any(step.op == "base" for step in self.steps[1:]):
            raise ValueError("the first step must be the only base operation")
        if self.steps[0].pattern is not None:
            raise ValueError("the base step cannot be repeated")
        if sum(step.pattern.count if step.pattern else 1 for step in self.steps) > 256:
            raise ValueError("CAD program exceeds 256 patterned instances")
        ids = [step.id for step in self.steps]
        if len(ids) != len(set(ids)):
            raise ValueError("CAD step IDs must be unique")
        return self
