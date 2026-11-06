"""Vendor a small, pinned CC0 KayKit collection and retain only the clips used in play.

Run from the repository root with Python 3.12+. No third-party packages required.
The generated GLBs are self-contained and are served locally, never from a game-time CDN.
"""
from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path
import struct
from urllib.parse import urljoin
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "apps/web/public/models/kaykit"
PACKS = {
    "adventurers": ("KayKit-Character-Pack-Adventures-1.0", "672074b73ba276876a19e8816ecdc5241817ab47"),
    "medieval": ("KayKit-Medieval-Hexagon-Pack-1.0", "84fa4e91af6a88989be7c99e0891cede11f2ca38"),
    "skeletons": ("KayKit-Character-Pack-Skeletons-1.0", "15b62b9bad122f72926c10fb14d622c73819fa54"),
    "dungeon": ("KayKit-Dungeon-Remastered-1.0", "b0ca9bd96a8072ab36a3a5464f00ed1e06a16d07"),
}
CLIPS = {
    "Idle", "Walking_A", "Running_A", "Jump_Start", "Jump_Idle", "Jump_Land", "Death_A", "Hit_A",
    "1H_Melee_Attack_Chop", "1H_Melee_Attack_Slice_Diagonal", "1H_Melee_Attack_Slice_Horizontal",
    "1H_Ranged_Shoot", "Dodge_Forward", "Interact", "Cheer", "Sit_Chair_Idle", "Lie_Idle", "Spellcast_Shoot",
}


def read(url: str) -> bytes:
    cached = ROOT / ".cache/game-assets/downloads" / hashlib.sha256(url.encode()).hexdigest()
    if not cached.exists():
        cached.parent.mkdir(parents=True, exist_ok=True)
        with urlopen(url, timeout=30) as response:
            cached.write_bytes(response.read())
    return cached.read_bytes()


def pack_glb(data: dict, binary: bytes) -> bytes:
    # Compact accessors and buffer views after removing unused animation clips.
    references: list[tuple[dict, str | int]] = []
    for mesh in data.get("meshes", []):
        for primitive in mesh["primitives"]:
            references.extend((primitive["attributes"], key) for key in primitive["attributes"])
            if "indices" in primitive:
                references.append((primitive, "indices"))
            for target in primitive.get("targets", []):
                references.extend((target, key) for key in target)
    references.extend((skin, "inverseBindMatrices") for skin in data.get("skins", []) if "inverseBindMatrices" in skin)
    for animation in data.get("animations", []):
        for sampler in animation["samplers"]:
            references.extend([(sampler, "input"), (sampler, "output")])
    used = sorted({container[key] for container, key in references})
    remap = {old: new for new, old in enumerate(used)}
    accessors = [copy.deepcopy(data["accessors"][old]) for old in used]
    for container, key in references:
        container[key] = remap[container[key]]
    views = []
    for accessor in accessors:
        if "bufferView" in accessor:
            views.append((accessor, "bufferView"))
        if "sparse" in accessor:
            views.extend((accessor["sparse"][part], "bufferView") for part in ["indices", "values"])
    views.extend((image, "bufferView") for image in data.get("images", []) if "bufferView" in image)
    used_views = sorted({container[key] for container, key in views})
    view_remap = {old: new for new, old in enumerate(used_views)}
    compact = bytearray()
    new_views = []
    for old in used_views:
        view = copy.deepcopy(data["bufferViews"][old])
        offset, length = view.get("byteOffset", 0), view["byteLength"]
        compact.extend(b"\0" * (-len(compact) % 4))
        view.update(buffer=0, byteOffset=len(compact))
        compact.extend(binary[offset:offset + length])
        new_views.append(view)
    for container, key in views:
        container[key] = view_remap[container[key]]
    data.update(accessors=accessors, bufferViews=new_views, buffers=[{"byteLength": len(compact)}])
    text = json.dumps(data, separators=(",", ":")).encode()
    text += b" " * (-len(text) % 4)
    compact.extend(b"\0" * (-len(compact) % 4))
    return struct.pack("<III", 0x46546C67, 2, 28 + len(text) + len(compact)) + struct.pack("<II", len(text), 0x4E4F534A) + text + struct.pack("<II", len(compact), 0x004E4942) + compact


def vendor(pack: str, path: str, name: str) -> dict:
    repository, commit = PACKS[pack]
    base = f"https://raw.githubusercontent.com/KayKit-Game-Assets/{repository}/{commit}/"
    url = base + path
    original = read(url)
    if path.endswith(".glb"):
        length = struct.unpack_from("<I", original, 12)[0]
        data = json.loads(original[20:20 + length])
        binary = original[28 + length:]
        data["animations"] = [clip for clip in data.get("animations", []) if clip.get("name") in CLIPS]
    else:
        data = json.loads(original)
        assert len(data["buffers"]) == 1
        binary = read(urljoin(url, data["buffers"][0].pop("uri")))
        for image in data.get("images", []):
            if "uri" not in image:
                continue
            image_data = read(urljoin(url, image.pop("uri")))
            binary += b"\0" * (-len(binary) % 4)
            image["bufferView"] = len(data["bufferViews"])
            image["mimeType"] = "image/png"
            data["bufferViews"].append({"buffer": 0, "byteOffset": len(binary), "byteLength": len(image_data)})
            binary += image_data
    output = pack_glb(data, binary)
    OUTPUT.mkdir(parents=True, exist_ok=True)
    (OUTPUT / f"{name}.glb").write_bytes(output)
    (OUTPUT / f"LICENSE-{pack}.txt").write_bytes(read(base + "LICENSE.txt"))
    print(f"{name}: {len(output):,} bytes")
    return {"id": name, "file": f"{name}.glb", "source": f"https://github.com/KayKit-Game-Assets/{repository}/blob/{commit}/{path}", "license": "CC0-1.0", "author": "Kay Lousberg", "bytes": len(output), "sha256": hashlib.sha256(output).hexdigest(), "clips": [clip["name"] for clip in data.get("animations", [])]}


def main() -> None:
    assets = []
    for name in ["Knight", "Rogue", "Mage", "Barbarian", "Rogue_Hooded"]:
        assets.append(vendor("adventurers", f"addons/kaykit_character_pack_adventures/Characters/gltf/{name}.glb", name.lower()))
    for name in ["sword_1handed", "axe_1handed", "staff"]:
        assets.append(vendor("adventurers", f"addons/kaykit_character_pack_adventures/Assets/gltf/{name}.gltf", name))
    for name in ["hill_single_A", "rock_single_A", "tree_single_A"]:
        assets.append(vendor("medieval", f"addons/kaykit_medieval_hexagon_pack/Assets/gltf/decoration/nature/{name}.gltf", name.lower()))
    for name in ["Skeleton_Warrior", "Skeleton_Minion", "Skeleton_Rogue", "Skeleton_Mage"]:
        assets.append(vendor("skeletons", f"addons/kaykit_character_pack_skeletons/Characters/gltf/{name}.glb", name.lower()))
    for name in ["wall", "wall_pillar", "floor_tile_large", "barrel_large", "pillar", "pillar_decorated", "chest", "torch"]:
        # Dungeon filenames are checked against the pinned source tree by the catalogue script.
        path = f"addons/kaykit_dungeon_remastered/Assets/gltf/{name}{'.glb' if name == 'chest' else '.gltf.glb'}"
        try:
            assets.append(vendor("dungeon", path, f"dungeon_{name}"))
        except Exception as error:
            raise RuntimeError(f"Cannot vendor required dungeon model {path}") from error
    (OUTPUT / "manifest.json").write_text(json.dumps(assets, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
