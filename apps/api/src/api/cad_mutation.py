from __future__ import annotations

from domain.cad_part import CadPartSpec, CylindricalBoss, ThroughHole, UprightHole
from domain.cad_plan import (
    CadEditPlan,
    RemoveBoss,
    RemoveHole,
    RemoveUprightHole,
    SetCadParameter,
    SetCornerChamfer,
    SetCornerRadius,
    SetDiscDiameter,
    SetUprightParameter,
    UpsertBoss,
    UpsertHole,
    UpsertUprightHole,
)
from pydantic import ValidationError


class CadMutationError(Exception):
    pass


def apply_cad_plan(spec: CadPartSpec, plan: CadEditPlan) -> CadPartSpec:
    candidate = spec.model_copy(deep=True)
    if plan.schemaVersion == "2.0" and candidate.schemaVersion == "2.0":
        candidate.schemaVersion = "2.1"
        candidate.features[0].id = "hole_1"
        candidate.cornerChamfer = 0
    for operation in plan.operations:
        if isinstance(operation, SetCadParameter):
            if operation.parameter.startswith("hole_"):
                name = operation.parameter.removeprefix("hole_")
                setattr(candidate.features[0], name, operation.value)
            else:
                setattr(candidate.base, operation.parameter, operation.value)
        elif isinstance(operation, SetCornerChamfer):
            candidate.cornerChamfer = operation.value
        elif isinstance(operation, SetCornerRadius):
            if candidate.schemaVersion not in ("2.3", "2.4") or candidate.base.kind != "extruded_rectangle":
                raise CadMutationError("Corner radius requires a rounded rectangular plate")
            candidate.cornerRadius = operation.value
        elif isinstance(operation, SetDiscDiameter):
            if candidate.schemaVersion not in ("2.3", "2.4") or candidate.base.kind != "extruded_disc":
                raise CadMutationError("Disc diameter requires a circular flange")
            candidate.base.width = operation.value
            candidate.base.depth = operation.value
        elif isinstance(operation, UpsertBoss):
            if candidate.schemaVersion != "2.4":
                raise CadMutationError("Cylindrical bosses require a composite CAD part")
            boss = CylindricalBoss(kind="cylindrical_boss", id=operation.bossId, x=operation.x,
                                   y=operation.y, diameter=operation.diameter, height=operation.height)
            index = next((index for index, current in enumerate(candidate.bosses) if current.id == operation.bossId), None)
            if index is None:
                candidate.bosses.append(boss)
            else:
                candidate.bosses[index] = boss
        elif isinstance(operation, RemoveBoss):
            if candidate.schemaVersion != "2.4" or not any(boss.id == operation.bossId for boss in candidate.bosses):
                raise CadMutationError(f"CAD boss {operation.bossId} was not found")
            candidate.bosses = [boss for boss in candidate.bosses if boss.id != operation.bossId]
        elif isinstance(operation, UpsertHole):
            hole = ThroughHole(kind="through_hole", id=operation.holeId, x=operation.x, y=operation.y, diameter=operation.diameter)
            index = next((index for index, current in enumerate(candidate.features) if current.id == operation.holeId), None)
            if index is None:
                candidate.features.append(hole)
            else:
                candidate.features[index] = hole
        elif isinstance(operation, RemoveHole):
            if not any(hole.id == operation.holeId for hole in candidate.features):
                raise CadMutationError(f"CAD hole {operation.holeId} was not found")
            candidate.features = [hole for hole in candidate.features if hole.id != operation.holeId]
        elif isinstance(operation, SetUprightParameter):
            if candidate.upright is None:
                raise CadMutationError("This CAD part has no upright wall")
            setattr(candidate.upright, operation.parameter, operation.value)
        elif isinstance(operation, UpsertUprightHole):
            if candidate.upright is None:
                raise CadMutationError("This CAD part has no upright wall")
            upright_hole = UprightHole(id=operation.holeId, x=operation.x, z=operation.z, diameter=operation.diameter)
            index = next((index for index, current in enumerate(candidate.upright.holes) if current.id == operation.holeId), None)
            if index is None:
                candidate.upright.holes.append(upright_hole)
            else:
                candidate.upright.holes[index] = upright_hole
        elif isinstance(operation, RemoveUprightHole):
            if candidate.upright is None or not any(hole.id == operation.holeId for hole in candidate.upright.holes):
                raise CadMutationError(f"CAD upright hole {operation.holeId} was not found")
            candidate.upright.holes = [hole for hole in candidate.upright.holes if hole.id != operation.holeId]
    try:
        return CadPartSpec.model_validate(candidate.model_dump())
    except ValidationError as exc:
        raise CadMutationError(exc.errors()[0]["msg"]) from exc
