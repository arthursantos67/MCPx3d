# Construction recipe API

`GET /api/recipes?q=mesa` searches the local SQLite catalog; `GET /api/recipes/match?q=quero%20uma%20mesa` matches generic table or kitchen requests or returns `null` for a request with custom constraints; `GET /api/recipes/{id}` returns one recipe. The seeded kitchen has 65 distinct parts and passes the same overlap and X3D checks as a generated plan. `POST /api/recipes` accepts `{ "projectId": "...", "expectedRevision": 1, "name": "..." }` and only saves a nonempty current revision with validated X3D. The returned `plan` can be submitted to the existing `POST /api/projects/{id}/plans` endpoint for an empty project with matching units and display scale. The plan is revalidated by MCP before committing.

The default database is `data/recipes.sqlite3`; `RECIPE_DATABASE_PATH` overrides it. The database stores reusable plans only. Sessions and artifacts remain temporary in memory. The API has no accounts, so recipe writes are shared across callers.

## Project recovery API

`GET /api/projects/{id}/state` returns the current ModelSpec, validation summary, preview URL and artifact availability for a live session. `POST /api/projects/{id}/import?expectedRevision=N` accepts a raw ModelSpec v1 JSON manifest. It checks the upload size, version, fields, primitive dimensions, object limit and expected revision, then rebuilds and validates X3D before committing a new revision. The manifest's original project ID and revision are replaced with the destination session ID and next revision. A failed import leaves the current revision intact.

## Experimental CAD plate API

Start the API with `uv run --extra cad api` in `apps/api` to install and retain the optional CadQuery engine. `POST /api/cad/parts/inspect` accepts a `CadPartSpec` 2.x JSON document and reports the solid count, volume, bounds and STEP size. `POST /api/cad/parts/step` accepts the same document and downloads a STEP file. Both calls build the actual CadQuery solid, export STEP, reimport it and check one valid solid, volume, bounds, hole center and cylindrical face area before returning success.

Example body:

```json
{
  "schemaVersion": "2.0",
  "units": "mm",
  "partId": "bracket_plate",
  "base": { "kind": "extruded_rectangle", "width": 100, "depth": 80, "thickness": 10 },
  "features": [{ "kind": "through_hole", "x": 10, "y": 5, "diameter": 12 }]
}
```

Coordinates are measured from the center of the plate. The hole must keep at least 0.1 mm clearance from all edges. Dimensions are limited to 0.1–10,000 mm. The stateless inspection/export routes remain available for one-off parts.

## CAD projects and revisions

`POST /api/cad/projects` accepts `{ "spec": <CadPartSpec> }`, validates the solid and stores revision 0. `GET /api/cad/projects/{id}` returns the current spec and inspection. `POST /api/cad/projects/{id}/plans` accepts `{ "expectedRevision": N, "plan": { "schemaVersion": "1.0", "operations": [{ "op": "set_parameter", "parameter": "width", "value": 120 }] } }`. The allowed parameters are `width`, `depth`, `thickness`, `hole_x`, `hole_y` and `hole_diameter`; each may appear once per plan. A candidate is committed only after CAD and STEP round-trip validation. Stale edits return 409 and failed candidates leave the current revision intact.

`GET /api/cad/projects/{id}/revisions/{revision}` returns a saved revision; append `/step` to download its exact validated STEP. The SQLite store path is `CAD_DATABASE_PATH` (default `data/cad.sqlite3`). The browser remembers the last CAD project ID locally and resumes it after reload. CAD projects are separate from Web3D sessions and recipes. The API has no account ownership; use it in a private workspace until access control is added.

`CadPartSpec` 2.1 supports 1–16 identified through-holes plus four equal vertical-corner chamfers (`cornerChamfer` in mm). It checks edge, chamfer and inter-hole clearances. `CadEditPlan` 2.0 accepts the original `set_parameter` operation plus `set_corner_chamfer`, `upsert_hole` (`holeId`, `x`, `y`, `diameter`) and `remove_hole` (`holeId`). A 2.0 part upgrades to 2.1 on a 2.0 edit plan; its earlier revision remains available. The [sample spec](../../packages/domain/fixtures/cad-part/valid-mounting-plate.json) generates a [STEP part](../../examples/cad/mounting_plate.step) independently checked by FreeCAD.

`CadPartSpec` 2.2 adds a fused L bracket. Version 2.3 adds a rounded rectangular plate (`cornerRadius`) and a circular flange (`base.kind = extruded_disc`, with `width = depth = outside diameter`). `CadEditPlan` 4.0 accepts `set_corner_radius` and `set_disc_diameter`, alongside the earlier hole and dimension edits. `POST /api/cad/projects/{id}/spec` saves a complete validated spec after manual field edits, with an expected revision. The [rounded plate](../../examples/cad/rounded_plate.step) and [circular flange](../../examples/cad/round_flange.step) STEP samples were independently opened and checked in FreeCAD.

`CadPartSpec` 2.4 adds up to four cylindrical bosses fused to the base. Axial holes subtract material from the base and any boss they lie fully inside. `CadEditPlan` 5.0 accepts `upsert_boss` and `remove_boss`; all edits still pass the domain and STEP round-trip checks before commit. The [composite example](../../examples/cad/composite_mount.step) was independently checked in FreeCAD.
