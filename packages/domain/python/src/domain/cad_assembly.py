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
    factor: float | None = Field(default=None, ge=-1_000, le=1_000, allow_inf_nan=False)

    @model_validator(mode="after")
    def _valid_range(self) -> CadMotion:
        if self.minimum >= self.maximum or not self.minimum <= self.value <= self.maximum:
            raise ValueError("CAD motion value must lie within a nonempty travel range")
        if (self.kind == "screw") != (self.pitch is not None):
            raise ValueError("screw motion needs a pitch; slider motion must omit it")
        if self.factor is not None:
            if self.factor == 0 or self.group is None:
                raise ValueError("a motion factor must be nonzero and belong to a group")
            if self.kind != "rotary" and max(abs(self.minimum * self.factor), abs(self.maximum * self.factor)) > 10_000:
                raise ValueError("scaled CAD travel exceeds 10000 mm")
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


class CadMechanicalConnection(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    id: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    kind: Literal["fixed", "linear", "rotary", "thread"]
    first: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    second: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    firstFeature: str = Field(max_length=64, pattern=r"^[A-Za-z0-9_-]*$")
    secondFeature: str = Field(max_length=64, pattern=r"^[A-Za-z0-9_-]*$")
    maxClearance: float = Field(ge=0, le=1, allow_inf_nan=False)
    minEngagement: float = Field(ge=0.1, le=1_000, allow_inf_nan=False)
    fastening: Literal["none", "bonded", "bolted", "captured"]
    fastenerDiameter: float = Field(ge=0, le=100, allow_inf_nan=False)

    @model_validator(mode="after")
    def _valid_connection(self) -> CadMechanicalConnection:
        if self.first == self.second:
            raise ValueError("mechanical connections need distinct components")
        if (self.kind == "fixed") != (self.fastening != "none"):
            raise ValueError("fixed connections need a fastening method; moving joints must use none")
        needs_features = self.kind != "fixed" or self.fastening == "bolted"
        if needs_features and (not self.firstFeature or not self.secondFeature):
            raise ValueError("mechanical connection needs both feature IDs")
        if bool(self.firstFeature) != bool(self.secondFeature):
            raise ValueError("mechanical connection must supply both feature IDs or neither")
        if (self.fastening == "bolted") != (self.fastenerDiameter > 0):
            raise ValueError("only bolted connections need a positive fastener diameter")
        return self


class CadMechanics(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    grounded: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    connections: list[CadMechanicalConnection] = Field(min_length=1, max_length=24)


class CadAssemblySpec(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    schemaVersion: Literal["4.0"]
    units: Literal["mm"]
    partId: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    components: list[CadComponent] = Field(min_length=2, max_length=8)
    mechanics: CadMechanics | None = None

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
                      "parameter" if motion.factor is not None else "degrees" if motion.kind == "rotary" else "mm")
            if motion.group in groups and groups[motion.group] != travel:
                raise ValueError(f"CAD motion group {motion.group} must share range and value")
            groups[motion.group] = travel
        if self.mechanics is not None:
            components = {component.id: component for component in self.components}
            if self.mechanics.grounded not in components or components[self.mechanics.grounded].motion is not None:
                raise ValueError("mechanical ground must reference a fixed component")
            joint_ids: set[str] = set()
            graph: dict[str, set[str]] = {key: set() for key in components}
            for connection in self.mechanics.connections:
                if connection.id in joint_ids:
                    raise ValueError("mechanical connection IDs must be unique")
                joint_ids.add(connection.id)
                if connection.first not in components or connection.second not in components:
                    raise ValueError("mechanical connection references an unknown component")
                for component_id, feature_id in ((connection.first, connection.firstFeature), (connection.second, connection.secondFeature)):
                    if feature_id and not any(step.id == feature_id for step in components[component_id].steps):
                        raise ValueError(f"mechanical connection {connection.id} references unknown feature {component_id}/{feature_id}")
                graph[connection.first].add(connection.second)
                graph[connection.second].add(connection.first)
            reached = {self.mechanics.grounded}
            pending = [self.mechanics.grounded]
            while pending:
                for neighbor in graph[pending.pop()] - reached:
                    reached.add(neighbor)
                    pending.append(neighbor)
            if reached != set(components):
                raise ValueError("every mechanical component needs a connection path to ground")
        return self
