from __future__ import annotations

import math
from dataclasses import dataclass
from importlib import import_module
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any

from domain.cad_part import CadPartSpec

from api.cad_runtime import configure_cad_kernel


class CadEngineUnavailableError(Exception):
    pass


class CadGeometryError(Exception):
    pass


class CadArtifactTooLargeError(CadGeometryError):
    pass


@dataclass(frozen=True)
class CadArtifact:
    step: bytes
    volume_mm3: float
    bounds_mm: tuple[float, float, float]
    solid_count: int = 1


def _validated_solid(workplane: Any) -> Any:
    solids = workplane.solids().vals()
    if len(solids) != 1 or not solids[0].isValid() or solids[0].Volume() <= 0:
        raise CadGeometryError("CAD geometry must contain one valid solid")
    return solids[0]


def _bounds(solid: Any) -> tuple[float, float, float]:
    box = solid.BoundingBox()
    return (box.xlen, box.ylen, box.zlen)


def _verify_hole(solid: Any, spec: CadPartSpec) -> None:
    faces = [face for face in solid.Faces() if face.geomType() == "CYLINDER"]
    wall_holes = spec.upright.holes if spec.upright else []
    outer_faces = (1 if spec.base.kind == "extruded_disc" else 4 if spec.cornerRadius else 0) + len(spec.bosses)
    if len(faces) != len(spec.features) + len(wall_holes) + outer_faces:
        raise CadGeometryError("CAD part has an unexpected number of through-hole faces")
    for hole in spec.features:
        boss_height = sum(
            boss.height for boss in spec.bosses
            if math.hypot(hole.x - boss.x, hole.y - boss.y) + hole.diameter / 2 + 0.1 <= boss.diameter / 2
        )
        expected_area = math.pi * hole.diameter * (spec.base.thickness + boss_height)
        if not any(
            math.isclose(face.Center().x, hole.x, rel_tol=1e-6, abs_tol=1e-4)
            and math.isclose(face.Center().y, hole.y, rel_tol=1e-6, abs_tol=1e-4)
            and math.isclose(face._geomAdaptor().Cylinder().Radius(), hole.diameter / 2, rel_tol=1e-6, abs_tol=1e-4)
            and math.isclose(face.Area(), expected_area, rel_tol=1e-6, abs_tol=1e-4)
            for face in faces
        ):
            raise CadGeometryError("CAD hole position or size differs from the parameters")
    if spec.upright:
        for wall_hole in wall_holes:
            expected_area = math.pi * wall_hole.diameter * spec.upright.thickness
            if not any(
                math.isclose(face.Center().x, wall_hole.x, rel_tol=1e-6, abs_tol=1e-4)
                and math.isclose(face.Center().z, wall_hole.z - spec.base.thickness / 2, rel_tol=1e-6, abs_tol=1e-4)
                and math.isclose(face._geomAdaptor().Cylinder().Radius(), wall_hole.diameter / 2, rel_tol=1e-6, abs_tol=1e-4)
                and math.isclose(face.Area(), expected_area, rel_tol=1e-6, abs_tol=1e-4)
                for face in faces
            ):
                raise CadGeometryError("CAD upright hole position or size differs from the parameters")


def _verify_chamfers(solid: Any, spec: CadPartSpec) -> None:
    chamfer = spec.cornerChamfer or 0
    if not chamfer:
        return
    expected_area = chamfer * math.sqrt(2) * spec.base.thickness
    faces = [
        face for face in solid.Faces()
        if face.geomType() == "PLANE"
        and math.isclose(face.Area(), expected_area, rel_tol=1e-6, abs_tol=1e-4)
        and math.isclose(abs(face.Center().x), spec.base.width / 2 - chamfer / 2, abs_tol=1e-4)
        and math.isclose(abs(face.Center().y), spec.base.depth / 2 - chamfer / 2, abs_tol=1e-4)
    ]
    if len(faces) != 4:
        raise CadGeometryError("CAD corner chamfers differ from the parameters")


def _verify_curved_profile(solid: Any, spec: CadPartSpec) -> None:
    if spec.base.kind == "extruded_disc":
        area = math.pi * spec.base.width * spec.base.thickness
        radius = spec.base.width / 2
        expected_faces = 1
    elif spec.cornerRadius:
        area = math.pi * spec.cornerRadius * spec.base.thickness / 2
        radius = spec.cornerRadius
        expected_faces = 4
    else:
        return
    faces = [face for face in solid.Faces() if face.geomType() == "CYLINDER" and
             math.isclose(face._geomAdaptor().Cylinder().Radius(), radius, rel_tol=1e-6, abs_tol=1e-4) and
             math.isclose(face.Area(), area, rel_tol=1e-6, abs_tol=1e-4) and
             (spec.base.kind == "extruded_disc" or (
                 abs(face.Center().x) > spec.base.width / 2 - (spec.cornerRadius or 0) and
                 abs(face.Center().y) > spec.base.depth / 2 - (spec.cornerRadius or 0)
             ))]
    if len(faces) != expected_faces:
        raise CadGeometryError("CAD curved outline differs from the parameters")


