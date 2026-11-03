# Skip-a-vote feature: POST /api/games/{code}/skip {player_id, undo?, by_id, pin}. Only player 1 (host_id = players[0]) may skip/undo, with their PIN.
import pytest
from test_traitors_game import API, S, mk_players, pin_of

CODES = []
NAMES = {}  # player id -> name (for PINs)
HOST = {}  # game code -> player 1 id


@pytest.fixture(scope="module", autouse=True)
def cleanup():
    yield
    for c in CODES:
        S.delete(f"{API}/games/{c}")


def G(code):
    return f"{API}/games/{code}"


def new_game(n=5):
    r = S.post(f"{API}/games", json={"players": mk_players(n)})
    assert r.status_code == 200, r.text
    g = r.json()
    CODES.append(g["code"])
    NAMES.update({p["id"]: p["name"] for p in g["players"]})
    HOST[g["code"]] = g["host_id"]
    assert g["host_id"] == g["players"][0]["id"]
    roles = {p["id"]: S.post(f"{G(g['code'])}/private", json={"player_id": p["id"], "pin": pin_of(p["name"])}).json()["role"] for p in g["players"]}
    return g, roles


def state(code):
    return S.get(G(code)).json()


def to_roundtable(n=5):
    g, r = new_game(n)
    code, ps = g["code"], g["players"]
    tr = [p for p in ps if r[p["id"]] == "traitor"]
    fa = [p for p in ps if r[p["id"]] == "faithful"]
    for p in ps:
        body = {"player_id": p["id"], "pin": pin_of(p["name"])}
        if r[p["id"]] == "traitor":
            body["target_id"] = fa[0]["id"]
        assert S.post(f"{G(code)}/turn", json=body).status_code == 200
    assert S.post(f"{G(code)}/advance").json()["phase"] == "day"
    assert S.post(f"{G(code)}/advance").json()["phase"] == "roundtable"
    return code, ps, r, tr, fa


def vote(code, p, target, **extra):
    return S.post(f"{G(code)}/turn", json={"player_id": p["id"], "pin": pin_of(p["name"]), "vote_target_id": target["id"], **extra})


def skip(code, pid, undo=False, by=None, pin=None):
    """Skip/undo pid's vote. By default done by player 1 (host) with their correct PIN (needed for undo too)."""
    by_id = by or HOST[code]
    body = {"player_id": pid, "undo": undo, "by_id": by_id,
            "pin": pin if pin is not None else (pin_of(NAMES[by_id]) if by_id in NAMES else "0001")}
    return S.post(f"{G(code)}/skip", json=body)


def pl(s, pid):
    return next(p for p in s["players"] if p["id"] == pid)


class TestSkipPhaseRules:
    def test_skip_rejected_in_setup_and_day(self):
        g, r = new_game(5)
        code, ps = g["code"], g["players"]
        res = skip(code, ps[0]["id"])
        assert res.status_code == 400 and "Round Table" in res.json()["detail"]
        fa = [p for p in ps if r[p["id"]] == "faithful"]
        for p in ps:
            body = {"player_id": p["id"], "pin": pin_of(p["name"])}
            if r[p["id"]] == "traitor":
                body["target_id"] = fa[0]["id"]
            S.post(f"{G(code)}/turn", json=body)
        assert S.post(f"{G(code)}/advance").json()["phase"] == "day"
        assert skip(code, ps[0]["id"]).status_code == 400

    def test_skip_unknown_player_400(self):
        code, ps, r, tr, fa = to_roundtable()
        assert skip(code, "nope").status_code == 400

    def test_skip_unknown_game_404(self):
        assert S.post(f"{API}/games/ZZZZZZ/skip", json={"player_id": "x"}).status_code == 404


