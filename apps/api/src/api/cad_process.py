from __future__ import annotations

import json
import os
import signal
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from tempfile import TemporaryDirectory
from time import monotonic
from typing import Any

from api.cad_cancellation import cad_cancellation
from api.cad_worker_slot import cad_worker_slot
from api.config import Settings, get_settings
from api.errors import api_error
from api.process_limits import close_memory_job, limit_process_memory


@dataclass(frozen=True)
class NativeOutput:
    metadata: dict[str, Any]
    data: bytes


def _stop(process: subprocess.Popen[bytes]) -> None:
    if process.poll() is not None:
        return
    if sys.platform == "win32":
        subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"], capture_output=True, check=False)
    else:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    process.wait(timeout=10)


def run_cad_process(operation: str, payload: dict[str, Any], settings: Settings | None = None, source_step: bytes | None = None) -> NativeOutput:
    settings = settings or get_settings()
    try:
        with cad_worker_slot(settings.cad_worker_lock_path, settings.cad_worker_queue_timeout_seconds, cad_cancellation.get()):
            return _run_cad_process(operation, payload, settings, source_step)
    except OSError as exc:
        raise api_error(503, "CAD_ENGINE_RESOURCE_LIMIT", "Não foi possível reservar os recursos do motor CAD. O rascunho foi conservado.") from exc


def _run_cad_process(operation: str, payload: dict[str, Any], settings: Settings, source_step: bytes | None) -> NativeOutput:
    cancelled = cad_cancellation.get()

    def check_cancelled() -> None:
        if cancelled is not None and cancelled.is_set():
            raise api_error(499, "CAD_ENGINE_CANCELLED", "O cálculo CAD foi cancelado e seu processo foi encerrado. O rascunho foi conservado.")

    check_cancelled()
    env = {**os.environ, "CAD_KERNEL_THREADS": str(settings.cad_kernel_threads),
           "OPENBLAS_NUM_THREADS": "1", "OMP_NUM_THREADS": "1"}
    with TemporaryDirectory(prefix="forma-cad-worker-") as temporary:
        directory = Path(temporary)
        request = {"operation": operation, "payload": payload, "memoryMb": settings.cad_worker_memory_mb}
        (directory / "input.json").write_text(json.dumps(request), encoding="utf-8")
        if source_step is not None:
            (directory / "source.step").write_bytes(source_step)
        process = subprocess.Popen([sys.executable, "-m", "api.cad_worker", str(directory)], env=env,
                                   stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                   start_new_session=sys.platform != "win32",
                                   creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0)
        memory_job = None
        try:
            memory_job = limit_process_memory(settings.cad_worker_memory_mb, process.pid)
            deadline = monotonic() + settings.cad_worker_timeout_seconds
            while True:
                check_cancelled()
                remaining = deadline - monotonic()
                if remaining <= 0:
                    raise subprocess.TimeoutExpired(process.args, settings.cad_worker_timeout_seconds)
                try:
                    process.wait(timeout=min(.1, remaining))
                    check_cancelled()
                    break
                except subprocess.TimeoutExpired:
                    if monotonic() >= deadline:
                        raise
        except subprocess.TimeoutExpired as exc:
            _stop(process)
            raise api_error(504, "CAD_ENGINE_TIMEOUT", "O cálculo CAD atingiu seu prazo e o processo foi encerrado. O rascunho foi conservado; reduza a complexidade ou revise os limites do motor.") from exc
        except OSError as exc:
            raise api_error(503, "CAD_ENGINE_RESOURCE_LIMIT", "Não foi possível proteger ou executar o processo CAD. O cálculo foi interrompido e o rascunho foi conservado.") from exc
        finally:
            _stop(process)
            close_memory_job(memory_job)
        metadata_path = directory / "result.json"
        if process.returncode != 0 or not metadata_path.exists():
            raise api_error(503, "CAD_ENGINE_RESOURCE_LIMIT", "O processo CAD foi encerrado por falha nativa ou limite de memória. A API continua disponível e o rascunho foi conservado.")
        if metadata_path.stat().st_size > settings.max_cad_draft_bundle_bytes:
            raise api_error(413, "COMPLEXITY_LIMIT", "CAD worker response exceeds the configured size limit")
        result = json.loads(metadata_path.read_text(encoding="utf-8"))
        if "error" in result:
            error = result["error"]
            raise api_error(error["status"], error["code"], error["message"], details=error.get("details", []))
        data_path = directory / "artifact.bin"
        if data_path.exists() and data_path.stat().st_size > settings.max_cad_draft_bundle_bytes:
            raise api_error(413, "COMPLEXITY_LIMIT", "CAD worker artifact exceeds the configured size limit")
        return NativeOutput(result, data_path.read_bytes() if data_path.exists() else b"")
