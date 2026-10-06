from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

Coordinate = Annotated[float, Field(allow_inf_nan=False)]
Volume = Annotated[float, Field(gt=0, allow_inf_nan=False)]
ComponentId = Annotated[str, Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")]
CadCollisionPose = Literal["current", "minimum", "quarter", "middle", "three_quarters", "maximum"]


class CadBounds(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    x: tuple[Coordinate, Coordinate]
    y: tuple[Coordinate, Coordinate]
    z: tuple[Coordinate, Coordinate]

    @model_validator(mode="after")
    def ordered(self) -> CadBounds:
        if any(lower > upper for lower, upper in (self.x, self.y, self.z)):
            raise ValueError("CAD bounds must be ordered")
        return self


class CadCollision(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    components: tuple[ComponentId, ComponentId]
    pose: CadCollisionPose
    message: str
    overlapVolumeMm3: Volume
    componentVolumesMm3: tuple[Volume, Volume]
    overlapBoundsMm: CadBounds
    componentBoundsMm: tuple[CadBounds, CadBounds]

    @model_validator(mode="after")
    def distinct_components(self) -> CadCollision:
        if self.components[0] == self.components[1]:
            raise ValueError("CAD collision must reference distinct components")
        return self


class CadMechanicalIssue(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    connectionId: str = Field(max_length=64, pattern=r"^[A-Za-z0-9_-]*$")
    components: list[ComponentId] = Field(min_length=1, max_length=2)
    pose: CadCollisionPose
    message: str


class CadAssemblyDiagnostics(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    schemaVersion: Literal["1.0"] = "1.0"
    check: Literal["assembly_interference"] = "assembly_interference"
    collisions: list[CadCollision] = Field(min_length=1, max_length=168)
    mechanicalIssues: list[CadMechanicalIssue] = Field(default_factory=list, max_length=152)

    @model_validator(mode="after")
    def unique_collisions(self) -> CadAssemblyDiagnostics:
        keys = [(tuple(sorted(item.components)), item.pose) for item in self.collisions]
        if len(set(keys)) != len(keys):
            raise ValueError("CAD collisions must be unique by component pair and pose")
        return self
