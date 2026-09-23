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

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query, Response

from api.artifacts import (
    ArtifactConversionError,
    StaleArtifactRequestError,
    build_converted_artifact,
    build_html_artifact,
    build_model_spec_artifact,
    build_x3d_artifact,
    normalized_artifact_filename,
)
from api.config import Settings, get_settings
from api.mcp_client import X3DMcpClient
from api.projects import ProjectSessionService, get_project_service

router = APIRouter(prefix="/api/projects", tags=["artifacts"])


@router.get("/{project_id}/artifacts/html")
async def get_html_artifact(
    project_id: str,
    revision: Annotated[int, Query(ge=0)],
    project_service: Annotated[ProjectSessionService, Depends(get_project_service)],
    settings: Annotated[Settings, Depends(get_settings)],
    download: bool = False,
) -> Response:
    # ProjectNotFoundError propagates to the PROJECT_NOT_FOUND handler.
    session = project_service.get_project(project_id)
    snapshot_revision = session.revision
    x3d_content = session.validated_x3d.get(snapshot_revision)
    if revision != snapshot_revision or x3d_content is None:
        raise StaleArtifactRequestError(project_id, revision, snapshot_revision)

    cached_html = session.html_artifacts.get(snapshot_revision)
    if cached_html is not None:
        return Response(
            content=cached_html,
            media_type="text/html; charset=utf-8",
            headers={
                "Content-Disposition": _content_disposition(
                    normalized_artifact_filename(project_id, snapshot_revision, "html"), download
                )
            },
        )

    async with X3DMcpClient.connect(
        str(settings.mcp_base_url), settings.mcp_request_timeout_seconds
    ) as client:
        artifact = await build_html_artifact(
            client,
            project_id=project_id,
            revision=snapshot_revision,
            x3d_content=x3d_content,
            requested_revision=revision,
            max_bytes=settings.max_artifact_bytes,
        )
    project_service.cache_html_artifact(project_id, snapshot_revision, artifact.content)

    return Response(
        content=artifact.content,
        media_type=artifact.media_type,
        headers={"Content-Disposition": _content_disposition(artifact.filename, download)},
    )


def _content_disposition(filename: str, download: bool) -> str:
    disposition = "attachment" if download else "inline"
    return f'{disposition}; filename="{filename}"'


ArtifactFormat = Literal["x3d", "x3dj", "x3dv", "manifest"]


@router.get("/{project_id}/artifacts/{format}")
async def get_download_artifact(
    project_id: str,
    format: ArtifactFormat,
    revision: Annotated[int, Query(ge=0)],
    project_service: Annotated[ProjectSessionService, Depends(get_project_service)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> Response:
    session = project_service.get_project(project_id)
    x3d_content = session.validated_x3d.get(session.revision)

    if format == "manifest":
        artifact = build_model_spec_artifact(
            project_id=project_id,
            revision=session.revision,
            model_spec=session.model_spec,
            requested_revision=revision,
            max_bytes=settings.max_artifact_bytes,
        )
    else:
        if format == "x3dj":
            raise ArtifactConversionError(format, "X3DJ is unavailable for the pinned X3D toolchain")
        if x3d_content is None:
            raise StaleArtifactRequestError(project_id, revision, session.revision)
        if format == "x3d":
            artifact = build_x3d_artifact(
                project_id=project_id,
                revision=session.revision,
                x3d_content=x3d_content,
                requested_revision=revision,
                max_bytes=settings.max_artifact_bytes,
            )
        else:
            async with X3DMcpClient.connect(
                str(settings.mcp_base_url), settings.mcp_request_timeout_seconds
            ) as client:
                artifact = await build_converted_artifact(
                    client,
                    format=format,
                    project_id=project_id,
                    revision=session.revision,
                    x3d_content=x3d_content,
                    requested_revision=revision,
                    max_bytes=settings.max_artifact_bytes,
                )

    return Response(
        content=artifact.content,
        media_type=artifact.media_type,
        headers={"Content-Disposition": _content_disposition(artifact.filename, True)},
    )
