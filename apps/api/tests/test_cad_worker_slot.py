import subprocess
import sys
from pathlib import Path
from threading import Event

import pytest
from fastapi import HTTPException

from api.cad_worker_slot import cad_worker_slot


def test_separate_process_cannot_enter_the_slot_until_owner_releases_it(tmp_path: Path):
    lock = tmp_path / "shared.lock"
    script = """import sys
from pathlib import Path
from fastapi import HTTPException
from api.cad_worker_slot import cad_worker_slot
try:
    with cad_worker_slot(Path(sys.argv[1]), .15, None):
        print('entered')
except HTTPException as exc:
    print(exc.detail['code'])
"""
    with cad_worker_slot(lock, 1, None):
        result = subprocess.run([sys.executable, "-c", script, str(lock)], capture_output=True, text=True, timeout=10, check=True)
        assert result.stdout.strip() == "CAD_ENGINE_BUSY"
    result = subprocess.run([sys.executable, "-c", script, str(lock)], capture_output=True, text=True, timeout=10, check=True)
    assert result.stdout.strip() == "entered"
    assert lock.exists()


def test_slot_releases_on_failure_and_cancelled_wait_never_enters(tmp_path: Path):
    lock = tmp_path / "shared.lock"
    with pytest.raises(ValueError), cad_worker_slot(lock, 1, None):
        raise ValueError("native failure")
    cancelled = Event()
    cancelled.set()
    with pytest.raises(HTTPException) as caught, cad_worker_slot(lock, 1, cancelled):
        pytest.fail("A cancelled request must not acquire the native slot")
    assert caught.value.detail["code"] == "CAD_ENGINE_CANCELLED"
    with cad_worker_slot(lock, 1, None):
        pass