class TestSkipFlow:
    def test_skip_undo_and_reskip(self):
        code, ps, r, tr, fa = to_roundtable()
        s = skip(code, fa[1]["id"]).json()
        assert s["turns_done"] == 1 and pl(s, fa[1]["id"])["skipped"] is True and pl(s, fa[1]["id"])["turn_done"] is True
        # double skip is idempotent
        s = skip(code, fa[1]["id"]).json()
        assert s["turns_done"] == 1
        s = skip(code, fa[1]["id"], undo=True).json()
        assert s["turns_done"] == 0 and pl(s, fa[1]["id"])["skipped"] is False
        # undo again is harmless
        s = skip(code, fa[1]["id"], undo=True).json()
        assert s["turns_done"] == 0
        # persisted
        assert state(code)["turns_done"] == 0

    def test_skip_after_vote_does_nothing(self):
        code, ps, r, tr, fa = to_roundtable()
        assert vote(code, fa[1], fa[2]).status_code == 200
        s = skip(code, fa[1]["id"]).json()
        assert s["turns_done"] == 1 and pl(s, fa[1]["id"])["skipped"] is False
        # undo on a voter must not remove their turn
        s = skip(code, fa[1]["id"], undo=True).json()
        assert s["turns_done"] == 1 and pl(s, fa[1]["id"])["turn_done"] is True

    def test_skipped_player_can_vote_later_and_counts(self):
        code, ps, r, tr, fa = to_roundtable()
        skip(code, fa[1]["id"])
        assert vote(code, fa[1], fa[2]).status_code == 200
        s = state(code)
        assert pl(s, fa[1]["id"])["skipped"] is False and s["turns_done"] == 1
        # everyone else skipped -> reveal; fa[1]'s vote banishes fa[2]
        for p in ps:
            if p["id"] != fa[1]["id"]:
                skip(code, p["id"])
        s = S.post(f"{G(code)}/advance").json()
        assert s["phase"] == "reveal"
        h = s["history"][-1]
        assert h["banish"]["target_id"] == fa[2]["id"] and h["banish"]["tally"][0]["votes"] == 1
        assert fa[1]["name"] not in h["skipped"]

    def test_reveal_blocked_until_all_voted_or_skipped(self):
        code, ps, r, tr, fa = to_roundtable()
        for p in ps[:-1]:
            skip(code, p["id"])
        assert S.post(f"{G(code)}/advance").status_code == 400
        skip(code, ps[-1]["id"])
        assert S.post(f"{G(code)}/advance").json()["phase"] == "reveal"

    def test_all_skipped_nobody_banished_history_and_reset(self):
        code, ps, r, tr, fa = to_roundtable()
        for p in ps:
            skip(code, p["id"])
        s = S.post(f"{G(code)}/advance").json()
        h = s["history"][-1]
        assert h["banish"]["tally"] == [] and h["banish"]["target_id"] is None and h["banish"]["tie"] is False
        assert sorted(h["skipped"]) == sorted(p["name"] for p in ps)
        start = max(p["lives"] for p in s["players"])
        assert all(p["lives"] == start for p in s["players"])  # no banish; traitor skipped so no murder either
        s = S.post(f"{G(code)}/advance").json()
        assert s["phase"] == "day" and s["day"] == 2
        assert all(p["skipped"] is False for p in s["players"])
        s = S.post(f"{G(code)}/advance").json()
        assert s["phase"] == "roundtable" and s["turns_done"] == 0 and all(not p["skipped"] for p in s["players"])


class TestSkipTraitor:
    def test_skipped_traitor_murder_void_and_repick(self):
        code, ps, r, tr, fa = to_roundtable(5)  # 5 players -> 1 traitor
        assert len(tr) == 1
        t = tr[0]
        victim_lives = pl(state(code), fa[0]["id"])["lives"]
        skip(code, t["id"])
        for p in fa:
            vt = fa[1] if p["id"] != fa[1]["id"] else fa[2]
            assert vote(code, p, vt).status_code == 200
        s = S.post(f"{G(code)}/advance").json()
        h = s["history"][-1]
        assert h["murder"]["success"] is False
        assert pl(s, fa[0]["id"])["lives"] == victim_lives
        assert t["name"] in h["skipped"]
        s = S.post(f"{G(code)}/advance").json()
        assert s["phase"] == "day" and s["day"] == 2
        pv = S.post(f"{G(code)}/private", json={"player_id": t["id"], "pin": pin_of(t["name"])}).json()
        assert pv["target"] is None
        alive_f = [p for p in fa if pl(s, p["id"])["alive"]]
        res = S.post(f"{G(code)}/turn", json={"player_id": t["id"], "pin": pin_of(t["name"]), "target_id": alive_f[0]["id"]})
        assert res.status_code == 200, res.text
        assert res.json()["target"]["id"] == alive_f[0]["id"] and res.json()["action"]
        # history never leaks the action
        assert "action" not in s["history"][-1]["murder"]


