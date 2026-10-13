from __future__ import annotations

from typing import Any

from domain.cad_program import CadStep, CircularPattern, LinearPattern


def place_feature(feature: Any, step: CadStep) -> Any:
    for angle, axis in ((step.rotation.x, (1, 0, 0)), (step.rotation.y, (0, 1, 0)), (step.rotation.z, (0, 0, 1))):
        if angle:
            feature = feature.rotate((0, 0, 0), axis, angle)
    return feature.translate((step.position.x, step.position.y, step.position.z))


def pattern_instances(feature: Any, pattern: CircularPattern | LinearPattern | None) -> list[Any]:
    if pattern is None:
        return [feature]
    instances = [feature]
    if isinstance(pattern, CircularPattern):
        center = pattern.center
        direction = {"x": (1, 0, 0), "y": (0, 1, 0), "z": (0, 0, 1)}[pattern.axis]
        start = (center.x, center.y, center.z)
        end = tuple(start[index] + direction[index] for index in range(3))
        increment = pattern.sweepAngle / (pattern.count if pattern.sweepAngle == 360 else pattern.count - 1)
        for index in range(1, pattern.count):
            instances.append(feature.rotate(start, end, increment * index))
    else:
        for index in range(1, pattern.count):
            instances.append(feature.translate((pattern.offset.x * index, pattern.offset.y * index, pattern.offset.z * index)))
    return instances
