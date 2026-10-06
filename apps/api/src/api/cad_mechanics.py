from __future__ import annotations

import math
from dataclasses import dataclass
from importlib import import_module
from typing import Any

from domain.cad_assembly import CadAssemblySpec, CadComponent, CadMechanicalConnection
from domain.cad_diagnostics import CadCollisionPose
from domain.cad_program import (
    CadStep,
    CylinderStep,
    HoleStep,
    LinearPattern,
    ThreadStep,
)

from api.cad_adapter import CadGeometryError

Point = tuple[float, float, float]
ZERO: Point = (0.0, 0.0, 0.0)
AXES: dict[str, Point] = {"x": (1.0, 0.0, 0.0), "y": (0.0, 1.0, 0.0), "z": (0.0, 0.0, 1.0)}


def add(a: Point, b: Point) -> Point:
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def scale(a: Point, b: float) -> Point:
    return (a[0] * b, a[1] * b, a[2] * b)


def dot(a: Point, b: Point) -> float:
    return sum(x * y for x, y in zip(a, b, strict=True))


def cross(a: Point, b: Point) -> Point:
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def rotate(point: Point, axis: Point, degrees: float) -> Point:
    radians = math.radians(degrees)
    return add(add(scale(point, math.cos(radians)), scale(cross(axis, point), math.sin(radians))),
               scale(axis, dot(axis, point) * (1 - math.cos(radians))))


def coordinates(vector: Any) -> Point:
    return (float(vector.x), float(vector.y), float(vector.z))


def world(component: CadComponent, point: Point, vector: bool = False) -> Point:
    motion = component.motion
    if motion:
        command = motion.value * (motion.factor if motion.factor is not None else 1)
        if motion.kind != "slider":
            if motion.kind == "screw":
                assert motion.pitch is not None
            angle = command if motion.kind == "rotary" else command * 360 / (motion.pitch or 1)
            point = rotate(point, AXES[motion.axis], angle)
        if not vector and motion.kind != "rotary":
            point = add(point, scale(AXES[motion.axis], command))
    return point if vector else add(point, coordinates(component.position))


def line_distance(first: Point, second: Point, axis: Point) -> float:
    delta = add(first, scale(second, -1))
    return math.sqrt(max(0, dot(delta, delta) - dot(delta, axis) ** 2))


@dataclass(frozen=True)
class Feature:
    step: CylinderStep | HoleStep | ThreadStep
    center: Point
    axis: Point
    low: float
    high: float


def feature(component: CadComponent, step_id: str, offset: Point = ZERO) -> Feature:
    step: CadStep = next(step for step in component.steps if step.id == step_id)
    if not isinstance(step, (CylinderStep, HoleStep, ThreadStep)):
        raise TypeError("use a cylindrical shaft, bore or thread feature")
    axis = AXES["z"]
    for key in ("x", "y", "z"):
        axis = rotate(axis, AXES[key], getattr(step.rotation, key))
    center = add(coordinates(step.position), offset)
    if isinstance(step, HoleStep):
        center = add(center, scale(axis, -step.height / 2))
    center, axis = world(component, center), world(component, axis, vector=True)
    coordinate = dot(center, axis)
    return Feature(step, center, axis, coordinate - step.height / 2, coordinate + step.height / 2)


def _feature_basis(component: CadComponent, step: CadStep, vector: Point) -> Point:
    for key in ("x", "y", "z"):
        vector = rotate(vector, AXES[key], getattr(step.rotation, key))
    return world(component, vector, vector=True)


def _positive_feature_preserved(component: CadComponent, step: CadStep) -> bool:
    index = next(index for index, candidate in enumerate(component.steps) if candidate.id == step.id)
    return step.op in ("base", "union") and all(candidate.op == "union" for candidate in component.steps[index + 1:])


