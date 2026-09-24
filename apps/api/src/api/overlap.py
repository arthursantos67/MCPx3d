from __future__ import annotations

import math
from dataclasses import dataclass

from domain.model_plan import CreateObject, DuplicateObject, ModelPlan, RotateObject, ScaleObject, SetDimensions, TranslateObject
from domain.model_spec import ModelObject, ModelSpec


@dataclass(frozen=True)
class Bounds:
    minimum: tuple[float, float, float]
    maximum: tuple[float, float, float]


class UnintendedOverlapError(Exception):
    def __init__(self, first: ModelObject, second: ModelObject) -> None:
        super().__init__(f"'{first.name}' ({first.id}) intersects '{second.name}' ({second.id}); move one part or set allowOverlap to true for the requested intersection.")
        self.first = first
        self.second = second


def validate_no_unintended_overlap(spec: ModelSpec, plan: ModelPlan) -> None:
    allowed = _allowed_object_ids(plan)
    for index, first in enumerate(spec.objects):
        first_bounds = bounds_for(first)
        for second in spec.objects[index + 1:]:
            if first.id in allowed or second.id in allowed:
                continue
            if _penetrates(first_bounds, bounds_for(second)):
                raise UnintendedOverlapError(first, second)


def bounds_for(obj: ModelObject) -> Bounds:
    half = _half_extents(obj)
    rotation = _rotation_matrix(obj.transform.rotation)
    rotated = tuple(sum(abs(rotation[row][column]) * half[column] for column in range(3)) for row in range(3))
    position = obj.transform.position
    return Bounds(tuple(position[i] - rotated[i] for i in range(3)), tuple(position[i] + rotated[i] for i in range(3)))


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
    return tuple(abs(raw[i] * obj.transform.scale[i]) for i in range(3))


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
