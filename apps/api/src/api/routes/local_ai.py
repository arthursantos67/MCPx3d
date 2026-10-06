from __future__ import annotations

import json
from typing import Any, Literal

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, ConfigDict, Field

from api.config import get_settings
from api.errors import api_error
from api.local_ai import Client, LocalAiError, client_status, generate


def require_loopback(request: Request) -> None:
    if (
        request.client is None or request.client.host not in {"127.0.0.1", "::1"}
        or request.url.hostname not in {"localhost", "127.0.0.1", "::1"}
        or (request.headers.get("origin") is not None and request.headers["origin"] not in get_settings().cors_allow_origins)
    ):
        raise api_error(403, "CLI_LOCAL_ONLY", "A integração com assinaturas está disponível apenas no servidor local.")


router = APIRouter(prefix="/api/ai/local", tags=["local-ai"], dependencies=[Depends(require_loopback)])


class Message(BaseModel):
    model_config = ConfigDict(extra="forbid")
    role: Literal["system", "user", "assistant"]
    content: str = Field(max_length=300_000)


class GenerateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    client: Client
    model: str = Field(default="", max_length=120, pattern=r"^[a-zA-Z0-9_.:/-]*$")
    messages: list[Message] = Field(min_length=1, max_length=100)
    schema_: dict[str, Any] = Field(alias="schema")


@router.get("/status/{client}")
async def status(client: Client) -> dict[str, Any]:
    try:
        return await client_status(client)
    except LocalAiError as exc:
        raise api_error(exc.status, exc.code, str(exc)) from exc


@router.post("/generate")
async def completion(body: GenerateRequest, request: Request) -> dict[str, Any]:
    if len(json.dumps(body.model_dump())) > 600_000:
        raise api_error(413, "CLI_REQUEST_SIZE", "A solicitação excedeu o limite de contexto da integração local.")
    try:
        return await generate(body.client, body.model, [message.model_dump() for message in body.messages], body.schema_, request.is_disconnected)
    except LocalAiError as exc:
        raise api_error(exc.status, exc.code, str(exc)) from exc
