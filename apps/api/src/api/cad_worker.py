from __future__ import annotations

import json
import sys
import traceback
from pathlib import Path
from typing import Any

from api.process_limits import limit_process_memory


def execute(operation: str, payload: dict[str, Any], directory: Path) -> dict[str, Any]:
    from domain.cad_assembly import CadAssemblySpec
    from domain.cad_part import CadPartSpec
    from domain.cad_program import CadProgramSpec
    from pydantic import TypeAdapter

    from api.cad_adapter import build_step
    from api.cad_assembly_adapter import (
        build_assembly_mesh,
        build_assembly_solids,
        build_assembly_step,
    )
    from api.cad_drafts import (
        CadDraftRequest,
        draft_bundle,
        draft_geometry,
        draft_mesh,
        draft_report,
    )
    from api.cad_mechanics import legacy_mechanics_report
    from api.cad_program_adapter import build_program_mesh, build_program_step
    from api.cad_stl import (
        component_from_saved_step,
        step_from_shape,
        stl_artifact_from_saved_step,
        stl_artifact_from_shape,
    )
    from api.errors import api_error

    if operation == "artifact":
        spec: CadPartSpec | CadProgramSpec | CadAssemblySpec = TypeAdapter(CadPartSpec | CadProgramSpec | CadAssemblySpec).validate_python(payload["spec"])
        limit = payload["maxBytes"]
        artifact = (build_assembly_step(spec, limit) if isinstance(spec, CadAssemblySpec) else
                    build_program_step(spec, limit) if isinstance(spec, CadProgramSpec) else build_step(spec, limit))
        (directory / "artifact.bin").write_bytes(artifact.step)
        return {"volumeMm3": artifact.volume_mm3, "boundsMm": artifact.bounds_mm, "solidCount": artifact.solid_count}
    if operation == "program_mesh":
        return build_program_mesh(CadProgramSpec.model_validate(payload["spec"]))
    if operation == "assembly_mesh":
        return build_assembly_mesh(CadAssemblySpec.model_validate(payload["spec"]))
    if operation == "legacy_mechanics":
        assembly = CadAssemblySpec.model_validate(payload["spec"])
        return legacy_mechanics_report(assembly, build_assembly_solids(assembly))
    if operation in ("saved_stl", "component_export"):
        source_step = (directory / "source.step").read_bytes()
        if operation == "saved_stl":
            mesh = stl_artifact_from_saved_step(source_step, payload["maxStlBytes"])
        else:
            solid = component_from_saved_step(source_step, payload["index"])
            if payload["format"] == "step":
                (directory / "artifact.bin").write_bytes(step_from_shape(solid, payload["maxBytes"]))
                return {}
            mesh = stl_artifact_from_shape(solid, payload["maxStlBytes"])
        (directory / "artifact.bin").write_bytes(mesh.data)
        return {"headers": mesh.headers()}
    if operation in ("draft_mesh", "draft_bundle"):
        request = CadDraftRequest.model_validate(payload["request"])
        bodies = draft_geometry(request)
        if not any(body.solid is not None for body in bodies):
            raise api_error(422, "CAD_DRAFT_EMPTY", "Não há sólido válido para exportar. O JSON original continua disponível.", details=[draft_report(request, bodies)])
        if operation == "draft_mesh":
            return draft_mesh(request, bodies)
        data = draft_bundle(request, bodies, payload["maxBytes"], payload["maxStlBytes"], payload["maxBundleBytes"])
        (directory / "artifact.bin").write_bytes(data)
        return {}
    raise ValueError("Unknown internal CAD worker operation")


def main() -> int:
    directory = Path(sys.argv[1])
    request = json.loads((directory / "input.json").read_text(encoding="utf-8"))
    limit_process_memory(request["memoryMb"])
    from fastapi import HTTPException

    from api.cad_adapter import (
        CadArtifactTooLargeError,
        CadEngineUnavailableError,
        CadGeometryError,
    )
    from api.cad_assembly_adapter import (
        CadAssemblyInterferenceError,
        CadAssemblyMechanicalError,
    )

    try:
        result = execute(request["operation"], request["payload"], directory)
    except HTTPException as exc:
        detail = exc.detail if isinstance(exc.detail, dict) else {"code": "CAD_ENGINE_FAILURE", "message": exc.detail}
        result = {"error": {"status": exc.status_code, **detail}}
    except CadEngineUnavailableError as exc:
        result = {"error": {"status": 503, "code": "CAD_ENGINE_UNAVAILABLE", "message": str(exc)}}
    except CadArtifactTooLargeError as exc:
        result = {"error": {"status": 413, "code": "COMPLEXITY_LIMIT", "message": str(exc)}}
    except CadAssemblyInterferenceError as exc:
        result = {"error": {"status": 422, "code": "CAD_GEOMETRY_INVALID", "message": str(exc), "details": [exc.diagnostics.model_dump(mode="json")]}}
    except CadAssemblyMechanicalError as exc:
        result = {"error": {"status": 422, "code": "CAD_MECHANICS_INVALID", "message": str(exc), "details": [exc.diagnostics]}}
    except CadGeometryError as exc:
        if any(token in str(exc).lower() for token in ("outofmemory", "bad_alloc", "memory allocation", "not enough memory")):
            result = {"error": {"status": 503, "code": "CAD_ENGINE_RESOURCE_LIMIT", "message": "O cálculo CAD excedeu a memória disponível no processo protegido."}}
        else:
            result = {"error": {"status": 422, "code": "CAD_GEOMETRY_INVALID", "message": str(exc)}}
    except MemoryError:
        result = {"error": {"status": 503, "code": "CAD_ENGINE_RESOURCE_LIMIT", "message": "O cálculo CAD excedeu o limite de memória do processo."}}
    except Exception as exc:  # noqa: BLE001 -- the worker must always report a structured result
        traceback.print_exc(file=sys.stderr)
        result = {"error": {"status": 500, "code": "CAD_ENGINE_FAILURE", "message": f"O motor CAD falhou de forma inesperada ({type(exc).__name__}). O rascunho foi conservado."}}
    (directory / "result.json").write_text(json.dumps(result), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
