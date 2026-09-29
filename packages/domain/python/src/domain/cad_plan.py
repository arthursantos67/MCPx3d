from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

CadParameter = Literal["width", "depth", "thickness", "hole_x", "hole_y", "hole_diameter"]


class SetCadParameter(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    op: Literal["set_parameter"]
    parameter: CadParameter
    value: float = Field(allow_inf_nan=False)


class SetCornerChamfer(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    op: Literal["set_corner_chamfer"]
    value: float = Field(allow_inf_nan=False)


class SetCornerRadius(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    op: Literal["set_corner_radius"]
    value: float = Field(allow_inf_nan=False)


class SetDiscDiameter(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    op: Literal["set_disc_diameter"]
    value: float = Field(allow_inf_nan=False)


class UpsertBoss(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    op: Literal["upsert_boss"]
    bossId: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    x: float = Field(allow_inf_nan=False)
    y: float = Field(allow_inf_nan=False)
    diameter: float = Field(allow_inf_nan=False)
    height: float = Field(allow_inf_nan=False)


class RemoveBoss(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    op: Literal["remove_boss"]
    bossId: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")


class UpsertHole(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    op: Literal["upsert_hole"]
    holeId: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    x: float = Field(allow_inf_nan=False)
    y: float = Field(allow_inf_nan=False)
    diameter: float = Field(allow_inf_nan=False)


class RemoveHole(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    op: Literal["remove_hole"]
    holeId: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")


class SetUprightParameter(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    op: Literal["set_upright_parameter"]
    parameter: Literal["height", "thickness"]
    value: float = Field(allow_inf_nan=False)


class UpsertUprightHole(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    op: Literal["upsert_upright_hole"]
    holeId: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    x: float = Field(allow_inf_nan=False)
    z: float = Field(allow_inf_nan=False)
    diameter: float = Field(allow_inf_nan=False)


class RemoveUprightHole(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    op: Literal["remove_upright_hole"]
    holeId: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")


CadOperation = Annotated[
    SetCadParameter | SetCornerChamfer | UpsertHole | RemoveHole |
    SetUprightParameter | UpsertUprightHole | RemoveUprightHole |
    SetCornerRadius | SetDiscDiameter | UpsertBoss | RemoveBoss,
    Field(discriminator="op"),
]


class CadEditPlan(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    schemaVersion: Literal["1.0", "2.0", "3.0", "4.0", "5.0"]
    operations: list[CadOperation] = Field(min_length=1, max_length=20)

    @model_validator(mode="after")
    def _unique_parameters(self) -> CadEditPlan:
        if self.schemaVersion == "1.0" and (
            len(self.operations) > 6 or any(not isinstance(operation, SetCadParameter) for operation in self.operations)
        ):
            raise ValueError("CAD plan 1.0 supports at most six parameter changes")
        if self.schemaVersion == "2.0" and any(
            isinstance(operation, (SetUprightParameter, UpsertUprightHole, RemoveUprightHole))
            for operation in self.operations
        ):
            raise ValueError("CAD plan 2.0 does not support upright wall edits")
        if self.schemaVersion not in ("4.0", "5.0") and any(isinstance(operation, (SetCornerRadius, SetDiscDiameter)) for operation in self.operations):
            raise ValueError("rounded profile edits require CAD plan 4.0 or later")
        if self.schemaVersion != "5.0" and any(isinstance(operation, (UpsertBoss, RemoveBoss)) for operation in self.operations):
            raise ValueError("composite boss edits require CAD plan 5.0")
        targets = [
            f"parameter:{operation.parameter}" if isinstance(operation, SetCadParameter)
            else f"upright:{operation.parameter}" if isinstance(operation, SetUprightParameter)
            else f"upright_hole:{operation.holeId}" if isinstance(operation, (UpsertUprightHole, RemoveUprightHole))
            else f"hole:{operation.holeId}" if isinstance(operation, (UpsertHole, RemoveHole))
            else "corner_radius" if isinstance(operation, SetCornerRadius)
            else "disc_diameter" if isinstance(operation, SetDiscDiameter)
            else f"boss:{operation.bossId}" if isinstance(operation, (UpsertBoss, RemoveBoss))
            else "corner_chamfer"
            for operation in self.operations
        ]
        if len(targets) != len(set(targets)):
            raise ValueError("each CAD target may be changed at most once per plan")
        return self
