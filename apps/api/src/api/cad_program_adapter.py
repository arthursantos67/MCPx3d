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
                feature = cq.Workplane("XY").polyline([(point.x, point.y) for point in step.points]).close().extrude(step.height).translate((0, 0, -step.height / 2))
            elif isinstance(step, RevolveStep):
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
                    before = _one_solid(part).Volume()
                    part = part.union(instance) if step.op == "union" else part.cut(instance)
                    after = _one_solid(part, f"step {step.id}{f' instance {number}' if step.pattern else ''} ({step.op})").Volume()
                    if not math.isfinite(after) or abs(after - before) <= max(1e-6, before * 1e-9):
                        raise CadGeometryError(f"CAD step {step.id} instance {number} does not change the solid")
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
