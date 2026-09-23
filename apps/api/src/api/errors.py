"""Standard HTTP error body (PRD §9.4).

Two entry points share the same `{code, message, details, correlationId}`
body and logging:

- `api_error` builds an `HTTPException`, for the few call sites that still
  raise directly and let FastAPI's own default `HTTPException` handling
  render it (e.g. the apply-plan endpoint's `AMBIGUOUS_TARGET` short-circuit,
  which is route-specific business logic with no natural exception type of
  its own).
- `error_response` builds a `Response` directly, for `error_handlers.py`'s
  centralized exception-to-response mapping (Issue #23): the exceptions it
  maps are plain domain exceptions (`ProjectNotFoundError`, `MutationError`,
  ...), not `HTTPException`, so its handlers construct the response
  themselves instead of raising one.

Issue #23 ("Standardize backend errors") is what added `error_response` and
`error_handlers.py` -- before it, every route repeated its own
exception-to-`api_error` mapping inline.
"""

from __future__ import annotations

import logging

from fastapi import HTTPException
from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)


def _log(status_code: int, code: str, correlation_id: str | None, message: str) -> None:
    level = logging.ERROR if status_code >= 500 else logging.WARNING
    logger.log(
        level,
        "api_error status=%s code=%s correlation_id=%s message=%s",
        status_code,
        code,
        correlation_id,
        message,
    )


def _detail(
    code: str, message: str, details: list[object] | None, correlation_id: str | None
) -> dict[str, object]:
    return {
        "code": code,
        "message": message,
        "details": details or [],
        "correlationId": correlation_id,
    }


def api_error(
    status_code: int,
    code: str,
    message: str,
    *,
    details: list[object] | None = None,
    correlation_id: str | None = None,
) -> HTTPException:
    _log(status_code, code, correlation_id, message)
    return HTTPException(
        status_code=status_code,
        detail=_detail(code, message, details, correlation_id),
    )


def error_response(
    status_code: int,
    code: str,
    message: str,
    *,
    details: list[object] | None = None,
    correlation_id: str | None = None,
) -> JSONResponse:
    _log(status_code, code, correlation_id, message)
    response = JSONResponse(
        status_code=status_code,
        content=_detail(code, message, details, correlation_id),
    )
    if correlation_id:
        response.headers["X-Correlation-Id"] = correlation_id
    return response
