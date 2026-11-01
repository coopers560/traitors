# Multi-phone sync: /game/advance?expected=<phase> idempotency tests (single global game, run with -n 0)
from test_traitors_game import API, S, setup_game, pin_of, private


def adv(expected=None):
    url = f"{API}/game/advance" + (f"?expected={expected}" if expected else "")
    return S.post(url)


def state():
    return S.get(f"{API}/game").json()


def seed_setup_done():
    S.delete(f"{API}/game")
    g, r = setup_game(5)
    ps = g["players"]
    tr = next(p for p in ps if r[p["id"]] == "traitor")
    fa = [p for p in ps if r[p["id"]] == "faithful"]
    S.post(f"{API}/game/turn", json={"player_id": tr["id"], "pin": pin_of(tr["name"]), "target_id": fa[0]["id"]})
    for p in ps:
        if p["id"] != tr["id"]:
            S.post(f"{API}/game/turn", json={"player_id": p["id"], "pin": pin_of(p["name"])})
    return g, r


def vote_all():
    g = state()
    r = {p["id"]: private(p["id"], pin_of(p["name"])).json()["role"] for p in g["players"]}
    alive = [p for p in g["players"] if p["alive"]]
    alive_f = [p for p in alive if r[p["id"]] == "faithful"]
    target, nxt = alive_f[-1], alive_f[0]
    for p in alive:
        vt = target["id"] if p["id"] != target["id"] else next(x["id"] for x in alive if x["id"] != p["id"])
        body = {"player_id": p["id"], "pin": pin_of(p["name"]), "vote_target_id": vt}
        if r[p["id"]] == "traitor":
            body["murder_done"] = True
            body["target_id"] = nxt["id"]
        assert S.post(f"{API}/game/turn", json=body).status_code == 200


class TestAdvanceExpected:
    def test_setup_double_tap(self):
        seed_setup_done()
        a = adv("setup")
        assert a.status_code == 200 and a.json()["phase"] == "day" and a.json()["day"] == 1
        b = adv("setup")  # second phone, same button
        assert b.status_code == 200 and b.json()["phase"] == "day"
        assert state()["phase"] == "day"

    def test_wrong_expected_noop(self):
        r = adv("roundtable")
        assert r.status_code == 200 and r.json()["phase"] == "day"
        r = adv("reveal")
        assert r.json()["phase"] == "day" and state()["day"] == 1

    def test_day_double_tap(self):
        assert adv("day").json()["phase"] == "roundtable"
        assert adv("day").json()["phase"] == "roundtable"
        s = state()
        assert s["phase"] == "roundtable" and s["turns_done"] == 0

    def test_roundtable_double_tap(self):
        vote_all()
        a = adv("roundtable")
        assert a.status_code == 200 and a.json()["phase"] == "reveal"
        hist_len = len(a.json()["history"])
        b = adv("roundtable")
        assert b.json()["phase"] == "reveal" and len(b.json()["history"]) == hist_len == 1

    def test_reveal_double_tap_does_not_skip_day2_roundtable(self):
        a = adv("reveal")
        assert a.json()["phase"] == "day" and a.json()["day"] == 2
        b = adv("reveal")  # stale reveal screen tapping finish
        assert b.json()["phase"] == "day" and b.json()["day"] == 2
        s = state()
        assert s["phase"] == "day" and s["day"] == 2 and len(s["history"]) == 1

    def test_no_param_still_advances(self):
        r = adv()
        assert r.status_code == 200 and r.json()["phase"] == "roundtable" and r.json()["day"] == 2

    def test_invalid_expected_value_noop(self):
        r = adv("bogus")
        assert r.status_code == 200 and r.json()["phase"] == "roundtable"

    def test_empty_expected_treated_as_none(self):
        # ?expected= (empty) behaves like no param -> roundtable without votes must 400
        r = S.post(f"{API}/game/advance?expected=")
        assert r.status_code == 400

    def test_cleanup(self):
        S.delete(f"{API}/game")
        assert state()["exists"] is False


# Several phones taking turns at the same moment must not lose turns (read-modify-write race on the game doc)
class TestConcurrentTurns:
    def test_parallel_setup_turns_all_recorded(self):
        from concurrent.futures import ThreadPoolExecutor
        import requests
        lost = []
        for _ in range(3):
            S.delete(f"{API}/game")
            g, r = setup_game(12)
            fa = [p for p in g["players"] if r[p["id"]] == "faithful"]

            def turn(p):
                return requests.post(f"{API}/game/turn", json={"player_id": p["id"], "pin": pin_of(p["name"])}).status_code

            with ThreadPoolExecutor(len(fa)) as ex:
                codes = list(ex.map(turn, fa))
            assert codes == [200] * len(fa)
            lost.append(len(fa) - state()["turns_done"])
        S.delete(f"{API}/game")
        assert lost == [0, 0, 0], f"turns lost per trial (all returned 200): {lost}"
