from __future__ import annotations

import logging
import math
from importlib import import_module
from pathlib import Path
from tempfile import TemporaryDirectory
from time import monotonic
from typing import Any

from domain.cad_assembly import CadAssemblySpec, CadComponent
from domain.cad_diagnostics import (
    CadAssemblyDiagnostics,
    CadBounds,
    CadCollision,
    CadCollisionPose,
    CadMechanicalIssue,
)
from domain.cad_program import CadProgramSpec

from api.cad_adapter import CadArtifact, CadArtifactTooLargeError, CadGeometryError
from api.cad_mechanics import check_mechanics
from api.cad_mesh import preview_tessellation
from api.cad_program_adapter import _engine, _one_solid, build_program_solid

logger = logging.getLogger(__name__)


def _broad_bounds(solid: Any, cq: Any) -> Any:
    box = import_module("OCP.Bnd").Bnd_Box()
    import_module("OCP.BRepBndLib").BRepBndLib.Add_s(solid.wrapped, box, True)
    return cq.BoundBox(box)


class CadAssemblyInterferenceError(CadGeometryError):
    def __init__(self, collisions: list[CadCollision], mechanical_issues: list[dict[str, Any]] | None = None) -> None:
        super().__init__(collisions[0].message)
        self.diagnostics = CadAssemblyDiagnostics(collisions=collisions, mechanicalIssues=[CadMechanicalIssue.model_validate(issue) for issue in mechanical_issues or []])


class CadAssemblyMechanicalError(CadGeometryError):
    def __init__(self, issues: list[dict[str, Any]]) -> None:
        super().__init__(issues[0]["message"])
        self.diagnostics = {"schemaVersion": "1.0", "check": "assembly_mechanics", "issues": issues}


def _box_bounds(box: Any) -> CadBounds:
    return CadBounds(x=(box.xmin, box.xmax), y=(box.ymin, box.ymax), z=(box.zmin, box.zmax))


def _local_component_solid(component: CadComponent, cq: Any) -> Any:
    program = CadProgramSpec(schemaVersion="3.0", units="mm", partId=component.id, steps=component.steps)
    try:
        solid = _one_solid(build_program_solid(program, cq), f"component {component.id}")
    except CadGeometryError as exc:
        raise CadGeometryError(f"CAD component {component.id}: {exc}") from exc
    return solid


def _position_component(component: CadComponent, solid: Any) -> Any:
    motion = component.motion
    if motion is not None:
        value = motion.value * (motion.factor if motion.factor is not None else 1)
        direction = {"x": (1, 0, 0), "y": (0, 1, 0), "z": (0, 0, 1)}[motion.axis]
        if motion.kind == "rotary":
            solid = solid.rotate((0, 0, 0), direction, value)
        elif motion.kind == "screw":
            assert motion.pitch is not None
            solid = solid.rotate((0, 0, 0), direction, value * 360 / motion.pitch)
        if motion.kind != "rotary":
            solid = solid.translate(tuple(axis * value for axis in direction))
    return solid.translate((component.position.x, component.position.y, component.position.z))


def _component_solid(component: CadComponent, cq: Any) -> Any:
    return _position_component(component, _local_component_solid(component, cq))


def build_assembly_solids(spec: CadAssemblySpec, cq: Any | None = None) -> list[Any]:
    engine = cq or _engine()
    return [_component_solid(component, engine) for component in spec.components]


