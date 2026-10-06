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
    position: Vector3
    rotation: Rotation3
    pattern: Pattern | None = None


class PrimitiveStep(StepBase):
    op: Literal["base", "union", "cut"]


class BoxStep(PrimitiveStep):
    shape: Literal["box"]
    width: float = Field(ge=0.1, le=10_000, allow_inf_nan=False)
    depth: float = Field(ge=0.1, le=10_000, allow_inf_nan=False)
    height: float = Field(ge=0.1, le=10_000, allow_inf_nan=False)


class CylinderStep(PrimitiveStep):
    shape: Literal["cylinder"]
    diameter: float = Field(ge=0.1, le=10_000, allow_inf_nan=False)
    height: float = Field(ge=0.1, le=10_000, allow_inf_nan=False)


class SphereStep(PrimitiveStep):
    shape: Literal["sphere"]
    diameter: float = Field(ge=0.1, le=10_000, allow_inf_nan=False)


class ConeStep(PrimitiveStep):
    shape: Literal["cone"]
    bottomDiameter: float = Field(ge=0.1, le=10_000, allow_inf_nan=False)
    topDiameter: float = Field(ge=0, le=10_000, allow_inf_nan=False)
    height: float = Field(ge=0.1, le=10_000, allow_inf_nan=False)


