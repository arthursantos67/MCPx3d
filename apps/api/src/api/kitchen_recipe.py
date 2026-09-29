"""Validated, reusable Web3D kitchen assembled from explicit visible parts."""

from __future__ import annotations

from domain.model_plan import ModelPlan


def _box(
    object_id: str, name: str, width: float, height: float, depth: float,
    x: float, y: float, z: float, color: str, group: str,
) -> dict[str, object]:
    return {
        "op": "create_object", "id": object_id, "name": name, "kind": "box",
        "dimensions": {"width": width, "height": height, "depth": depth},
        "position": [x, y, z], "color": color, "tags": ["kitchen", group],
    }


def _cylinder(
    object_id: str, name: str, radius: float, height: float,
    x: float, y: float, z: float, color: str, group: str,
) -> dict[str, object]:
    return {
        "op": "create_object", "id": object_id, "name": name, "kind": "cylinder",
        "dimensions": {"radius": radius, "height": height},
        "position": [x, y, z], "color": color, "tags": ["kitchen", group],
    }


def _cone(
    object_id: str, name: str, radius: float, height: float,
    x: float, y: float, z: float, color: str, group: str,
) -> dict[str, object]:
    return {
        "op": "create_object", "id": object_id, "name": name, "kind": "cone",
        "dimensions": {"bottomRadius": radius, "height": height},
        "position": [x, y, z], "color": color, "tags": ["kitchen", group],
    }


def _sphere(
    object_id: str, name: str, radius: float,
    x: float, y: float, z: float, color: str, group: str,
) -> dict[str, object]:
    return {
        "op": "create_object", "id": object_id, "name": name, "kind": "sphere",
        "dimensions": {"radius": radius}, "position": [x, y, z],
        "color": color, "tags": ["kitchen", group],
    }


