import os
import shutil
import subprocess
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
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    try:
        _wait_for_pulse(base_url, process)
        yield base_url
    finally:
        process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=10)
