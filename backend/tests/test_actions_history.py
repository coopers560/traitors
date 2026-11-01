# Custom murder actions (GET/PUT/DELETE /api/actions) + history usage tests
import pytest
from test_traitors_game import API, S, setup_game, pin_of, private

CUSTOM = ["TEST_Act Alpha", "TEST_Act Beta", "TEST_Act Gamma"]


@pytest.fixture(scope="module", autouse=True)
def reset_after():
    S.delete(f"{API}/actions")
    yield
    S.delete(f"{API}/actions")
    S.delete(f"{API}/game")


# ---- Actions CRUD ----
class TestActions:
    def test_defaults(self):
        r = S.get(f"{API}/actions")
        assert r.status_code == 200
        d = r.json()
        assert d["is_default"] is True and len(d["actions"]) == 26
        assert "Hand them a bottle of water" in d["actions"]

    def test_put_trims_and_dedupes(self):
        r = S.put(f"{API}/actions", json={"actions": ["  TEST_Act Alpha ", "test_act alpha", "TEST_Act Beta", "", "   ", "TEST_Act Gamma", "TEST_ACT BETA"]})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["actions"] == CUSTOM and d["is_default"] is False
        g = S.get(f"{API}/actions").json()
        assert g["actions"] == CUSTOM and g["is_default"] is False

    def test_put_min_three(self):
        r = S.put(f"{API}/actions", json={"actions": ["A one", "a ONE", "B two", "  "]})
        assert r.status_code == 400
        assert "at least 3" in r.json()["detail"]
        # unchanged
        assert S.get(f"{API}/actions").json()["actions"] == CUSTOM

    def test_put_too_long_dropped(self):
        r = S.put(f"{API}/actions", json={"actions": CUSTOM + ["x" * 121]})
        assert r.status_code == 200 and r.json()["actions"] == CUSTOM

    def test_custom_actions_used_in_game(self):
        S.put(f"{API}/actions", json={"actions": CUSTOM})
        g, roles = setup_game(5)
        ps = g["players"]
        tr = next(p for p in ps if roles[p["id"]] == "traitor")
        fa = [p for p in ps if roles[p["id"]] == "faithful"]
        r = S.post(f"{API}/game/turn", json={"player_id": tr["id"], "pin": pin_of(tr["name"]), "target_id": fa[0]["id"]})
        assert r.status_code == 200 and r.json()["action"] in CUSTOM
        first_action = r.json()["action"]
        for p in ps:
            if p["id"] != tr["id"]:
                S.post(f"{API}/game/turn", json={"player_id": p["id"], "pin": pin_of(p["name"])})
        assert S.post(f"{API}/game/advance").json()["phase"] == "day"
        assert S.post(f"{API}/game/advance").json()["phase"] == "roundtable"
        for p in ps:
            body = {"player_id": p["id"], "pin": pin_of(p["name"]),
                    "vote_target_id": fa[1]["id"] if p["id"] != fa[1]["id"] else fa[2]["id"]}
            if p["id"] == tr["id"]:
                body.update({"murder_done": True, "target_id": fa[3]["id"]})
            assert S.post(f"{API}/game/turn", json=body).status_code == 200
        v = private(tr["id"], pin_of(tr["name"])).json()
        assert v["next_action"] in CUSTOM and v["next_action"] != first_action
        r = S.post(f"{API}/game/advance").json()
        h = r["history"][-1]
        # history contains murder action + banishment tally
        assert h["day"] == 1 and h["murder"]["success"] and h["murder"]["action"] == first_action
        assert h["murder"]["victim_name"] == fa[0]["name"]
        assert h["banish"]["name"] == fa[1]["name"] and h["banish"]["tally"][0]["votes"] == 4
        r = S.post(f"{API}/game/advance").json()
        assert r["day"] == 2 and r["phase"] == "day"
        v = private(tr["id"], pin_of(tr["name"])).json()
        assert v["action"] in CUSTOM and v["target"]["id"] == fa[3]["id"]

    def test_reset(self):
        r = S.delete(f"{API}/actions")
        assert r.status_code == 200 and r.json()["is_default"] is True
        g = S.get(f"{API}/actions").json()
        assert g["is_default"] is True and len(g["actions"]) == 26