# Player-1-only rules: by_id + pin required for skip AND undo; non-host 403; wrong PIN 401
class TestSkipHostOnly:
    def test_missing_by_or_pin_400_skip_and_undo(self):
        code, ps, r, tr, fa = to_roundtable()
        host = ps[0]
        t = ps[1]["id"]
        for undo in (False, True):
            for body in ({"player_id": t}, {"player_id": t, "by_id": host["id"]}, {"player_id": t, "pin": "0001"},
                         {"player_id": t, "by_id": host["id"], "pin": ""}):
                res = S.post(f"{G(code)}/skip", json={**body, "undo": undo})
                assert res.status_code == 400, (undo, body, res.text)
                assert res.json()["detail"] == f"{host['name']} (player 1) must enter their PIN to skip a vote"
        assert pl(state(code), t)["skipped"] is False and state(code)["turns_done"] == 0

    def test_non_host_with_own_correct_pin_403(self):
        code, ps, r, tr, fa = to_roundtable()
        host, other, target = ps[0], ps[1], ps[2]
        res = skip(code, target["id"], by=other["id"])
        assert res.status_code == 403, res.text
        assert res.json()["detail"] == f"Only {host['name']} (player 1) can skip votes"
        # non-host skipping themself is also refused
        assert skip(code, other["id"], by=other["id"]).status_code == 403
        s = state(code)
        assert s["turns_done"] == 0 and not any(p["skipped"] for p in s["players"])
        # host skips, then non-host tries to undo -> 403, still skipped
        assert skip(code, target["id"]).status_code == 200
        res = skip(code, target["id"], undo=True, by=other["id"])
        assert res.status_code == 403, res.text
        assert pl(state(code), target["id"])["skipped"] is True and state(code)["turns_done"] == 1

    def test_wrong_pin_401_skip_and_undo(self):
        code, ps, r, tr, fa = to_roundtable()
        t = ps[1]["id"]
        res = skip(code, t, pin="9999")
        assert res.status_code == 401 and "Incorrect PIN" in res.json()["detail"]
        # another player's PIN for host -> 401
        assert skip(code, t, pin=pin_of(ps[2]["name"])).status_code == 401
        assert state(code)["turns_done"] == 0
        assert skip(code, t).status_code == 200
        res = skip(code, t, undo=True, pin="9999")
        assert res.status_code == 401
        assert pl(state(code), t)["skipped"] is True
        # unknown by_id -> 404 player not found
        res = S.post(f"{G(code)}/skip", json={"player_id": t, "by_id": "nope", "pin": "0001"})
        assert res.status_code == 404, res.text

    def test_host_skip_undo_turns_done_and_skipped_by(self):
        code, ps, r, tr, fa = to_roundtable()
        host, t = ps[0], ps[1]
        s = skip(code, t["id"]).json()
        assert s["host_id"] == host["id"]
        assert s["turns_done"] == 1 and pl(s, t["id"])["skipped"] is True and pl(s, t["id"])["skipped_by"] == host["name"]
        assert pl(state(code), t["id"])["skipped_by"] == host["name"]  # persisted
        res = skip(code, t["id"], undo=True)
        assert res.status_code == 200, res.text
        s = res.json()
        assert s["turns_done"] == 0 and pl(s, t["id"])["skipped"] is False and pl(s, t["id"])["skipped_by"] is None
        assert state(code)["turns_done"] == 0
        # host can skip themself too
        s = skip(code, host["id"]).json()
        assert pl(s, host["id"])["skipped"] is True and s["turns_done"] == 1

    def test_history_records_host_as_skipper(self):
        code, ps, r, tr, fa = to_roundtable()
        host, b = ps[0], ps[1]
        skip(code, b["id"])
        for p in ps:
            if p["id"] != b["id"]:
                tgt = ps[2] if p["id"] != ps[2]["id"] else ps[3]
                assert vote(code, p, tgt).status_code == 200
        h = S.post(f"{G(code)}/advance").json()["history"][-1]
        assert h["skipped"] == [b["name"]] and h["skipped_by"] == {b["name"]: host["name"]}

    def test_vote_later_clears_skipped_by(self):
        code, ps, r, tr, fa = to_roundtable()
        t = ps[1]
        skip(code, t["id"])
        assert vote(code, t, ps[2]).status_code == 200
        p = pl(state(code), t["id"])
        assert p["skipped"] is False and p["skipped_by"] is None and p["turn_done"] is True


# Player 1 keeps the power to skip after being eliminated
class TestEliminatedHost:
    def test_eliminated_host_can_still_skip_and_undo(self):
        # need player 1 faithful so banishing them doesn't end the game
        for _ in range(15):
            g, r = new_game(7)
            if r[g["players"][0]["id"]] == "faithful":
                break
        else:
            pytest.skip("could not get a faithful player 1")
        code, ps = g["code"], g["players"]
        host = ps[0]
        others_f = [p for p in ps[1:] if r[p["id"]] == "faithful"]
        for p in ps:
            body = {"player_id": p["id"], "pin": pin_of(p["name"])}
            if r[p["id"]] == "traitor":
                body["target_id"] = others_f[0]["id"]
            assert S.post(f"{G(code)}/turn", json=body).status_code == 200
        S.post(f"{G(code)}/advance")  # day
        for _ in range(3):
            s = S.post(f"{G(code)}/advance").json()  # roundtable
            assert s["phase"] == "roundtable", s
            if not pl(s, host["id"])["alive"]:
                break
            for p in ps:
                if pl(s, p["id"])["alive"]:
                    tgt = host if p["id"] != host["id"] else others_f[-1]
                    assert vote(code, p, tgt).status_code == 200
            s = S.post(f"{G(code)}/advance").json()  # reveal
            assert s["winner"] is None, s["winner"]
            S.post(f"{G(code)}/advance")  # next day
        s = state(code)
        assert s["phase"] == "roundtable" and pl(s, host["id"])["alive"] is False
        target = next(p for p in ps if pl(s, p["id"])["alive"])
        res = skip(code, target["id"])
        assert res.status_code == 200, res.text
        assert pl(res.json(), target["id"])["skipped_by"] == host["name"]
        res = skip(code, target["id"], undo=True)
        assert res.status_code == 200 and pl(res.json(), target["id"])["skipped"] is False
        # eliminated host can't be the skip target
        assert skip(code, host["id"]).status_code == 400
