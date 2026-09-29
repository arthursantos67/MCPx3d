from __future__ import annotations

import math
from importlib import import_module
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any

from domain.cad_program import (
    BoxStep,
    CadProgramSpec,
    CircularPattern,
    ConeStep,
    CylinderStep,
    LinearPattern,
    PolygonStep,
    RevolveStep,
    SphereStep,
)

from api.cad_adapter import (
    CadArtifact,
    CadArtifactTooLargeError,
    CadEngineUnavailableError,
    CadGeometryError,
)


def _engine() -> Any:
    try:
        return import_module("cadquery")
    except ImportError as exc:
        raise CadEngineUnavailableError("Start the API with uv run --extra cad api to enable CAD exports") from exc


def _one_solid(workplane: Any, context: str | None = None) -> Any:
    solids = workplane.solids().vals()
    if len(solids) == 1 and solids[0].isValid() and solids[0].Volume() > 0:
        return solids[0]
    if context is None:
        raise CadGeometryError("Each CAD step must produce one valid connected solid")
    if len(solids) > 1:
        raise CadGeometryError(
            f"CAD {context} leaves {len(solids)} separate solids; every union must overlap the part and no cut may split it"
        )
    raise CadGeometryError(f"CAD {context} produces an invalid or empty solid")


def _instances(feature: Any, pattern: CircularPattern | LinearPattern | None) -> list[Any]:
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


def _bounds(box: Any) -> str:
    return ", ".join(
        f"{axis}=[{getattr(box, axis + 'min'):.2f}, {getattr(box, axis + 'max'):.2f}]"
        for axis in ("x", "y", "z")
    )


def _point(vector: Any) -> str:
    return f"x={vector.x:.2f}, y={vector.y:.2f}, z={vector.z:.2f}"


def _boxes_overlap(left: Any, right: Any) -> bool:
    return all(
        min(getattr(left, axis + "max"), getattr(right, axis + "max"))
        > max(getattr(left, axis + "min"), getattr(right, axis + "min"))
        for axis in ("x", "y", "z")
    )


def _profile_issue(points: list[Any]) -> str | None:
    count = len(points)

    def cross(a: Any, b: Any, c: Any) -> float:
        return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)

    def on_segment(a: Any, b: Any, c: Any) -> bool:
        return (min(a.x, b.x) <= c.x <= max(a.x, b.x)
                and min(a.y, b.y) <= c.y <= max(a.y, b.y))

    for index, point in enumerate(points):
        following = points[(index + 1) % count]
        if point.x == following.x and point.y == following.y:
            return f"profile has a zero-length edge at points {index + 1} and {(index + 1) % count + 1}"

    for first in range(count):
        a, b = points[first], points[(first + 1) % count]
        for second in range(first + 1, count):
            if (first + 1) % count == second or (second + 1) % count == first:
                continue
            c, d = points[second], points[(second + 1) % count]
            ab_c, ab_d = cross(a, b, c), cross(a, b, d)
            cd_a, cd_b = cross(c, d, a), cross(c, d, b)
            if ((ab_c > 0 > ab_d or ab_d > 0 > ab_c) and (cd_a > 0 > cd_b or cd_b > 0 > cd_a)) or (
                ab_c == 0 and on_segment(a, b, c)
            ) or (
                ab_d == 0 and on_segment(a, b, d)
            ) or (
                cd_a == 0 and on_segment(c, d, a)
            ) or (
                cd_b == 0 and on_segment(c, d, b)
            ):
                return f"profile self-intersects between edges {first + 1} and {second + 1}"
    return None