def built_in_kitchen_plan() -> ModelPlan:
    cabinet = "#e7e3dc"
    door = "#f4f1eb"
    metal = "#aeb4b8"
    dark = "#343a40"
    wood = "#9c704a"
    operations: list[dict[str, object]] = [
        # Refrigerator: doors and handles sit on its exterior front face.
        _box("fridge_body", "Geladeira corpo", 600, 1850, 650, -1300, 925, -25, "#d6dade", "fridge"),
        _box("fridge_lower_door", "Geladeira porta inferior", 580, 900, 25, -1300, 450, 312.5, "#eef1f2", "fridge"),
        _box("fridge_upper_door", "Geladeira porta superior", 580, 900, 25, -1300, 1390, 312.5, "#eef1f2", "fridge"),
        _box("fridge_lower_handle", "Puxador inferior da geladeira", 22, 260, 30, -1050, 500, 340, metal, "fridge"),
        _box("fridge_upper_handle", "Puxador superior da geladeira", 22, 260, 30, -1050, 1450, 340, metal, "fridge"),

        # Base cabinet modules leave a real open bay beneath the sink.
        _box("base_left", "Armario inferior esquerdo", 350, 860, 600, -775, 430, 0, cabinet, "cabinet"),
        _box("base_middle", "Armario inferior central", 650, 860, 600, 125, 430, 0, cabinet, "cabinet"),
        _box("stove_body", "Fogao e forno corpo", 500, 860, 600, 700, 430, 0, "#c5c9c9", "stove"),
        _box("base_right", "Armario inferior direito", 200, 860, 600, 1050, 430, 0, cabinet, "cabinet"),
        _box("base_left_door", "Porta armario esquerdo", 330, 820, 30, -775, 420, 315, door, "cabinet"),
        _box("sink_door_left", "Porta esquerda sob pia", 190, 820, 30, -500, 420, 315, door, "sink"),
        _box("sink_door_right", "Porta direita sob pia", 190, 820, 30, -300, 420, 315, door, "sink"),
        _box("base_middle_door_left", "Porta central esquerda", 305, 820, 30, -37.5, 420, 315, door, "cabinet"),
        _box("base_middle_door_right", "Porta central direita", 305, 820, 30, 287.5, 420, 315, door, "cabinet"),
        _box("base_right_door", "Porta armario direito", 180, 820, 30, 1050, 420, 315, door, "cabinet"),
        _box("base_left_handle", "Puxador armario esquerdo", 18, 110, 25, -640, 625, 342.5, metal, "cabinet"),
        _box("sink_handle_left", "Puxador esquerdo sob pia", 18, 110, 25, -420, 625, 342.5, metal, "sink"),
        _box("sink_handle_right", "Puxador direito sob pia", 18, 110, 25, -380, 625, 342.5, metal, "sink"),
        _box("base_middle_handle_left", "Puxador central esquerdo", 18, 110, 25, 100, 625, 342.5, metal, "cabinet"),
        _box("base_middle_handle_right", "Puxador central direito", 18, 110, 25, 150, 625, 342.5, metal, "cabinet"),
        _box("base_right_handle", "Puxador armario direito", 18, 110, 25, 1100, 625, 342.5, metal, "cabinet"),

        # Four countertop segments leave an opening; basin floor is 190 mm below the top.
        _box("counter_left", "Bancada esquerda", 350, 40, 650, -775, 880, 0, dark, "counter"),
        _box("counter_right", "Bancada direita", 1350, 40, 650, 475, 880, 0, dark, "counter"),
        _box("counter_sink_front", "Borda dianteira da pia", 400, 40, 150, -400, 880, 250, dark, "sink"),
        _box("counter_sink_back", "Borda traseira da pia", 400, 40, 150, -400, 880, -250, dark, "sink"),
        _box("basin_floor", "Fundo rebaixado da cuba", 380, 20, 330, -400, 700, 0, "#555f65", "sink"),
        _box("basin_left", "Parede esquerda da cuba", 10, 150, 350, -595, 785, 0, metal, "sink"),
        _box("basin_right", "Parede direita da cuba", 10, 150, 350, -205, 785, 0, metal, "sink"),
        _box("basin_front", "Parede dianteira da cuba", 380, 150, 10, -400, 785, 170, metal, "sink"),
        _box("basin_back", "Parede traseira da cuba", 380, 150, 10, -400, 785, -170, metal, "sink"),
        _cylinder("faucet_base", "Base da torneira", 18, 30, -400, 915, -250, metal, "sink"),
        _cylinder("faucet_riser", "Coluna da torneira", 9, 300, -400, 1080, -250, metal, "sink"),
        _box("faucet_spout", "Bica da torneira", 18, 18, 250, -400, 1239, -125, metal, "sink"),

        # Stove and hood share the same X/Z axis; both are distinct from pendant lamps.
        _box("cooktop", "Mesa do fogao", 450, 20, 430, 700, 910, 0, "#171b1e", "stove"),
        _cylinder("burner_front_left", "Queimador dianteiro esquerdo", 42, 12, 585, 926, 105, dark, "stove"),
        _cylinder("burner_front_right", "Queimador dianteiro direito", 42, 12, 815, 926, 105, dark, "stove"),
        _cylinder("burner_back_left", "Queimador traseiro esquerdo", 42, 12, 585, 926, -105, dark, "stove"),
        _cylinder("burner_back_right", "Queimador traseiro direito", 42, 12, 815, 926, -105, dark, "stove"),
        _box("oven_door", "Porta do forno", 450, 560, 30, 700, 400, 315, "#292d30", "stove"),
        _box("oven_window", "Vidro do forno", 350, 220, 10, 700, 430, 335, "#526a7d", "stove"),
        _box("oven_handle", "Puxador do forno", 300, 20, 25, 700, 615, 342.5, metal, "stove"),
        _box("stove_control_bar", "Painel do fogao", 450, 80, 20, 700, 790, 310, "#9da3a5", "stove"),
        _sphere("stove_knob_1", "Botao do fogao 1", 14, 550, 790, 334, dark, "stove"),
        _sphere("stove_knob_2", "Botao do fogao 2", 14, 650, 790, 334, dark, "stove"),
        _sphere("stove_knob_3", "Botao do fogao 3", 14, 750, 790, 334, dark, "stove"),
        _sphere("stove_knob_4", "Botao do fogao 4", 14, 850, 790, 334, dark, "stove"),
        _cone("hood_canopy", "Coifa sobre fogao", 220, 220, 700, 1850, 0, metal, "hood"),
        _box("hood_duct", "Duto da coifa", 140, 640, 140, 700, 2280, 0, metal, "hood"),

        _box("upper_cabinet", "Armario aereo", 950, 700, 300, -475, 1850, -150, cabinet, "cabinet"),
        _box("upper_door_left", "Porta aerea esquerda", 470, 680, 25, -715, 1850, 12.5, door, "cabinet"),
        _box("upper_door_right", "Porta aerea direita", 470, 680, 25, -235, 1850, 12.5, door, "cabinet"),
        _box("upper_handle_left", "Puxador aereo esquerdo", 18, 130, 25, -510, 1800, 37.5, metal, "cabinet"),
        _box("upper_handle_right", "Puxador aereo direito", 18, 130, 25, -440, 1800, 37.5, metal, "cabinet"),

        # Island creates a separate working zone for two pendant lamps.
        _box("island_body", "Ilha corpo", 1000, 840, 500, 0, 420, 1300, "#d7c3a9", "island"),
        _box("island_top", "Ilha tampo", 1200, 60, 700, 0, 870, 1300, wood, "island"),
        _box("island_door_left", "Ilha porta esquerda", 440, 800, 30, -230, 410, 1565, "#e6d7c0", "island"),
        _box("island_door_right", "Ilha porta direita", 440, 800, 30, 230, 410, 1565, "#e6d7c0", "island"),
        _box("island_handle_left", "Ilha puxador esquerdo", 110, 18, 25, -230, 700, 1592.5, metal, "island"),
        _box("island_handle_right", "Ilha puxador direito", 110, 18, 25, 230, 700, 1592.5, metal, "island"),
    ]
    for side, x in (("left", -300), ("right", 300)):
        operations.extend([
            _cylinder(f"pendant_{side}_cord", f"Lustre {side} cabo", 5, 520, x, 2340, 1300, dark, "pendant"),
            _cone(f"pendant_{side}_shade", f"Lustre {side} cupula", 135, 180, x, 1990, 1300, "#cfad66", "pendant"),
            _cylinder(f"pendant_{side}_bulb", f"Lustre {side} lampada", 28, 35, x, 1882.5, 1300, "#f6e6a8", "pendant"),
        ])
    operations.append({"op": "set_scene_title", "title": "Cozinha completa"})
    return ModelPlan.model_validate({"intent": "create_detailed_kitchen_from_recipe", "operations": operations})
