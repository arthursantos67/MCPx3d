"""Applies ModelPlan requests through revision checks, mutation, X3D validation and atomic commit. Invalid candidates preserve the current revision."""

from __future__ import annotations

import logging
import re
from time import perf_counter
from typing import Annotated, Literal
from uuid import uuid4

from domain.model_plan import Clarify, ModelPlan, NoChange
from domain.model_spec import ModelSpec
from fastapi import APIRouter, Body, Depends, Request, Response
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from api.config import Settings, get_settings
from api.errors import api_error
from api.limits import ComplexityLimitError
from api.mutation import MutationError, apply_plan
from api.overlap import check_scene_layout
from api.projects import (
    ProjectSessionService,
    RevisionConflictError,
    get_project_service,
)
from api.timing import StageTimer
from api.x3d_backend import connect_x3d
from api.x3d_validation import build_and_validate_candidate

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/projects", tags=["plans"])

_REQUEST_ID_PATTERN = r"^[A-Za-z0-9._:-]{1,128}$"
_REQUEST_ID = re.compile(_REQUEST_ID_PATTERN)

ArtifactFormat = Literal["html", "x3d", "x3dj", "x3dv"]
_ARTIFACT_AVAILABILITY: tuple[tuple[ArtifactFormat, bool, str | None], ...] = (
    ("html", True, None),
    ("x3d", True, None),
    ("x3dj", False, "X3DJ conversion is unavailable for this X3D toolchain."),
    ("x3dv", True, None),
)


class ApplyPlanRequest(BaseModel):
    """Revision-checked plan request with explicit spatial policy."""

    model_config = ConfigDict(extra="forbid", strict=True)

    expectedRevision: int = Field(ge=0)
    requestId: str | None = Field(default=None, pattern=_REQUEST_ID_PATTERN)
    plan: ModelPlan
    overlapPolicy: Literal["visual", "strict"] = "visual"
    resolveOverlaps: bool = False
    """Separate penetrating parts deterministically instead of rejecting."""


class ValidationSummary(BaseModel):
    schemaValid: bool
    semanticValid: bool
    warnings: list[dict[str, str]]
    autofixes: list[dict[str, object]]


class ArtifactDescriptor(BaseModel):
    format: ArtifactFormat
    available: bool
    reason: str | None = None


class PreviewInfo(BaseModel):
    url: str


class ApplyPlanResponse(BaseModel):
    """Committed scene state, validation summary and available artifacts."""

    projectId: str
    revision: int
    modelSpec: ModelSpec
    validation: ValidationSummary
    preview: PreviewInfo | None
    artifacts: list[ArtifactDescriptor]
    timings: dict[str, int] = Field(default_factory=dict)


def artifact_descriptors() -> list[ArtifactDescriptor]:
    return [
        ArtifactDescriptor(format=fmt, available=available, reason=reason)
        for fmt, available, reason in _ARTIFACT_AVAILABILITY
    ]


def _request_id(body: dict[str, object]) -> str:
    raw = body.get("requestId")
    return raw if isinstance(raw, str) and _REQUEST_ID.fullmatch(raw) else str(uuid4())


