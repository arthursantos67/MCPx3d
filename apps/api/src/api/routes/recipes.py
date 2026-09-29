"""Search and save reusable construction plans."""

from __future__ import annotations

import re
from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict, Field, field_validator

from api.config import Settings, get_settings
from api.errors import api_error
from api.projects import (
    ProjectSessionService,
    RevisionConflictError,
    get_project_service,
)
from api.recipes import Recipe, RecipeStore, normalize

router = APIRouter(prefix="/api/recipes", tags=["recipes"])

_GENERIC_KITCHEN_WORDS = frozenset({
    "a", "ao", "apenas", "atencao", "bancada", "blocos", "com", "completa", "completo",
    "cuidado", "crie", "criar", "da", "de", "detalhe", "detalhes", "dos", "e", "etc",
    "faca", "fogao", "geladeira", "ilha", "itens", "lustre", "lustres", "mim", "modelo",
    "moveis", "movel", "nao", "nenhum", "objetos", "objeto", "os", "ou", "para", "pia",
    "puxador", "puxadores", "que", "quero", "realista", "sem", "tem", "tenha", "torneira",
    "torneiras", "uma", "um",
})


def _is_generic_kitchen_request(key: str) -> bool:
    words = re.findall(r"[a-z0-9]+", key)
    if "cozinha" not in words or any(word.isdigit() for word in words):
        return False
    if any(re.search(rf"\b{phrase}\b", key) for phrase in (
        "sem ilha", "sem geladeira", "sem fogao", "sem forno", "sem coifa",
    )):
        return False
    return all(
        word == "cozinha" or word in _GENERIC_KITCHEN_WORDS
        or word.startswith(("sobrepo", "sobrepos", "detalh"))
        for word in words
    )


@lru_cache
def get_recipe_store() -> RecipeStore:
    return RecipeStore(get_settings().recipe_database_path)


class SaveRecipeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    projectId: str = Field(min_length=1)
    expectedRevision: int = Field(ge=1)
    name: str = Field(min_length=1, max_length=80)

    @field_validator("name")
    @classmethod
    def _name_not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("name must contain visible characters")
        return value.strip()


@router.get("", response_model=list[Recipe])
def list_recipes(
    store: Annotated[RecipeStore, Depends(get_recipe_store)],
    q: Annotated[str, Query(max_length=80)] = "",
) -> list[Recipe]:
    return store.list(q)


@router.get("/match", response_model=Recipe | None)
def match_recipe(
    store: Annotated[RecipeStore, Depends(get_recipe_store)],
    q: Annotated[str, Query(min_length=1, max_length=1000)],
) -> Recipe | None:
    key = normalize(q)
    for prefix in ("quero ", "crie ", "criar ", "faca ", "faça ", "gere "):
        if key.startswith(normalize(prefix)):
            key = key[len(normalize(prefix)):].strip()
            break
    for article in ("uma ", "um "):
        if key.startswith(article):
            key = key[len(article):]
            break
    if key == "mesa":
        return store.get("builtin_table")
    if _is_generic_kitchen_request(key):
        return store.get("builtin_kitchen")
    return next((recipe for recipe in store.list(key) if normalize(recipe.name) == key), None)


@router.get("/{recipe_id}", response_model=Recipe)
def get_recipe(recipe_id: str, store: Annotated[RecipeStore, Depends(get_recipe_store)]) -> Recipe:
    recipe = store.get(recipe_id)
    if recipe is None:
        raise api_error(404, "RECIPE_NOT_FOUND", "Recipe not found")
    return recipe


@router.post("", response_model=Recipe, status_code=201)
def save_recipe(
    body: SaveRecipeRequest,
    store: Annotated[RecipeStore, Depends(get_recipe_store)],
    projects: Annotated[ProjectSessionService, Depends(get_project_service)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> Recipe:
    session = projects.get_project(body.projectId)
    if session.revision != body.expectedRevision:
        raise RevisionConflictError(body.projectId, body.expectedRevision, session.revision)
    snapshot = projects.snapshot_revision(body.projectId, body.expectedRevision)
    if snapshot is None:
        raise api_error(422, "RECIPE_REQUIRES_VALIDATED_MODEL", "Validate the current model before saving a recipe")
    try:
        return store.save(body.name, snapshot.model_spec, max_operations=settings.max_operations_per_plan)
    except ValueError as exc:
        raise api_error(422, "RECIPE_TOO_COMPLEX", str(exc)) from exc
