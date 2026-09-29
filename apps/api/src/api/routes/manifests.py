"""Restore a downloaded ModelSpec into an existing project session."""

from __future__ import annotations

import json
from time import perf_counter
from typing import Annotated
from uuid import uuid4

from domain.model_spec import ModelSpec
from fastapi import APIRouter, Depends, Query, Request, Response
from pydantic import ValidationError

from api.config import Settings, get_settings
from api.errors import api_error
from api.limits import ComplexityLimitError
from api.mcp_client import X3DMcpClient
from api.mutation import validate_spec_dimensions
from api.projects import (
    ProjectSessionService,
    RevisionConflictError,
    get_project_service,
)
from api.routes.plans import (
    ApplyPlanResponse,
    PreviewInfo,
    ValidationSummary,
    artifact_descriptors,
)
from api.timing import StageTimer
from api.x3d_validation import build_and_validate_candidate

router = APIRouter(prefix="/api/projects", tags=["projects"])


@router.post("/{project_id}/import", response_model=ApplyPlanResponse)
async def import_manifest(
    project_id: str,
    expected_revision: Annotated[int, Query(alias="expectedRevision", ge=0)],
    request: Request,
    response: Response,
    projects: Annotated[ProjectSessionService, Depends(get_project_service)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> ApplyPlanResponse:
    correlation_id = str(uuid4())
    request.state.correlation_id = correlation_id
    response.headers["X-Correlation-Id"] = correlation_id
    timer = StageTimer(clock=perf_counter)

    content = bytearray()
    async for chunk in request.stream():
        content.extend(chunk)
        if len(content) > settings.max_artifact_bytes:
            raise ComplexityLimitError("manifest bytes", limit=settings.max_artifact_bytes, actual=len(content))
    with timer.measure("manifest_validation"):
        try:
            manifest = ModelSpec.model_validate(json.loads(content.decode("utf-8")))
        except (UnicodeDecodeError, json.JSONDecodeError, ValidationError) as exc:
            raise api_error(400, "INVALID_MANIFEST", "The file is not a compatible ModelSpec v1 manifest") from exc
        validate_spec_dimensions(manifest)
        if len(manifest.objects) > settings.max_objects_per_project:
            raise ComplexityLimitError(
                "objects", limit=settings.max_objects_per_project, actual=len(manifest.objects)
            )

    session = projects.get_project(project_id)
    if session.revision != expected_revision:
        raise RevisionConflictError(project_id, expected_revision, session.revision)
    candidate = manifest.model_copy(update={"projectId": project_id, "revision": expected_revision})

    timer.start("mcp_connect")
    async with X3DMcpClient.connect(
        str(settings.mcp_base_url), settings.mcp_request_timeout_seconds
    ) as client:
        timer.finish("mcp_connect")
        stage_timings: dict[str, int] = {}
        _def_names, validation = await build_and_validate_candidate(client, candidate, stage_timings)
        timer.add(stage_timings)

    committed = projects.commit_revision(
        project_id, expected_revision, candidate, validation.content, validation.to_summary()
    )
    return ApplyPlanResponse(
        projectId=project_id,
        revision=committed.revision,
        modelSpec=committed.model_spec,
        validation=ValidationSummary.model_validate(validation.to_summary()),
        preview=PreviewInfo(url=f"/api/projects/{project_id}/artifacts/html?revision={committed.revision}"),
        artifacts=artifact_descriptors(),
        timings=timer.summary(),
    )
