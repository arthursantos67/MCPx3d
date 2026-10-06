from __future__ import annotations

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


def stl_from_saved_step(step: bytes, max_bytes: int) -> bytes:
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
            return stl_from_shape(imported, max_bytes)
    except (CadArtifactTooLargeError, CadEngineUnavailableError, CadGeometryError):
        raise
    except Exception as exc:
        raise CadGeometryError("CAD STL conversion failed") from exc


def stl_from_shape(shape: object, max_bytes: int) -> bytes:
    try:
        with TemporaryDirectory(prefix="mcp-x3d-stl-shape-") as directory:
            target = Path(directory) / "part.stl"
            _engine().exporters.export(shape, str(target), exportType="STL", tolerance=0.1, angularTolerance=0.1)
            if target.stat().st_size > max_bytes:
                raise CadArtifactTooLargeError("STL artifact exceeds the configured size limit")
            data = target.read_bytes()
            if len(data) < 84 or (len(data) - 84) % 50 or int.from_bytes(data[80:84], "little") != (len(data) - 84) // 50 or len(data) == 84:
                raise CadGeometryError("CAD STL conversion produced an empty or invalid mesh")
            return data
    except (CadArtifactTooLargeError, CadEngineUnavailableError, CadGeometryError):
        raise
    except Exception as exc:
        raise CadGeometryError("CAD STL conversion failed") from exc
