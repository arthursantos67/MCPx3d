"""Persistent, data-only construction recipes for validated ModelSpecs."""

from __future__ import annotations

import json
import secrets
import sqlite3
import unicodedata
from pathlib import Path
from typing import Literal

from domain.model_plan import ModelPlan
from domain.model_spec import ModelSpec
from pydantic import BaseModel, ConfigDict

from api.kitchen_recipe import built_in_kitchen_plan


class Recipe(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    schemaVersion: Literal["1.0"] = "1.0"
    name: str
    units: str
    displayScale: float
    objectCount: int
    plan: ModelPlan


def normalize(text: str) -> str:
    decomposed = unicodedata.normalize("NFKD", text.casefold())
    return " ".join("".join(char for char in decomposed if not unicodedata.combining(char)).split()).strip(" .!?")


def plan_from_spec(spec: ModelSpec, *, max_operations: int) -> ModelPlan:
    if not spec.objects:
        raise ValueError("Only a nonempty validated model can become a recipe")
    operations: list[dict[str, object]] = []
    for obj in spec.objects:
        operations.append({
            "op": "create_object", "id": obj.id, "name": obj.name, "kind": obj.kind,
            "dimensions": obj.dimensions, "position": obj.transform.position,
            "rotation": obj.transform.rotation, "color": obj.material.color,
            "tags": obj.tags, "allowOverlap": True,
        })
        if obj.transform.scale != (1.0, 1.0, 1.0):
            operations.append({"op": "scale_object", "target": obj.id, "factor": obj.transform.scale, "allowOverlap": True})
        if obj.material.transparency is not None:
            operations.append({"op": "set_material", "target": obj.id, "transparency": obj.material.transparency})
    operations.append({"op": "set_scene_title", "title": spec.scene.title})
    if spec.scene.background is not None:
        operations.append({"op": "set_scene", "background": spec.scene.background})
    if len(operations) > max_operations:
        raise ValueError(f"Recipe requires {len(operations)} operations; limit is {max_operations}")
    return ModelPlan.model_validate({"intent": "reuse_validated_model", "operations": operations})


_TABLE_PLAN = ModelPlan.model_validate({
    "intent": "create_dining_table_from_recipe",
    "operations": [
        {"op": "create_object", "id": "table_top", "name": "Tampo", "kind": "box", "dimensions": {"width": 1200, "height": 50, "depth": 700}, "position": [0, 725, 0], "color": "#9b6840"},
        {"op": "create_object", "id": "table_leg_front_left", "name": "Perna dianteira esquerda", "kind": "box", "dimensions": {"width": 70, "height": 700, "depth": 70}, "position": [-520, 350, 270], "color": "#69452e"},
        {"op": "create_object", "id": "table_leg_front_right", "name": "Perna dianteira direita", "kind": "box", "dimensions": {"width": 70, "height": 700, "depth": 70}, "position": [520, 350, 270], "color": "#69452e"},
        {"op": "create_object", "id": "table_leg_back_left", "name": "Perna traseira esquerda", "kind": "box", "dimensions": {"width": 70, "height": 700, "depth": 70}, "position": [-520, 350, -270], "color": "#69452e"},
        {"op": "create_object", "id": "table_leg_back_right", "name": "Perna traseira direita", "kind": "box", "dimensions": {"width": 70, "height": 700, "depth": 70}, "position": [520, 350, -270], "color": "#69452e"},
        {"op": "create_object", "id": "table_apron_front", "name": "Saia dianteira", "kind": "box", "dimensions": {"width": 970, "height": 80, "depth": 30}, "position": [0, 660, 270], "color": "#805536"},
        {"op": "create_object", "id": "table_apron_back", "name": "Saia traseira", "kind": "box", "dimensions": {"width": 970, "height": 80, "depth": 30}, "position": [0, 660, -270], "color": "#805536"},
        {"op": "create_object", "id": "table_apron_left", "name": "Saia lateral esquerda", "kind": "box", "dimensions": {"width": 30, "height": 80, "depth": 470}, "position": [-520, 660, 0], "color": "#805536"},
        {"op": "create_object", "id": "table_apron_right", "name": "Saia lateral direita", "kind": "box", "dimensions": {"width": 30, "height": 80, "depth": 470}, "position": [520, 660, 0], "color": "#805536"},
        {"op": "set_scene_title", "title": "Mesa de jantar"},
    ],
})


class RecipeStore:
    def __init__(self, path: Path) -> None:
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as connection:
            connection.execute("""
                CREATE TABLE IF NOT EXISTS recipes (
                    id TEXT PRIMARY KEY,
                    schema_version TEXT NOT NULL,
                    name TEXT NOT NULL,
                    search_key TEXT NOT NULL,
                    units TEXT NOT NULL,
                    display_scale REAL NOT NULL,
                    object_count INTEGER NOT NULL,
                    plan_json TEXT NOT NULL
                )
            """)
            connection.execute("CREATE INDEX IF NOT EXISTS recipes_search_idx ON recipes(search_key)")
            connection.execute(
                "INSERT OR REPLACE INTO recipes VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                ("builtin_table", "1.0", "Mesa de jantar", "mesa de jantar", "mm", 0.001, 9, _TABLE_PLAN.model_dump_json()),
            )
            kitchen = built_in_kitchen_plan()
            connection.execute(
                "INSERT OR REPLACE INTO recipes VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                ("builtin_kitchen", "1.0", "Cozinha completa", "cozinha completa", "mm", 0.001,
                 len(kitchen.operations) - 1, kitchen.model_dump_json()),
            )

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path, timeout=10)
        connection.row_factory = sqlite3.Row
        return connection

    @staticmethod
    def _recipe(row: sqlite3.Row) -> Recipe:
        return Recipe(
            id=row["id"], schemaVersion=row["schema_version"], name=row["name"], units=row["units"],
            displayScale=row["display_scale"], objectCount=row["object_count"],
            plan=ModelPlan.model_validate(json.loads(row["plan_json"])),
        )

    def list(self, query: str = "") -> list[Recipe]:
        key = normalize(query)
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT * FROM recipes WHERE search_key LIKE ? ORDER BY name LIMIT 30",
                (f"%{key}%",),
            ).fetchall()
        return [self._recipe(row) for row in rows]

    def get(self, recipe_id: str) -> Recipe | None:
        with self._connect() as connection:
            row = connection.execute("SELECT * FROM recipes WHERE id = ?", (recipe_id,)).fetchone()
        return self._recipe(row) if row is not None else None

    def save(self, name: str, spec: ModelSpec, *, max_operations: int) -> Recipe:
        plan = plan_from_spec(spec, max_operations=max_operations)
        recipe = Recipe(
            id=f"recipe_{secrets.token_hex(12)}", name=name, units=spec.units,
            displayScale=spec.scene.displayScale, objectCount=len(spec.objects), plan=plan,
        )
        with self._connect() as connection:
            connection.execute(
                "INSERT INTO recipes VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (recipe.id, recipe.schemaVersion, recipe.name, normalize(recipe.name), recipe.units,
                 recipe.displayScale, recipe.objectCount, recipe.plan.model_dump_json()),
            )
        return recipe