def _check_interference(spec: CadAssemblySpec, cq: Any) -> list[Any]:
    started = monotonic()
    local_solids = [_local_component_solid(component, cq) for component in spec.components]
    volumes = [solid.Volume() for solid in local_solids]
    current = [_position_component(component, solid) for component, solid in zip(spec.components, local_solids, strict=True)]
    positions: list[tuple[CadCollisionPose, str, list[Any], list[float | None]]] = [
        ("current", "posição atual", current, [component.motion.value if component.motion else None for component in spec.components])]
    mechanical_poses: list[tuple[CadCollisionPose, list[CadComponent], list[Any]]] = [("current", spec.components, current)]
    samples: tuple[tuple[CadCollisionPose, str, float], ...] = (("minimum", "curso mínimo", 0.0), ("quarter", "25% do curso", 0.25),
               ("middle", "meio do curso", 0.5), ("three_quarters", "75% do curso", 0.75), ("maximum", "curso máximo", 1.0))
    for pose, label, fraction in samples if any(component.motion for component in spec.components) else ():
        components = [component.model_copy(update={"motion": component.motion.model_copy(update={
            "value": component.motion.minimum + (component.motion.maximum - component.motion.minimum) * fraction})})
                      if component.motion else component for component in spec.components]
        extreme = spec.model_copy(update={"components": components})
        positions.append((pose, label, [_position_component(component, solid)
                                  for component, solid in zip(extreme.components, local_solids, strict=True)],
                          [component.motion.value if component.motion else None for component in extreme.components]))
        mechanical_poses.append((pose, extreme.components, positions[-1][2]))
    collisions: list[CadCollision] = []
    broad_boxes: dict[tuple[int, float | None], Any] = {}
    exact_boxes: dict[tuple[int, float | None], Any] = {}
    pairs: dict[tuple[int, int, float | None, float | None], tuple[Any, float, float, float] | None] = {}
    for pose, label, solids, values in positions:
        for first_index, first in enumerate(solids):
            first_key = (first_index, values[first_index])
            if first_key not in broad_boxes:
                broad_boxes[first_key] = _broad_bounds(first, cq)
            broad_a = broad_boxes[first_key]
            for second_index in range(first_index + 1, len(solids)):
                second = solids[second_index]
                second_key = (second_index, values[second_index])
                pair_key = (first_index, second_index, values[first_index], values[second_index])
                if second_key not in broad_boxes:
                    broad_boxes[second_key] = _broad_bounds(second, cq)
                broad_b = broad_boxes[second_key]
                if pair_key not in pairs:
                    if any(min(getattr(broad_a, axis + "max"), getattr(broad_b, axis + "max")) -
                           max(getattr(broad_a, axis + "min"), getattr(broad_b, axis + "min")) <= 0
                           for axis in ("x", "y", "z")):
                        pairs[pair_key] = None
                    else:
                        logger.info("CAD interference pose=%s pair=%s/%s elapsed=%.1fs", pose,
                                    spec.components[first_index].id, spec.components[second_index].id, monotonic() - started)
                        try:
                            intersection = first.intersect(second)
                            overlap = intersection.Volume()
                            if not intersection.isValid() or not math.isfinite(overlap) or overlap < -1e-6:
                                raise CadGeometryError("CAD assembly interference check produced invalid geometry or volume")
                        except CadGeometryError:
                            raise
                        except Exception as exc:
                            raise CadGeometryError("CAD assembly interference check failed") from exc
                        pairs[pair_key] = (intersection.BoundingBox(), overlap, volumes[first_index], volumes[second_index]) if overlap > 0.1 else None
                result = pairs[pair_key]
                if result is None:
                    continue
                overlap_box, overlap, first_volume, second_volume = result
                if overlap > 0.1:
                    if first_key not in exact_boxes:
                        exact_boxes[first_key] = first.BoundingBox()
                    if second_key not in exact_boxes:
                        exact_boxes[second_key] = second.BoundingBox()
                    a, b = exact_boxes[first_key], exact_boxes[second_key]
                    names = (spec.components[first_index].id, spec.components[second_index].id)
                    def bounds(box: Any) -> str:
                        return (f"x=[{box.xmin:.2f}, {box.xmax:.2f}], "
                                f"y=[{box.ymin:.2f}, {box.ymax:.2f}], "
                                f"z=[{box.zmin:.2f}, {box.zmax:.2f}]")
                    message = (
                        f"CAD components {names[0]} and {names[1]} intersect at {label} by {overlap:.2f} mm³; "
                        f"component volumes: {names[0]}={first_volume:.2f}, {names[1]}={second_volume:.2f} mm³; "
                        f"overlap fractions: {names[0]}={overlap / first_volume:.4f}, "
                        f"{names[1]}={overlap / second_volume:.4f}; "
                        f"overlap bounds: {bounds(overlap_box)}; "
                        f"component bounds: {names[0]} {bounds(a)}; {names[1]} {bounds(b)}; "
                        "add a clearance or reduce the travel"
                    )
                    collisions.append(CadCollision(components=names, pose=pose, message=message,
                        overlapVolumeMm3=overlap, componentVolumesMm3=(first_volume, second_volume),
                        overlapBoundsMm=_box_bounds(overlap_box), componentBoundsMm=(_box_bounds(a), _box_bounds(b))))

    logger.info("CAD interference completed pairs=%s collisions=%s elapsed=%.1fs", len(pairs), len(collisions), monotonic() - started)

    try:
        mechanical_issues = check_mechanics(spec, cq, mechanical_poses)
    except CadGeometryError:
        raise
    except Exception as exc:
        raise CadGeometryError("CAD mechanical verification failed; no functional approval was issued") from exc
    if collisions:
        raise CadAssemblyInterferenceError(collisions, mechanical_issues)
    if mechanical_issues:
        raise CadAssemblyMechanicalError(mechanical_issues)

    return current


