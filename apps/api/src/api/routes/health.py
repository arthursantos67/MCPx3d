from typing import Annotated, Literal

import httpx
from fastapi import APIRouter, Depends
from pydantic import BaseModel

from api.config import Settings, get_settings

router = APIRouter(prefix="/api", tags=["health"])


class HealthStatus(BaseModel):
    status: Literal["ok"] = "ok"


class McpHealthStatus(BaseModel):
    reachable: bool
    detail: str | None = None


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
