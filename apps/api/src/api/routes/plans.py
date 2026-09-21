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
message to show the user.
"""

from __future__ import annotations

import logging
from typing import Annotated, Literal
from uuid import uuid4

from domain.model_plan import Clarify, ModelPlan
from domain.model_spec import ModelSpec
from fastapi import APIRouter, Body, Depends, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from api.config import Settings, get_settings
from api.errors import api_error
from api.mcp_client import McpUnavailableError, X3DMcpClient
from api.mutation import MutationError, UnknownTargetError, apply_plan
from api.projects import (
    ProjectNotFoundError,
    ProjectSessionService,
    RevisionConflictError,
    get_project_service,
)
from api.x3d_validation import (
    ValidationResult,
    X3DValidationError,
    build_and_validate_candidate,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/projects", tags=["plans"])

ArtifactFormat = Literal["html", "x3d", "x3dj", "x3dv"]
_ARTIFACT_FORMATS: tuple[ArtifactFormat, ...] = ("html", "x3d", "x3dj", "x3dv")


class ApplyPlanRequest(BaseModel):
    """PRD §9.2."""

    model_config = ConfigDict(extra="forbid")

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


class PreviewInfo(BaseModel):
    url: str


class ApplyPlanResponse(BaseModel):
    """PRD §9.3."""

    projectId: str
    revision: int
    modelSpec: ModelSpec
    validation: ValidationSummary
    preview: PreviewInfo
    artifacts: list[ArtifactDescriptor]


def _request_id(body: dict[str, object]) -> str:
    raw = body.get("requestId")
    return raw if isinstance(raw, str) and raw else str(uuid4())


def _pydantic_error_details(exc: ValidationError) -> list[object]:
    return [{"loc": list(error["loc"]), "message": error["msg"]} for error in exc.errors()]


def _x3d_validation_details(result: ValidationResult) -> list[object]:
    details: list[object] = [{"schemaError": error} for error in result.schema_errors]
    details += [{"check": d.check, "message": d.message} for d in result.errors]
    return details


@router.post("/{project_id}/plans", response_model=ApplyPlanResponse)
async def apply_plan_endpoint(
    project_id: str,
    body: Annotated[dict[str, object], Body(...)],
    response: Response,
    project_service: Annotated[ProjectSessionService, Depends(get_project_service)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> ApplyPlanResponse:
    correlation_id = _request_id(body)
    response.headers["X-Correlation-Id"] = correlation_id

    try:
        try:
            request = ApplyPlanRequest.model_validate(body)
        except ValidationError as exc:
            raise api_error(
                400,
                "INVALID_PLAN",
                "The request body is not a valid apply-plan request.",
                details=_pydantic_error_details(exc),
                correlation_id=correlation_id,
            ) from exc

        logger.info(
            "apply_plan.start correlation_id=%s project_id=%s expected_revision=%s",
            correlation_id,
            project_id,
            request.expectedRevision,
        )

        clarify_questions = [op.question for op in request.plan.operations if isinstance(op, Clarify)]
        if clarify_questions:
            raise api_error(
                422,
                "AMBIGUOUS_TARGET",
                clarify_questions[0],
                details=list(clarify_questions),
                correlation_id=correlation_id,
            )

        try:
            session = project_service.get_project(project_id)
        except ProjectNotFoundError as exc:
            raise api_error(
                404,
                "PROJECT_NOT_FOUND",
                f"Project '{project_id}' was not found or has expired.",
                correlation_id=correlation_id,
            ) from exc

        if request.expectedRevision != session.revision:
            raise api_error(
                409,
                "REVISION_CONFLICT",
                f"Expected revision {request.expectedRevision}, current revision is {session.revision}.",
                correlation_id=correlation_id,
            )

        try:
            candidate = apply_plan(session.model_spec, request.plan)
        except UnknownTargetError as exc:
            raise api_error(422, "UNKNOWN_TARGET", str(exc), correlation_id=correlation_id) from exc
        except MutationError as exc:
            raise api_error(422, "DOMAIN_VALIDATION_FAILED", str(exc), correlation_id=correlation_id) from exc

        try:
            async with X3DMcpClient.connect(
                str(settings.mcp_base_url), settings.mcp_request_timeout_seconds
            ) as client:
                _def_names, validation = await build_and_validate_candidate(client, candidate)
        except McpUnavailableError as exc:
            raise api_error(503, "MCP_UNAVAILABLE", str(exc), correlation_id=correlation_id) from exc
        except X3DValidationError as exc:
            raise api_error(
                422,
                "X3D_VALIDATION_FAILED",
                "The candidate scene could not be validated.",
                details=_x3d_validation_details(exc.result),
                correlation_id=correlation_id,
            ) from exc

        try:
            updated_session = project_service.commit_revision(
                project_id, request.expectedRevision, candidate
            )
        except RevisionConflictError as exc:
            raise api_error(
                409,
                "REVISION_CONFLICT",
                f"Expected revision {exc.expected_revision}, current revision is {exc.current_revision}.",
                correlation_id=correlation_id,
            ) from exc
        except ProjectNotFoundError as exc:
            raise api_error(
                404,
                "PROJECT_NOT_FOUND",
                f"Project '{project_id}' was not found or has expired.",
                correlation_id=correlation_id,
            ) from exc

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
            artifacts=[ArtifactDescriptor(format=fmt, available=True) for fmt in _ARTIFACT_FORMATS],
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise api_error(
            500, "INTERNAL_ERROR", "Unexpected server failure.", correlation_id=correlation_id
        ) from exc