def _thread_evidence(frame: Feature, component: CadComponent, solid: Any, station: float, material: MaterialChecks) -> None:
    step = frame.step
    assert isinstance(step, ThreadStep)
    axial = station - dot(frame.center, frame.axis)
    phase = (1 if step.handedness == "right" else -1) * 360 * axial / (step.pitch * step.starts)
    basis = _feature_basis(component, step, AXES["x"])
    crest = rotate(basis, frame.axis, phase)
    valley = rotate(basis, frame.axis, phase + 180 / step.starts)
    center = add(frame.center, scale(frame.axis, axial))
    outer = step.diameter / 2 + step.clearance
    depth = step.pitch * (0.613434654 if step.profile == "metric" else 0.5)
    middle = outer - depth / 2
    if step.op == "cut":
        if material.inside(solid, add(center, scale(crest, middle))) or not material.inside(solid, add(center, scale(valley, middle))):
            raise ValueError("female thread has no exposed helical material; a smooth enlarged bore cannot transmit the declared screw drive")
    elif (not _positive_feature_preserved(component, step) and not material.inside(solid, add(center, scale(crest, outer - min(.02, depth / 10))))) or material.inside(solid, add(center, scale(valley, middle))):
        raise ValueError("male thread crest/valley was removed or filled; thread metadata alone does not prove transmission")


def _rate(component: CadComponent, axis: Point, angular: bool) -> float:
    motion = component.motion
    if not motion or (angular and motion.kind == "slider") or (not angular and motion.kind == "rotary"):
        return 0.0
    factor = motion.factor if motion.factor is not None else 1.0
    return factor * dot(AXES[motion.axis], axis) * (360 / (motion.pitch or 1) if angular and motion.kind == "screw" else 1)


def _shared_command(first: CadComponent, second: CadComponent) -> bool:
    a, b = first.motion, second.motion
    return not (a and b) or bool(a.group and a.group == b.group)


def _pose_key(component: CadComponent) -> tuple[float, float]:
    motion = component.motion
    if motion is None:
        return (0, 0)
    value = motion.value * (motion.factor if motion.factor is not None else 1)
    return (value if motion.kind != "rotary" else 0,
            (value if motion.kind == "rotary" else value * 360 / (motion.pitch or 1) if motion.kind == "screw" else 0) % 360)


def _rigid_motion(first: CadComponent, second: CadComponent) -> bool:
    a, b = first.motion, second.motion
    if a is None or b is None:
        return a is None and b is None
    shared = (a.kind == b.kind and a.kind in ("slider", "rotary") and a.axis == b.axis
              and a.group is not None and a.group == b.group
              and (a.factor if a.factor is not None else 1) == (b.factor if b.factor is not None else 1))
    return bool(shared and (a.kind == "slider" or line_distance(coordinates(first.position), coordinates(second.position), AXES[a.axis]) < 1e-6))


class MaterialChecks:
    def __init__(self) -> None:
        self.classifiers: dict[int, Any] = {}
        self.classifier_type = import_module("OCP.BRepClass3d").BRepClass3d_SolidClassifier
        self.point_type = import_module("OCP.gp").gp_Pnt
        self.inside_state = import_module("OCP.TopAbs").TopAbs_IN

    def inside(self, solid: Any, point: Point) -> bool:
        key = id(solid)
        if key not in self.classifiers:
            self.classifiers[key] = self.classifier_type(solid.wrapped)
        classifier = self.classifiers[key]
        classifier.Perform(self.point_type(*point), 1e-6)
        return bool(classifier.State() == self.inside_state or classifier.IsOnAFace())


def _contact_area(first: Any, second: Any) -> float:
    a_faces = [face for face in first.Faces() if face.geomType() == "PLANE"]
    b_faces = [face for face in second.Faces() if face.geomType() == "PLANE"]
    area = 0.0
    for a in a_faces:
        a_normal, a_center = coordinates(a.normalAt()), coordinates(a.Center())
        a_box = a.BoundingBox()
        for b in b_faces:
            if dot(a_normal, coordinates(b.normalAt())) > -1 + 1e-6:
                continue
            if abs(dot(add(coordinates(b.Center()), scale(a_center, -1)), a_normal)) > 1e-5:
                continue
            b_box = b.BoundingBox()
            if any(getattr(a_box, axis + "max") < getattr(b_box, axis + "min") - 1e-5 or
                   getattr(b_box, axis + "max") < getattr(a_box, axis + "min") - 1e-5 for axis in ("x", "y", "z")):
                continue
            contact = a.intersect(b)
            value = contact.Area()
            if not contact.isValid() or not math.isfinite(value):
                raise CadGeometryError("Mechanical contact check returned invalid geometry")
            area += value
    return area


