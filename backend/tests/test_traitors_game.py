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


def del_game(code=None):
    """Delete a game. Supplies host auth so an in-progress game can be removed —
    only the host may end a game that has not finished."""
    code = code or CUR["code"]
    st = S.get(G(code)).json()
    body = None
    if st.get("exists") and st.get("host_id"):
        body = {"player_id": st["host_id"], "pin": pin_of(st["host_name"])}
    return S.delete(G(code), json=body)


def setup_game(n=10):
    if CUR["code"]:
        del_game()  # clean up previous test game
    r = S.post(f"{API}/games", json={"players": mk_players(n)})
    assert r.status_code == 200, r.text
    g = r.json()
    CUR["code"] = g["code"]
    roles = {}
    for p in g["players"]:
        v = private(p["id"], pin_of(p["name"])).json()
        roles[p["id"]] = v["role"]
    return g, roles


def cast_votes(votes):
    """Each alive voter in `votes` casts its banish vote. votes: {voter_id: target_id}."""
    g = S.get(f"{G()}").json()
    for p in g["players"]:
        if p["alive"] and p["id"] in votes:
            r = S.post(f"{G()}/turn", json={"player_id": p["id"], "pin": pin_of(p["name"]), "vote_target_id": votes[p["id"]]})
            assert r.status_code == 200, r.text


def do_night(roles, murder_target=None):
    """Every alive player takes the night turn. The first alive Traitor murders
    `murder_target` via the two-step flow (pick victim -> choose 1 of 3 actions);
    everyone else just passes. With no target, all lie low."""
    g = S.get(f"{G()}").json()
    committed = False
    for p in g["players"]:
        if not p["alive"]:
            continue
        if murder_target and not committed and roles.get(p["id"]) == "traitor":
            r = S.post(f"{G()}/turn", json={"player_id": p["id"], "pin": pin_of(p["name"]), "target_id": murder_target})
            assert r.status_code == 200, r.text
            choices = r.json()["action_choices"]
            assert len(choices) == 3
            r2 = S.post(f"{G()}/turn", json={"player_id": p["id"], "pin": pin_of(p["name"]), "action": choices[0]})
            assert r2.status_code == 200 and r2.json()["murder_confirmed"] is True, r2.text
            committed = True
        else:
            assert S.post(f"{G()}/turn", json={"player_id": p["id"], "pin": pin_of(p["name"])}).status_code == 200


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

    @pytest.mark.parametrize("n,t", [(4, 1), (6, 1), (7, 2), (12, 2), (13, 3), (15, 3)])
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


