from __future__ import annotations

from typing import Annotated

from domain.cad_program import CadProgramSpec
from fastapi import APIRouter, Depends

from api.cad_adapter import (
    CadArtifactTooLargeError,
    CadEngineUnavailableError,
    CadGeometryError,
)
from api.cad_program_adapter import build_program_mesh
from api.cad_service import build_cad_artifact
from api.config import Settings, get_settings
from api.errors import api_error
from api.routes.cad import CadInspection

router = APIRouter(prefix="/api/cad/programs", tags=["cad"])


@router.post("/inspect", response_model=CadInspection, response_model_exclude_none=True)
def inspect_program(spec: CadProgramSpec, settings: Annotated[Settings, Depends(get_settings)]) -> CadInspection:
    artifact = build_cad_artifact(spec, settings)
    return CadInspection(partId=spec.partId, solidCount=1, volumeMm3=artifact.volume_mm3,
                         boundsMm=artifact.bounds_mm, stepBytes=len(artifact.step))


@router.post("/mesh")
def mesh_program(spec: CadProgramSpec) -> dict[str, object]:
    try:
        return build_program_mesh(spec)
    except CadEngineUnavailableError as exc:
        raise api_error(503, "CAD_ENGINE_UNAVAILABLE", str(exc)) from exc
    except CadArtifactTooLargeError as exc:
        raise api_error(413, "COMPLEXITY_LIMIT", str(exc)) from exc
    except CadGeometryError as exc:
        raise api_error(422, "CAD_GEOMETRY_INVALID", str(exc)) from exc
