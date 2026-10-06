from functools import lru_cache

from domain.cad_assembly import CadAssemblySpec
from domain.cad_part import CadPartSpec
from domain.cad_program import CadProgramSpec
from pydantic import TypeAdapter

from api.cad_adapter import (
    CadArtifact,
    CadArtifactTooLargeError,
    CadEngineUnavailableError,
    CadGeometryError,
    build_step,
)
from api.cad_assembly_adapter import (
    CadAssemblyInterferenceError,
    CadAssemblyMechanicalError,
    build_assembly_step,
)
from api.cad_program_adapter import build_program_step
from api.config import Settings
from api.errors import api_error

CadSpec = CadPartSpec | CadProgramSpec | CadAssemblySpec
_spec_adapter: TypeAdapter[CadSpec] = TypeAdapter(CadSpec)


def build_cad_artifact(spec: CadSpec, settings: Settings) -> CadArtifact:
    return _build_cached(spec.model_dump_json(exclude_none=True), settings.max_artifact_bytes)


@lru_cache(maxsize=8)
def _build_cached(spec_json: str, max_bytes: int) -> CadArtifact:
    spec = _spec_adapter.validate_json(spec_json)
    try:
        if isinstance(spec, CadAssemblySpec):
            return build_assembly_step(spec, max_bytes)
        return build_program_step(spec, max_bytes) if isinstance(spec, CadProgramSpec) else build_step(spec, max_bytes)
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


