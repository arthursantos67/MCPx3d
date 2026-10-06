from __future__ import annotations

from typing import Annotated, Literal

from domain.cad_part import CadPartSpec
from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, ConfigDict

from api.cad_service import build_cad_artifact
from api.config import Settings, get_settings

router = APIRouter(prefix="/api/cad/parts", tags=["cad"])


class CadInspection(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    partId: str
    solidCount: int
    volumeMm3: float
    boundsMm: tuple[float, float, float]
    stepBytes: int
    mechanicalStatus: Literal["verified", "unverified"] | None = None


@router.post("/inspect", response_model=CadInspection, response_model_exclude_none=True)
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