def _blocked(solid: Any, obstacle: Any) -> bool:
    intersection = solid.intersect(obstacle)
    value = intersection.Volume()
    if not intersection.isValid() or not math.isfinite(value) or value < -1e-6:
        raise CadGeometryError("Mechanical retention check returned invalid geometry")
    return bool(value > 0.1)


def _captured(first: CadComponent, second: CadComponent, a: Any, b: Any, clearance: float) -> None:
    motion = first.motion or second.motion
    axis = AXES[motion.axis] if motion else AXES["x"]
    for direction in AXES.values():
        for sign in (-1, 1):
            if not _blocked(a.translate(scale(direction, sign * (clearance + 0.25))), b):
                raise ValueError("captured fastening lacks opposing translational stops; add a retainer or use an explicit fastening")
    center = world(first, ZERO)
    for sign in (-1, 1):
        if not _blocked(a.rotate(center, add(center, axis), sign * 15), b):
            raise ValueError("captured fastening lacks antirotation; a loose round cavity does not hold a nut")


def _bore_evidence(frame: Feature, solid: Any, joint: CadMechanicalConnection, material: MaterialChecks) -> None:
    box = solid.BoundingBox()
    projections = [dot((x, y, z), frame.axis) for x in (box.xmin, box.xmax) for y in (box.ymin, box.ymax) for z in (box.zmin, box.zmax)]
    low, high = max(frame.low, min(projections)), min(frame.high, max(projections))
    if frame.low > min(projections) + 1e-5 or frame.high < max(projections) - 1e-5:
        raise ValueError("bolted mounting requires through bores reaching both mounting faces; blind bores are not verified")
    if high - low < joint.minEngagement - 1e-5:
        raise ValueError("mounting bore has insufficient material thickness for declared engagement")
    side = cross(frame.axis, AXES["z"] if abs(frame.axis[2]) < 0.9 else AXES["x"])
    side = scale(side, 1 / math.sqrt(dot(side, side)))
    other = cross(frame.axis, side)
    for fraction in (0.001, 0.2, 0.5, 0.8, 0.999):
        point = add(frame.center, scale(frame.axis, low + (high - low) * fraction - dot(frame.center, frame.axis)))
        if material.inside(solid, point) or not all(material.inside(solid, add(point, scale(direction, frame.step.diameter / 2 + 0.2)))
                                              for direction in (side, scale(side, -1), other, scale(other, -1))):
            raise ValueError("declared mounting bore is blocked, removed or lacks surrounding material")


def _bolted(joint: CadMechanicalConnection, first: CadComponent, second: CadComponent, first_solid: Any, second_solid: Any, material: MaterialChecks) -> None:
    a_step = next(step for step in first.steps if step.id == joint.firstFeature)
    b_step = next(step for step in second.steps if step.id == joint.secondFeature)
    patterns = [step.pattern for step in (a_step, b_step)]
    counts = [pattern.count if pattern else 1 for pattern in patterns]
    if counts[0] != counts[1] or counts[0] < 2 or any(pattern and pattern.kind != "linear" for pattern in patterns):
        raise ValueError("bolted mounting needs at least two matching holes in a linear pattern")
    for index in range(counts[0]):
        offsets = [scale(coordinates(pattern.offset), index) if isinstance(pattern, LinearPattern) else ZERO for pattern in patterns]
        a, b = feature(first, joint.firstFeature, offsets[0]), feature(second, joint.secondFeature, offsets[1])
        if a.step.op != "cut" or b.step.op != "cut" or isinstance(a.step, ThreadStep) or isinstance(b.step, ThreadStep):
            raise ValueError("bolted mounting currently requires matching clearance bores; threaded fastenings are not verified")
        if abs(dot(a.axis, b.axis)) < 1 - 1e-6 or line_distance(a.center, b.center, a.axis) > 1e-5:
            raise ValueError("mounting holes are not coaxial in assembly coordinates")
        if any(not 0 <= (step.diameter - joint.fastenerDiameter) / 2 <= joint.maxClearance + 1e-6 for step in (a.step, b.step)):
            raise ValueError("mounting hole clearance does not match the declared fastener diameter")
        _bore_evidence(a, first_solid, joint, material)
        _bore_evidence(b, second_solid, joint, material)


