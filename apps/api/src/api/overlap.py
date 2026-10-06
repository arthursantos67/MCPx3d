from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Literal

from domain.model_plan import (
    CreateObject,
    DuplicateObject,
    ModelPlan,
    RotateObject,
    ScaleObject,
    SetDimensions,
    TranslateObject,
)
from domain.model_spec import ModelObject, ModelSpec


@dataclass(frozen=True)
class Bounds:
    minimum: tuple[float, float, float]
    maximum: tuple[float, float, float]


MAX_REPORTED_OVERLAPS = 10
MAX_SEPARATION_STEPS = 200
MAX_DIAGNOSTIC_PAIRS = 1_000

OverlapPair = tuple[ModelObject, ModelObject]


class UnintendedOverlapError(Exception):
    """Every penetrating pair (bounded), so one repair can fix all of them at once."""

    def __init__(self, pairs: list[OverlapPair]) -> None:
        described = "; ".join(
            f"'{first.name}' ({first.id}) intersects '{second.name}' ({second.id})"
            for first, second in pairs[:MAX_REPORTED_OVERLAPS]
        )
        more = f" (and {len(pairs) - MAX_REPORTED_OVERLAPS} more)" if len(pairs) > MAX_REPORTED_OVERLAPS else ""
        super().__init__(
            f"{described}{more}; the objects' bounding boxes overlap; revise placement or the separation requirement."
        )
        self.pairs = pairs
        self.diagnostics = {
            "schemaVersion": "1.0", "check": "x3d_layout", "method": "axis_aligned_bounds",
            "overlapCount": len(pairs), "truncated": len(pairs) > MAX_DIAGNOSTIC_PAIRS,
            "pairs": [{"objects": [first.id, second.id]} for first, second in pairs[:MAX_DIAGNOSTIC_PAIRS]],
        }


def find_unintended_overlaps(
    spec: ModelSpec, plan: ModelPlan, *, honor_allow_overlap: bool = True
) -> list[OverlapPair]:
    allowed = _allowed_object_ids(plan) if honor_allow_overlap else set()
    pairs: list[OverlapPair] = []
    for index, first in enumerate(spec.objects):
        first_bounds = bounds_for(first)
        for second in spec.objects[index + 1:]:
            if first.id in allowed or second.id in allowed:
                continue
            if _penetrates(first_bounds, bounds_for(second)):
                pairs.append((first, second))
    return pairs


def validate_no_unintended_overlap(
    spec: ModelSpec, plan: ModelPlan, *, honor_allow_overlap: bool = True
) -> None:
    pairs = find_unintended_overlaps(spec, plan, honor_allow_overlap=honor_allow_overlap)
    if pairs:
        raise UnintendedOverlapError(pairs)


def resolve_unintended_overlaps(
    previous: ModelSpec, spec: ModelSpec, plan: ModelPlan, *, honor_allow_overlap: bool = True
) -> tuple[ModelSpec, list[dict[str, object]]]:
    """Deterministically separates penetrating parts by the smallest translation.

    Only parts this plan created or changed are moved -- never a part committed
    by an earlier revision -- and never downward, so nothing is pushed through
    the floor. Returns the adjusted spec and one autofix record per moved part;
    raises `UnintendedOverlapError` if the overlaps cannot be resolved within
    `MAX_SEPARATION_STEPS`.
    """
    existing = {obj.id for obj in previous.objects}
    movable = {obj.id for obj in spec.objects if obj.id not in existing} | _plan_touched_ids(plan)
    offsets: dict[str, list[float]] = {}
    separated_from: dict[str, list[str]] = {}
    current = spec
    for _ in range(MAX_SEPARATION_STEPS):
        pairs = find_unintended_overlaps(current, plan, honor_allow_overlap=honor_allow_overlap)
        if not pairs:
            return current, [
                {
                    "type": "overlap_separation",
                    "objectId": object_id,
                    "offset": [round(value, 6) for value in offset],
                    "separatedFrom": separated_from[object_id],
                }
                for object_id, offset in offsets.items()
            ]
        first, second = pairs[0]
        if second.id in movable:
            mover, anchor = second, first
        elif first.id in movable:
            mover, anchor = first, second
        else:
            raise UnintendedOverlapError(pairs)
        delta = _separation(bounds_for(mover), bounds_for(anchor))
        position = mover.transform.position
        moved = mover.model_copy(
            update={
                "transform": mover.transform.model_copy(
                    update={"position": (position[0] + delta[0], position[1] + delta[1], position[2] + delta[2])}
                )
            }
        )
        current = current.model_copy(
            update={"objects": [moved if obj.id == mover.id else obj for obj in current.objects]}
        )
        total = offsets.setdefault(mover.id, [0.0, 0.0, 0.0])
        for axis in range(3):
            total[axis] += delta[axis]
        if anchor.id not in separated_from.setdefault(mover.id, []):
            separated_from[mover.id].append(anchor.id)
    raise UnintendedOverlapError(find_unintended_overlaps(current, plan, honor_allow_overlap=honor_allow_overlap))


