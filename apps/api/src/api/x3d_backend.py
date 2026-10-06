from __future__ import annotations

import json
from collections.abc import AsyncIterator, Sequence
from contextlib import asynccontextmanager
from html import escape
from importlib import import_module
from threading import Lock
from typing import Literal, cast
from xml.etree import ElementTree as ET

from anyio import to_thread
from domain.model_spec import ModelSpec

from api.config import Settings
from api.mcp_client import X3DMcpClient
from api.x3d_adapter import (
    _def_name,
    _dimensions_to_x3d,
    _hex_to_rgb,
    _scale_vec3,
    euler_xyz_to_axis_angle,
    framing_viewpoint,
)

_validation_lock = Lock()


def _numbers(values: Sequence[float]) -> str:
    return " ".join(format(value, ".15g") for value in values)


def serialize_model_spec(spec: ModelSpec) -> tuple[dict[str, str], str]:
    root = ET.Element("X3D", profile="Immersive", version="4.0")
    if spec.scene.title:
        head = ET.SubElement(root, "head")
        ET.SubElement(head, "meta", name="title", content=spec.scene.title)
    scene = ET.SubElement(root, "Scene")
    if spec.scene.background:
        ET.SubElement(scene, "Background", skyColor=_numbers(_hex_to_rgb(spec.scene.background)))
    viewpoint = framing_viewpoint(spec)
    if viewpoint:
        ET.SubElement(scene, "Viewpoint", {
            "position": _numbers(cast(Sequence[float], viewpoint["position"])),
            "orientation": _numbers(cast(Sequence[float], viewpoint["orientation"])),
            "description": "Scene overview",
        })
    names = {}
    node_types = {"box": "Box", "sphere": "Sphere", "cylinder": "Cylinder", "cone": "Cone"}
    for obj in spec.objects:
        name = _def_name(obj.id)
        names[obj.id] = name
        transform = ET.SubElement(scene, "Transform", {
            "DEF": name,
            "translation": _numbers(_scale_vec3(obj.transform.position, spec.scene.displayScale)),
            "rotation": _numbers(euler_xyz_to_axis_angle(obj.transform.rotation)),
            "scale": _numbers(obj.transform.scale),
        })
        shape = ET.SubElement(transform, "Shape")
        appearance = ET.SubElement(shape, "Appearance")
        material = {"diffuseColor": _numbers(_hex_to_rgb(obj.material.color))}
        if obj.material.transparency is not None:
            material["transparency"] = format(obj.material.transparency, ".15g")
        ET.SubElement(appearance, "Material", material)
        dimensions = _dimensions_to_x3d(obj.kind, obj.dimensions, spec.scene.displayScale)
        ET.SubElement(shape, node_types[obj.kind], {
            key: _numbers(value) if isinstance(value, list) else format(value, ".15g")
            for key, value in dimensions.items()
        })
    ET.indent(root)
    return names, ET.tostring(root, encoding="utf-8", xml_declaration=True).decode("utf-8")


class LocalX3DBackend:
    async def build(self, spec: ModelSpec) -> tuple[dict[str, str], str]:
        return await to_thread.run_sync(serialize_model_spec, spec)

    async def validate_x3d(self, content: str, *, encoding: Literal["xml", "json"] = "xml") -> str:
        def validate() -> str:
            with _validation_lock:
                module = import_module("validation.validate")
                result = module.validate_xml(content) if encoding == "xml" else module.validate_json(content)
                return json.dumps(result)
        return await to_thread.run_sync(validate)

    async def validate_semantic(self, content: str) -> str:
        def validate() -> str:
            with _validation_lock:
                return str(import_module("validation.semantic").validate_semantic(content))
        return await to_thread.run_sync(validate)

    async def autofix_x3d(self, content: str) -> str:
        def fix() -> str:
            with _validation_lock:
                return json.dumps(import_module("validation.autofix").autofix_containerfields(content))
        return await to_thread.run_sync(fix)

    async def generate_x3dom_page(self, content: str, *, title: str = "X3D Preview") -> str:
        def render() -> str:
            scene = import_module("tools.render")._extract_scene_content(content)
            return f'''<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>{escape(title)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="https://www.x3dom.org/download/1.8.2/x3dom.css">
<script src="https://www.x3dom.org/download/1.8.2/x3dom.js"></script>
<style>html,body{{margin:0;width:100%;height:100%;overflow:hidden;background:#edf2f7}}
x3d{{display:block;width:100%;height:100%;border:0}}</style>
</head><body><x3d><scene>{scene}</scene></x3d></body></html>'''
        return await to_thread.run_sync(render)

    async def convert_x3d(
        self, content: str, *, from_encoding: Literal["xml"], to_encoding: Literal["json", "vrml"]
    ) -> str:
        def convert() -> str:
            model = import_module("tools.convert")._parse_xml_to_model(content)
            if to_encoding == "json":
                return str(model.JSON())
            return str(model.VRML()).replace("#VRML V", "#X3D V", 1)
        return await to_thread.run_sync(convert)


X3DBackend = LocalX3DBackend | X3DMcpClient


@asynccontextmanager
async def connect_x3d(settings: Settings) -> AsyncIterator[X3DBackend]:
    if settings.x3d_backend == "local":
        yield LocalX3DBackend()
    else:
        async with X3DMcpClient.connect(str(settings.mcp_base_url), settings.mcp_request_timeout_seconds) as client:
            yield client