# ---- Full round flow: banish first, murder after, each in its own reveal ----
class TestFlow:
    def test_full_round(self):
        g, roles = setup_game(10)
        ps = g["players"]
        traitors = [p for p in ps if roles[p["id"]] == "traitor"]
        faithful = [p for p in ps if roles[p["id"]] == "faithful"]
        t0 = traitors[0]
        # cannot advance before all saw roles
        assert S.post(f"{G()}/advance").status_code == 400
        # setup just acknowledges the role; no victim is chosen up front
        assert S.post(f"{G()}/turn", json={"player_id": t0["id"], "pin": pin_of(t0["name"])}).status_code == 200
        # wrong pin on turn
        assert S.post(f"{G()}/turn", json={"player_id": ps[0]["id"], "pin": "9998"}).status_code == 401
        for p in ps:
            assert S.post(f"{G()}/turn", json={"player_id": p["id"], "pin": pin_of(p["name"])}).status_code == 200, p["name"]
        assert S.post(f"{G()}/advance").json()["phase"] == "day"
        # no turns in the day phase
        assert S.post(f"{G()}/turn", json={"player_id": ps[0]["id"], "pin": pin_of(ps[0]["name"]), "vote_target_id": ps[1]["id"]}).status_code == 400
        assert S.post(f"{G()}/advance").json()["phase"] == "roundtable"
        # self-vote rejected
        assert S.post(f"{G()}/turn", json={"player_id": ps[0]["id"], "pin": pin_of(ps[0]["name"]), "vote_target_id": ps[0]["id"]}).status_code == 400
        # cannot banish before all voted
        assert S.post(f"{G()}/advance").status_code == 400
        banished = faithful[1]
        cast_votes({p["id"]: (banished["id"] if p["id"] != banished["id"] else faithful[2]["id"]) for p in ps})
        rb = S.post(f"{G()}/advance").json()
        assert rb["phase"] == "banished"
        h = rb["history"][-1]
        assert h["murder"] is None  # the murder has not happened yet
        assert h["banish"]["target_id"] == banished["id"] and h["banish"]["lives_left"] == 1 and not h["banish"]["tie"]
        assert h["winner"] is None
        # banished -> night: the murder is chosen now, after the Round Table
        assert S.post(f"{G()}/advance").json()["phase"] == "night"
        # a traitor cannot murder a fellow traitor
        assert S.post(f"{G()}/turn", json={"player_id": t0["id"], "pin": pin_of(t0["name"]), "target_id": traitors[1]["id"]}).status_code == 400
        victim = faithful[0]
        # step 1: pick the victim -> three action choices, nothing committed, turn not yet taken
        r = S.post(f"{G()}/turn", json={"player_id": t0["id"], "pin": pin_of(t0["name"]), "target_id": victim["id"]})
        assert r.status_code == 200 and r.json()["target"]["id"] == victim["id"]
        choices = r.json()["action_choices"]
        assert len(choices) == 3 and r.json()["action"] is None and r.json()["murder_confirmed"] is False
        # an action that was not offered is rejected
        assert S.post(f"{G()}/turn", json={"player_id": t0["id"], "pin": pin_of(t0["name"]), "action": "not a real option"}).status_code == 400
        # step 2: confirm one of the three
        r = S.post(f"{G()}/turn", json={"player_id": t0["id"], "pin": pin_of(t0["name"]), "action": choices[1]})
        assert r.status_code == 200 and r.json()["action"] == choices[1] and r.json()["murder_confirmed"] is True
        for p in ps:
            if p["id"] != t0["id"]:
                assert S.post(f"{G()}/turn", json={"player_id": p["id"], "pin": pin_of(p["name"])}).status_code == 200
        rv = S.post(f"{G()}/advance").json()
        assert rv["phase"] == "reveal"
        h = rv["history"][-1]
        assert h["murder"]["success"] and h["murder"]["victim_id"] == victim["id"] and h["murder"]["lives_left"] == 1
        assert "action" not in h["murder"] and h["banish"]["target_id"] == banished["id"]
        assert h["winner"] is None
        r = S.post(f"{G()}/advance").json()
        assert r["phase"] == "day" and r["day"] == 2
        t = private(t0["id"], pin_of(t0["name"])).json()
        assert t["target"] is None and t["murder_confirmed"] is False and "next_target" not in t
        STATE.update(roles=roles, ps=ps, banished=banished, victim=victim)

    def test_elimination_and_eliminated_cannot_vote(self):
        roles, ps, banished = STATE["roles"], STATE["ps"], STATE["banished"]
        traitors = [p for p in ps if roles[p["id"]] == "traitor"]
        # day 2: banish the same faithful again -> eliminated (one life left)
        assert S.post(f"{G()}/advance").json()["phase"] == "roundtable"
        cast_votes({p["id"]: (banished["id"] if p["id"] != banished["id"] else STATE["victim"]["id"]) for p in ps})
        rb = S.post(f"{G()}/advance").json()
        assert rb["phase"] == "banished"
        h = rb["history"][-1]
        assert h["banish"]["eliminated"] and h["banish"]["role"] == "faithful"
        bp = next(p for p in rb["players"] if p["id"] == banished["id"])
        assert bp["alive"] is False and bp["role"] == "faithful"
        # night: the traitors lie low
        assert S.post(f"{G()}/advance").json()["phase"] == "night"
        do_night(roles, murder_target=None)
        rv = S.post(f"{G()}/advance").json()
        assert rv["phase"] == "reveal" and rv["history"][-1]["murder"]["success"] is False
        # reveal -> day 3 -> roundtable
        assert S.post(f"{G()}/advance").json()["phase"] == "day"
        assert S.post(f"{G()}/advance").json()["phase"] == "roundtable"
        # an eliminated player cannot vote
        r = S.post(f"{G()}/turn", json={"player_id": banished["id"], "pin": pin_of(banished["name"]), "vote_target_id": ps[0]["id"] if ps[0]["id"] != banished["id"] else ps[1]["id"]})
        assert r.status_code == 400
        # cannot vote for an eliminated player
        voter = traitors[0]
        assert S.post(f"{G()}/turn", json={"player_id": voter["id"], "pin": pin_of(voter["name"]), "vote_target_id": banished["id"]}).status_code == 400
        assert S.get(f"{G()}").json()["turns_needed"] == 9

    def test_tie_and_faithful_win(self):
        g, roles = setup_game(4)
        ps = g["players"]
        tr = next(p for p in ps if roles[p["id"]] == "traitor")
        fa = [p for p in ps if roles[p["id"]] == "faithful"]
        finish_setup(ps)  # -> day 1
        # Day 1 round table: a 2-2 tie, nobody banished
        assert S.post(f"{G()}/advance").json()["phase"] == "roundtable"
        cast_votes({fa[0]["id"]: fa[1]["id"], fa[1]["id"]: fa[0]["id"], fa[2]["id"]: fa[0]["id"], tr["id"]: fa[1]["id"]})
        rb = S.post(f"{G()}/advance").json()
        assert rb["phase"] == "banished" and rb["history"][-1]["banish"]["tie"] is True
        # night: lie low; -> reveal -> day 2
        assert S.post(f"{G()}/advance").json()["phase"] == "night"
        do_night(roles, murder_target=None)
        assert S.post(f"{G()}/advance").json()["phase"] == "reveal"
        assert S.post(f"{G()}/advance").json()["phase"] == "day"
        # vote the traitor out (2 lives -> 2 banishments) with no murders
        winner = None
        for _ in range(3):
            assert S.post(f"{G()}/advance").json()["phase"] == "roundtable"
            alive = [p for p in S.get(f"{G()}").json()["players"] if p["alive"]]
            cast_votes({p["id"]: (tr["id"] if p["id"] != tr["id"] else fa[0]["id"]) for p in alive})
            rb = S.post(f"{G()}/advance").json()  # -> banished (or ended)
            winner = rb.get("winner")
            if winner:
                break
            assert S.post(f"{G()}/advance").json()["phase"] == "night"
            do_night(roles, murder_target=None)
            rv = S.post(f"{G()}/advance").json()  # -> reveal
            winner = rv.get("winner")
            if winner:
                break
            S.post(f"{G()}/advance")  # -> day
        assert winner == "faithful"
        r2 = S.post(f"{G()}/advance").json()  # banished/reveal (winner) -> ended
        assert r2["phase"] == "ended" and all(p["role"] for p in r2["players"])
        assert S.post(f"{G()}/advance").status_code == 400

    def test_traitor_win_by_numbers(self):
        g, roles = setup_game(4)
        ps = g["players"]
        tr = next(p for p in ps if roles[p["id"]] == "traitor")
        finish_setup(ps)  # -> day 1
        winner = None
        for _ in range(6):
            assert S.post(f"{G()}/advance").json()["phase"] == "roundtable"
            alive = [p for p in S.get(f"{G()}").json()["players"] if p["alive"]]
            alive_f = [p for p in alive if roles[p["id"]] == "faithful"]
            bt = alive_f[0]
            cast_votes({p["id"]: (bt["id"] if p["id"] != bt["id"] else next(x["id"] for x in alive if x["id"] != p["id"])) for p in alive})
            rb = S.post(f"{G()}/advance").json()  # -> banished (or ended)
            if rb.get("winner"):
                winner = rb["winner"]; break
            assert S.post(f"{G()}/advance").json()["phase"] == "night"
            af = [p for p in S.get(f"{G()}").json()["players"] if p["alive"] and roles[p["id"]] == "faithful"]
            do_night(roles, murder_target=af[-1]["id"] if af else None)
            rv = S.post(f"{G()}/advance").json()  # -> reveal
            if rv.get("winner"):
                winner = rv["winner"]; break
            S.post(f"{G()}/advance")  # -> day
        assert winner == "traitors"
        # play through to the end screen: the murder methods are now revealed
        st = S.get(f"{G()}").json()
        while st["phase"] in ("banished", "reveal"):
            st = S.post(f"{G()}/advance").json()
        assert st["phase"] == "ended"
        murders = [h["murder"] for h in st["history"] if h["murder"] and h["murder"].get("success")]
        assert murders and all(m.get("action") for m in murders)


