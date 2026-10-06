from __future__ import annotations

import math
from functools import lru_cache
from importlib import import_module
from typing import Any

from domain.cad_program import ThreadStep

from api.cad_adapter import CadGeometryError


@lru_cache(maxsize=16)
def _thread_solid(diameter: float, pitch: float, height: float, profile: str,
                  handedness: str, clearance: float, starts: int) -> Any:
    cq = import_module("cadquery")
    outer = diameter / 2 + clearance
    depth = pitch * (0.613434654 if profile == "metric" else 0.5)
    root = outer - depth
    base = 5 / 6 if profile == "metric" else 0.5 + depth / pitch * math.tan(math.radians(15))
    crest = 1 / 8 if profile == "metric" else 0.5 - depth / pitch * math.tan(math.radians(15))
    crest_angle, root_angle = crest * 180 / starts, base * 180 / starts

    def point(radius: float, angle: float) -> Any:
        angle = math.radians(angle)
        return cq.Vector(radius * math.cos(angle), radius * math.sin(angle), 0)

    def flank(r1: float, r2: float, a1: float, a2: float) -> Any:
        return cq.Edge.makeSplineApprox([point(r1 + (r2 - r1) * i / 32, a1 + (a2 - a1) * i / 32) for i in range(33)], tol=1e-5)

    edges = []
    for index in range(starts):
        angle, following = index * 360 / starts, (index + 1) * 360 / starts
        edges.extend([
            cq.Edge.makeCircle(outer, angle1=angle - crest_angle, angle2=angle + crest_angle),
            flank(outer, root, angle + crest_angle, angle + root_angle),
            cq.Edge.makeCircle(root, angle1=angle + root_angle, angle2=following - root_angle),
            flank(root, outer, following - root_angle, following - crest_angle),
        ])
    wire = cq.Wire.assembleEdges(edges)
    area = cq.Face.makeFromWires(wire).Area()
    count = math.ceil(height / (pitch * starts))
    segment_height = height / count
    twist = (-1 if handedness == "left" else 1) * 360 * segment_height / (pitch * starts)
    segment = cq.Solid.extrudeLinearWithRotation(wire, [], cq.Vector(0, 0, 0), cq.Vector(0, 0, segment_height), twist)
    segment = segment.rotate((0, 0, 0), (0, 0, 1), -twist / 2).translate((0, 0, -segment_height / 2))
    pieces = [segment.rotate((0, 0, 0), (0, 0, 1), twist * (index - (count - 1) / 2)).translate(
        (0, 0, segment_height * (index - (count - 1) / 2))) for index in range(count)]
    fused = pieces[0].fuse(*pieces[1:])
    solids = fused.Solids()
    if len(solids) != 1:
        raise CadGeometryError("Thread segments do not form one connected solid")
    solid = solids[0]
    volume = solid.Volume()
    core_volume, envelope_volume = math.pi * root ** 2 * height, math.pi * outer ** 2 * height
    if (not solid.isValid() or len(solid.Solids()) != 1 or
            not core_volume < volume < envelope_volume or
            not math.isclose(volume, area * height, rel_tol=1e-4, abs_tol=1e-4)):
        raise CadGeometryError("Thread construction lost its helical profile or produced invalid material")
    return solid


def build_thread(step: ThreadStep, cq: Any) -> Any:
    solid = _thread_solid(step.diameter, step.pitch, step.height, step.profile,
                          step.handedness, step.clearance, step.starts)
    return cq.Workplane("XY").newObject([solid.copy()])