def _fit(joint: CadMechanicalConnection, first: CadComponent, second: CadComponent, a_solid: Any, b_solid: Any, material: MaterialChecks) -> Feature:
    a, b = feature(first, joint.firstFeature), feature(second, joint.secondFeature)
    if a.step.pattern or b.step.pattern:
        raise ValueError("use individual feature IDs for shaft/bore joints; patterned joints are not verified")
    if a.step.op not in ("base", "union") or b.step.op != "cut":
        raise ValueError("first feature must be a material shaft/thread and second feature a cut bore/thread")
    if abs(dot(a.axis, b.axis)) < 1 - 1e-6 or line_distance(a.center, b.center, a.axis) > 1e-5:
        raise ValueError("shaft and receiving feature are not coaxial in assembly coordinates; account for local offsets and component positions")
    b_low, b_high = sorted((dot(b.center, a.axis) - b.step.height / 2, dot(b.center, a.axis) + b.step.height / 2))
    low, high = max(a.low, b_low), min(a.high, b_high)
    if high - low < joint.minEngagement - 1e-5:
        raise ValueError(f"insufficient engagement: {max(0, high - low):.3f} mm; need {joint.minEngagement:.3f} mm throughout travel")
    if joint.kind == "thread":
        if not isinstance(a.step, ThreadStep) or not isinstance(b.step, ThreadStep):
            raise ValueError("thread connection must reference male and female thread features")
        if any(getattr(a.step, key) != getattr(b.step, key) for key in ("diameter", "pitch", "starts", "profile", "handedness")) or dot(a.axis, b.axis) < 1 - 1e-6:
            raise ValueError("mating thread diameter, pitch, starts, profile, handedness and axis orientation must match")
        clearance = b.step.clearance
        sign = 1 if a.step.handedness == "right" else -1
        lead = a.step.pitch * a.step.starts
        residual = _rate(first, a.axis, True) - _rate(second, a.axis, True) + sign * 360 / lead * (_rate(second, a.axis, False) - _rate(first, a.axis, False))
        if not _shared_command(first, second) or abs(residual) > 1e-6:
            raise ValueError("thread drive motion is incompatible with handedness, lead or shared command; linked animation is not proof of transmission")
        core_radius = (a.step.diameter - 2 * a.step.pitch * (0.613434654 if a.step.profile == "metric" else 0.5)) / 4
        wall_radius = b.step.diameter / 2 + b.step.clearance + 0.2
    else:
        if isinstance(a.step, ThreadStep) or isinstance(b.step, ThreadStep):
            raise ValueError("use a smooth journal for a guide/bearing; threaded material is not a cylindrical journal")
        clearance = (b.step.diameter - a.step.diameter) / 2
        core_radius, wall_radius = a.step.diameter / 2 - min(.01, a.step.diameter / 20), b.step.diameter / 2 + 0.2
    if clearance < 0.001 or clearance > joint.maxClearance + 1e-6:
        raise ValueError(f"radial clearance {clearance:.4f} mm is outside 0.001–{joint.maxClearance:.4f} mm")
    transverse = cross(a.axis, AXES["z"] if abs(a.axis[2]) < 0.9 else AXES["x"])
    transverse = scale(transverse, 1 / math.sqrt(dot(transverse, transverse)))
    other = cross(a.axis, transverse)
    hits = []
    for fraction in (0.2, 0.5, 0.8):
        station = low + (high - low) * fraction
        center = add(a.center, scale(a.axis, station - dot(a.center, a.axis)))
        directions = (transverse, scale(transverse, -1), other, scale(other, -1))
        if not _positive_feature_preserved(first, a.step) and not all(material.inside(a_solid, add(center, scale(direction, core_radius))) for direction in directions):
            raise ValueError("referenced shaft/thread was removed or does not contain material at the engagement")
        hits.append(all(material.inside(b_solid, add(center, scale(direction, wall_radius))) for direction in directions))
        if joint.kind == "thread":
            _thread_evidence(a, first, a_solid, station, material)
            _thread_evidence(b, second, b_solid, dot(center, b.axis), material)
    if not all(hits):
        raise ValueError("receiving bore/thread lacks surrounding material over its declared engagement; a cut in air is not a bearing")
    return a


