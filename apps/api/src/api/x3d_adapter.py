"""ModelSpec -> X3D primitive adapter (PRD FR-12, FR-38, §10.6, Issue #9).

`apply_model_spec` rebuilds an `X3DMcpClient` session's scene from scratch to
match a `ModelSpec`, one `create_primitive` tool call per object. The LLM
never sees or produces X3D/XML -- only this module (and `X3DMcpClient`, which
it delegates to) knows the X3D node/field shapes involved (FR-12, NFR-08).

Two conversions are not 1:1 with the ModelSpec fields, and are the reason this
module exists rather than passing ModelSpec straight to `create_primitive`:

- `ModelObject.dimensions` keys are kind-specific by convention (see
  `packages/domain/README.md`) and mostly already match X3D field names
  (`radius`, `height`, `bottomRadius`) -- except `box`, whose three separate
  `width`/`height`/`depth` keys must be combined into X3D `Box.size`, a single
  SFVec3f. `scene.displayScale` (PRD §3.10, §10.6: "positions in semantic
  project units before displayScale") is applied to dimensions and position,
  not to `transform.scale`, which is already a unitless multiplier.
- `ModelObject.transform.rotation` is three per-axis radian values (see
  `domain.model_plan`'s `rotate_object` docstring), not X3D's SFRotation
  axis-angle. It is interpreted as intrinsic rotations applied in X, then Y,
  then Z order and composed into one SFRotation via quaternion multiplication.
"""

from __future__ import annotations

import math

from domain.model_spec import ModelSpec, PrimitiveKind, Vec3

from api.mcp_client import X3DMcpClient

AxisAngle = tuple[float, float, float, float]

_DEF_PREFIX = "obj_"
_DEFAULT_AXIS_ANGLE: AxisAngle = (0.0, 0.0, 1.0, 0.0)
_ZERO_ROTATION_EPSILON = 1e-9


async def apply_model_spec(client: X3DMcpClient, spec: ModelSpec) -> dict[str, str]:
    """Resets `client`'s scene and recreates every object in `spec`.

    Returns the `ModelObject.id` -> X3D DEF name mapping each primitive was
    created with, so callers can correlate ModelSpec objects with X3D nodes.
    """
    await client.reset_scene()

    def_names: dict[str, str] = {}
    for obj in spec.objects:
        def_name = _def_name(obj.id)
        await client.create_primitive(
            obj.kind,
            _dimensions_to_x3d(obj.kind, obj.dimensions, spec.scene.displayScale),
            translation=_scale_vec3(obj.transform.position, spec.scene.displayScale),
            rotation=euler_xyz_to_axis_angle(obj.transform.rotation),
            scale=obj.transform.scale,
            color=_hex_to_rgb(obj.material.color),
            transparency=obj.material.transparency,
            def_name=def_name,
        )
        def_names[obj.id] = def_name

    return def_names


def _def_name(object_id: str) -> str:
    """`ModelObject.id` allows characters/leading digits an X3D DEF (NCName) does not."""
    return f"{_DEF_PREFIX}{object_id}"


def _scale_vec3(vector: Vec3, factor: float) -> Vec3:
    return (vector[0] * factor, vector[1] * factor, vector[2] * factor)


def _dimensions_to_x3d(
    kind: PrimitiveKind, dimensions: dict[str, float], display_scale: float
) -> dict[str, float | list[float]]:
    if kind == "box":
        return {
            "size": [
                dimensions["width"] * display_scale,
                dimensions["height"] * display_scale,
                dimensions["depth"] * display_scale,
            ]
        }
    if kind == "sphere":
        return {"radius": dimensions["radius"] * display_scale}
    if kind == "cylinder":
        return {
            "radius": dimensions["radius"] * display_scale,
            "height": dimensions["height"] * display_scale,
        }
    return {
        "bottomRadius": dimensions["bottomRadius"] * display_scale,
        "height": dimensions["height"] * display_scale,
    }


def _hex_to_rgb(color: str) -> tuple[float, float, float]:
    """Converts a normalized `#rrggbb` color (see `domain.model_spec.Material`) to 0-1 RGB floats."""
    return (
        int(color[1:3], 16) / 255.0,
        int(color[3:5], 16) / 255.0,
        int(color[5:7], 16) / 255.0,
    )


def euler_xyz_to_axis_angle(rotation: Vec3) -> AxisAngle:
    """Converts per-axis radians (X, then Y, then Z) to one X3D SFRotation (axis + angle)."""
    rx, ry, rz = rotation
    if rx == 0.0 and ry == 0.0 and rz == 0.0:
        return _DEFAULT_AXIS_ANGLE

    qx = _axis_quaternion((1.0, 0.0, 0.0), rx)
    qy = _axis_quaternion((0.0, 1.0, 0.0), ry)
    qz = _axis_quaternion((0.0, 0.0, 1.0), rz)
    w, x, y, z = _quaternion_multiply(_quaternion_multiply(qz, qy), qx)

    w = max(-1.0, min(1.0, w))
    sin_half_angle = math.sqrt(max(0.0, 1.0 - w * w))
    if sin_half_angle < _ZERO_ROTATION_EPSILON:
        return _DEFAULT_AXIS_ANGLE

    angle = 2.0 * math.acos(w)
    return (x / sin_half_angle, y / sin_half_angle, z / sin_half_angle, angle)


Quaternion = tuple[float, float, float, float]


def _axis_quaternion(axis: Vec3, angle: float) -> Quaternion:
    half_angle = angle / 2.0
    s = math.sin(half_angle)
    return (math.cos(half_angle), axis[0] * s, axis[1] * s, axis[2] * s)


def _quaternion_multiply(a: Quaternion, b: Quaternion) -> Quaternion:
    aw, ax, ay, az = a
    bw, bx, by, bz = b
    return (
        aw * bw - ax * bx - ay * by - az * bz,
        aw * bx + ax * bw + ay * bz - az * by,
        aw * by - ax * bz + ay * bw + az * bx,
        aw * bz + ax * by - ay * bx + az * bw,
    )
