# Traitors game API regression tests (per-game join codes /api/games/{code}; tests run in order)
import os
import pytest
import requests

def _base():
    url = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("EXPO_BACKEND_URL")
    if not url:
        for line in open("/app/frontend/.env"):
            if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
                url = line.split("=", 1)[1].strip().strip('"')
    return url.rstrip("/") + "/api"

API = _base()
S = requests.Session()
STATE = {}
CUR = {"code": None}


def G(code=None):
    """Base URL of the current (or given) game."""
    return f"{API}/games/{code or CUR['code']}"


def mk_players(n):
    return [{"name": f"TEST_P{i}", "pin": f"{i:04d}"} for i in range(1, n + 1)]


def pin_of(name):
    return f"{int(name.split('P')[1]):04d}"


def private(pid, pin):
    return S.post(f"{G()}/private", json={"player_id": pid, "pin": pin})


def finish_setup(ps):
    # everyone (non-traitor already done is harmless) sees their role, then advance setup -> day
    for p in ps:
        S.post(f"{G()}/turn", json={"player_id": p["id"], "pin": pin_of(p["name"])})
    r = S.post(f"{G()}/advance")
    assert r.status_code == 200 and r.json()["phase"] == "day", r.text


def setup_game(n=10):
    if CUR["code"]:
        S.delete(G())  # clean up previous test game
    r = S.post(f"{API}/games", json={"players": mk_players(n)})
    assert r.status_code == 200, r.text
    g = r.json()
    CUR["code"] = g["code"]
    roles = {}
    for p in g["players"]:
        v = private(p["id"], pin_of(p["name"])).json()
        roles[p["id"]] = v["role"]
    return g, roles


# ---- Create validation ----
class TestCreate:
    def test_too_few(self):
        r = S.post(f"{API}/games", json={"players": mk_players(3)})
        assert r.status_code == 400

    def test_too_many(self):
        r = S.post(f"{API}/games", json={"players": mk_players(16)})
        assert r.status_code == 400

    def test_duplicate_names_case_insensitive(self):
        ps = mk_players(4); ps[1]["name"] = "test_p1"
        assert S.post(f"{API}/games", json={"players": ps}).status_code == 400

    def test_bad_pins(self):
        for bad in ["123", "12345", "abcd", ""]:
            ps = mk_players(4); ps[0]["pin"] = bad
            assert S.post(f"{API}/games", json={"players": ps}).status_code == 400, bad

    def test_empty_name(self):
        ps = mk_players(4); ps[0]["name"] = "  "
        assert S.post(f"{API}/games", json={"players": ps}).status_code == 400

    @pytest.mark.parametrize("n,t", [(4, 1), (10, 2), (12, 2), (13, 3), (15, 3)])
    def test_traitor_counts(self, n, t):
        g, roles = setup_game(n)
        assert list(roles.values()).count("traitor") == t
        assert g["phase"] == "setup" and g["day"] == 1 and g["turns_needed"] == n


# ---- Privacy ----
class TestPrivacy:
    def test_get_no_leak(self):
        g, roles = setup_game(10)
        r = S.get(f"{G()}").json()
        txt = str(r)
        assert "pin" not in txt.lower() or "pin_hash" not in txt
        for p in r["players"]:
            assert p["role"] is None
            assert set(p.keys()) == {"id", "name", "lives", "alive", "role", "turn_done"}
        assert "target_id" not in r and "action" not in r

    def test_wrong_pin_401(self):
        g = S.get(f"{G()}").json()
        r = private(g["players"][0]["id"], "9999")
        assert r.status_code == 401

    def test_unknown_player_404(self):
        assert private("nope", "0001").status_code == 404

    def test_faithful_no_traitor_info(self):
        g = S.get(f"{G()}").json()
        for p in g["players"]:
            v = private(p["id"], pin_of(p["name"])).json()
            if v["role"] == "faithful":
                assert "fellow_traitors" not in v and "target" not in v
            else:
                assert len(v["fellow_traitors"]) == 1