def build_assembly_step(spec: CadAssemblySpec, max_bytes: int) -> CadArtifact:
    cq = _engine()
    solids = _check_interference(spec, cq)
    compound = cq.Compound.makeCompound(solids)
    try:
        with TemporaryDirectory(prefix="mcp-x3d-assembly-") as directory:
            path = Path(directory) / "assembly.step"
            cq.exporters.export(compound, str(path), exportType="STEP")
            if path.stat().st_size > max_bytes:
                raise CadArtifactTooLargeError("CAD assembly STEP exceeds the configured size limit")
            data = path.read_bytes()
            imported = cq.importers.importStep(str(path)).solids().vals()
    except CadArtifactTooLargeError:
        raise
    except Exception as exc:
        raise CadGeometryError("CAD assembly STEP conversion failed") from exc
    if len(imported) != len(solids) or any(not solid.isValid() or solid.Volume() <= 0 for solid in imported):
        raise CadGeometryError("CAD assembly STEP lost or invalidated a component")
    for component, original, restored in zip(spec.components, solids, imported, strict=True):
        original_box, restored_box = original.BoundingBox(), restored.BoundingBox()
        if not math.isclose(original.Volume(), restored.Volume(), rel_tol=1e-5, abs_tol=1e-4) or any(
            not math.isclose(getattr(original_box, axis), getattr(restored_box, axis), rel_tol=1e-5, abs_tol=1e-4)
            for axis in ("xmin", "xmax", "ymin", "ymax", "zmin", "zmax")
        ):
            raise CadGeometryError(f"CAD assembly STEP differs from component {component.id}")
    original_volume = sum(solid.Volume() for solid in solids)
    imported_volume = sum(solid.Volume() for solid in imported)
    source_box, target_box = compound.BoundingBox(), cq.Compound.makeCompound(imported).BoundingBox()
    if not math.isclose(original_volume, imported_volume, rel_tol=1e-5, abs_tol=1e-4) or any(
        not math.isclose(getattr(source_box, axis), getattr(target_box, axis), rel_tol=1e-5, abs_tol=1e-4)
        for axis in ("xmin", "xmax", "ymin", "ymax", "zmin", "zmax")
    ):
        raise CadGeometryError("CAD assembly STEP differs from the component geometry")
    return CadArtifact(data, imported_volume, (target_box.xlen, target_box.ylen, target_box.zlen), len(imported))


def build_assembly_mesh(spec: CadAssemblySpec) -> dict[str, Any]:
    solids = _check_interference(spec, _engine())
    vertices: list[list[float]] = []
    triangles: list[list[int]] = []
    components: list[dict[str, Any]] = []
    meshes = preview_tessellation(solids)
    for component, solid, (local_vertices, local_triangles) in zip(spec.components, solids, meshes, strict=True):
        offset = len(vertices)
        vertices.extend([[vertex.x, vertex.y, vertex.z] for vertex in local_vertices])
        triangles.extend([[a + offset, b + offset, c + offset] for a, b, c in local_triangles])
        components.append({"id": component.id, "triangles": len(local_triangles), "volumeMm3": solid.Volume()})
    box = _engine().Compound.makeCompound(solids).BoundingBox()
    return {"vertices": vertices, "triangles": triangles,
            "boundsMm": [box.xlen, box.ylen, box.zlen], "components": components}
