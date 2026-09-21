"""Application-facing wrapper around the x3d_mcp Streamable HTTP tool surface.

Encapsulates MCP protocol details (sessions, tool-call plumbing, content
blocks) behind a small set of typed methods, per PRD ยง9.5. Callers never see
raw MCP request/response objects.

The underlying x3d_mcp server keeps its granular (in-memory) scene state per
MCP session (see FR-25), so one X3DMcpClient holds a single session for its
whole lifetime -- primitives created through it accumulate in that session's
scene until reset_scene() is called.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import AsyncExitStack, asynccontextmanager
from typing import Any, Literal

import httpx
from mcp import ClientSession, types
from mcp.client.streamable_http import streamable_http_client
from mcp.shared.exceptions import McpError

PrimitiveKind = Literal["box", "sphere", "cylinder", "cone"]

_GEOMETRY_NODE_TYPES: dict[PrimitiveKind, str] = {
    "box": "Box",
    "sphere": "Sphere",
    "cylinder": "Cylinder",
    "cone": "Cone",
}


class X3DMcpError(Exception):
    """Base class for X3DMcpClient failures."""


class McpUnavailableError(X3DMcpError):
    """The x3d_mcp service could not be reached, or the session could not be established."""


class McpToolError(X3DMcpError):
    """An x3d_mcp tool call completed but reported an error."""

    def __init__(self, tool: str, message: str) -> None:
        super().__init__(f"{tool}: {message}")
        self.tool = tool


class X3DMcpClient:
    """Minimal wrapper sufficient to spike create-validate-render through x3d_mcp."""

    def __init__(self, session: ClientSession) -> None:
        self._session = session

    @classmethod
    @asynccontextmanager
    async def connect(cls, base_url: str, timeout_seconds: float = 30.0) -> AsyncIterator[X3DMcpClient]:
        """Open one MCP session against the x3d_mcp server's /mcp endpoint.

        Only connection setup (transport handshake, `initialize()`) is mapped to
        `McpUnavailableError` here; errors raised by caller code using the
        yielded client are left untouched so they keep their own typing.
        """
        mcp_url = f"{base_url.rstrip('/')}/mcp"
        stack = AsyncExitStack()
        try:
            http_client = await stack.enter_async_context(httpx.AsyncClient(timeout=timeout_seconds))
            read_stream, write_stream, _get_session_id = await stack.enter_async_context(
                streamable_http_client(mcp_url, http_client=http_client)
            )
            session = await stack.enter_async_context(ClientSession(read_stream, write_stream))
            await session.initialize()
        except BaseException as exc:
            # A failed transport task can make anyio's task-group teardown raise its own
            # ExceptionGroup here, which would bury the real cause -- swallow that and
            # report the original failure instead.
            try:
                await stack.aclose()
            except Exception:  # noqa: BLE001, S110 -- best-effort cleanup, must not hide `exc`
                pass
            raise McpUnavailableError(str(exc)) from exc

        try:
            yield cls(session)
        finally:
            await stack.aclose()

    async def reset_scene(self) -> str:
        """Clear the session's scene to an empty state."""
        return await self._call("reset_scene")

    async def create_primitive(
        self,
        kind: PrimitiveKind,
        dimensions: dict[str, float | list[float]],
        *,
        translation: tuple[float, float, float] | None = None,
        rotation: tuple[float, float, float, float] | None = None,
        scale: tuple[float, float, float] | None = None,
        color: tuple[float, float, float] | None = None,
        transparency: float | None = None,
        def_name: str,
    ) -> str:
        """Add one Transform > Shape(Appearance/Material + geometry) primitive.

        Returns `def_name`, the DEF assigned to the primitive's Transform, so
        callers have a stable identity for later X3D DEF/ROUTE references.
        """
        geometry_type = _GEOMETRY_NODE_TYPES[kind]

        transform_fields: dict[str, Any] = {}
        if translation is not None:
            transform_fields["translation"] = list(translation)
        if rotation is not None:
            transform_fields["rotation"] = list(rotation)
        if scale is not None:
            transform_fields["scale"] = list(scale)
        transform_id = await self._create_node("Transform", transform_fields)

        shape_id = await self._create_node("Shape")
        appearance_id = await self._create_node("Appearance")

        material_fields: dict[str, Any] = {}
        if color is not None:
            material_fields["diffuseColor"] = list(color)
        if transparency is not None:
            material_fields["transparency"] = transparency
        material_id = await self._create_node("Material", material_fields)

        geometry_id = await self._create_node(geometry_type, dict(dimensions))

        await self._add_child(appearance_id, material_id)
        await self._add_child(shape_id, appearance_id, container_field="appearance")
        await self._add_child(shape_id, geometry_id, container_field="geometry")
        await self._add_child(transform_id, shape_id)
        await self._call("def_node", {"node_id": transform_id, "name": def_name})

        return def_name

    async def get_scene(self, encoding: Literal["xml", "json", "vrml"] = "xml") -> str:
        """Return the session's current scene, serialized in `encoding`."""
        return await self._call("get_scene", {"encoding": encoding})

    async def validate_current_scene(self) -> str:
        """Schema (XSD) and semantic validation of the session's current scene."""
        return await self._call("validate_current_scene")

    async def validate_x3d(self, content: str, *, encoding: Literal["xml", "json"] = "xml") -> str:
        """Schema (XSD/JSON Schema) validation for arbitrary X3D content.

        Returns the raw `{"valid": bool, "errors": [...]}` JSON text.
        """
        return await self._call("validate_x3d", {"content": content, "encoding": encoding})

    async def validate_semantic(self, content: str) -> str:
        """Semantic validation report for arbitrary X3D content."""
        return await self._call("validate_semantic", {"content": content})

    async def autofix_x3d(self, content: str) -> str:
        """Auto-correct containerField mistakes in `content`.

        Returns the raw `{"fixed": str, "changes": [...], "unfixable": [...]}` JSON text.
        """
        return await self._call("autofix_x3d", {"content": content})

    async def generate_x3dom_page(self, content: str, *, title: str = "X3D Preview") -> str:
        """Wrap X3D content in a standalone X3DOM HTML page."""
        return await self._call("x3dom_page", {"content": content, "title": title})

    async def _create_node(self, node_type: str, fields: dict[str, Any] | None = None) -> str:
        text = await self._call("create_node", {"node_type": node_type, "fields": fields or None})
        # Tool returns "Created {node_type} with ID: {node_id}".
        return text.rsplit(":", 1)[-1].strip()

    async def _add_child(self, parent_id: str, child_id: str, *, container_field: str = "") -> None:
        await self._call(
            "add_child",
            {"parent_id": parent_id, "child_id": child_id, "container_field": container_field},
        )

    async def _call(self, tool: str, arguments: dict[str, Any] | None = None) -> str:
        try:
            result = await self._session.call_tool(tool, arguments or {})
        except (httpx.HTTPError, OSError) as exc:
            raise McpUnavailableError(str(exc)) from exc
        except McpError as exc:
            raise McpToolError(tool, str(exc)) from exc
        if result.isError:
            raise McpToolError(tool, _result_text(result))
        return _result_text(result)


def _result_text(result: types.CallToolResult) -> str:
    parts = [block.text for block in result.content if isinstance(block, types.TextContent)]
    return "\n".join(parts)
