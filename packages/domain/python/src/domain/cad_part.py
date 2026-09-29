from __future__ import annotations

import math
import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]+$")


class ExtrudedRectangle(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    kind: Literal["extruded_rectangle", "extruded_disc"]
    width: float = Field(ge=0.1, le=10_000, allow_inf_nan=False)
    depth: float = Field(ge=0.1, le=10_000, allow_inf_nan=False)
    thickness: float = Field(ge=0.1, le=10_000, allow_inf_nan=False)


class ThroughHole(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    kind: Literal["through_hole"]
    id: str | None = Field(default=None, max_length=64)
    x: float = Field(allow_inf_nan=False)
    y: float = Field(allow_inf_nan=False)
    diameter: float = Field(ge=0.1, le=10_000, allow_inf_nan=False)


class UprightHole(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    id: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    x: float = Field(allow_inf_nan=False)
    z: float = Field(allow_inf_nan=False)
    diameter: float = Field(ge=0.1, le=10_000, allow_inf_nan=False)


class UprightWall(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    kind: Literal["upright_wall"]
    height: float = Field(ge=0.2, le=10_000, allow_inf_nan=False)
    thickness: float = Field(ge=0.1, le=10_000, allow_inf_nan=False)
    holes: list[UprightHole] = Field(default_factory=list, max_length=8)


class CylindricalBoss(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    kind: Literal["cylindrical_boss"]
    id: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    x: float = Field(allow_inf_nan=False)
    y: float = Field(allow_inf_nan=False)
    diameter: float = Field(ge=0.1, le=10_000, allow_inf_nan=False)
    height: float = Field(ge=0.1, le=10_000, allow_inf_nan=False)


class CadPartSpec(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    schemaVersion: Literal["2.0", "2.1", "2.2", "2.3", "2.4"]
    units: Literal["mm"]
    partId: str = Field(min_length=1, max_length=64)
    base: ExtrudedRectangle
    features: list[ThroughHole] = Field(min_length=1, max_length=16)
    cornerChamfer: float | None = Field(default=None, ge=0, le=2_500, allow_inf_nan=False)
    cornerRadius: float | None = Field(default=None, ge=0, le=5_000, allow_inf_nan=False)
    upright: UprightWall | None = None
    bosses: list[CylindricalBoss] = Field(default_factory=list, max_length=4)

    @model_validator(mode="after")
    def _valid_geometry(self) -> CadPartSpec:
        if not _ID_PATTERN.fullmatch(self.partId):
            raise ValueError("partId must match ^[A-Za-z0-9_-]+$")
        if self.schemaVersion != "2.4" and self.bosses:
            raise ValueError("cylindrical bosses require CAD 2.4")
        if self.schemaVersion not in ("2.3", "2.4") and (self.base.kind != "extruded_rectangle" or self.cornerRadius is not None):
            raise ValueError("this CAD version requires a rectangular base without corner radius")
        if self.schemaVersion == "2.0":
            if len(self.features) != 1 or self.features[0].id is not None or self.cornerChamfer is not None or self.upright is not None:
                raise ValueError("CAD 2.0 requires one unnamed hole and no corner chamfer")
        else:
            ids = [hole.id for hole in self.features]
            if self.cornerChamfer is None or any(not hole_id or not _ID_PATTERN.fullmatch(hole_id) for hole_id in ids):
                raise ValueError("CAD 2.1 requires a corner chamfer and an ID for every hole")
            if len(ids) != len(set(ids)):
                raise ValueError("CAD hole IDs must be unique")
            if ids[0] != "hole_1":
                raise ValueError("first CAD hole ID must be hole_1")
            if self.cornerChamfer > min(self.base.width, self.base.depth) / 4:
                raise ValueError("corner chamfer must not exceed one quarter of the shortest side")
            if self.schemaVersion == "2.1" and self.upright is not None:
                raise ValueError("CAD 2.1 does not support an upright wall")
            if self.schemaVersion == "2.2" and self.upright is None:
                raise ValueError("CAD 2.2 requires an upright wall")
            if self.schemaVersion == "2.3":
                if self.upright is not None or self.cornerChamfer != 0 or self.cornerRadius is None:
                    raise ValueError("CAD 2.3 requires a rounded base, zero chamfer and no upright wall")
                if self.base.kind == "extruded_disc":
                    if self.base.width != self.base.depth or self.cornerRadius != 0:
                        raise ValueError("a disc requires equal width and depth and zero corner radius")
                elif self.cornerRadius <= 0 or self.cornerRadius >= min(self.base.width, self.base.depth) / 2:
                    raise ValueError("rounded rectangle corner radius must be positive and below half the shortest side")
            if self.schemaVersion == "2.4":
                if self.upright is not None or self.cornerChamfer != 0 or self.cornerRadius is None or not self.bosses:
                    raise ValueError("CAD 2.4 requires a base, cylindrical bosses, zero chamfer and no upright wall")
                if self.base.kind == "extruded_disc":
                    if self.base.width != self.base.depth or self.cornerRadius != 0:
                        raise ValueError("a disc requires equal width and depth and zero corner radius")
                elif self.cornerRadius >= min(self.base.width, self.base.depth) / 2:
                    raise ValueError("corner radius must be below half the shortest side")
                boss_ids = [boss.id for boss in self.bosses]
                if len(boss_ids) != len(set(boss_ids)) or set(boss_ids).intersection(ids):
                    raise ValueError("boss IDs must be unique across the part")
        if self.upright is not None:
            wall = self.upright
            if self.cornerChamfer != 0:
                raise ValueError("an upright wall requires zero corner chamfer")
            if wall.height <= self.base.thickness + 0.1:
                raise ValueError("upright height must exceed the base thickness by more than 0.1 mm")
            if wall.thickness >= self.base.depth / 2:
                raise ValueError("upright thickness must be less than half the base depth")
            if len(self.features) + len(wall.holes) > 16:
                raise ValueError("a CAD part supports at most 16 holes in total")
            all_ids = [hole.id for hole in self.features] + [hole.id for hole in wall.holes]
            if len(all_ids) != len(set(all_ids)):
                raise ValueError("all base and upright hole IDs must be unique")
            for index, wall_hole in enumerate(wall.holes):
                radius = wall_hole.diameter / 2
                if self.base.width / 2 - abs(wall_hole.x) < radius + 0.1:
                    raise ValueError("upright hole must keep at least 0.1 mm from the X edges")
                if wall_hole.z - self.base.thickness < radius + 0.1 or wall.height - wall_hole.z < radius + 0.1:
                    raise ValueError("upright hole must stay within the wall above the base")
                for other_wall_hole in wall.holes[:index]:
                    if math.hypot(wall_hole.x - other_wall_hole.x, wall_hole.z - other_wall_hole.z) < radius + other_wall_hole.diameter / 2 + 1:
                        raise ValueError("upright holes must keep at least 1 mm of material between them")
        clearance = 0.1
        for index, boss in enumerate(self.bosses):
            radius = boss.diameter / 2
            if self.base.kind == "extruded_disc":
                fits = math.hypot(boss.x, boss.y) + radius + clearance <= self.base.width / 2
            elif self.cornerRadius:
                qx = abs(boss.x) - (self.base.width / 2 - self.cornerRadius)
                qy = abs(boss.y) - (self.base.depth / 2 - self.cornerRadius)
                signed_distance = math.hypot(max(qx, 0), max(qy, 0)) + min(max(qx, qy), 0) - self.cornerRadius
                fits = signed_distance <= -radius - clearance
            else:
                fits = (abs(boss.x) + radius + clearance <= self.base.width / 2 and
                        abs(boss.y) + radius + clearance <= self.base.depth / 2)
            if not fits:
                raise ValueError("cylindrical boss must fit entirely within the base profile")
            for other_boss in self.bosses[:index]:
                if math.hypot(boss.x - other_boss.x, boss.y - other_boss.y) < radius + other_boss.diameter / 2 + 1:
                    raise ValueError("cylindrical bosses must keep at least 1 mm between them")
        for index, hole in enumerate(self.features):
            radius = hole.diameter / 2
            distance_x = self.base.width / 2 - abs(hole.x)
            distance_y = self.base.depth / 2 - abs(hole.y)
            if distance_x < radius + clearance:
                raise ValueError("through hole must keep at least 0.1 mm from the X edges")
            if distance_y < radius + clearance:
                raise ValueError("through hole must keep at least 0.1 mm from the Y edges")
            if self.upright and hole.y + radius + clearance > self.base.depth / 2 - self.upright.thickness:
                raise ValueError("base through hole must not intersect the upright wall")
            if self.cornerChamfer and distance_x + distance_y < self.cornerChamfer + math.sqrt(2) * (radius + clearance):
                raise ValueError("through hole must keep at least 0.1 mm from the corner chamfer")
            if self.base.kind == "extruded_disc":
                if math.hypot(hole.x, hole.y) + radius + clearance > self.base.width / 2:
                    raise ValueError("through hole must keep at least 0.1 mm from the circular edge")
            elif self.cornerRadius:
                corner_x = self.base.width / 2 - self.cornerRadius
                corner_y = self.base.depth / 2 - self.cornerRadius
                qx, qy = abs(hole.x) - corner_x, abs(hole.y) - corner_y
                signed_distance = math.hypot(max(qx, 0), max(qy, 0)) + min(max(qx, qy), 0) - self.cornerRadius
                if signed_distance > -radius - clearance:
                    raise ValueError("through hole must keep at least 0.1 mm from the rounded edge")
            for boss in self.bosses:
                distance = math.hypot(hole.x - boss.x, hole.y - boss.y)
                boss_radius = boss.diameter / 2
                if boss_radius - radius - clearance < distance < boss_radius + radius + clearance:
                    raise ValueError("through hole must stay fully inside or outside each boss")
            for other in self.features[:index]:
                if math.hypot(hole.x - other.x, hole.y - other.y) < radius + other.diameter / 2 + 1:
                    raise ValueError("through holes must keep at least 1 mm of material between them")
        return self