class TestMurderChoice:
    def test_three_choices_then_lie_low(self):
        g, roles = setup_game(5)
        ps = g["players"]
        tr = next(p for p in ps if roles[p["id"]] == "traitor")
        fa = [p for p in ps if roles[p["id"]] == "faithful"]
        finish_setup(ps)  # -> day
        assert S.post(f"{G()}/advance").json()["phase"] == "roundtable"
        cast_votes({p["id"]: (fa[0]["id"] if p["id"] != fa[0]["id"] else fa[1]["id"]) for p in ps})
        assert S.post(f"{G()}/advance").json()["phase"] == "banished"
        assert S.post(f"{G()}/advance").json()["phase"] == "night"
        # picking a victim offers three distinct actions and commits nothing yet
        r = S.post(f"{G()}/turn", json={"player_id": tr["id"], "pin": pin_of(tr["name"]), "target_id": fa[2]["id"]})
        ch = r.json()["action_choices"]
        assert len(ch) == 3 and len(set(ch)) == 3 and r.json()["action"] is None and r.json()["murder_confirmed"] is False
        # the traitor can still lie low after seeing the choices -> no murder, turn taken
        assert S.post(f"{G()}/turn", json={"player_id": tr["id"], "pin": pin_of(tr["name"])}).status_code == 200
        for p in ps:
            if p["id"] != tr["id"]:
                S.post(f"{G()}/turn", json={"player_id": p["id"], "pin": pin_of(p["name"])})
        rv = S.post(f"{G()}/advance").json()
        assert rv["phase"] == "reveal" and rv["history"][-1]["murder"]["success"] is False


