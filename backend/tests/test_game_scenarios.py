from copy import deepcopy

import pytest

from backend.app.game_scenarios import MISSION_DATA, _validate_mission, list_game_missions


def test_catalog_contains_unique_valid_missions():
    missions = list_game_missions()

    assert len(missions) == 15
    assert len({mission["id"] for mission in missions}) == len(missions)
    assert all(mission["startNodeId"] in {node["id"] for node in mission["nodes"]} for mission in missions)


def test_rejects_unknown_next_node():
    mission = deepcopy(MISSION_DATA[0])
    mission["nodes"][0]["choices"][0]["nextNodeId"] = "missing-node"

    with pytest.raises(ValueError, match="invalid nextNodeId"):
        _validate_mission(mission)


def test_rejects_ai_candidates_outside_authored_nodes():
    mission = deepcopy(MISSION_DATA[0])
    mission["nodes"][0]["choices"][0]["possibleNextNodeIds"] = ["invented-node"]

    with pytest.raises(ValueError, match="invalid AI branch candidates"):
        _validate_mission(mission)