@router.post("/{project_id}/plans", response_model=ApplyPlanResponse)
async def apply_plan_endpoint(
    project_id: str,
    body: Annotated[dict[str, object], Body(...)],
    http_request: Request,
    response: Response,
    project_service: Annotated[ProjectSessionService, Depends(get_project_service)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> ApplyPlanResponse:
    timer = StageTimer(clock=perf_counter)
    correlation_id = _request_id(body)
    response.headers["X-Correlation-Id"] = correlation_id
    # So api.error_handlers can echo the same correlation id on any error
    # raised below, including ones this endpoint never explicitly catches.
    http_request.state.correlation_id = correlation_id

    with timer.measure("plan_validation"):
        try:
            plan_request = ApplyPlanRequest.model_validate(body)
        except ValidationError as exc:
            raise api_error(
                400,
                "INVALID_PLAN",
                "The request body is not a valid apply-plan request.",
                details=[{"loc": list(error["loc"]), "message": error["msg"]} for error in exc.errors()],
                correlation_id=correlation_id,
            ) from exc

    logger.info(
        "apply_plan.start correlation_id=%s project_id=%s expected_revision=%s",
        correlation_id,
        project_id,
        plan_request.expectedRevision,
    )

    if len(plan_request.plan.intent) > settings.max_prompt_characters:
        raise ComplexityLimitError(
            "prompt", limit=settings.max_prompt_characters, actual=len(plan_request.plan.intent)
        )
    if len(plan_request.plan.operations) > settings.max_operations_per_plan:
        raise ComplexityLimitError(
            "operations",
            limit=settings.max_operations_per_plan,
            actual=len(plan_request.plan.operations),
        )

    clarify_questions = [op.question for op in plan_request.plan.operations if isinstance(op, Clarify)]
    if clarify_questions:
        raise api_error(
            422,
            "AMBIGUOUS_TARGET",
            clarify_questions[0],
            details=list(clarify_questions),
            correlation_id=correlation_id,
        )

    # ProjectNotFoundError propagates to the PROJECT_NOT_FOUND handler.
    session = project_service.get_project(project_id)

    if plan_request.expectedRevision != session.revision:
        raise RevisionConflictError(project_id, plan_request.expectedRevision, session.revision)

    # UnknownTargetError/MutationError/ComplexityLimitError propagate to their handlers.
    with timer.measure("candidate_mutation"):
        try:
            candidate = apply_plan(
                session.model_spec, plan_request.plan, max_objects=settings.max_objects_per_project
            )
        except ValidationError as exc:
            raise MutationError(f"The plan produces an invalid model: {exc.errors()[0]['msg']}") from exc

    candidate, layout_warnings, overlap_fixes = check_scene_layout(
        session.model_spec, candidate, plan_request.plan,
        policy=plan_request.overlapPolicy, resolve=plan_request.resolveOverlaps,
    )

    if all(isinstance(operation, NoChange) for operation in plan_request.plan.operations):
        return ApplyPlanResponse(
            projectId=project_id,
            revision=session.revision,
            modelSpec=session.model_spec,
            validation=ValidationSummary(
                schemaValid=True, semanticValid=True, warnings=layout_warnings, autofixes=[]
            ),
            preview=(
                PreviewInfo(url=f"/api/projects/{project_id}/artifacts/html?revision={session.revision}")
                if session.revision in session.validated_x3d
                else None
            ),
            artifacts=artifact_descriptors() if session.revision in session.validated_x3d else [],
            timings=timer.summary(),
        )

    # McpUnavailableError/McpToolError/X3DValidationError propagate to their handlers.
    connection_stage = "mcp_connect" if settings.x3d_backend == "mcp" else "x3d_backend"
    timer.start(connection_stage)
    async with connect_x3d(settings) as client:
        timer.finish(connection_stage)
        stage_timings: dict[str, int] = {}
        _def_names, validation = await build_and_validate_candidate(client, candidate, stage_timings)
        timer.add(stage_timings)

    # RevisionConflictError/ProjectNotFoundError propagate to their handlers (a race
    # with another request between the pre-check above and this commit).
    semantic_warnings = [{"check": warning.check, "message": warning.message} for warning in validation.warnings]
    summary = {**validation.to_summary(), "warnings": [*layout_warnings, *semantic_warnings],
               "autofixes": [*overlap_fixes, *validation.autofixes]}
    updated_session = project_service.commit_revision(
        project_id,
        plan_request.expectedRevision,
        candidate,
        validation.content,
        summary,
    )

    logger.info(
        "apply_plan.committed correlation_id=%s project_id=%s revision=%s",
        correlation_id,
        project_id,
        updated_session.revision,
    )

    return ApplyPlanResponse(
        projectId=project_id,
        revision=updated_session.revision,
        modelSpec=updated_session.model_spec,
        validation=ValidationSummary.model_validate(summary),
        preview=PreviewInfo(
            url=f"/api/projects/{project_id}/artifacts/html?revision={updated_session.revision}"
        ),
        artifacts=artifact_descriptors(),
        timings=timer.summary(),
    )