class TestSkipMissing:
    def test_skip_needs_a_vote_then_reveals(self):
        g, roles = setup_game(5)
        ps = g["players"]
        finish_setup(ps)  # -> day
        assert S.post(f"{G()}/advance").json()["phase"] == "roundtable"
        # nobody has voted yet: even force refuses
        assert S.post(f"{G()}/advance?expected=roundtable&force=true").status_code == 400
        # four of five vote; ps[4] is "missing". Everyone votes ps[0] (ps[0] votes ps[1]).
        votes = {ps[0]["id"]: ps[1]["id"], ps[1]["id"]: ps[0]["id"], ps[2]["id"]: ps[0]["id"], ps[3]["id"]: ps[0]["id"]}
        for pid, tid in votes.items():
            p = next(x for x in ps if x["id"] == pid)
            assert S.post(f"{G()}/turn", json={"player_id": pid, "pin": pin_of(p["name"]), "vote_target_id": tid}).status_code == 200
        # normal advance is blocked: ps[4] has not voted
        assert S.post(f"{G()}/advance?expected=roundtable").status_code == 400
        # force skips the missing voter and reveals on the votes cast so far
        r = S.post(f"{G()}/advance?expected=roundtable&force=true").json()
        assert r["phase"] == "banished"
        h = r["history"][-1]
        assert h["banish"]["target_id"] == ps[0]["id"] and h["banish"]["tally"][0]["votes"] == 3


