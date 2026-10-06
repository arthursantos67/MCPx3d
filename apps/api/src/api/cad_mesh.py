from typing import Any

from api.cad_adapter import CadArtifactTooLargeError


def preview_tessellation(solids: list[Any]) -> list[tuple[Any, Any]]:
    for angle in (0.3, 0.6, 0.9):
        meshes = []
        count = 0
        for solid in solids:
            mesh = solid.copy().tessellate(0.5, angularTolerance=angle)
            meshes.append(mesh)
            count += len(mesh[1])
            if count > 50_000:
                break
        if count <= 50_000:
            return meshes
    raise CadArtifactTooLargeError("CAD preview exceeds 50,000 triangles at supported preview resolutions")
