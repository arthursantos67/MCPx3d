"""Project session REST endpoints (PRD §9.1, Issue #21): create, get, reset/delete.

Session/revision metadata is the `ModelSpec` itself -- it already carries
`projectId` and `revision` (§8.2) alongside the scene, so create/get return it
directly rather than a separate wrapper shape.
"""

from __future__ import annotations

from typing import Annotated

from domain.model_spec import ModelSpec
from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, ConfigDict, Field

from api.projects import ProjectSessionService, get_project_service

router = APIRouter(prefix="/api/projects", tags=["projects"])


class SceneTitleUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    expectedRevision: int = Field(ge=0)
    title: str = Field(min_length=1, max_length=80)


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
    # ProjectNotFoundError propagates to the PROJECT_NOT_FOUND handler
    # (api.error_handlers, Issue #23).
    session = project_service.get_project(project_id)
    return session.model_spec


@router.patch("/{project_id}/scene/title", response_model=ModelSpec)
async def update_scene_title(
    project_id: str,
    body: SceneTitleUpdate,
    project_service: Annotated[ProjectSessionService, Depends(get_project_service)],
) -> ModelSpec:
    return project_service.set_scene_title(project_id, body.expectedRevision, body.title).model_spec


@router.delete("/{project_id}", status_code=204, response_class=Response)
async def delete_project(
    project_id: str,
    project_service: Annotated[ProjectSessionService, Depends(get_project_service)],
) -> Response:
    project_service.delete_project(project_id)
    return Response(status_code=204)
