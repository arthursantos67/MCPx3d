from importlib import import_module
from typing import Annotated, Literal

import httpx
from anyio import to_thread
from fastapi import APIRouter, Depends
from pydantic import BaseModel

from api.config import Settings, get_settings
from api.x3d_backend import LocalX3DBackend

router = APIRouter(prefix="/api", tags=["health"])


class HealthStatus(BaseModel):
    status: Literal["ok"] = "ok"


class McpHealthStatus(BaseModel):
    reachable: bool
    detail: str | None = None


class EngineStatus(BaseModel):
    available: bool
    backend: str
    detail: str | None = None


class EnginesStatus(BaseModel):
    x3d: EngineStatus
    cad: EngineStatus


@router.get("/health/engines", response_model=EnginesStatus)
async def get_engines_health(settings: Annotated[Settings, Depends(get_settings)]) -> EnginesStatus:
    if settings.x3d_backend == "mcp":
        health = await get_mcp_health(settings)
        x3d = EngineStatus(available=health.reachable, backend="mcp", detail=health.detail)
    else:
        try:
            await LocalX3DBackend().validate_x3d('<X3D profile="Immersive" version="4.0"><Scene/></X3D>')
            x3d = EngineStatus(available=True, backend="local")
        except (ImportError, OSError) as exc:
            x3d = EngineStatus(available=False, backend="local", detail=str(exc))
    try:
        await to_thread.run_sync(import_module, "cadquery")
        cad = EngineStatus(available=True, backend="cadquery")
    except ImportError:
        cad = EngineStatus(available=False, backend="cadquery", detail="Run uv sync in apps/api")
    return EnginesStatus(x3d=x3d, cad=cad)


@router.get("/health", response_model=HealthStatus)
async def get_health() -> HealthStatus:
    return HealthStatus()


@router.get("/health/mcp", response_model=McpHealthStatus)
async def get_mcp_health(settings: Annotated[Settings, Depends(get_settings)]) -> McpHealthStatus:
    url = f"{str(settings.mcp_base_url).rstrip('/')}/pulse"

    try:
        async with httpx.AsyncClient(timeout=settings.mcp_request_timeout_seconds) as client:
            response = await client.get(url)
    except httpx.TimeoutException:
        return McpHealthStatus(reachable=False, detail="timeout")
    except httpx.RequestError:
        return McpHealthStatus(reachable=False, detail="connection_error")

    if response.status_code != 200:
        return McpHealthStatus(reachable=False, detail=f"unexpected_status_{response.status_code}")

    return McpHealthStatus(reachable=True)
