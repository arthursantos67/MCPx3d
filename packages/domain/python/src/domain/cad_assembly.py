from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from domain.cad_program import CadProgramSpec, CadStep, Vector3


class CadMotion(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    kind: Literal["slider", "screw", "rotary"]
    axis: Literal["x", "y", "z"]
    minimum: float = Field(ge=-10_000, le=10_000, allow_inf_nan=False)
    maximum: float = Field(ge=-10_000, le=10_000, allow_inf_nan=False)
    value: float = Field(ge=-10_000, le=10_000, allow_inf_nan=False)
    pitch: float | None = Field(default=None, gt=0, le=1_000, allow_inf_nan=False)
    group: str | None = Field(default=None, min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")

    @model_validator(mode="after")
    def _valid_range(self) -> CadMotion:
        if self.minimum >= self.maximum or not self.minimum <= self.value <= self.maximum:
            raise ValueError("CAD motion value must lie within a nonempty travel range")
        if (self.kind == "screw") != (self.pitch is not None):
            raise ValueError("screw motion needs a pitch; slider motion must omit it")
        return self


class CadComponent(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    id: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    position: Vector3
    steps: list[CadStep] = Field(min_length=1, max_length=32)
    motion: CadMotion | None = None

    @model_validator(mode="after")
    def _valid_program(self) -> CadComponent:
        CadProgramSpec(schemaVersion="3.0", units="mm", partId=self.id, steps=self.steps)
        return self


class CadAssemblySpec(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    schemaVersion: Literal["4.0"]
    units: Literal["mm"]
    partId: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    components: list[CadComponent] = Field(min_length=2, max_length=8)

    @model_validator(mode="after")
    def _valid_components(self) -> CadAssemblySpec:
        ids = [component.id for component in self.components]
        if len(ids) != len(set(ids)):
            raise ValueError("CAD component IDs must be unique")
        if sum(len(component.steps) for component in self.components) > 128:
            raise ValueError("CAD assembly exceeds 128 construction steps")
        if not any(component.motion is None for component in self.components):
            raise ValueError("CAD assembly needs at least one fixed component")
        groups: dict[str, tuple[float, float, float, str]] = {}
        for component in self.components:
            motion = component.motion
            if motion is None or motion.group is None:
                continue
            travel = (motion.minimum, motion.maximum, motion.value,
                      "degrees" if motion.kind == "rotary" else "mm")
            if motion.group in groups and groups[motion.group] != travel:
                raise ValueError(f"CAD motion group {motion.group} must share range and value")
            groups[motion.group] = travel
        return self
