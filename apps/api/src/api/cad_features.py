from __future__ import annotations

import math
from typing import Any

from domain.cad_program import (
    ChamferStep,
    CircleSection,
    FilletStep,
    HoleStep,
    LoftStep,
    ShellStep,
    SlotStep,
    ThreadStep,
    TorusStep,
    TubeStep,
)

from api.cad_adapter import CadGeometryError
from api.cad_threads import build_thread

_SELECTORS = {"all": None, "parallel_x": "|X", "parallel_y": "|Y", "parallel_z": "|Z", "circular": "%CIRCLE",
              "top": ">Z", "bottom": "<Z", "positive_x": ">X", "negative_x": "<X", "positive_y": ">Y", "negative_y": "<Y"}


def build_feature(step: TubeStep | TorusStep | SlotStep | HoleStep | ThreadStep | LoftStep, cq: Any) -> Any:
    if isinstance(step, ThreadStep):
        return build_thread(step, cq)
    if isinstance(step, TubeStep):
        return cq.Workplane("XY").circle(step.diameter / 2).circle(step.innerDiameter / 2).extrude(step.height).translate((0, 0, -step.height / 2))
    if isinstance(step, TorusStep):
        return cq.Workplane("XY").newObject([cq.Solid.makeTorus(step.majorRadius, step.minorRadius)])
    if isinstance(step, SlotStep):
        return cq.Workplane("XY").slot2D(step.length, step.width).extrude(step.height).translate((0, 0, -step.height / 2))
    if isinstance(step, HoleStep):
        bore = cq.Workplane("XY").circle(step.diameter / 2).extrude(-step.height)
        if step.holeType == "plain":
            return bore
        if step.holeType == "counterbore":
            head = cq.Workplane("XY").circle(step.headDiameter / 2).extrude(-step.headDepth)
        else:
            head = cq.Workplane("XY").newObject([cq.Solid.makeCone(
                step.diameter / 2, step.headDiameter / 2, step.headDepth, cq.Vector(0, 0, -step.headDepth))])
        return bore.union(head)
    pending = cq.Workplane("XY")
    previous_z = 0.0
    for section in step.sections:
        pending = pending.workplane(offset=section.z - previous_z)
        pending = pending.circle(section.diameter / 2) if isinstance(section, CircleSection) else pending.rect(section.width, section.depth)
        previous_z = section.z
    return pending.loft(ruled=step.ruled)


def finish_part(part: Any, step: FilletStep | ChamferStep | ShellStep) -> Any:
    before = part.val().Volume()
    selection = part.faces(_SELECTORS[step.selector]) if isinstance(step, ShellStep) else part.edges(_SELECTORS[step.selector])
    if selection.size() == 0:
        raise CadGeometryError(f"CAD step {step.id} selected no {'faces' if isinstance(step, ShellStep) else 'edges'}; revise selector {step.selector}")
    try:
        if isinstance(step, FilletStep):
            result = selection.fillet(step.radius)
        elif isinstance(step, ChamferStep):
            result = selection.chamfer(step.distance)
        else:
            result = selection.shell(-step.thickness)
    except Exception as exc:
        size_field = "radius" if isinstance(step, FilletStep) else "distance" if isinstance(step, ChamferStep) else "thickness"
        size = getattr(step, size_field)
        details = f"selected {'faces' if isinstance(step, ShellStep) else 'edges'}: {selection.size()}; {size_field}={size:g} mm"
        if not isinstance(step, ShellStep):
            lengths = [edge.Length() for edge in selection.vals()]
            details += f"; shortest selected edge={min(lengths):.6g} mm"
        raise CadGeometryError(
            f"CAD step {step.id} ({step.shape}) cannot apply selector {step.selector} at requested size; "
            f"choose suitable edges/faces or reduce an unspecified size; {details}; "
            "directional selectors use component coordinates; circular/all can include small shoulders, "
            "bore rims and thread transitions; apply the intended finish before threading when appropriate"
        ) from exc
    solids = result.solids().vals()
    if len(solids) != 1 or not solids[0].isValid() or solids[0].Volume() <= 0:
        raise CadGeometryError(f"CAD step {step.id} ({step.shape}) must retain one valid connected solid")
    if math.isclose(before, solids[0].Volume(), rel_tol=1e-9, abs_tol=1e-6):
        raise CadGeometryError(f"CAD step {step.id} ({step.shape}) does not change the solid; revise selection")
    return result.newObject([solids[0]])