# ---- Full round flow ----
class TestFlow:
    def test_full_round(self):
        g, roles = setup_game(10)
        ps = g["players"]
        traitors = [p for p in ps if roles[p["id"]] == "traitor"]
        faithful = [p for p in ps if roles[p["id"]] == "faithful"]
        t0 = traitors[0]
        # cannot advance before all saw roles
        assert S.post(f"{G()}/advance").status_code == 400
        # cannot vote in setup... roundtable turn not allowed in day
        # traitor targeting traitor rejected
        r = S.post(f"{G()}/turn", json={"player_id": t0["id"], "pin": pin_of(t0["name"]), "target_id": traitors[1]["id"]})
        assert r.status_code == 400
        # traitor without target -> 400
        r = S.post(f"{G()}/turn", json={"player_id": t0["id"], "pin": pin_of(t0["name"])})
        assert r.status_code == 400
        victim = faithful[0]
        r = S.post(f"{G()}/turn", json={"player_id": t0["id"], "pin": pin_of(t0["name"]), "target_id": victim["id"]})
        assert r.status_code == 200 and r.json()["target"]["id"] == victim["id"] and r.json()["action"]
        for p in ps:
            if p["id"] != t0["id"]:
                r = S.post(f"{G()}/turn", json={"player_id": p["id"], "pin": pin_of(p["name"])})
                assert r.status_code == 200, r.text
        # wrong pin on turn
        assert S.post(f"{G()}/turn", json={"player_id": ps[0]["id"], "pin": "9998"}).status_code == 401
        r = S.post(f"{G()}/advance"); assert r.json()["phase"] == "day"
        # no turns in day phase
        assert S.post(f"{G()}/turn", json={"player_id": ps[0]["id"], "pin": pin_of(ps[0]["name"]), "vote_target_id": ps[1]["id"]}).status_code == 400
        r = S.post(f"{G()}/advance"); assert r.json()["phase"] == "roundtable"
        # self-vote rejected
        assert S.post(f"{G()}/turn", json={"player_id": ps[0]["id"], "pin": pin_of(ps[0]["name"]), "vote_target_id": ps[0]["id"]}).status_code == 400
        # cannot reveal before all voted
        assert S.post(f"{G()}/advance").status_code == 400
        # everyone votes faithful[1] (except faithful[1] votes faithful[2])
        banished = faithful[1]
        nxt = faithful[3]
        for p in ps:
            body = {"player_id": p["id"], "pin": pin_of(p["name"]),
                    "vote_target_id": banished["id"] if p["id"] != banished["id"] else faithful[2]["id"]}
            if roles[p["id"]] == "traitor":
                body.update({"murder_done": True, "target_id": nxt["id"]})
            r = S.post(f"{G()}/turn", json=body)
            assert r.status_code == 200, r.text
        r = S.post(f"{G()}/advance").json()
        assert r["phase"] == "reveal"
        h = r["history"][-1]
        assert h["murder"]["success"] and h["murder"]["victim_id"] == victim["id"] and h["murder"]["lives_left"] == 1
        assert h["banish"]["target_id"] == banished["id"] and h["banish"]["lives_left"] == 1 and not h["banish"]["tie"]
        assert h["winner"] is None
        r = S.post(f"{G()}/advance").json()
        assert r["phase"] == "day" and r["day"] == 2
        t = private(t0["id"], pin_of(t0["name"])).json()
        assert t["target"]["id"] == nxt["id"] and t["next_target"] is None and t["murder_confirmed"] is False
        STATE.update(roles=roles, ps=ps, banished=banished, victim=victim)

    def test_elimination_and_eliminated_cannot_vote(self):
        roles, ps, banished = STATE["roles"], STATE["ps"], STATE["banished"]
        traitors = [p for p in ps if roles[p["id"]] == "traitor"]
        S.post(f"{G()}/advance")  # -> roundtable day 2
        for p in ps:
            body = {"player_id": p["id"], "pin": pin_of(p["name"]),
                    "vote_target_id": banished["id"] if p["id"] != banished["id"] else STATE["victim"]["id"]}
            if roles[p["id"]] == "traitor":
                body.update({"murder_done": False})
            r = S.post(f"{G()}/turn", json=body); assert r.status_code == 200, r.text
        r = S.post(f"{G()}/advance").json()
        h = r["history"][-1]
        assert h["murder"]["success"] is False
        assert h["banish"]["eliminated"] and h["banish"]["role"] == "faithful"
        bp = next(p for p in r["players"] if p["id"] == banished["id"])
        assert bp["alive"] is False and bp["role"] == "faithful"
        S.post(f"{G()}/advance"); S.post(f"{G()}/advance")  # day3 roundtable
        r = S.post(f"{G()}/turn", json={"player_id": banished["id"], "pin": pin_of(banished["name"]), "vote_target_id": ps[0]["id"] if ps[0]["id"] != banished["id"] else ps[1]["id"]})
        assert r.status_code == 400
        # can't vote for eliminated player
        voter = traitors[0]
        r = S.post(f"{G()}/turn", json={"player_id": voter["id"], "pin": pin_of(voter["name"]), "vote_target_id": banished["id"]})
        assert r.status_code == 400
        g = S.get(f"{G()}").json()
        assert g["turns_needed"] == 9

    def test_tie_and_faithful_win(self):
        g, roles = setup_game(4)
        ps = g["players"]
        tr = next(p for p in ps if roles[p["id"]] == "traitor")
        fa = [p for p in ps if roles[p["id"]] == "faithful"]
        S.post(f"{G()}/turn", json={"player_id": tr["id"], "pin": pin_of(tr["name"]), "target_id": fa[0]["id"]})
        finish_setup(ps); S.post(f"{G()}/advance")
        # tie: 2 votes vs 2 votes
        votes = {fa[0]["id"]: fa[1]["id"], fa[1]["id"]: fa[0]["id"], fa[2]["id"]: fa[0]["id"], tr["id"]: fa[1]["id"]}
        for p in ps:
            S.post(f"{G()}/turn", json={"player_id": p["id"], "pin": pin_of(p["name"]), "vote_target_id": votes[p["id"]], "murder_done": False, "target_id": fa[2]["id"]})
        h = S.post(f"{G()}/advance").json()["history"][-1]
        assert h["banish"]["tie"] is True and h["banish"]["target_id"] is None
        # two rounds voting the traitor -> faithful win
        for _ in range(2):
            S.post(f"{G()}/advance"); S.post(f"{G()}/advance")
            for p in ps:
                vt = tr["id"] if p["id"] != tr["id"] else fa[0]["id"]
                S.post(f"{G()}/turn", json={"player_id": p["id"], "pin": pin_of(p["name"]), "vote_target_id": vt, "murder_done": False, "target_id": fa[2]["id"]})
            r = S.post(f"{G()}/advance").json()
        assert r["winner"] == "faithful"
        r = S.post(f"{G()}/advance").json()
        assert r["phase"] == "ended" and all(p["role"] for p in r["players"])
        assert S.post(f"{G()}/advance").status_code == 400

    def test_traitor_win_by_numbers(self):
        g, roles = setup_game(4)
        ps = g["players"]
        tr = next(p for p in ps if roles[p["id"]] == "traitor")
        fa = [p for p in ps if roles[p["id"]] == "faithful"]
        S.post(f"{G()}/turn", json={"player_id": tr["id"], "pin": pin_of(tr["name"]), "target_id": fa[0]["id"]})
        finish_setup(ps)
        winner = None
        for _ in range(4):
            S.post(f"{G()}/advance")
            g = S.get(f"{G()}").json()
            alive = [p for p in g["players"] if p["alive"]]
            alive_f = [p for p in alive if p["id"] != tr["id"]]
            target = alive_f[0]
            for p in alive:
                vt = target["id"] if p["id"] != target["id"] else tr["id"]
                S.post(f"{G()}/turn", json={"player_id": p["id"], "pin": pin_of(p["name"]), "vote_target_id": vt, "murder_done": True, "target_id": alive_f[-1]["id"]})
            r = S.post(f"{G()}/advance").json()
            winner = r["winner"]
            if winner:
                break
            S.post(f"{G()}/advance")
        assert winner == "traitors"


class TestDelete:
    def test_delete(self):
        assert S.delete(f"{G()}").json() == {"exists": False}
        r = S.get(f"{G()}")
        assert r.status_code == 404 and r.json()["detail"] == "No game found with that code"
        assert S.post(f"{G()}/advance").status_code == 404
