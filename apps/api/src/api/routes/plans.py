"""Apply-ModelPlan orchestration endpoint (PRD §9.1/§9.2/§9.3, Issue #22).

The central mutation transaction: validate the incoming request -> check the
expected revision -> build a candidate `ModelSpec` (Issue #7) -> render and
validate it as X3D through `x3d_mcp` (Issue #10) -> commit (Issue #8) ->
describe available artifacts. Every step before `commit_revision` only ever
reads project state and returns/raises, matching `apply_plan`'s and
`build_and_validate_candidate`'s own never-mutate-until-success contracts
(FE-08's "last-valid-scene rule") -- so any failure in this endpoint leaves
the project's stored revision exactly as it was.

A `ModelPlan` containing a `clarify` operation is rejected with
`422 AMBIGUOUS_TARGET` before anything else happens (no MCP call, no
candidate is built, nothing commits) -- `packages/agent`'s Issue #20 already
keeps the agent from mixing a `clarify` with a mutation, but this endpoint
does not trust that guarantee from an untrusted caller; it enforces it again
here as the authoritative boundary, consistent with `apply_plan`'s own
"clarify/no_change are no-ops, keeping the two apart is agent-layer policy"
note explicitly leaving this case to a higher layer (§8.4, Issue #7). The
clarify question(s) are surfaced in the error body's `details` so a caller
that always POSTs whatever plan the agent produced still gets an actionable
message to show the user. This is the one error case still raised directly
as an `HTTPException` (via `api.errors.api_error`) rather than left to
`api.error_handlers` (Issue #23): it is route-specific business logic with
no domain exception type of its own, and FastAPI's built-in `HTTPException`
handling already renders `api_error`'s body exactly as PRD §9.4 requires.

Complexity limits (PRD FR-32, NFR-12, Issue #24) are checked as early as
possible, before the revision/MCP round trip: `request.plan.intent` length
is the only free-text field this request shape carries that stands in for
NFR-12's "prompt text" limit (the raw user prompt itself is never sent to
this backend -- WebLLM inference is client-side, per PRD §3.6 -- so
`intent`, the agent's own short summary of what the user asked for, is the
closest thing to it that reaches this endpoint), and the operation count is
checked directly against the parsed plan. The object-count limit is
enforced inside `apply_plan` itself (Issue #7/#24), since only it knows the
plan's net effect on the object count.
"""

from __future__ import annotations

import logging
from typing import Annotated, Literal
from uuid import uuid4

from domain.model_plan import Clarify, ModelPlan, NoChange
from domain.model_spec import ModelSpec
from fastapi import APIRouter, Body, Depends, Request, Response
from pydantic import BaseModel, ConfigDict, Field

from api.config import Settings, get_settings
from api.errors import api_error
from api.limits import ComplexityLimitError
from api.mcp_client import X3DMcpClient
from api.mutation import apply_plan
from api.projects import (
    ProjectSessionService,
    RevisionConflictError,
    get_project_service,
)
from api.x3d_validation import build_and_validate_candidate

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/projects", tags=["plans"])

ArtifactFormat = Literal["html", "x3d", "x3dj", "x3dv"]
_ARTIFACT_AVAILABILITY: tuple[tuple[ArtifactFormat, bool, str | None], ...] = (
    ("html", True, None),
    ("x3d", True, None),
    ("x3dj", False, "X3DJ conversion is unavailable for this X3D toolchain."),
    ("x3dv", True, None),
)


class ApplyPlanRequest(BaseModel):
    """PRD §9.2."""

    model_config = ConfigDict(extra="forbid", strict=True)

    expectedRevision: int = Field(ge=0)
    requestId: str | None = None
    plan: ModelPlan


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
    """PRD §9.3."""

    projectId: str
    revision: int
    modelSpec: ModelSpec
    validation: ValidationSummary
    preview: PreviewInfo | None
    artifacts: list[ArtifactDescriptor]


def _request_id(body: dict[str, object]) -> str:
    raw = body.get("requestId")
    return raw if isinstance(raw, str) and raw else str(uuid4())


@router.post("/{project_id}/plans", response_model=ApplyPlanResponse)
async def apply_plan_endpoint(
    project_id: str,
    body: Annotated[dict[str, object], Body(...)],
    http_request: Request,
    response: Response,
    project_service: Annotated[ProjectSessionService, Depends(get_project_service)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> ApplyPlanResponse:
    correlation_id = _request_id(body)
    response.headers["X-Correlation-Id"] = correlation_id
    # So api.error_handlers can echo the same correlation id on any error
    # raised below, including ones this endpoint never explicitly catches.
    http_request.state.correlation_id = correlation_id

    # ValidationError propagates to the INVALID_PLAN handler (api.error_handlers, Issue #23).
    plan_request = ApplyPlanRequest.model_validate(body)

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
    candidate = apply_plan(
        session.model_spec, plan_request.plan, max_objects=settings.max_objects_per_project
    )

    if all(isinstance(operation, NoChange) for operation in plan_request.plan.operations):
        return ApplyPlanResponse(
            projectId=project_id,
            revision=session.revision,
            modelSpec=session.model_spec,
            validation=ValidationSummary(
                schemaValid=True, semanticValid=True, warnings=[], autofixes=[]
            ),
            preview=(
                PreviewInfo(url=f"/api/projects/{project_id}/artifacts/html?revision={session.revision}")
                if session.revision in session.validated_x3d
                else None
            ),
            artifacts=[
                ArtifactDescriptor(format=fmt, available=available, reason=reason)
                for fmt, available, reason in _ARTIFACT_AVAILABILITY
            ],
        )

    # McpUnavailableError/McpToolError/X3DValidationError propagate to their handlers.
    async with X3DMcpClient.connect(
        str(settings.mcp_base_url), settings.mcp_request_timeout_seconds
    ) as client:
        _def_names, validation = await build_and_validate_candidate(client, candidate)

    # RevisionConflictError/ProjectNotFoundError propagate to their handlers (a race
    # with another request between the pre-check above and this commit).
    updated_session = project_service.commit_revision(
        project_id,
        plan_request.expectedRevision,
        candidate,
        validation.content,
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
        validation=ValidationSummary.model_validate(validation.to_summary()),
        preview=PreviewInfo(
            url=f"/api/projects/{project_id}/artifacts/html?revision={updated_session.revision}"
        ),
        artifacts=[
            ArtifactDescriptor(format=fmt, available=available, reason=reason)
            for fmt, available, reason in _ARTIFACT_AVAILABILITY
        ],
    )
