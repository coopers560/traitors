# Game join codes: unique 5-char codes, case-insensitive lookup, per-game isolation, removed legacy routes
import re
import pytest
from test_traitors_game import API, S, G, mk_players, pin_of, del_game

CODE_RE = re.compile(r"^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$")
CREATED = []


def create(n=5):
    r = S.post(f"{API}/games", json={"players": mk_players(n)})
    assert r.status_code == 200, r.text
    g = r.json()
    CREATED.append(g["code"])
    return g


def roles_of(code, g):
    return {p["id"]: S.post(f"{G(code)}/private", json={"player_id": p["id"], "pin": pin_of(p["name"])}).json()["role"] for p in g["players"]}


def run_setup_and_day1(code, g):
    """Traitor picks victim, everyone sees role, advance to roundtable, everyone votes, reveal."""
    roles = roles_of(code, g)
    ps = g["players"]
    tr = [p for p in ps if roles[p["id"]] == "traitor"]
    fa = [p for p in ps if roles[p["id"]] == "faithful"]
    r = S.post(f"{G(code)}/turn", json={"player_id": tr[0]["id"], "pin": pin_of(tr[0]["name"]), "target_id": fa[0]["id"]})
    assert r.status_code == 200, r.text
    action = r.json()["action"]
    for p in ps:
        S.post(f"{G(code)}/turn", json={"player_id": p["id"], "pin": pin_of(p["name"])})
    assert S.post(f"{G(code)}/advance?expected=setup&expected_day=1").json()["phase"] == "day"
    assert S.post(f"{G(code)}/advance?expected=day&expected_day=1").json()["phase"] == "roundtable"
    for p in ps:
        tgt = fa[1] if p["id"] != fa[1]["id"] else fa[2]
        body = {"player_id": p["id"], "pin": pin_of(p["name"]), "vote_target_id": tgt["id"]}
        if roles[p["id"]] == "traitor":
            body["murder_done"] = True
        assert S.post(f"{G(code)}/turn", json=body).status_code == 200
    res = S.post(f"{G(code)}/advance?expected=roundtable&expected_day=1").json()
    assert res["phase"] == "reveal"
    return action, res


@pytest.fixture(scope="module", autouse=True)
def cleanup():
    yield
    for c in CREATED:
        del_game(c)


class TestCodes:
    def test_code_format_and_unique(self):
        codes = [create()["code"] for _ in range(6)]
        assert all(CODE_RE.match(c) for c in codes), codes
        assert len(set(codes)) == len(codes)

    def test_case_insensitive_lookup(self):
        g = create()
        r = S.get(G(g["code"].lower()))
        assert r.status_code == 200 and r.json()["code"] == g["code"]
        r = S.get(G(" " + g["code"].lower() + " "))
        assert r.status_code == 200
        # private + actions also work lowercase
        p = g["players"][0]
        assert S.post(f"{G(g['code'].lower())}/private", json={"player_id": p["id"], "pin": pin_of(p["name"])}).status_code == 200
        assert S.get(f"{G(g['code'].lower())}/actions").status_code == 200

    def test_unknown_code_404(self):
        for path, m in [("", "get"), ("/actions", "get"), ("/advance", "post")]:
            r = getattr(S, m)(f"{API}/games/ZZZZ9{path}")
            assert r.status_code == 404 and r.json()["detail"] == "No game found with that code", (path, r.text)
        r = S.post(f"{API}/games/ZZZZ9/private", json={"player_id": "x", "pin": "0001"})
        assert r.status_code == 404 and r.json()["detail"] == "No game found with that code"
        r = S.post(f"{API}/games/ZZZZ9/turn", json={"player_id": "x", "pin": "0001"})
        assert r.status_code == 404
        r = S.put(f"{API}/games/ZZZZ9/actions", json={"actions": ["a", "b", "c"]})
        assert r.status_code == 404

    def test_legacy_routes_gone(self):
        assert S.get(f"{API}/game").status_code in (404, 405)
        assert S.get(f"{API}/actions").status_code in (404, 405)
        assert S.post(f"{API}/game", json={"players": mk_players(5)}).status_code in (404, 405)


class TestIsolation:
    def test_players_and_turns_separate(self):
        a, b = create(5), create(6)
        assert len(S.get(G(a["code"])).json()["players"]) == 5
        assert len(S.get(G(b["code"])).json()["players"]) == 6
        pa = a["players"][0]
        # player id from game A is unknown in game B
        r = S.post(f"{G(b['code'])}/private", json={"player_id": pa["id"], "pin": pin_of(pa["name"])})
        assert r.status_code == 404 and r.json()["detail"] == "Player not found"
        r = S.post(f"{G(b['code'])}/turn", json={"player_id": pa["id"], "pin": pin_of(pa["name"])})
        assert r.status_code == 404
        # turns in A do not affect B
        S.post(f"{G(a['code'])}/turn", json={"player_id": pa["id"], "pin": pin_of(pa["name"])})
        assert S.get(G(a["code"])).json()["turns_done"] >= 0
        assert S.get(G(b["code"])).json()["turns_done"] == 0

    def test_actions_per_game_and_used_in_murder(self):
        a, b = create(5), create(5)
        custom = ["TEST_Iso One", "TEST_Iso Two", "TEST_Iso Three"]
        r = S.put(f"{G(a['code'])}/actions", json={"actions": custom})
        assert r.status_code == 200 and r.json()["actions"] == custom and r.json()["is_default"] is False
        assert S.get(f"{G(b['code'])}/actions").json()["is_default"] is True
        act_a, _ = run_setup_and_day1(a["code"], a)
        act_b, _ = run_setup_and_day1(b["code"], b)
        assert act_a in custom
        assert act_b not in custom
        # reset only A
        assert S.delete(f"{G(a['code'])}/actions").json()["is_default"] is True

    def test_delete_one_game_keeps_other(self):
        a, b = create(), create()
        assert del_game(a["code"].lower()).json() == {"exists": False}
        assert S.get(G(a["code"])).status_code == 404
        assert S.get(G(b["code"])).status_code == 200
