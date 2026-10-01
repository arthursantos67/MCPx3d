from __future__ import annotations

from typing import Annotated

from domain.cad_part import CadPartSpec
from domain.cad_program import CadProgramSpec
from domain.cad_assembly import CadAssemblySpec
from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, ConfigDict

from api.cad_adapter import (
    CadArtifact,
    CadArtifactTooLargeError,
    CadEngineUnavailableError,
    CadGeometryError,
    build_step,
)
from api.cad_program_adapter import build_program_step
from api.cad_assembly_adapter import build_assembly_step
from api.config import Settings, get_settings
from api.errors import api_error

router = APIRouter(prefix="/api/cad/parts", tags=["cad"])


class CadInspection(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    partId: str
    solidCount: int
    volumeMm3: float
    boundsMm: tuple[float, float, float]
    stepBytes: int


def build_cad_artifact(spec: CadPartSpec | CadProgramSpec | CadAssemblySpec, settings: Settings) -> CadArtifact:
    try:
        if isinstance(spec, CadAssemblySpec):
            return build_assembly_step(spec, settings.max_artifact_bytes)
        return build_program_step(spec, settings.max_artifact_bytes) if isinstance(spec, CadProgramSpec) else build_step(spec, settings.max_artifact_bytes)
    except CadEngineUnavailableError as exc:
        raise api_error(503, "CAD_ENGINE_UNAVAILABLE", str(exc)) from exc
    except CadArtifactTooLargeError as exc:
        raise api_error(413, "COMPLEXITY_LIMIT", str(exc)) from exc
    except CadGeometryError as exc:
        raise api_error(422, "CAD_GEOMETRY_INVALID", str(exc)) from exc


@router.post("/inspect", response_model=CadInspection)
def inspect_part(
    spec: CadPartSpec,
    settings: Annotated[Settings, Depends(get_settings)],
) -> CadInspection:
    artifact = build_cad_artifact(spec, settings)
    return CadInspection(
        partId=spec.partId,
        solidCount=1,
        volumeMm3=artifact.volume_mm3,
        boundsMm=artifact.bounds_mm,
        stepBytes=len(artifact.step),
    )


@router.post("/step")
def export_step(
    spec: CadPartSpec,
    settings: Annotated[Settings, Depends(get_settings)],
) -> Response:
    artifact = build_cad_artifact(spec, settings)
    return Response(
        content=artifact.step,
        media_type="application/step",
        headers={"Content-Disposition": f'attachment; filename="{spec.partId}.step"'},
    )
