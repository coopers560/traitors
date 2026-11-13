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


def setup_game_traitors(n, want):
    """Like setup_game but retries the random Traitor draw until exactly `want`
    Traitors are chosen, so multi-day flow tests stay deterministic."""
    for _ in range(400):
        g, roles = setup_game(n)
        if list(roles.values()).count("traitor") == want:
            return g, roles
    raise AssertionError(f"could not draw {want} traitors out of {n}")


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

    @pytest.mark.parametrize("n", [4, 5, 8, 10, 12, 15])
    def test_traitor_count_random_minority(self, n):
        g, roles = setup_game(n)
        t = list(roles.values()).count("traitor")
        assert 1 <= t <= min(3, (n - 1) // 2)  # random 1-3, always a minority
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
        roles = {p["id"]: private(p["id"], pin_of(p["name"])).json()["role"] for p in g["players"]}
        n_tr = list(roles.values()).count("traitor")
        for p in g["players"]:
            v = private(p["id"], pin_of(p["name"])).json()
            if v["role"] == "faithful":
                assert "fellow_traitors" not in v and "target" not in v
            else:
                assert len(v["fellow_traitors"]) == n_tr - 1


# ---- Full round flow: banish first, murder after, each in its own reveal ----
class TestFlow:
    def test_full_round(self):
        g, roles = setup_game_traitors(10, 2)
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
        assert h["banish"]["target_id"] == banished["id"] and h["banish"]["eliminated"] and not h["banish"]["tie"]
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
        assert h["murder"]["success"] and h["murder"]["victim_id"] == victim["id"] and h["murder"]["eliminated"]
        assert "action" not in h["murder"] and h["banish"]["target_id"] == banished["id"]
        assert h["winner"] is None
        r = S.post(f"{G()}/advance").json()
        assert r["phase"] == "day" and r["day"] == 2
        t = private(t0["id"], pin_of(t0["name"])).json()
        assert t["target"] is None and t["murder_confirmed"] is False and "next_target" not in t
        STATE.update(roles=roles, ps=ps, banished=banished, victim=victim)

    def test_elimination_and_eliminated_cannot_vote(self):
        roles, ps, banished, victim = STATE["roles"], STATE["ps"], STATE["banished"], STATE["victim"]
        # One hit is out: both the banished Faithful and the murder victim left on Day 1.
        g = S.get(f"{G()}").json()
        dead = {p["id"]: p for p in g["players"] if not p["alive"]}
        assert banished["id"] in dead and victim["id"] in dead
        assert dead[banished["id"]]["role"] == "faithful" and dead[victim["id"]]["role"] == "faithful"
        assert g["phase"] == "day" and g["turns_needed"] == 8  # 10 - 2 eliminated
        alive = [p for p in g["players"] if p["alive"]]
        assert S.post(f"{G()}/advance").json()["phase"] == "roundtable"
        # an eliminated player cannot vote
        assert S.post(f"{G()}/turn", json={"player_id": banished["id"], "pin": pin_of(banished["name"]), "vote_target_id": alive[0]["id"]}).status_code == 400
        # cannot vote for an eliminated player
        assert S.post(f"{G()}/turn", json={"player_id": alive[0]["id"], "pin": pin_of(alive[0]["name"]), "vote_target_id": victim["id"]}).status_code == 400
        assert S.get(f"{G()}").json()["turns_needed"] == 8

    def test_tie_and_faithful_win(self):
        # 4 players = endgame: each round is a banish-again-or-end vote, no nights.
        g, roles = setup_game_traitors(4, 1)
        ps = g["players"]
        tr = next(p for p in ps if roles[p["id"]] == "traitor")
        fa = [p for p in ps if roles[p["id"]] == "faithful"]
        finish_setup(ps)  # -> day
        # Round 1: a 2-2 tie, nobody banished
        assert S.post(f"{G()}/advance").json()["phase"] == "roundtable"
        cast_votes({fa[0]["id"]: fa[1]["id"], fa[1]["id"]: fa[0]["id"], fa[2]["id"]: fa[0]["id"], tr["id"]: fa[1]["id"]})
        rb = S.post(f"{G()}/advance").json()
        assert rb["phase"] == "banished" and rb["history"][-1]["banish"]["tie"] is True
        assert S.post(f"{G()}/advance").json()["phase"] == "day"  # straight to the next vote (no night)
        # Round 2: banish the Traitor -> Faithful win
        assert S.post(f"{G()}/advance").json()["phase"] == "roundtable"
        cast_votes({p["id"]: (tr["id"] if p["id"] != tr["id"] else fa[0]["id"]) for p in ps})
        rb = S.post(f"{G()}/advance").json()
        assert rb["phase"] == "banished" and rb["winner"] == "faithful"
        r2 = S.post(f"{G()}/advance").json()
        assert r2["phase"] == "ended" and all(p["role"] for p in r2["players"])
        assert S.post(f"{G()}/advance").status_code == 400

    def test_traitor_win_by_numbers(self):
        # 8 players, 3 Traitors: a banishment + a murder brings 3v3 parity before the endgame.
        g, roles = setup_game_traitors(8, 3)
        ps = g["players"]
        fa = [p for p in ps if roles[p["id"]] == "faithful"]
        finish_setup(ps)  # -> day
        assert S.post(f"{G()}/advance").json()["phase"] == "roundtable"
        cast_votes({p["id"]: (fa[0]["id"] if p["id"] != fa[0]["id"] else fa[1]["id"]) for p in ps})
        assert S.post(f"{G()}/advance").json()["phase"] == "banished"  # 7 alive, no winner yet
        assert S.post(f"{G()}/advance").json()["phase"] == "night"
        do_night(roles, murder_target=fa[1]["id"])  # 6 alive -> 3 Traitors vs 3 Faithful
        rv = S.post(f"{G()}/advance").json()
        assert rv["phase"] == "reveal" and rv["winner"] == "traitors"
        # the murder method is revealed once the game ends
        st = S.post(f"{G()}/advance").json()
        assert st["phase"] == "ended"
        murders = [h["murder"] for h in st["history"] if h["murder"] and h["murder"].get("success")]
        assert murders and all(m.get("action") for m in murders)


class TestMurderChoice:
    def test_three_choices_then_lie_low(self):
        g, roles = setup_game_traitors(6, 1)  # 6 so a banishment leaves a normal night (not endgame)
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
    def test_recruit_available_at_six_or_more(self):
        g, roles = setup_game_traitors(8, 1)  # one Traitor so a banishment can't end it early
        ps = g["players"]
        tr = next(p for p in ps if roles[p["id"]] == "traitor")
        fa = [p for p in ps if roles[p["id"]] == "faithful"]
        finish_setup(ps)  # -> day 1
        # Banish a Faithful -> 7 still in (>= 6): recruitment is available tonight
        assert S.post(f"{G()}/advance").json()["phase"] == "roundtable"
        cast_votes({p["id"]: (fa[0]["id"] if p["id"] != fa[0]["id"] else fa[1]["id"]) for p in ps})
        assert S.post(f"{G()}/advance").json()["phase"] == "banished"
        assert S.post(f"{G()}/advance").json()["phase"] == "night"
        assert private(tr["id"], pin_of(tr["name"])).json()["can_recruit"] is True
        recruit = fa[2]
        assert private(recruit["id"], pin_of(recruit["name"])).json()["role"] == "faithful"
        assert S.post(f"{G()}/turn", json={"player_id": tr["id"], "pin": pin_of(tr["name"]), "recruit_id": recruit["id"]}).status_code == 200
        for p in S.get(f"{G()}").json()["players"]:
            if p["alive"] and p["id"] != tr["id"]:
                assert S.post(f"{G()}/turn", json={"player_id": p["id"], "pin": pin_of(p["name"])}).status_code == 200
        rv = S.post(f"{G()}/advance").json()
        assert rv["phase"] == "reveal" and rv["history"][-1]["recruited"] is True
        nv = private(recruit["id"], pin_of(recruit["name"])).json()
        assert nv["role"] == "traitor" and tr["name"] in nv["fellow_traitors"]

    def test_no_recruit_under_six(self):
        g, roles = setup_game_traitors(6, 1)
        ps = g["players"]
        tr = next(p for p in ps if roles[p["id"]] == "traitor")
        fa = [p for p in ps if roles[p["id"]] == "faithful"]
        finish_setup(ps)  # -> day 1
        # Banish a Faithful -> 5 left (< 6): no recruiting tonight
        assert S.post(f"{G()}/advance").json()["phase"] == "roundtable"
        cast_votes({p["id"]: (fa[0]["id"] if p["id"] != fa[0]["id"] else fa[1]["id"]) for p in ps})
        assert S.post(f"{G()}/advance").json()["phase"] == "banished"
        assert S.post(f"{G()}/advance").json()["phase"] == "night"
        assert private(tr["id"], pin_of(tr["name"])).json()["can_recruit"] is False
        assert S.post(f"{G()}/turn", json={"player_id": tr["id"], "pin": pin_of(tr["name"]), "recruit_id": fa[1]["id"]}).status_code == 400


class TestHideRoleAndEndgame:
    def test_banish_role_shown_above_six(self):
        g, roles = setup_game_traitors(7, 1)
        ps = g["players"]
        fa = [p for p in ps if roles[p["id"]] == "faithful"]
        finish_setup(ps)  # -> day
        assert S.post(f"{G()}/advance").json()["phase"] == "roundtable"
        cast_votes({p["id"]: (fa[0]["id"] if p["id"] != fa[0]["id"] else fa[1]["id"]) for p in ps})
        h = S.post(f"{G()}/advance").json()["history"][-1]["banish"]
        assert h["eliminated"] and h["role"] == "faithful" and not h.get("role_hidden")  # 7 remained

    def test_banish_role_hidden_at_six(self):
        g, roles = setup_game_traitors(6, 1)
        ps = g["players"]
        fa = [p for p in ps if roles[p["id"]] == "faithful"]
        finish_setup(ps)  # -> day
        assert S.post(f"{G()}/advance").json()["phase"] == "roundtable"
        cast_votes({p["id"]: (fa[0]["id"] if p["id"] != fa[0]["id"] else fa[1]["id"]) for p in ps})
        rb = S.post(f"{G()}/advance").json()
        h = rb["history"][-1]["banish"]
        assert h["eliminated"] and h["role"] is None and h["role_hidden"] is True  # 6 remained
        # hidden in the player list too (until the game ends)
        bp = next(p for p in rb["players"] if p["id"] == fa[0]["id"])
        assert bp["alive"] is False and bp["role"] is None

    def test_endgame_vote_to_end(self):
        g, roles = setup_game_traitors(4, 1)  # 4 alive = endgame
        ps = g["players"]
        tr = next(p for p in ps if roles[p["id"]] == "traitor")
        finish_setup(ps)  # -> day
        assert S.get(f"{G()}").json()["endgame"] is True
        assert S.post(f"{G()}/advance").json()["phase"] == "roundtable"
        assert private(tr["id"], pin_of(tr["name"])).json()["endgame"] is True
        for p in ps:  # everyone votes to end
            assert S.post(f"{G()}/turn", json={"player_id": p["id"], "pin": pin_of(p["name"]), "end_vote": True}).status_code == 200
        r = S.post(f"{G()}/advance").json()
        assert r["phase"] == "ended" and r["winner"] == "traitors"  # a Traitor was still in
        assert r["history"][-1]["ended_by_vote"] is True
        assert all(p["role"] for p in r["players"])  # all revealed at the end

    def test_endgame_banish_last_traitor_faithful_win(self):
        g, roles = setup_game_traitors(4, 1)
        ps = g["players"]
        tr = next(p for p in ps if roles[p["id"]] == "traitor")
        finish_setup(ps)
        assert S.post(f"{G()}/advance").json()["phase"] == "roundtable"
        for p in ps:  # the Traitor votes to end, the Faithful banish the Traitor
            body = {"player_id": p["id"], "pin": pin_of(p["name"])}
            body["end_vote"] = True if p["id"] == tr["id"] else None
            if p["id"] != tr["id"]:
                body["vote_target_id"] = tr["id"]
            assert S.post(f"{G()}/turn", json=body).status_code == 200
        rb = S.post(f"{G()}/advance").json()
        assert rb["phase"] == "banished" and rb["winner"] == "faithful"
        assert rb["history"][-1]["banish"]["target_id"] == tr["id"] and rb["history"][-1]["banish"]["role"] is None
        assert S.post(f"{G()}/advance").json()["phase"] == "ended"

    def test_endgame_banish_faithful_continues_without_night(self):
        g, roles = setup_game_traitors(4, 1)
        ps = g["players"]
        fa = [p for p in ps if roles[p["id"]] == "faithful"]
        finish_setup(ps)
        assert S.post(f"{G()}/advance").json()["phase"] == "roundtable"
        cast_votes({p["id"]: (fa[0]["id"] if p["id"] != fa[0]["id"] else fa[1]["id"]) for p in ps})
        rb = S.post(f"{G()}/advance").json()
        assert rb["phase"] == "banished" and rb.get("winner") is None
        nxt = S.post(f"{G()}/advance").json()
        assert nxt["phase"] == "day" and nxt["endgame"] is True  # no night in the endgame


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