class TestRecruit:
    def test_recruit_when_short(self):
        g, roles = setup_game(12)
        ps = g["players"]
        traitors = [p for p in ps if roles[p["id"]] == "traitor"]
        faithful = [p for p in ps if roles[p["id"]] == "faithful"]
        assert len(traitors) == 2
        ta, tb = traitors
        finish_setup(ps)  # -> day 1

        def banish_ta():
            assert S.post(f"{G()}/advance").json()["phase"] == "roundtable"
            alive = [p for p in S.get(f"{G()}").json()["players"] if p["alive"]]
            cast_votes({p["id"]: (ta["id"] if p["id"] != ta["id"] else faithful[0]["id"]) for p in alive})
            assert S.post(f"{G()}/advance").json()["phase"] == "banished"
            assert S.post(f"{G()}/advance").json()["phase"] == "night"

        # Day 1: banish ta once (still alive). Two Traitors are at full strength.
        banish_ta()
        assert private(tb["id"], pin_of(tb["name"])).json()["can_recruit"] is False
        # recruiting while at strength is rejected
        assert S.post(f"{G()}/turn", json={"player_id": tb["id"], "pin": pin_of(tb["name"]), "recruit_id": faithful[1]["id"]}).status_code == 400
        do_night(roles, None)  # lie low
        assert S.post(f"{G()}/advance").json()["phase"] == "reveal"
        assert S.post(f"{G()}/advance").json()["phase"] == "day"

        # Day 2: banish ta again -> eliminated. Now the Traitors are short.
        banish_ta()
        assert private(tb["id"], pin_of(tb["name"])).json()["can_recruit"] is True
        recruit = faithful[1]
        assert private(recruit["id"], pin_of(recruit["name"])).json()["role"] == "faithful"
        assert S.post(f"{G()}/turn", json={"player_id": tb["id"], "pin": pin_of(tb["name"]), "recruit_id": recruit["id"]}).status_code == 200
        for p in S.get(f"{G()}").json()["players"]:
            if p["alive"] and p["id"] != tb["id"]:
                assert S.post(f"{G()}/turn", json={"player_id": p["id"], "pin": pin_of(p["name"])}).status_code == 200
        rv = S.post(f"{G()}/advance").json()
        assert rv["phase"] == "reveal"
        assert rv["history"][-1]["recruited"] is True
        assert rv["history"][-1]["murder"]["success"] is False  # recruiting replaces the murder
        # the recruit is now a Traitor and sees their fellow
        nv = private(recruit["id"], pin_of(recruit["name"])).json()
        assert nv["role"] == "traitor" and tb["name"] in nv["fellow_traitors"]


class TestHostEndGame:
    def test_only_host_can_end_in_progress_game(self):
        g, _ = setup_game(6)
        host, other = g["players"][0], g["players"][1]
        # No credentials: blocked.
        assert S.delete(G()).status_code == 403
        # A non-host player: blocked.
        assert S.delete(G(), json={"player_id": other["id"], "pin": pin_of(other["name"])}).status_code == 403
        # Host id but wrong PIN: blocked.
        assert S.delete(G(), json={"player_id": host["id"], "pin": "9999"}).status_code == 401
        # Still there after all the blocked attempts.
        assert S.get(G()).status_code == 200
        # The host can end it.
        assert S.delete(G(), json={"player_id": host["id"], "pin": pin_of(host["name"])}).json() == {"exists": False}
        assert S.get(G()).status_code == 404


class TestDelete:
    def test_delete(self):
        assert del_game().json() == {"exists": False}
        r = S.get(f"{G()}")
        assert r.status_code == 404 and r.json()["detail"] == "No game found with that code"
        assert S.post(f"{G()}/advance").status_code == 404
