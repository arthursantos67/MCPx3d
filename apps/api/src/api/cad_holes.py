from __future__ import annotations

import math
from typing import Any

from domain.cad_program import CadProgramSpec, HoleStep, ThreadStep

from api.cad_adapter import CadGeometryError
from api.cad_program_adapter_helpers import pattern_instances, place_feature


def check_hole_terminations(spec: CadProgramSpec, solid: Any, cq: Any) -> None:
    for step in spec.steps:
        if not isinstance(step, (HoleStep, ThreadStep)) or step.op != "cut" or step.termination == "unspecified":
            continue
        bottom = -step.height if isinstance(step, HoleStep) else -step.height / 2
        radius = (step.diameter / 2 if isinstance(step, HoleStep) else
                  step.diameter / 2 - step.pitch * (0.613434654 if step.profile == "metric" else 0.5) + step.clearance)
        # Probe the guaranteed clear core, including both openings and the whole depth.
        core = cq.Workplane("XY").circle(radius - .0001).extrude(step.height + .0099).translate((0, 0, bottom + .0001))
        if isinstance(step, HoleStep) and step.holeType != "plain":
            if step.holeType == "counterbore":
                head = cq.Workplane("XY").circle(step.headDiameter / 2 - .0001).extrude(-step.headDepth + .0001)
            else:
                head = cq.Workplane("XY").newObject([cq.Solid.makeCone(step.diameter / 2 - .0001, step.headDiameter / 2 - .0001,
                    step.headDepth, cq.Vector(0, 0, -step.headDepth))])
            core = core.union(head)
        for index, probe in enumerate(pattern_instances(place_feature(core, step), step.pattern), 1):
            occupied = solid.intersect(probe.val())
            if not occupied.isValid() or not math.isfinite(occupied.Volume()) or occupied.Volume() > 1e-5:
                raise CadGeometryError(f"CAD step {step.id} instance {index}: declared {step.termination} hole is blocked or its entrance is buried")
        if step.termination == "through":
            exit_probe = cq.Workplane("XY").circle(radius - .0001).extrude(-.05).translate((0, 0, bottom))
            for index, probe in enumerate(pattern_instances(place_feature(exit_probe, step), step.pattern), 1):
                occupied = solid.intersect(probe.val())
                if not occupied.isValid() or not math.isfinite(occupied.Volume()) or occupied.Volume() > 1e-5:
                    raise CadGeometryError(f"CAD step {step.id} instance {index}: declared through hole has a closed exit; revise depth or termination")
            continue
        outer = step.diameter / 2 + (step.clearance if isinstance(step, ThreadStep) else 0)
        floor = cq.Workplane("XY").circle(outer).extrude(-step.minBottomThickness).translate((0, 0, bottom))
        for index, probe in enumerate(pattern_instances(place_feature(floor, step), step.pattern), 1):
            expected = probe.val().Volume()
            occupied = solid.intersect(probe.val())
            volume = occupied.Volume()
            if not occupied.isValid() or not math.isfinite(volume) or not math.isclose(volume, expected, rel_tol=1e-6, abs_tol=1e-5):
                raise CadGeometryError(f"CAD step {step.id} instance {index}: blind hole must retain at least {step.minBottomThickness:g} mm of solid floor across its full diameter in the final solid")