def build_program_solid(spec: CadProgramSpec, cq: Any | None = None) -> Any:
    cq = cq or _engine()
    part = None
    for step in spec.steps:
        try:
            if isinstance(step, BoxStep):
                feature = cq.Workplane("XY").box(step.width, step.depth, step.height)
            elif isinstance(step, CylinderStep):
                feature = cq.Workplane("XY").circle(step.diameter / 2).extrude(step.height).translate((0, 0, -step.height / 2))
            elif isinstance(step, SphereStep):
                feature = cq.Workplane("XY").sphere(step.diameter / 2)
            elif isinstance(step, ConeStep):
                feature = cq.Workplane("XY").newObject([cq.Solid.makeCone(step.bottomDiameter / 2, step.topDiameter / 2, step.height, cq.Vector(0, 0, -step.height / 2))])
            elif isinstance(step, PolygonStep):
                if issue := _profile_issue(step.points):
                    raise CadGeometryError(f"CAD step {step.id} ({step.op}) polygon_prism {issue}")
                feature = cq.Workplane("XY").polyline([(point.x, point.y) for point in step.points]).close().extrude(step.height).translate((0, 0, -step.height / 2))
            elif isinstance(step, RevolveStep):
                if issue := _profile_issue(step.points):
                    raise CadGeometryError(f"CAD step {step.id} ({step.op}) revolve_profile {issue}")
                feature = cq.Workplane("XZ").polyline([(point.x, point.y) for point in step.points]).close().revolve(360, (0, 0), (0, 1))
            else:
                raise CadGeometryError(f"Unsupported CAD shape in step {step.id}")
            for angle, axis in ((step.rotation.x, (1, 0, 0)), (step.rotation.y, (0, 1, 0)), (step.rotation.z, (0, 0, 1))):
                if angle:
                    feature = feature.rotate((0, 0, 0), axis, angle)
            feature = feature.translate((step.position.x, step.position.y, step.position.z))
            if part is None:
                part = feature
            else:
                for number, instance in enumerate(_instances(feature, step.pattern), start=1):
                    current = _one_solid(part)
                    before = current.Volume()
                    before_bounds = current.BoundingBox()
                    part = part.union(instance) if step.op == "union" else part.cut(instance)
                    solid_count = len(part.solids().vals())
                    if solid_count > 1:
                        tool = _one_solid(instance)
                        tool_bounds = tool.BoundingBox()
                        if step.op == "union":
                            hint = ("bounding boxes overlap, but the solids may be separated by an opening or earlier cut"
                                    if _boxes_overlap(before_bounds, tool_bounds) else "bounding boxes do not overlap")
                            if not _boxes_overlap(before_bounds, tool_bounds):
                                try:
                                    solid_point, tool_point = cq.occ_impl.shapes.closest(current, tool)
                                    hint += f"; nearest solid point: {_point(solid_point)}; nearest tool point: {_point(tool_point)}"
                                except Exception:
                                    pass
                        else:
                            hint = "the cut disconnects the remaining material; preserve a material bridge"
                        raise CadGeometryError(
                            f"CAD step {step.id}{f' instance {number}' if step.pattern else ''} ({step.op}) leaves "
                            f"{solid_count} separate solids; "
                            f"current solid bounds: {_bounds(before_bounds)}; "
                            f"tool bounds: {_bounds(tool_bounds)}; {hint}"
                        )
                    after = _one_solid(part, f"step {step.id}{f' instance {number}' if step.pattern else ''} ({step.op})").Volume()
                    if not math.isfinite(after) or abs(after - before) <= max(1e-6, before * 1e-9):
                        raise CadGeometryError(
                            f"CAD step {step.id} instance {number} does not change the solid; "
                            f"current solid bounds: {_bounds(before_bounds)}; "
                            f"tool bounds: {_bounds(_one_solid(instance).BoundingBox())}"
                        )
                    _one_solid(part)
            _one_solid(part, f"step {step.id} ({step.op})")
        except CadGeometryError:
            raise
        except Exception as exc:
            raise CadGeometryError(f"CAD step {step.id} failed: {exc}") from exc
    return part


def build_program_step(spec: CadProgramSpec, max_bytes: int) -> CadArtifact:
    cq = _engine()
    part = build_program_solid(spec, cq)
    original = _one_solid(part)
    try:
        with TemporaryDirectory(prefix="mcp-x3d-program-") as directory:
            path = Path(directory) / "part.step"
            cq.exporters.export(part, str(path), exportType="STEP")
            if path.stat().st_size > max_bytes:
                raise CadArtifactTooLargeError("STEP artifact exceeds the configured size limit")
            step = path.read_bytes()
            imported = _one_solid(cq.importers.importStep(str(path)))
    except CadGeometryError:
        raise
    except Exception as exc:
        raise CadGeometryError("CAD STEP conversion failed") from exc
    a, b = original.BoundingBox(), imported.BoundingBox()
    if not math.isclose(original.Volume(), imported.Volume(), rel_tol=1e-5, abs_tol=1e-4) or any(
        not math.isclose(getattr(a, key), getattr(b, key), rel_tol=1e-5, abs_tol=1e-4)
        for key in ("xlen", "ylen", "zlen")
    ):
        raise CadGeometryError("STEP geometry differs from the CAD program")
    return CadArtifact(step=step, volume_mm3=imported.Volume(), bounds_mm=(b.xlen, b.ylen, b.zlen))


def build_program_mesh(spec: CadProgramSpec) -> dict[str, Any]:
    solid = _one_solid(build_program_solid(spec))
    vertices, triangles = solid.tessellate(0.5)
    if len(triangles) > 50_000:
        raise CadArtifactTooLargeError("CAD mesh exceeds 50,000 triangles")
    return {
        "vertices": [[vertex.x, vertex.y, vertex.z] for vertex in vertices],
        "triangles": [list(triangle) for triangle in triangles],
        "boundsMm": [solid.BoundingBox().xlen, solid.BoundingBox().ylen, solid.BoundingBox().zlen],
    }
