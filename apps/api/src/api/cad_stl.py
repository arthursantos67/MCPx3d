from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any

from api.cad_adapter import (
    CadArtifactTooLargeError,
    CadEngineUnavailableError,
    CadGeometryError,
)
from api.cad_program_adapter import _engine


def component_from_saved_step(step: bytes, index: int) -> Any:
    try:
        with TemporaryDirectory(prefix="forma-component-") as directory:
            source = Path(directory) / "revision.step"
            source.write_bytes(step)
            solids = _engine().importers.importStep(str(source)).solids().vals()
        if index >= len(solids) or not solids[index].isValid() or solids[index].Volume() <= 0:
            raise CadGeometryError("Stored CAD component is missing or invalid")
        return solids[index]
    except (CadEngineUnavailableError, CadGeometryError):
        raise
    except Exception as exc:
        raise CadGeometryError("Stored CAD component could not be read") from exc


def step_from_shape(shape: object, max_bytes: int) -> bytes:
    try:
        with TemporaryDirectory(prefix="forma-component-step-") as directory:
            target = Path(directory) / "component.step"
            _engine().exporters.export(shape, str(target), exportType="STEP")
            if target.stat().st_size > max_bytes:
                raise CadArtifactTooLargeError("Component STEP exceeds the configured size limit")
            return target.read_bytes()
    except (CadArtifactTooLargeError, CadEngineUnavailableError, CadGeometryError):
        raise
    except Exception as exc:
        raise CadGeometryError("Component STEP conversion failed") from exc


@dataclass(frozen=True)
class CadStlArtifact:
    data: bytes
    triangles: int
    linear_deflection_mm: float
    angular_deflection_rad: float

    def report(self) -> dict[str, float | int | bool]:
        return {"bytes": len(self.data), "triangles": self.triangles,
                "linearDeflectionMm": self.linear_deflection_mm,
                "angularDeflectionRad": self.angular_deflection_rad,
                "adaptive": self.angular_deflection_rad > 0.1}

    def headers(self) -> dict[str, str]:
        return {"X-CAD-STL-Triangles": str(self.triangles),
                "X-CAD-STL-Linear-Deflection-Mm": str(self.linear_deflection_mm),
                "X-CAD-STL-Angular-Deflection-Rad": str(self.angular_deflection_rad)}


def stl_from_saved_step(step: bytes, max_bytes: int) -> bytes:
    return stl_artifact_from_saved_step(step, max_bytes).data


def stl_artifact_from_saved_step(step: bytes, max_bytes: int) -> CadStlArtifact:
    """Mesh the stored B-rep revision, so STL and STEP describe the same solid."""
    cq = _engine()
    try:
        with TemporaryDirectory(prefix="mcp-x3d-stl-") as directory:
            source = Path(directory) / "revision.step"
            source.write_bytes(step)
            imported = cq.importers.importStep(str(source))
            solids = imported.solids().vals()
            if not solids or any(not solid.isValid() or solid.Volume() <= 0 for solid in solids):
                raise CadGeometryError("Stored CAD STEP contains an invalid solid")
            return stl_artifact_from_shape(imported, max_bytes)
    except (CadArtifactTooLargeError, CadEngineUnavailableError, CadGeometryError):
        raise
    except Exception as exc:
        raise CadGeometryError("CAD STL conversion failed") from exc


def stl_from_shape(shape: object, max_bytes: int) -> bytes:
    return stl_artifact_from_shape(shape, max_bytes).data


def stl_artifact_from_shape(shape: Any, max_bytes: int) -> CadStlArtifact:
    try:
        cq = _engine()
        source = cq.Compound.makeCompound(shape.vals()) if isinstance(shape, cq.Workplane) else shape
        if max_bytes < 134:
            raise CadArtifactTooLargeError("STL limit is too small for even one binary triangle")
        with TemporaryDirectory(prefix="mcp-x3d-stl-shape-") as directory:
            target = Path(directory) / "part.stl"
            for angle in (0.1, 0.2, 0.35, 0.5):
                candidate = source.copy(mesh=False)
                if not candidate.exportStl(str(target), tolerance=0.1, angularTolerance=angle,
                                           ascii=False, relative=False, parallel=True):
                    raise CadGeometryError("CAD STL writer failed")
                size = target.stat().st_size
                if size > max_bytes:
                    continue
                data = target.read_bytes()
                triangles = int.from_bytes(data[80:84], "little")
                if len(data) < 134 or (len(data) - 84) % 50 or triangles != (len(data) - 84) // 50:
                    raise CadGeometryError("CAD STL conversion produced an empty or invalid mesh")
                return CadStlArtifact(data, triangles, 0.1, angle)
            raise CadArtifactTooLargeError(
                f"STL still exceeds {max_bytes} bytes after four bounded mesh attempts at 0.1 mm absolute deflection; "
                "download STEP or the individual components, or increase MAX_CAD_STL_BYTES")
    except (CadArtifactTooLargeError, CadEngineUnavailableError, CadGeometryError):
        raise
    except Exception as exc:
        raise CadGeometryError("CAD STL conversion failed") from exc
