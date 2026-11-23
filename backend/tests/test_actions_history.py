# Custom murder actions (GET/PUT/DELETE /api/games/{code}/actions) + history usage tests
import pytest
from test_traitors_game import API, S, G, setup_game, setup_game_traitors, pin_of, private, del_game

CUSTOM = ["TEST_Act Alpha", "TEST_Act Beta", "TEST_Act Gamma"]


@pytest.fixture(scope="module", autouse=True)
def reset_after():
    setup_game(5)
    yield
    S.delete(f"{G()}/actions")
    del_game()


# ---- Actions CRUD ----
class TestActions:
    def test_defaults(self):
        r = S.get(f"{G()}/actions")
        assert r.status_code == 200
        d = r.json()
        assert d["is_default"] is True and len(d["actions"]) == 47
        assert "Offer them some sun cream" in d["actions"]

    def test_put_trims_and_dedupes(self):
        r = S.put(f"{G()}/actions", json={"actions": ["  TEST_Act Alpha ", "test_act alpha", "TEST_Act Beta", "", "   ", "TEST_Act Gamma", "TEST_ACT BETA"]})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["actions"] == CUSTOM and d["is_default"] is False
        g = S.get(f"{G()}/actions").json()
        assert g["actions"] == CUSTOM and g["is_default"] is False

    def test_put_min_three(self):
        r = S.put(f"{G()}/actions", json={"actions": ["A one", "a ONE", "B two", "  "]})
        assert r.status_code == 400
        assert "at least 3" in r.json()["detail"]
        # unchanged
        assert S.get(f"{G()}/actions").json()["actions"] == CUSTOM

    def test_put_too_long_dropped(self):
        r = S.put(f"{G()}/actions", json={"actions": CUSTOM + ["x" * 121]})
        assert r.status_code == 200 and r.json()["actions"] == CUSTOM

    def test_custom_actions_used_in_game(self):
        g, roles = setup_game_traitors(6, 1)
        assert S.get(f"{G()}/actions").json()["is_default"] is True  # new game starts with defaults
        S.put(f"{G()}/actions", json={"actions": CUSTOM})
        ps = g["players"]
        tr = next(p for p in ps if roles[p["id"]] == "traitor")
        fa = [p for p in ps if roles[p["id"]] == "faithful"]
        # see roles, advance to the night (the Traitors move before the Round Table)
        for p in ps:
            S.post(f"{G()}/turn", json={"player_id": p["id"], "pin": pin_of(p["name"])})
        assert S.post(f"{G()}/advance").json()["phase"] == "day"
        assert S.post(f"{G()}/advance").json()["phase"] == "night"
        # the traitor is offered a choice of three custom actions and confirms one
        r = S.post(f"{G()}/turn", json={"player_id": tr["id"], "pin": pin_of(tr["name"]), "target_id": fa[0]["id"]})
        assert r.status_code == 200 and r.json()["target"]["id"] == fa[0]["id"]
        choices = r.json()["action_choices"]
        assert len(choices) == 3 and all(c in CUSTOM for c in choices)
        assert S.post(f"{G()}/turn", json={"player_id": tr["id"], "pin": pin_of(tr["name"]), "action": choices[0]}).status_code == 200
        for p in ps:
            if p["id"] != tr["id"]:
                assert S.post(f"{G()}/turn", json={"player_id": p["id"], "pin": pin_of(p["name"])}).status_code == 200
        # night -> roundtable; the murder isn't revealed yet and fa[0] still votes
        assert S.post(f"{G()}/advance").json()["phase"] == "roundtable"
        for p in S.get(f"{G()}").json()["players"]:
            if not p["alive"]:
                continue
            body = {"player_id": p["id"], "pin": pin_of(p["name"]), "vote_target_id": fa[1]["id"] if p["id"] != fa[1]["id"] else fa[2]["id"]}
            if p["id"] == tr["id"]:
                body["murder_done"] = True  # the Traitor confirms the murder was carried out
            assert S.post(f"{G()}/turn", json=body).status_code == 200
        r = S.post(f"{G()}/advance").json()
        assert r["phase"] == "banished"
        h = r["history"][-1]
        # the Round Table reveal holds the murder (secret action hidden) and the banishment
        assert h["day"] == 1 and h["murder"]["success"] and "action" not in h["murder"]
        assert h["murder"]["victim_name"] == fa[0]["name"]
        assert h["banish"]["name"] == fa[1]["name"] and h["banish"]["tally"][0]["votes"] == 5
        r = S.post(f"{G()}/advance").json()
        assert r["day"] == 2 and r["phase"] == "day"
        # a fresh day clears the victim and action until the next night
        v = private(tr["id"], pin_of(tr["name"])).json()
        assert v["target"] is None and v["action"] is None

    def test_reset(self):
        r = S.delete(f"{G()}/actions")
        assert r.status_code == 200 and r.json()["is_default"] is True
        g = S.get(f"{G()}/actions").json()
        assert g["is_default"] is True and len(g["actions"]) == 47
