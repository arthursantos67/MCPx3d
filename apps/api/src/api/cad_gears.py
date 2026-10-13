from __future__ import annotations

import math
from typing import Any

from domain.cad_program import RackStep, SpurGearStep


def gear_dimensions(step: SpurGearStep) -> tuple[float, float, float, float]:
    pitch = step.module * step.teeth / 2
    return pitch, pitch * math.cos(math.radians(step.pressureAngle)), pitch + step.module, pitch - 1.25 * step.module


def involute_point(step: SpurGearStep, parameter: float, side: int, angle: float = 0) -> tuple[float, float, float]:
    pitch, base, _, _ = gear_dimensions(step)
    pressure = math.radians(step.pressureAngle)
    half = math.pi / (2 * step.teeth) - step.backlash / (2 * pitch)
    theta = angle + side * (half + math.tan(pressure) - pressure - parameter + math.atan(parameter))
    radius = base * math.sqrt(1 + parameter ** 2)
    return (radius * math.cos(theta), radius * math.sin(theta), 0)


def build_spur_gear(step: SpurGearStep, cq: Any) -> Any:
    _, base, tip, root = gear_dimensions(step)
    start = math.sqrt(max(0, (max(base, root) / base) ** 2 - 1))
    end = math.sqrt((tip / base) ** 2 - 1)
    parameters = [start + (end - start) * index / 32 for index in range(33)]
    edges = []
    increment = 2 * math.pi / step.teeth
    root_point, tip_point = involute_point(step, start, 1), involute_point(step, end, 1)
    root_half, tip_half = math.atan2(root_point[1], root_point[0]), math.atan2(tip_point[1], tip_point[0])

    def polar(radius: float, angle: float) -> Any:
        return cq.Vector(radius * math.cos(angle), radius * math.sin(angle), 0)

    def arc(radius: float, begin: float, finish: float) -> Any:
        return cq.Edge.makeCircle(radius, angle1=math.degrees(begin), angle2=math.degrees(finish))

    for tooth in range(step.teeth):
        angle = tooth * increment
        left = [cq.Vector(*involute_point(step, parameter, -1, angle)) for parameter in parameters]
        right = [cq.Vector(*involute_point(step, parameter, 1, angle)) for parameter in parameters]
        if root < base:
            edges.append(cq.Edge.makeLine(polar(root, angle - root_half), left[0]))
        edges.append(cq.Edge.makeSpline(left, parameters=parameters, tol=1e-7))
        edges.append(arc(tip, angle - tip_half, angle + tip_half))
        edges.append(cq.Edge.makeSpline(list(reversed(right)), parameters=[end - value for value in reversed(parameters)], tol=1e-7))
        if root < base:
            edges.append(cq.Edge.makeLine(right[0], polar(root, angle + root_half)))
        edges.append(arc(root, angle + root_half, angle + increment - root_half))
    wire = cq.Wire.assembleEdges(edges)
    solid = cq.Solid.extrudeLinear(wire, [], cq.Vector(0, 0, step.height)).translate((0, 0, -step.height / 2))
    return cq.Workplane("XY").newObject([solid])


def build_rack(step: RackStep, cq: Any) -> Any:
    pitch = math.pi * step.module
    half_length = pitch * step.teeth / 2
    slope = math.tan(math.radians(step.pressureAngle))
    half_tooth = pitch / 4 - step.backlash / 2
    root_half, tip_half = half_tooth + 1.25 * step.module * slope, half_tooth - step.module * slope
    root, tip = -1.25 * step.module, step.module
    bottom = root - step.baseThickness
    points = [(-half_length, bottom), (half_length, bottom), (half_length, root)]
    for index in reversed(range(step.teeth)):
        center = -half_length + pitch * (index + .5)
        points.extend(((center + root_half, root), (center + tip_half, tip),
                       (center - tip_half, tip), (center - root_half, root)))
    points.append((-half_length, root))
    return cq.Workplane("XY").polyline(points).close().extrude(step.height).translate((0, 0, -step.height / 2))