class Point2(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    x: float = Field(ge=-10_000, le=10_000, allow_inf_nan=False)
    y: float = Field(ge=-10_000, le=10_000, allow_inf_nan=False)


class PolygonStep(PrimitiveStep):
    shape: Literal["polygon_prism"]
    points: list[Point2] = Field(min_length=3, max_length=32)
    height: float = Field(ge=0.1, le=10_000, allow_inf_nan=False)

    @model_validator(mode="after")
    def _valid_outline(self) -> PolygonStep:
        area = sum(a.x * b.y - b.x * a.y for a, b in zip(self.points, self.points[1:] + self.points[:1])) / 2
        if abs(area) < 0.01:
            raise ValueError("polygon profile must enclose an area")
        return self


class RevolveStep(PrimitiveStep):
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


class TubeStep(PrimitiveStep):
    shape: Literal["tube"]
    diameter: float = Field(ge=0.1, le=10_000, allow_inf_nan=False)
    innerDiameter: float = Field(gt=0, le=10_000, allow_inf_nan=False)
    height: float = Field(ge=0.1, le=10_000, allow_inf_nan=False)

    @model_validator(mode="after")
    def _wall(self) -> TubeStep:
        if self.diameter - self.innerDiameter < 0.2:
            raise ValueError("tube needs at least 0.1 mm radial wall")
        return self


class TorusStep(PrimitiveStep):
    shape: Literal["torus"]
    majorRadius: float = Field(ge=0.1, le=5_000, allow_inf_nan=False)
    minorRadius: float = Field(ge=0.1, le=5_000, allow_inf_nan=False)

    @model_validator(mode="after")
    def _radii(self) -> TorusStep:
        if self.majorRadius <= self.minorRadius:
            raise ValueError("torus majorRadius must exceed minorRadius")
        return self


class SlotStep(PrimitiveStep):
    shape: Literal["slot"]
    length: float = Field(ge=0.1, le=10_000, allow_inf_nan=False)
    width: float = Field(ge=0.1, le=10_000, allow_inf_nan=False)
    height: float = Field(ge=0.1, le=10_000, allow_inf_nan=False)

    @model_validator(mode="after")
    def _length(self) -> SlotStep:
        if self.length <= self.width:
            raise ValueError("slot length must exceed width; length includes the round ends")
        return self


class HoleStep(StepBase):
    op: Literal["cut"]
    shape: Literal["hole"]
    holeType: Literal["plain", "counterbore", "countersink"]
    diameter: float = Field(ge=0.1, le=10_000, allow_inf_nan=False)
    height: float = Field(ge=0.1, le=10_000, allow_inf_nan=False)
    headDiameter: float = Field(ge=0, le=10_000, allow_inf_nan=False)
    headDepth: float = Field(ge=0, le=10_000, allow_inf_nan=False)

    @model_validator(mode="after")
    def _head(self) -> HoleStep:
        if self.holeType == "plain":
            if self.headDiameter != 0 or self.headDepth != 0:
                raise ValueError("plain hole must set headDiameter and headDepth to zero")
        elif self.headDiameter <= self.diameter or not 0 < self.headDepth < self.height:
            raise ValueError("hole head must be wider than its bore and shallower than height")
        return self


class ThreadStep(PrimitiveStep):
    shape: Literal["thread"]
    diameter: float = Field(ge=1, le=1_000, allow_inf_nan=False)
    pitch: float = Field(ge=0.25, le=100, allow_inf_nan=False)
    height: float = Field(ge=0.25, le=10_000, allow_inf_nan=False)
    profile: Literal["metric", "trapezoidal"]
    handedness: Literal["right", "left"]
    clearance: float = Field(ge=0, le=2, allow_inf_nan=False)
    starts: int = Field(default=1, ge=1, le=4)

    @model_validator(mode="after")
    def _thread(self) -> ThreadStep:
        depth = self.pitch * (0.613434654 if self.profile == "metric" else 0.5)
        if self.diameter / 2 - depth < 0.1:
            raise ValueError("thread pitch leaves no positive core; increase diameter or reduce pitch")
        if self.height < self.pitch or self.height / self.pitch > 80:
            raise ValueError("thread height must contain 1 to 80 pitches")
        if self.clearance > self.pitch / 4 or (self.op != "cut" and self.clearance != 0):
            raise ValueError("thread clearance is radial, at most pitch/4, and only allowed for an internal cut")
        return self


class CircleSection(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    kind: Literal["circle"]
    z: float = Field(ge=-10_000, le=10_000, allow_inf_nan=False)
    diameter: float = Field(ge=0.1, le=10_000, allow_inf_nan=False)


class RectangleSection(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    kind: Literal["rectangle"]
    z: float = Field(ge=-10_000, le=10_000, allow_inf_nan=False)
    width: float = Field(ge=0.1, le=10_000, allow_inf_nan=False)
    depth: float = Field(ge=0.1, le=10_000, allow_inf_nan=False)


LoftSection = Annotated[CircleSection | RectangleSection, Field(discriminator="kind")]


class LoftStep(PrimitiveStep):
    shape: Literal["loft"]
    sections: list[LoftSection] = Field(min_length=2, max_length=8)
    ruled: bool = False

    @model_validator(mode="after")
    def _sections(self) -> LoftStep:
        if any(b.z - a.z < 0.1 for a, b in zip(self.sections, self.sections[1:])):
            raise ValueError("loft sections must have strictly increasing z, at least 0.1 mm apart")
        if self.sections[-1].z - self.sections[0].z > 10_000:
            raise ValueError("loft span exceeds 10000 mm")
        return self


EdgeSelector = Literal["all", "parallel_x", "parallel_y", "parallel_z", "circular", "top", "bottom",
                       "positive_x", "negative_x", "positive_y", "negative_y"]
FaceSelector = Literal["top", "bottom", "positive_x", "negative_x", "positive_y", "negative_y"]


class ModifierStep(StepBase):
    op: Literal["modify"]
    pattern: None = None

    @model_validator(mode="after")
    def _placement(self) -> ModifierStep:
        if any(value != 0 for value in (*self.position.model_dump().values(), *self.rotation.model_dump().values())):
            raise ValueError("finishing modifies the current part; position and rotation must be zero")
        return self


class FilletStep(ModifierStep):
    shape: Literal["fillet"]
    selector: EdgeSelector
    radius: float = Field(ge=0.1, le=1_000, allow_inf_nan=False)


class ChamferStep(ModifierStep):
    shape: Literal["chamfer"]
    selector: EdgeSelector
    distance: float = Field(ge=0.1, le=1_000, allow_inf_nan=False)


class ShellStep(ModifierStep):
    shape: Literal["shell"]
    selector: FaceSelector
    thickness: float = Field(ge=0.1, le=1_000, allow_inf_nan=False)


CadStep = Annotated[
    BoxStep | CylinderStep | SphereStep | ConeStep | PolygonStep | RevolveStep | TubeStep | TorusStep |
    SlotStep | HoleStep | ThreadStep | LoftStep | FilletStep | ChamferStep | ShellStep,
    Field(discriminator="shape"),
]


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
        if sum(step.height / step.pitch * (step.pattern.count if step.pattern else 1)
               for step in self.steps if isinstance(step, ThreadStep)) > 160:
            raise ValueError("CAD program exceeds 160 thread pitches including patterns")
        ids = [step.id for step in self.steps]
        if len(ids) != len(set(ids)):
            raise ValueError("CAD step IDs must be unique")
        return self