def check_scene_layout(
    previous: ModelSpec, spec: ModelSpec, plan: ModelPlan, *,
    policy: Literal["visual", "strict"], resolve: bool = False,
) -> tuple[ModelSpec, list[dict[str, str]], list[dict[str, object]]]:
    if resolve:
        resolved, fixes = resolve_unintended_overlaps(previous, spec, plan, honor_allow_overlap=policy != "strict")
        return resolved, [], fixes
    if policy == "strict":
        validate_no_unintended_overlap(spec, plan, honor_allow_overlap=False)
        return spec, [], []
    pairs = find_unintended_overlaps(spec, plan)
    warnings = [{
        "check": "layout_bounds",
        "message": (f"'{first.name}' ({first.id}) e '{second.name}' ({second.id}) têm caixas delimitadoras "
                    "sobrepostas. Confira o encaixe visual; isso não comprova interseção das superfícies."),
    } for first, second in pairs[:MAX_REPORTED_OVERLAPS]]
    if len(pairs) > MAX_REPORTED_OVERLAPS:
        warnings.append({"check": "layout_bounds", "message": (
            f"Há {len(pairs)} pares com caixas delimitadoras sobrepostas; "
            f"os primeiros {MAX_REPORTED_OVERLAPS} estão listados. As posições foram preservadas."
        )})
    return spec, warnings, []


def _separation(mover: Bounds, anchor: Bounds) -> tuple[float, float, float]:
    candidates: list[tuple[float, int, float]] = []
    for axis in range(3):
        candidates.append((anchor.maximum[axis] - mover.minimum[axis], axis, anchor.maximum[axis] - mover.minimum[axis]))
        if axis != 1:
            push = anchor.minimum[axis] - mover.maximum[axis]
            candidates.append((-push, axis, push))
    _, axis, push = min(candidates)
    delta = [0.0, 0.0, 0.0]
    delta[axis] = push
    return (delta[0], delta[1], delta[2])


def _plan_touched_ids(plan: ModelPlan) -> set[str]:
    return {
        operation.target
        for operation in plan.operations
        if isinstance(operation, (SetDimensions, TranslateObject, RotateObject, ScaleObject))
    }


def bounds_for(obj: ModelObject) -> Bounds:
    half = _half_extents(obj)
    rotation = _rotation_matrix(obj.transform.rotation)
    rotated = (
        sum(abs(rotation[0][column]) * half[column] for column in range(3)),
        sum(abs(rotation[1][column]) * half[column] for column in range(3)),
        sum(abs(rotation[2][column]) * half[column] for column in range(3)),
    )
    position = obj.transform.position
    return Bounds(
        (position[0] - rotated[0], position[1] - rotated[1], position[2] - rotated[2]),
        (position[0] + rotated[0], position[1] + rotated[1], position[2] + rotated[2]),
    )


def _half_extents(obj: ModelObject) -> tuple[float, float, float]:
    dimensions = obj.dimensions
    if obj.kind == "box":
        raw = (dimensions["width"] / 2, dimensions["height"] / 2, dimensions["depth"] / 2)
    elif obj.kind == "sphere":
        raw = (dimensions["radius"],) * 3
    elif obj.kind == "cylinder":
        raw = (dimensions["radius"], dimensions["height"] / 2, dimensions["radius"])
    else:
        raw = (dimensions["bottomRadius"], dimensions["height"] / 2, dimensions["bottomRadius"])
    return (
        abs(raw[0] * obj.transform.scale[0]),
        abs(raw[1] * obj.transform.scale[1]),
        abs(raw[2] * obj.transform.scale[2]),
    )


def _rotation_matrix(rotation: tuple[float, float, float]) -> tuple[tuple[float, float, float], ...]:
    x, y, z = rotation
    cx, sx, cy, sy, cz, sz = math.cos(x), math.sin(x), math.cos(y), math.sin(y), math.cos(z), math.sin(z)
    return (
        (cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx),
        (sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx),
        (-sy, cy * sx, cy * cx),
    )


def _penetrates(first: Bounds, second: Bounds) -> bool:
    epsilon = 1e-6
    return all(min(first.maximum[i], second.maximum[i]) - max(first.minimum[i], second.minimum[i]) > epsilon for i in range(3))


def _allowed_object_ids(plan: ModelPlan) -> set[str]:
    allowed: set[str] = set()
    for operation in plan.operations:
        if not getattr(operation, "allowOverlap", False):
            continue
        if isinstance(operation, CreateObject) and operation.id is not None:
            allowed.add(operation.id)
        elif isinstance(operation, DuplicateObject):
            allowed.add(operation.newId)
        elif isinstance(operation, (SetDimensions, TranslateObject, RotateObject, ScaleObject)):
            allowed.add(operation.target)
    return allowed
