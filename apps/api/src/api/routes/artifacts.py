"""Standalone HTML artifact endpoint (PRD §9.1/§10.3, Issue #11's HTTP half,
wired for Issue #28's preview iframe).

`POST /plans` (`routes/plans.py`, Issue #22) already returns
`preview.url = "/api/projects/{id}/artifacts/html?revision=N"`, and
`api.artifacts.build_html_artifact` (Issue #11) already builds the standalone
X3DOM HTML from validated X3D content -- this module is only the HTTP wiring
between them, the same shape Issue #21/#22 already used to wire #7/#8/#10's
module logic to HTTP.

`ProjectSessionService` only stores the current `ModelSpec` (PRD §3.12: no
database, and X3D content is never persisted -- ModelSpec is the semantic
source of truth). So this route rebuilds the X3D content from the project's
already-committed, already-valid `ModelSpec` via `build_and_validate_candidate`
rather than reading cached content; a committed `ModelSpec` is guaranteed
valid (nothing commits otherwise, PRD FE-08/NFR-06), so this rebuild is not
expected to ever fail validation in practice -- it exists to regenerate X3D
from the renderer-independent source of truth, not to re-validate a proposed
change.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response

from api.artifacts import build_html_artifact
from api.config import Settings, get_settings
from api.mcp_client import X3DMcpClient
from api.projects import ProjectSessionService, get_project_service
from api.x3d_validation import build_and_validate_candidate

router = APIRouter(prefix="/api/projects", tags=["artifacts"])


@router.get("/{project_id}/artifacts/html")
async def get_html_artifact(
    project_id: str,
    revision: Annotated[int, Query(ge=0)],
    project_service: Annotated[ProjectSessionService, Depends(get_project_service)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> Response:
    # ProjectNotFoundError propagates to the PROJECT_NOT_FOUND handler.
    session = project_service.get_project(project_id)

    # McpUnavailableError/McpToolError/X3DValidationError propagate to their handlers.
    async with X3DMcpClient.connect(
        str(settings.mcp_base_url), settings.mcp_request_timeout_seconds
    ) as client:
        _def_names, validation = await build_and_validate_candidate(client, session.model_spec)

        # StaleArtifactRequestError/ArtifactTooLargeError propagate to their handlers.
        artifact = await build_html_artifact(
            client,
            project_id=project_id,
            revision=session.revision,
            x3d_content=validation.content,
            requested_revision=revision,
            max_bytes=settings.max_artifact_bytes,
        )

    return Response(
        content=artifact.content,
        media_type=artifact.media_type,
        headers={"Content-Disposition": f'inline; filename="{artifact.filename}"'},
    )