def check_mechanics(spec: CadAssemblySpec, cq: Any, poses: list[tuple[CadCollisionPose, list[CadComponent], list[Any]]]) -> list[dict[str, Any]]:
    if spec.mechanics is None:
        return []
    material = MaterialChecks()
    issues: list[dict[str, Any]] = []
    joint_checks: dict[tuple[str, tuple[float, float], tuple[float, float]], str | None] = {}
    for pose, components, solids in poses:
        bodies = {component.id: (component, solid) for component, solid in zip(components, solids, strict=True)}
        for joint in spec.mechanics.connections:
            first, a = bodies[joint.first]
            second, b = bodies[joint.second]
            if pose != "current" and first.motion is None and second.motion is None:
                continue
            key = (joint.id, _pose_key(first), _pose_key(second))
            if key in joint_checks:
                if joint_checks[key] is not None:
                    issues.append({"connectionId": joint.id, "components": [joint.first, joint.second], "pose": pose,
                                   "message": f"CAD mechanical connection {joint.id} ({joint.first}/{joint.second}) at {pose}: {joint_checks[key]}"})
                continue
            try:
                if joint.kind == "fixed":
                    if not _rigid_motion(first, second):
                        raise ValueError("fixed fastening needs equal rigid motion; sharing a group with different factors is insufficient")
                    if joint.fastening == "captured":
                        _captured(first, second, a, b, joint.maxClearance)
                    elif joint.fastening == "bonded" and joint.firstFeature and joint.secondFeature:
                        _fit(joint, first, second, a, b, material)
                    else:
                        area = _contact_area(a, b)
                        if area < 1:
                            raise ValueError(f"mounting surfaces have no shared planar contact area (found {area:.3f} mm²); parts are floating or separated")
                        if joint.fastening == "bolted":
                            _bolted(joint, first, second, a, b, material)
                else:
                    frame = _fit(joint, first, second, a, b, material)
                    if joint.kind in ("linear", "rotary"):
                        relative_translation = _rate(first, frame.axis, False) - _rate(second, frame.axis, False)
                        relative_rotation = _rate(first, frame.axis, True) - _rate(second, frame.axis, True)
                        moving = [component for component in (first, second) if component.motion]
                        if not _shared_command(first, second) or any(abs(dot(AXES[component.motion.axis], frame.axis)) < 1 - 1e-6 for component in moving if component.motion):
                            raise ValueError("guide/bearing motion must follow its joint axis and shared command")
                        if joint.kind == "linear" and (abs(relative_rotation) > 1e-6 or abs(relative_translation) < 1e-6):
                            raise ValueError("linear guide requires relative translation and no relative rotation")
                        if joint.kind == "rotary" and (abs(relative_translation) > 1e-6 or abs(relative_rotation) < 1e-6):
                            raise ValueError("rotary bearing requires relative rotation and no axial translation")
                joint_checks[key] = None
            except (ValueError, TypeError) as exc:
                joint_checks[key] = str(exc)
                issues.append({"connectionId": joint.id, "components": [joint.first, joint.second], "pose": pose,
                               "message": f"CAD mechanical connection {joint.id} ({joint.first}/{joint.second}) at {pose}: {exc}"})
    if issues:
        return issues
    current_components, current_solids = poses[0][1], poses[0][2]
    bodies = {component.id: (component, solid) for component, solid in zip(current_components, current_solids, strict=True)}
    rigid_graph = {component.id: {component.id} for component in current_components}
    for joint in spec.mechanics.connections:
        if joint.kind == "fixed":
            rigid_graph[joint.first].add(joint.second)
            rigid_graph[joint.second].add(joint.first)
    def cluster(component_id: str) -> set[str]:
        reached, pending = {component_id}, [component_id]
        while pending:
            for next_id in rigid_graph[pending.pop()] - reached:
                reached.add(next_id)
                pending.append(next_id)
        return reached
    grounded = cluster(spec.mechanics.grounded)
    for component in current_components:
        members = cluster(component.id)
        reason = None
        if component.motion is None and component.id not in grounded:
            reason = "fixed component lacks a verified fixed fastening path to ground"
        elif component.motion and component.motion.kind == "slider":
            guides = [joint for joint in spec.mechanics.connections if joint.kind == "linear" and bool(joint.first in members) != bool(joint.second in members)]
            frames = [feature(bodies[joint.first][0], joint.firstFeature) for joint in guides]
            if not any(abs(dot(a.axis, b.axis)) > 1 - 1e-6 and line_distance(a.center, b.center, a.axis) > 1 for index, a in enumerate(frames) for b in frames[index + 1:]):
                reason = "slider needs two separated parallel guides on its rigid cluster to prevent rotation; a screw alone is not a guide"
        elif component.motion and component.motion.kind == "rotary":
            bearings = [joint for joint in spec.mechanics.connections if joint.kind == "rotary" and joint.first in members and joint.second not in members]
            axis = AXES[component.motion.axis]
            retention_checks: dict[tuple[tuple[float, float], ...], bool] = {}
            for pose, posed_components, posed_solids in poses:
                posed_bodies = {item.id: solid for item, solid in zip(posed_components, posed_solids, strict=True)}
                posed_parameters = {item.id: item for item in posed_components}
                retention_key = tuple(_pose_key(posed_parameters[item]) for item in [*sorted(members), *[joint.second for joint in bearings]])
                obstacles = [posed_bodies[joint.second] for joint in bearings]
                source = cq.Compound.makeCompound([posed_bodies[item] for item in sorted(members)]) if len(members) > 1 else posed_bodies[component.id]
                if retention_key not in retention_checks:
                    retention_checks[retention_key] = bool(obstacles) and all(any(_blocked(source.translate(scale(axis, sign * (joint.maxClearance + 0.25))), obstacle)
                                                                      for joint, obstacle in zip(bearings, obstacles, strict=True)) for sign in (-1, 1))
                if not retention_checks[retention_key]:
                    issues.append({"connectionId": "", "components": [component.id], "pose": pose,
                                   "message": f"CAD mechanical component {component.id} at {pose}: rotary shaft lacks bearing support and opposing axial stops; add shoulders/retainers in the modeled geometry"})
        elif component.motion and component.motion.kind == "screw":
            reason = "combined screw motion requires an explicit helical guide; current mechanical verification supports stationary rotary screws driving guided sliders"
        if reason:
            issues.append({"connectionId": "", "components": [component.id], "pose": "current", "message": f"CAD mechanical component {component.id}: {reason}"})
    return issues


def legacy_mechanics_report(spec: CadAssemblySpec, solids: list[Any]) -> dict[str, Any]:
    fixed = [(component, solid) for component, solid in zip(spec.components, solids, strict=True) if component.motion is None]
    separated = []
    for component, solid in fixed:
        others = [(other, body) for other, body in fixed if other.id != component.id]
        if others:
            distances = [(other.id, float(solid.distance(body))) for other, body in others]
            nearest, gap = min(distances, key=lambda item: item[1])
            if not math.isfinite(gap):
                raise CadGeometryError("Mechanical distance check returned a nonfinite value")
            if gap > 1e-5:
                separated.append({"component": component.id, "nearestFixedComponent": nearest, "gapMm": gap})
    return {"status": "unverified", "message": "Conjunto sem vínculos mecânicos declarados. Ausência de colisões não comprova funcionamento.",
            "separatedFixedComponents": separated, "connections": 0, "requirements": []}
