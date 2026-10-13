from typing import Annotated, Any

from fastapi import APIRouter, Depends, Response

from api.cad_drafts import (
    CadDraftRequest,
)
from api.cad_process import run_cad_process
from api.config import Settings, get_settings

router = APIRouter(prefix="/api/cad/drafts", tags=["cad"])


@router.post("/mesh")
def preview_draft(request: CadDraftRequest) -> dict[str, Any]:
    return run_cad_process("draft_mesh", {"request": request.model_dump(mode="json", exclude_none=True)}).metadata


@router.post("/export")
def export_draft(request: CadDraftRequest, settings: Annotated[Settings, Depends(get_settings)]) -> Response:
    data = run_cad_process("draft_bundle", {"request": request.model_dump(mode="json", exclude_none=True),
        "maxBytes": settings.max_artifact_bytes, "maxStlBytes": settings.max_cad_stl_bytes,
        "maxBundleBytes": settings.max_cad_draft_bundle_bytes}, settings).data
    return Response(data, media_type="application/zip", headers={
        "Content-Disposition": f'attachment; filename="{request.spec.partId}-draft.zip"',
        "X-CAD-Validation": "draft", "Cache-Control": "no-store"})
