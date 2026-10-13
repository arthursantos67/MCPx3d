from __future__ import annotations

from typing import Annotated

from domain.cad_assembly import CadAssemblySpec
from fastapi import APIRouter, Depends

from api.cad_process import run_cad_process
from api.cad_service import build_cad_artifact
from api.config import Settings, get_settings
from api.routes.cad import CadInspection

router = APIRouter(prefix="/api/cad/assemblies", tags=["cad"])


@router.post("/inspect", response_model=CadInspection)
def inspect_assembly(spec: CadAssemblySpec, settings: Annotated[Settings, Depends(get_settings)]) -> CadInspection:
    artifact = build_cad_artifact(spec, settings)
    return CadInspection(partId=spec.partId, solidCount=artifact.solid_count,
                         volumeMm3=artifact.volume_mm3, boundsMm=artifact.bounds_mm,
                         stepBytes=len(artifact.step), mechanicalStatus="verified" if spec.mechanics else "unverified")


@router.post("/mechanics")
def inspect_mechanics(spec: CadAssemblySpec, settings: Annotated[Settings, Depends(get_settings)]) -> dict[str, object]:
    if spec.mechanics is not None:
        build_cad_artifact(spec, settings)
        requirements = [f"{joint.id}: instalar fixadores Ø{joint.fastenerDiameter:g} mm nos furos declarados; comprimento, pré-carga e resistência não verificados."
                        if joint.fastening == "bolted" else f"{joint.id}: instalar parafusos métricos Ø{joint.fastenerDiameter:g} mm na rosca receptora; conservar engate e folga ao fundo, dimensionar comprimento. Pré-carga e resistência não verificadas."
                        if joint.fastening == "threaded" else f"{joint.id}: união por adesivo nas superfícies de contato; adesivo e resistência não verificados."
                        for joint in spec.mechanics.connections if joint.fastening in ("bolted", "threaded", "bonded")]
        return {"status": "verified", "connections": len(spec.mechanics.connections), "separatedFixedComponents": [], "requirements": requirements,
                "message": "Vínculos, apoios, alinhamento e transmissão verificados nas poses amostradas. Cargas, fabricação e sequência de montagem não avaliadas."}
    return run_cad_process("legacy_mechanics", {"spec": spec.model_dump(mode="json", exclude_none=True)}, settings).metadata


@router.post("/mesh")
def mesh_assembly(spec: CadAssemblySpec) -> dict[str, object]:
    return run_cad_process("assembly_mesh", {"spec": spec.model_dump(mode="json", exclude_none=True)}).metadata
