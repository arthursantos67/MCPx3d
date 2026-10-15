import subprocess
import sys
from threading import Event, Timer
from time import monotonic

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from api import cad_process
from api.cad_cancellation import cad_cancellation
from api.config import Settings
from api.main import app

ZERO = {"x": 0, "y": 0, "z": 0}
PLATE = {"schemaVersion": "3.0", "units": "mm", "partId": "isolated_plate", "steps": [
    {"id": "stock", "op": "base", "shape": "box", "width": 30, "depth": 30, "height": 10, "position": ZERO, "rotation": ZERO},
    {"id": "blind_bore", "op": "cut", "shape": "hole", "diameter": 5, "height": 6, "holeType": "plain", "headDiameter": 0, "headDepth": 0,
     "position": {**ZERO, "z": 5}, "rotation": ZERO, "termination": "blind", "minBottomThickness": 2}]}


def test_native_worker_returns_a_real_step_and_preserves_geometry_diagnostics():
    result = cad_process.run_cad_process("artifact", {"spec": PLATE, "maxBytes": 1_000_000})
    assert b"ISO-10303-21" in result.data
    assert result.metadata["solidCount"] == 1
    invalid = {**PLATE, "steps": [PLATE["steps"][0], {**PLATE["steps"][1], "height": 10.5}]}
    with pytest.raises(HTTPException) as caught:
        cad_process.run_cad_process("artifact", {"spec": invalid, "maxBytes": 1_000_000})
    assert caught.value.status_code == 422
    assert caught.value.detail["code"] == "CAD_GEOMETRY_INVALID"
    assert "floor" in caught.value.detail["message"]


def test_real_timeout_terminates_child_and_keeps_api_responsive(monkeypatch):
    original = subprocess.Popen
    launched = []

    def launch(_command, **kwargs):
        if "api.cad_worker" not in _command:
            return original(_command, **kwargs)
        child = original([sys.executable, "-c", "import time; time.sleep(20)"], **kwargs)
        launched.append(child)
        return child

    monkeypatch.setattr(cad_process.subprocess, "Popen", launch)
    started = monotonic()
    with pytest.raises(HTTPException) as caught:
        cad_process.run_cad_process("artifact", {}, Settings(cad_worker_timeout_seconds=1))
    assert caught.value.detail["code"] == "CAD_ENGINE_TIMEOUT"
    assert launched[0].poll() is not None
    assert monotonic() - started < 5
    assert TestClient(app).get("/api/health").status_code == 200


def test_crashed_worker_does_not_turn_into_geometry_repair_or_kill_api(monkeypatch):
    original = subprocess.Popen

    def launch(_command, **kwargs):
        if "api.cad_worker" not in _command:
            return original(_command, **kwargs)
        return original([sys.executable, "-c", "raise SystemExit(17)"], **kwargs)

    monkeypatch.setattr(cad_process.subprocess, "Popen", launch)
    with pytest.raises(HTTPException) as caught:
        cad_process.run_cad_process("artifact", {})
    assert caught.value.status_code == 503
    assert caught.value.detail["code"] == "CAD_ENGINE_RESOURCE_LIMIT"
    assert TestClient(app).get("/api/health").status_code == 200


def test_hard_memory_limit_refuses_an_allocation_larger_than_its_ceiling():
    script = """from api.process_limits import limit_process_memory
limit_process_memory(512)
try:
    bytearray(600 * 1024 * 1024)
except MemoryError:
    print('allocation refused')
else:
    raise SystemExit(9)
"""
    result = subprocess.run([sys.executable, "-c", script], capture_output=True, text=True, timeout=15, check=False)
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "allocation refused"


def test_worker_is_stopped_if_its_resource_guard_cannot_be_installed(monkeypatch):
    original = subprocess.Popen
    launched = []

    def launch(command, **kwargs):
        if "api.cad_worker" not in command:
            return original(command, **kwargs)
        child = original([sys.executable, "-c", "import time; time.sleep(20)"], **kwargs)
        launched.append(child)
        return child

    def unavailable_guard(*_args):
        raise PermissionError("Cannot install process guard")

    monkeypatch.setattr(cad_process.subprocess, "Popen", launch)
    monkeypatch.setattr(cad_process, "limit_process_memory", unavailable_guard)
    with pytest.raises(HTTPException) as caught:
        cad_process.run_cad_process("artifact", {})
    assert caught.value.detail["code"] == "CAD_ENGINE_RESOURCE_LIMIT"
    assert launched[0].poll() is not None


def test_cancellation_stops_a_running_native_process_without_waiting_for_timeout(monkeypatch):
    original = subprocess.Popen
    launched = []
    cancelled = Event()

    def launch(command, **kwargs):
        if "api.cad_worker" not in command:
            return original(command, **kwargs)
        child = original([sys.executable, "-c", "import time; time.sleep(20)"], **kwargs)
        launched.append(child)
        return child

    monkeypatch.setattr(cad_process.subprocess, "Popen", launch)
    token = cad_cancellation.set(cancelled)
    timer = Timer(.25, cancelled.set)
    started = monotonic()
    timer.start()
    try:
        with pytest.raises(HTTPException) as caught:
            cad_process.run_cad_process("artifact", {}, Settings(cad_worker_timeout_seconds=20))
        assert caught.value.detail["code"] == "CAD_ENGINE_CANCELLED"
        assert launched[0].poll() is not None
        assert monotonic() - started < 5
    finally:
        timer.cancel()
        cad_cancellation.reset(token)


def test_cancelled_request_never_launches_a_worker(monkeypatch):
    cancelled = Event()
    cancelled.set()
    token = cad_cancellation.set(cancelled)

    def unexpected_launch(*args, **kwargs):
        pytest.fail("A cancelled request must not launch a native process")

    monkeypatch.setattr(cad_process.subprocess, "Popen", unexpected_launch)
    try:
        with pytest.raises(HTTPException) as caught:
            cad_process.run_cad_process("artifact", {})
        assert caught.value.status_code == 499
    finally:
        cad_cancellation.reset(token)


def test_unexpected_worker_exception_becomes_a_structured_engine_failure(tmp_path, monkeypatch):
    import json

    from api import cad_worker

    (tmp_path / "input.json").write_text(json.dumps({"operation": "unknown", "payload": {}, "memoryMb": 2048}), encoding="utf-8")
    monkeypatch.setattr(cad_worker, "limit_process_memory", lambda _limit: None)
    monkeypatch.setattr(sys, "argv", ["cad_worker", str(tmp_path)])
    assert cad_worker.main() == 0
    error = json.loads((tmp_path / "result.json").read_text(encoding="utf-8"))["error"]
    assert error["status"] == 500
    assert error["code"] == "CAD_ENGINE_FAILURE"
