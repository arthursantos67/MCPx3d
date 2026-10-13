from __future__ import annotations

from typing import Any

from domain.cad_program import HelicalSpringStep, PipeBendStep, SweepStep


def _circular_sweep(path: Any, diameter: float, inner_diameter: float, cq: Any,
                    frenet: bool = False, transition: str = "transformed") -> Any:
    start, tangent = path.startPoint(), path.tangentAt(0)
    outer = cq.Wire.makeCircle(diameter / 2, start, tangent)
    inner = [cq.Wire.makeCircle(inner_diameter / 2, start, tangent)] if inner_diameter else []
    solid = cq.Solid.sweep(outer, inner, path, makeSolid=True, isFrenet=frenet, transitionMode=transition)
    return cq.Workplane("XY").newObject([solid])


def build_sweep(step: PipeBendStep | HelicalSpringStep | SweepStep, cq: Any) -> Any:
    if isinstance(step, PipeBendStep):
        path = cq.Edge.makeCircle(step.bendRadius, angle1=0, angle2=step.bendAngle)
        return _circular_sweep(path, step.diameter, step.innerDiameter, cq, frenet=True)
    if isinstance(step, HelicalSpringStep):
        height = step.pitch * step.turns
        path = cq.Wire.makeHelix(step.pitch, height, step.meanDiameter / 2,
                                 lefthand=step.handedness == "left")
        return _circular_sweep(path, step.wireDiameter, 0, cq, frenet=True).translate((0, 0, -height / 2))
    points = [cq.Vector(point.x, point.y, point.z) for point in step.path]
    path = cq.Wire.makePolygon(points)
    # Right transition keeps a constant section through mitered polyline
    # corners. Smooth bent tubing with a specified radius uses pipe_bend.
    return _circular_sweep(path, step.diameter, step.innerDiameter, cq, transition="right")
