import os
import shutil
import subprocess
import sys
import time
from collections.abc import Iterator
from pathlib import Path

import httpx
import pytest

_VENDOR_DIR = Path(__file__).resolve().parents[3] / "services" / "x3d-mcp" / "vendor"


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


def _find_uv() -> str | None:
    found = shutil.which("uv")
    if found:
        return found
    fallback = Path.home() / "AppData" / "Roaming" / "Python" / "Python313" / "Scripts" / "uv.exe"
    return str(fallback) if fallback.exists() else None


def _wait_for_pulse(base_url: str, process: subprocess.Popen[bytes], timeout: float = 60.0) -> None:
    deadline = time.monotonic() + timeout
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"x3d_mcp server exited early with code {process.returncode}")
        try:
            response = httpx.get(f"{base_url}/pulse", timeout=2.0)
            if response.status_code == 200:
                return
        except httpx.HTTPError as exc:
            last_error = exc
        time.sleep(0.5)
    raise RuntimeError(f"x3d_mcp server did not become ready in time: {last_error}")


def _terminate_tree(process: subprocess.Popen[bytes]) -> None:
    """Stops the server subprocess, including children `terminate()` alone would miss.

    `uv run ...` execs the real interpreter as a *child* of the process this
    fixture's `Popen` tracks; on Windows, `Popen.terminate()` only signals that
    direct `uv` process, leaving the actual `src/server.py` interpreter
    orphaned and still bound to `port` for every test session afterwards.
    `taskkill /T` kills the whole tree instead.
    """
    if sys.platform == "win32":
        subprocess.run(
            ["taskkill", "/PID", str(process.pid), "/T", "/F"],
            capture_output=True,
            check=False,
        )
        process.wait(timeout=10)
        return
    process.terminate()
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=10)


@pytest.fixture(scope="session")
def x3d_mcp_server() -> Iterator[str]:
    """Runs the pinned x3d_mcp vendor server as a real subprocess for integration tests."""
    uv = _find_uv()
    if uv is None or not _VENDOR_DIR.exists():
        pytest.skip("uv or the x3d_mcp vendor submodule is not available")

    port = 8931
    base_url = f"http://127.0.0.1:{port}"
    env = {**os.environ, "MCP_TRANSPORT": "streamable-http", "HOST": "127.0.0.1", "PORT": str(port)}

    process = subprocess.Popen(
        [uv, "run", "--with", "mcp<2", "python", "src/server.py"],
        cwd=_VENDOR_DIR,
        env=env,
        # Nothing ever reads Popen.stdout/stderr here; PIPE-ing them without a
        # reader deadlocks the server once it fills the OS pipe buffer with
        # its own logging (reliably hit partway through this file's tests).
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        _wait_for_pulse(base_url, process)
        yield base_url
    finally:
        _terminate_tree(process)
