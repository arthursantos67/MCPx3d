from typing import Annotated, Any

from fastapi import APIRouter, Depends, Response

from api.cad_drafts import (
    CadDraftRequest,
    DraftBody,
    draft_bundle,
    draft_geometry,
    draft_mesh,
    draft_report,
)
from api.config import Settings, get_settings
from api.errors import api_error

router = APIRouter(prefix="/api/cad/drafts", tags=["cad"])


def available_geometry(request: CadDraftRequest) -> list[DraftBody]:
    bodies = draft_geometry(request)
    if not any(body.solid is not None for body in bodies):
        raise api_error(422, "CAD_DRAFT_EMPTY", "Não há sólido válido para exportar. O JSON original continua disponível.",
                        details=[draft_report(request, bodies)])
    return bodies


@router.post("/mesh")
def preview_draft(request: CadDraftRequest) -> dict[str, Any]:
    return draft_mesh(request, available_geometry(request))


@router.post("/export")
def export_draft(request: CadDraftRequest, settings: Annotated[Settings, Depends(get_settings)]) -> Response:
    data = draft_bundle(request, available_geometry(request), settings.max_artifact_bytes)
    return Response(data, media_type="application/zip", headers={
        "Content-Disposition": f'attachment; filename="{request.spec.partId}-draft.zip"',
        "X-CAD-Validation": "draft", "Cache-Control": "no-store"})
