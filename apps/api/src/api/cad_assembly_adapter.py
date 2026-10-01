from __future__ import annotations

import math
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any

from domain.cad_assembly import CadAssemblySpec, CadComponent
from domain.cad_program import CadProgramSpec

from api.cad_adapter import CadArtifact, CadArtifactTooLargeError, CadGeometryError
from api.cad_program_adapter import _engine, _one_solid, build_program_solid


def _component_solid(component: CadComponent, cq: Any) -> Any:
    program = CadProgramSpec(schemaVersion="3.0", units="mm", partId=component.id, steps=component.steps)
    try:
        solid = _one_solid(build_program_solid(program, cq), f"component {component.id}")
    except CadGeometryError as exc:
        raise CadGeometryError(f"CAD component {component.id}: {exc}") from exc
    motion = component.motion
    if motion is not None:
        direction = {"x": (1, 0, 0), "y": (0, 1, 0), "z": (0, 0, 1)}[motion.axis]
        if motion.kind == "rotary":
            solid = solid.rotate((0, 0, 0), direction, motion.value)
        elif motion.kind == "screw":
            assert motion.pitch is not None
            solid = solid.rotate((0, 0, 0), direction, motion.value * 360 / motion.pitch)
        if motion.kind != "rotary":
            solid = solid.translate(tuple(axis * motion.value for axis in direction))
    return solid.translate((component.position.x, component.position.y, component.position.z))


def build_assembly_solids(spec: CadAssemblySpec, cq: Any | None = None) -> list[Any]:
    engine = cq or _engine()
    return [_component_solid(component, engine) for component in spec.components]


def _check_interference(spec: CadAssemblySpec, cq: Any) -> None:
    positions: list[tuple[str, list[Any]]] = [("posição atual", build_assembly_solids(spec, cq))]
    samples = (("curso mínimo", 0.0), ("25% do curso", 0.25),
               ("meio do curso", 0.5), ("75% do curso", 0.75), ("curso máximo", 1.0))
    for label, fraction in samples if any(component.motion for component in spec.components) else ():
        components = [component.model_copy(update={"motion": component.motion.model_copy(update={
            "value": component.motion.minimum + (component.motion.maximum - component.motion.minimum) * fraction})})
                      if component.motion else component for component in spec.components]
        extreme = spec.model_copy(update={"components": components})
        positions.append((label, build_assembly_solids(extreme, cq)))
    for label, solids in positions:
        for first_index, first in enumerate(solids):
            a = first.BoundingBox()
            for second_index in range(first_index + 1, len(solids)):
                second = solids[second_index]
                b = second.BoundingBox()
                if any(min(getattr(a, axis + "max"), getattr(b, axis + "max")) -
                       max(getattr(a, axis + "min"), getattr(b, axis + "min")) <= 0.01
                       for axis in ("x", "y", "z")):
                    continue
                try:
                    intersection = first.intersect(second)
                    overlap = intersection.Volume()
                except Exception as exc:
                    raise CadGeometryError("CAD assembly interference check failed") from exc
                if overlap > 0.1:
                    names = (spec.components[first_index].id, spec.components[second_index].id)
                    first_volume, second_volume = first.Volume(), second.Volume()
                    overlap_box = intersection.BoundingBox()
                    def bounds(box: Any) -> str:
                        return (f"x=[{box.xmin:.2f}, {box.xmax:.2f}], "
                                f"y=[{box.ymin:.2f}, {box.ymax:.2f}], "
                                f"z=[{box.zmin:.2f}, {box.zmax:.2f}]")
                    raise CadGeometryError(
                        f"CAD components {names[0]} and {names[1]} intersect at {label} by {overlap:.2f} mm³; "
                        f"component volumes: {names[0]}={first_volume:.2f}, {names[1]}={second_volume:.2f} mm³; "
                        f"overlap fractions: {names[0]}={overlap / first_volume:.4f}, "
                        f"{names[1]}={overlap / second_volume:.4f}; "
                        f"overlap bounds: {bounds(overlap_box)}; "
                        f"component bounds: {names[0]} {bounds(a)}; {names[1]} {bounds(b)}; "
                        "add a clearance or reduce the travel"
                    )


def build_assembly_step(spec: CadAssemblySpec, max_bytes: int) -> CadArtifact:
    cq = _engine()
    _check_interference(spec, cq)
    solids = build_assembly_solids(spec, cq)
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
    original_volume = sum(solid.Volume() for solid in solids)
    imported_volume = sum(solid.Volume() for solid in imported)
    source_box, target_box = compound.BoundingBox(), cq.Compound.makeCompound(imported).BoundingBox()
    if not math.isclose(original_volume, imported_volume, rel_tol=1e-5, abs_tol=1e-4) or any(
        not math.isclose(getattr(source_box, axis), getattr(target_box, axis), rel_tol=1e-5, abs_tol=1e-4)
        for axis in ("xlen", "ylen", "zlen")
    ):
        raise CadGeometryError("CAD assembly STEP differs from the component geometry")
    return CadArtifact(data, imported_volume, (target_box.xlen, target_box.ylen, target_box.zlen), len(imported))


def build_assembly_mesh(spec: CadAssemblySpec) -> dict[str, Any]:
    _check_interference(spec, _engine())
    solids = build_assembly_solids(spec)
    vertices: list[list[float]] = []
    triangles: list[list[int]] = []
    components: list[dict[str, Any]] = []
    for component, solid in zip(spec.components, solids, strict=True):
        local_vertices, local_triangles = solid.tessellate(0.5)
        offset = len(vertices)
        vertices.extend([[vertex.x, vertex.y, vertex.z] for vertex in local_vertices])
        triangles.extend([[a + offset, b + offset, c + offset] for a, b, c in local_triangles])
        components.append({"id": component.id, "triangles": len(local_triangles), "volumeMm3": solid.Volume()})
        if len(triangles) > 50_000:
            raise CadArtifactTooLargeError("CAD assembly mesh exceeds 50,000 triangles")
    box = _engine().Compound.makeCompound(solids).BoundingBox()
    return {"vertices": vertices, "triangles": triangles,
            "boundsMm": [box.xlen, box.ylen, box.zlen], "components": components}
