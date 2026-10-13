from functools import lru_cache

from domain.cad_assembly import CadAssemblySpec
from domain.cad_part import CadPartSpec
from domain.cad_program import CadProgramSpec
from pydantic import TypeAdapter

from api.cad_adapter import CadArtifact
from api.cad_process import run_cad_process
from api.config import Settings, get_settings

CadSpec = CadPartSpec | CadProgramSpec | CadAssemblySpec
_spec_adapter: TypeAdapter[CadSpec] = TypeAdapter(CadSpec)


def build_cad_artifact(spec: CadSpec, settings: Settings) -> CadArtifact:
    return _build_cached(spec.model_dump_json(exclude_none=True), settings.max_artifact_bytes,
                         settings.cad_worker_memory_mb, settings.cad_worker_timeout_seconds, settings.cad_kernel_threads)


@lru_cache(maxsize=8)
def _build_cached(spec_json: str, max_bytes: int, memory_mb: int, timeout: float, threads: int) -> CadArtifact:
    spec = _spec_adapter.validate_json(spec_json)
    settings = get_settings().model_copy(update={"cad_worker_memory_mb": memory_mb, "cad_worker_timeout_seconds": timeout, "cad_kernel_threads": threads})
    result = run_cad_process("artifact", {"spec": spec.model_dump(mode="json", exclude_none=True), "maxBytes": max_bytes}, settings)
    return CadArtifact(step=result.data, volume_mm3=result.metadata["volumeMm3"],
                       bounds_mm=tuple(result.metadata["boundsMm"]), solid_count=result.metadata["solidCount"])