def _verify_bosses(solid: Any, spec: CadPartSpec) -> None:
    faces = [face for face in solid.Faces() if face.geomType() == "CYLINDER"]
    for boss in spec.bosses:
        expected_area = math.pi * boss.diameter * boss.height
        if not any(
            math.isclose(face._geomAdaptor().Cylinder().Radius(), boss.diameter / 2, rel_tol=1e-6, abs_tol=1e-4)
            and math.isclose(face.Center().x, boss.x, rel_tol=1e-6, abs_tol=1e-4)
            and math.isclose(face.Center().y, boss.y, rel_tol=1e-6, abs_tol=1e-4)
            and math.isclose(face.Area(), expected_area, rel_tol=1e-6, abs_tol=1e-4)
            for face in faces
        ):
            raise CadGeometryError("CAD cylindrical boss differs from the parameters")


def build_step(spec: CadPartSpec, max_bytes: int) -> CadArtifact:
    try:
        cq = import_module("cadquery")
        configure_cad_kernel()
    except ImportError as exc:
        raise CadEngineUnavailableError("CAD engine unavailable. Run uv sync in apps/api and restart the API.") from exc

    base = spec.base
    chamfer = spec.cornerChamfer or 0
    profile_area = (math.pi * (base.width / 2) ** 2 if base.kind == "extruded_disc"
                    else base.width * base.depth - 2 * chamfer**2 - (4 - math.pi) * (spec.cornerRadius or 0) ** 2)
    expected_volume = (
        profile_area
        - sum(math.pi * (hole.diameter / 2) ** 2 for hole in spec.features)
    ) * base.thickness
    for boss in spec.bosses:
        expected_volume += math.pi * (boss.diameter / 2) ** 2 * boss.height
        expected_volume -= sum(
            math.pi * (hole.diameter / 2) ** 2 * boss.height for hole in spec.features
            if math.hypot(hole.x - boss.x, hole.y - boss.y) + hole.diameter / 2 + 0.1 <= boss.diameter / 2
        )
    if spec.upright:
        wall = spec.upright
        expected_volume += base.width * wall.thickness * (wall.height - base.thickness)
        expected_volume -= sum(math.pi * (hole.diameter / 2) ** 2 * wall.thickness for hole in wall.holes)
    expected_bounds = (base.width, base.depth, spec.upright.height if spec.upright else
                       base.thickness + max((boss.height for boss in spec.bosses), default=0))

    try:
        part = (cq.Workplane("XY").circle(base.width / 2).extrude(base.thickness)
                .translate((0, 0, -base.thickness / 2)) if base.kind == "extruded_disc"
                else cq.Workplane("XY").box(base.width, base.depth, base.thickness))
        if chamfer:
            part = part.edges("|Z").chamfer(chamfer)
        if spec.cornerRadius:
            part = part.edges("|Z").fillet(spec.cornerRadius)
        for boss in spec.bosses:
            addition = (cq.Workplane("XY").center(boss.x, boss.y).circle(boss.diameter / 2)
                        .extrude(boss.height).translate((0, 0, base.thickness / 2)))
            part = part.union(addition)
        if spec.upright:
            wall = spec.upright
            upright = cq.Workplane("XY").box(base.width, wall.thickness, wall.height).translate((
                0, base.depth / 2 - wall.thickness / 2, (wall.height - base.thickness) / 2,
            ))
            part = part.union(upright)
        for hole in spec.features:
            cutter = (
                cq.Workplane("XY")
                .center(hole.x, hole.y)
                .circle(hole.diameter / 2)
                .extrude(base.thickness + max((boss.height for boss in spec.bosses), default=0) + 2)
                .translate((0, 0, -base.thickness / 2 - 1))
            )
            part = part.cut(cutter)
        if spec.upright:
            for wall_hole in spec.upright.holes:
                cutter = (
                    cq.Workplane("XZ")
                    .center(wall_hole.x, wall_hole.z - base.thickness / 2)
                    .circle(wall_hole.diameter / 2)
                    .extrude(spec.upright.thickness + 2)
                    .translate((0, base.depth / 2 + 1, 0))
                )
                part = part.cut(cutter)
        original = _validated_solid(part)
        with TemporaryDirectory(prefix="mcp-x3d-cad-") as directory:
            path = Path(directory) / "part.step"
            cq.exporters.export(part, str(path), exportType="STEP")
            if path.stat().st_size > max_bytes:
                raise CadArtifactTooLargeError("STEP artifact exceeds the configured size limit")
            step = path.read_bytes()
            imported = _validated_solid(cq.importers.importStep(str(path)))
    except CadGeometryError:
        raise
    except Exception as exc:
        raise CadGeometryError("CAD geometry or STEP conversion failed") from exc

    for solid in (original, imported):
        _verify_hole(solid, spec)
        _verify_chamfers(solid, spec)
        _verify_curved_profile(solid, spec)
        _verify_bosses(solid, spec)
        if not math.isclose(solid.Volume(), expected_volume, rel_tol=1e-6, abs_tol=1e-4):
            raise CadGeometryError("CAD volume differs from the parametric dimensions")
        if any(
            not math.isclose(actual, expected, rel_tol=1e-6, abs_tol=1e-4)
            for actual, expected in zip(_bounds(solid), expected_bounds, strict=True)
        ):
            raise CadGeometryError("CAD bounds differ from the parametric dimensions")
    return CadArtifact(step=step, volume_mm3=imported.Volume(), bounds_mm=_bounds(imported))
