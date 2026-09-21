"""Standard HTTP error body (PRD §9.4, Issues #21/#22).

`api_error` is a shared helper, not a global exception-handler registry --
each route still chooses which caught exception maps to which `(status_code,
code)` pair. Issue #23 ("Standardize backend errors") is the issue that
centralizes that mapping into FastAPI exception handlers; #21/#22 only need
every error response to already carry the `{code, message, details,
correlationId}` shape §9.4 defines, which this helper guarantees regardless
of which route raises it. It also logs every call (NFR-09's "correlation ID
... logged"), so a route does not need its own logging call on error paths.
"""

from __future__ import annotations

import logging

from fastapi import HTTPException

logger = logging.getLogger(__name__)


def api_error(
    status_code: int,
    code: str,
    message: str,
    *,
    details: list[object] | None = None,
    correlation_id: str | None = None,
) -> HTTPException:
    level = logging.ERROR if status_code >= 500 else logging.WARNING
    logger.log(
        level,
        "api_error status=%s code=%s correlation_id=%s message=%s",
        status_code,
        code,
        correlation_id,
        message,
    )
    return HTTPException(
        status_code=status_code,
        detail={
            "code": code,
            "message": message,
            "details": details or [],
            "correlationId": correlation_id,
        },
    )
