from functools import lru_cache
from typing import Literal

from pydantic import AnyHttpUrl, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    environment: Literal["development", "production"] = "development"

    mcp_base_url: AnyHttpUrl = AnyHttpUrl("http://localhost:8000")
    mcp_request_timeout_seconds: float = Field(default=30.0, gt=0)

    session_ttl_seconds: int = Field(default=3600, gt=0)

    max_objects_per_project: int = Field(default=100, gt=0)
    max_operations_per_plan: int = Field(default=100, gt=0)
    max_prompt_characters: int = Field(default=8000, gt=0)

    cors_allow_origins: list[str] = Field(default_factory=lambda: ["http://localhost:5173"])


@lru_cache
def get_settings() -> Settings:
    return Settings()
