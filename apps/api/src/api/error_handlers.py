"""Centralized exception -> HTTP response mapping (PRD §9.4, Issue #23).

Before this module, every route caught each domain exception itself and
called `api.errors.api_error` inline (Issues #21/#22) -- correct, but the
`(exception type) -> (status, code)` mapping was re-derived at every call
site, and a route that forgot a `try/except` (e.g. `routes/projects.py`'s
`create_project`/`delete_project`) fell through to FastAPI/Starlette's
default error handling instead of PRD §9.4's `{code, message, details,
correlationId}` shape.

`register_error_handlers` fixes both: a route now only needs to let the
right exception type propagate (or raise it directly), and FastAPI finds the
most specific handler registered for that exception's MRO -- e.g.
`UnknownTargetError` before its `MutationError` base -- so subclasses that
need a distinct code still get one without a dedicated line, and any
exception type this module doesn't know about still resolves to the base
class it does.

The final `Exception` handler is what makes NFR-10 ("a generic server error
shall not expose Python stack traces...") hold for every route, not just
ones that remembered to wrap themselves; `HTTPException` (still raised
directly by e.g. `routes/plans.py`'s `AMBIGUOUS_TARGET` short-circuit) is
unaffected -- FastAPI's own built-in handler for it is more specific in the
MRO than this module's `Exception` handler, so it keeps rendering `exc.detail`
as-is.
"""

from __future__ import annotations

from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from api.artifacts import (
    ArtifactConversionError,
    ArtifactError,
    StaleArtifactRequestError,
)
from api.errors import error_response
from api.mcp_client import X3DMcpError
from api.mutation import MutationError, UnknownTargetError
from api.projects import ProjectNotFoundError, RevisionConflictError
from api.x3d_validation import X3DValidationError


def _correlation_id(request: Request) -> str:
    """Reuses the request's own correlation id (`routes/plans.py` sets
    `request.state.correlation_id` from the request body's `requestId`) when
    available, otherwise mints one -- an error response always carries a
    correlation id even for routes that have no such request field."""
    stored = getattr(request.state, "correlation_id", None)
    return stored if isinstance(stored, str) and stored else str(uuid4())


def _pydantic_error_details(exc: ValidationError) -> list[object]:
    return [{"loc": list(error["loc"]), "message": error["msg"]} for error in exc.errors()]


def _x3d_validation_details(exc: X3DValidationError) -> list[object]:
    result = exc.result
    details: list[object] = [{"schemaError": error} for error in result.schema_errors]
    details += [{"check": d.check, "message": d.message} for d in result.errors]
    return details


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ProjectNotFoundError)
    async def _project_not_found(request: Request, exc: ProjectNotFoundError) -> JSONResponse:
        return error_response(
            404,
            "PROJECT_NOT_FOUND",
            f"Project '{exc.project_id}' was not found or has expired.",
            correlation_id=_correlation_id(request),
        )

    @app.exception_handler(RevisionConflictError)
    async def _revision_conflict(request: Request, exc: RevisionConflictError) -> JSONResponse:
        return error_response(
            409,
            "REVISION_CONFLICT",
            f"Expected revision {exc.expected_revision}, current revision is {exc.current_revision}.",
            correlation_id=_correlation_id(request),
        )

    @app.exception_handler(UnknownTargetError)
    async def _unknown_target(request: Request, exc: UnknownTargetError) -> JSONResponse:
        return error_response(
            422, "UNKNOWN_TARGET", str(exc), correlation_id=_correlation_id(request)
        )

    @app.exception_handler(MutationError)
    async def _mutation_error(request: Request, exc: MutationError) -> JSONResponse:
        return error_response(
            422, "DOMAIN_VALIDATION_FAILED", str(exc), correlation_id=_correlation_id(request)
        )

    @app.exception_handler(X3DMcpError)
    async def _mcp_unavailable(request: Request, exc: X3DMcpError) -> JSONResponse:
        return error_response(
            503, "MCP_UNAVAILABLE", str(exc), correlation_id=_correlation_id(request)
        )

    @app.exception_handler(X3DValidationError)
    async def _x3d_validation_failed(request: Request, exc: X3DValidationError) -> JSONResponse:
        return error_response(
            422,
            "X3D_VALIDATION_FAILED",
            "The candidate scene could not be validated.",
            details=_x3d_validation_details(exc),
            correlation_id=_correlation_id(request),
        )

    @app.exception_handler(StaleArtifactRequestError)
    async def _stale_artifact(request: Request, exc: StaleArtifactRequestError) -> JSONResponse:
        return error_response(
            404, "ARTIFACT_UNAVAILABLE", str(exc), correlation_id=_correlation_id(request)
        )

    @app.exception_handler(ArtifactConversionError)
    async def _artifact_conversion_failed(
        request: Request, exc: ArtifactConversionError
    ) -> JSONResponse:
        return error_response(
            404, "ARTIFACT_UNAVAILABLE", str(exc), correlation_id=_correlation_id(request)
        )

    @app.exception_handler(ArtifactError)
    async def _artifact_unavailable(request: Request, exc: ArtifactError) -> JSONResponse:
        return error_response(
            404, "ARTIFACT_UNAVAILABLE", str(exc), correlation_id=_correlation_id(request)
        )

    @app.exception_handler(ValidationError)
    async def _pydantic_validation_error(request: Request, exc: ValidationError) -> JSONResponse:
        return error_response(
            400,
            "INVALID_PLAN",
            "The request body is not a valid apply-plan request.",
            details=_pydantic_error_details(exc),
            correlation_id=_correlation_id(request),
        )

    @app.exception_handler(RequestValidationError)
    async def _request_validation_error(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        return error_response(
            400,
            "INVALID_PLAN",
            "The request could not be parsed.",
            details=[{"loc": list(error["loc"]), "message": error["msg"]} for error in exc.errors()],
            correlation_id=_correlation_id(request),
        )

    @app.exception_handler(Exception)
    async def _unexpected_error(request: Request, exc: Exception) -> JSONResponse:
        return error_response(
            500,
            "INTERNAL_ERROR",
            "Unexpected server failure.",
            correlation_id=_correlation_id(request),
        )
