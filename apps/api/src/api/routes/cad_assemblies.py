from __future__ import annotations

from typing import Annotated

from domain.cad_assembly import CadAssemblySpec
from fastapi import APIRouter, Depends

from api.cad_adapter import (
    CadArtifactTooLargeError,
    CadEngineUnavailableError,
    CadGeometryError,
)
from api.cad_assembly_adapter import (
    CadAssemblyInterferenceError,
    CadAssemblyMechanicalError,
    build_assembly_mesh,
    build_assembly_solids,
)
from api.cad_mechanics import legacy_mechanics_report
from api.cad_service import build_cad_artifact
from api.config import Settings, get_settings
from api.errors import api_error
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
                        if joint.fastening == "bolted" else f"{joint.id}: união por adesivo nas superfícies de contato; adesivo e resistência não verificados."
                        for joint in spec.mechanics.connections if joint.fastening in ("bolted", "bonded")]
        return {"status": "verified", "connections": len(spec.mechanics.connections), "separatedFixedComponents": [], "requirements": requirements,
                "message": "Vínculos, apoios, alinhamento e transmissão verificados nas poses amostradas. Cargas, fabricação e sequência de montagem não avaliadas."}
    try:
        return legacy_mechanics_report(spec, build_assembly_solids(spec))
    except CadEngineUnavailableError as exc:
        raise api_error(503, "CAD_ENGINE_UNAVAILABLE", str(exc)) from exc
    except CadGeometryError as exc:
        raise api_error(422, "CAD_GEOMETRY_INVALID", str(exc)) from exc


@router.post("/mesh")
def mesh_assembly(spec: CadAssemblySpec) -> dict[str, object]:
    try:
        return build_assembly_mesh(spec)
    except CadEngineUnavailableError as exc:
        raise api_error(503, "CAD_ENGINE_UNAVAILABLE", str(exc)) from exc
    except CadArtifactTooLargeError as exc:
        raise api_error(413, "COMPLEXITY_LIMIT", str(exc)) from exc
    except CadAssemblyInterferenceError as exc:
        raise api_error(422, "CAD_GEOMETRY_INVALID", str(exc), details=[exc.diagnostics.model_dump(mode="json")]) from exc
    except CadAssemblyMechanicalError as exc:
        raise api_error(422, "CAD_MECHANICS_INVALID", str(exc), details=[exc.diagnostics]) from exc
    except CadGeometryError as exc:
        raise api_error(422, "CAD_GEOMETRY_INVALID", str(exc)) from exc
