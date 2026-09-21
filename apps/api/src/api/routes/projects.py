"""Project session REST endpoints (PRD §9.1, Issue #21): create, get, reset/delete.

Session/revision metadata is the `ModelSpec` itself -- it already carries
`projectId` and `revision` (§8.2) alongside the scene, so create/get return it
directly rather than a separate wrapper shape.
"""

from __future__ import annotations

from typing import Annotated
from uuid import uuid4

from domain.model_spec import ModelSpec
from fastapi import APIRouter, Depends, Response

from api.errors import api_error
from api.projects import (
    ProjectNotFoundError,
    ProjectSessionService,
    get_project_service,
)

router = APIRouter(prefix="/api/projects", tags=["projects"])


@router.post("", response_model=ModelSpec, status_code=201)
async def create_project(
    project_service: Annotated[ProjectSessionService, Depends(get_project_service)],
) -> ModelSpec:
    session = project_service.create_project()
    return session.model_spec


@router.get("/{project_id}", response_model=ModelSpec)
async def get_project(
    project_id: str,
    project_service: Annotated[ProjectSessionService, Depends(get_project_service)],
) -> ModelSpec:
    try:
        session = project_service.get_project(project_id)
    except ProjectNotFoundError as exc:
        raise api_error(
            404,
            "PROJECT_NOT_FOUND",
            f"Project '{project_id}' was not found or has expired.",
            correlation_id=str(uuid4()),
        ) from exc
    return session.model_spec


@router.delete("/{project_id}", status_code=204, response_class=Response)
async def delete_project(
    project_id: str,
    project_service: Annotated[ProjectSessionService, Depends(get_project_service)],
) -> Response:
    project_service.delete_project(project_id)
    return Response(status_code=204)
