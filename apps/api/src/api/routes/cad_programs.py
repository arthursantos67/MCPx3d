from __future__ import annotations

from typing import Annotated

from domain.cad_program import CadProgramSpec
from fastapi import APIRouter, Depends

from api.cad_process import run_cad_process
from api.cad_service import build_cad_artifact
from api.config import Settings, get_settings
from api.routes.cad import CadInspection

router = APIRouter(prefix="/api/cad/programs", tags=["cad"])


@router.post("/inspect", response_model=CadInspection, response_model_exclude_none=True)
def inspect_program(spec: CadProgramSpec, settings: Annotated[Settings, Depends(get_settings)]) -> CadInspection:
    artifact = build_cad_artifact(spec, settings)
    return CadInspection(partId=spec.partId, solidCount=1, volumeMm3=artifact.volume_mm3,
                         boundsMm=artifact.bounds_mm, stepBytes=len(artifact.step))


@router.post("/mesh")
def mesh_program(spec: CadProgramSpec) -> dict[str, object]:
    return run_cad_process("program_mesh", {"spec": spec.model_dump(mode="json", exclude_none=True)}).metadata
