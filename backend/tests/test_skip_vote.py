# Skip-a-vote feature: POST /api/games/{code}/skip {player_id, undo?, by_id, pin} (self-contained; each test makes its own game)
import pytest
from test_traitors_game import API, S, mk_players, pin_of

CODES = []
NAMES = {}  # player id -> name (for PINs)


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
    """Skip pid's vote. By default the skipper is pid themself with their correct PIN; undo sends no PIN."""
    body = {"player_id": pid, "undo": undo}
    if not undo:
        by_id = by or (pid if pid in NAMES else next(iter(NAMES)))
        body["by_id"] = by_id
        body["pin"] = pin if pin is not None else pin_of(NAMES[by_id])
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


# Skip needs the skipper's name + PIN; skipped_by shown on players and history
class TestSkipPin:
    def test_missing_by_or_pin_400(self):
        code, ps, r, tr, fa = to_roundtable()
        t = fa[1]["id"]
        for body in ({"player_id": t}, {"player_id": t, "by_id": fa[0]["id"]}, {"player_id": t, "pin": "0001"},
                     {"player_id": t, "by_id": fa[0]["id"], "pin": ""}):
            res = S.post(f"{G(code)}/skip", json=body)
            assert res.status_code == 400, body
            assert res.json()["detail"] == "Choose your name and enter your PIN to skip a vote"
        assert pl(state(code), t)["skipped"] is False and state(code)["turns_done"] == 0

    def test_wrong_pin_401_and_unknown_skipper(self):
        code, ps, r, tr, fa = to_roundtable()
        res = skip(code, fa[1]["id"], by=fa[0]["id"], pin="9999")
        assert res.status_code == 401, res.text
        s = state(code)
        assert pl(s, fa[1]["id"])["skipped"] is False and s["turns_done"] == 0
        res = S.post(f"{G(code)}/skip", json={"player_id": fa[1]["id"], "by_id": "nope", "pin": "0001"})
        assert res.status_code in (400, 401, 404), res.text
        assert state(code)["turns_done"] == 0

    def test_skipped_by_name_and_history(self):
        code, ps, r, tr, fa = to_roundtable()
        a, b = fa[0], fa[1]
        s = skip(code, b["id"], by=a["id"]).json()
        assert pl(s, b["id"])["skipped"] is True and pl(s, b["id"])["skipped_by"] == a["name"]
        assert all(p["skipped_by"] is None for p in s["players"] if p["id"] != b["id"])
        assert pl(state(code), b["id"])["skipped_by"] == a["name"]  # persisted
        # skip someone else by a different skipper
        s = skip(code, a["id"], by=ps[-1]["id"]).json()
        assert pl(s, a["id"])["skipped_by"] == ps[-1]["name"]
        for p in ps:
            if p["id"] not in (a["id"], b["id"]):
                assert vote(code, p, b if p["id"] != b["id"] else a).status_code == 200
        s = S.post(f"{G(code)}/advance").json()
        assert s["phase"] == "reveal"
        h = s["history"][-1]
        assert h["skipped_by"] == {b["name"]: a["name"], a["name"]: ps[-1]["name"]}
        s = S.post(f"{G(code)}/advance").json()
        assert s["phase"] == "day" and all(p["skipped_by"] is None for p in s["players"])
        s = S.post(f"{G(code)}/advance").json()
        assert s["phase"] == "roundtable" and all(p["skipped_by"] is None and not p["skipped"] for p in s["players"])
        assert s["history"][-1]["skipped_by"] == {b["name"]: a["name"], a["name"]: ps[-1]["name"]}

    def test_undo_no_pin_clears_skipped_by(self):
        code, ps, r, tr, fa = to_roundtable()
        skip(code, fa[1]["id"], by=fa[0]["id"])
        res = S.post(f"{G(code)}/skip", json={"player_id": fa[1]["id"], "undo": True})
        assert res.status_code == 200, res.text
        assert pl(res.json(), fa[1]["id"])["skipped"] is False and pl(res.json(), fa[1]["id"])["skipped_by"] is None
        # re-skip by another person records the new skipper
        s = skip(code, fa[1]["id"], by=fa[2]["id"]).json()
        assert pl(s, fa[1]["id"])["skipped_by"] == fa[2]["name"]

    def test_vote_later_clears_skipped_by(self):
        code, ps, r, tr, fa = to_roundtable()
        skip(code, fa[1]["id"], by=fa[0]["id"])
        assert vote(code, fa[1], fa[2]).status_code == 200
        p = pl(state(code), fa[1]["id"])
        assert p["skipped"] is False and p["skipped_by"] is None and p["turn_done"] is True
        for q in ps:
            if q["id"] != fa[1]["id"]:
                assert vote(code, q, fa[1] if q["id"] != fa[1]["id"] else fa[2]).status_code == 200
        h = S.post(f"{G(code)}/advance").json()["history"][-1]
        assert h["skipped"] == [] and h["skipped_by"] == {}
