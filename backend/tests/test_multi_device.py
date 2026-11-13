# Multi-phone sync: /game/advance?expected=<phase> idempotency tests (single global game, run with -n 0)
from test_traitors_game import API, S, G, setup_game, pin_of, private, del_game


def adv(expected=None):
    url = f"{G()}/advance" + (f"?expected={expected}" if expected else "")
    return S.post(url)


def state():
    return S.get(f"{G()}").json()


def seed_setup_done():
    del_game()
    g, r = setup_game(5)
    for p in g["players"]:
        S.post(f"{G()}/turn", json={"player_id": p["id"], "pin": pin_of(p["name"])})
    return g, r


def roles_now():
    g = state()
    return {p["id"]: private(p["id"], pin_of(p["name"])).json().get("role") for p in g["players"]}


def vote_all():
    g = state()
    alive = [p for p in g["players"] if p["alive"]]
    target = alive[-1]
    for p in alive:
        vt = target["id"] if p["id"] != target["id"] else next(x["id"] for x in alive if x["id"] != p["id"])
        assert S.post(f"{G()}/turn", json={"player_id": p["id"], "pin": pin_of(p["name"]), "vote_target_id": vt}).status_code == 200


def night_all():
    r = roles_now()
    g = state()
    alive = [p for p in g["players"] if p["alive"]]
    af = [p for p in alive if r[p["id"]] == "faithful"]
    target = af[-1]["id"] if af else None
    committed = False
    for p in alive:
        if target and not committed and r[p["id"]] == "traitor":
            rr = S.post(f"{G()}/turn", json={"player_id": p["id"], "pin": pin_of(p["name"]), "target_id": target})
            assert rr.status_code == 200
            choices = rr.json()["action_choices"]
            assert S.post(f"{G()}/turn", json={"player_id": p["id"], "pin": pin_of(p["name"]), "action": choices[0]}).status_code == 200
            committed = True
        else:
            assert S.post(f"{G()}/turn", json={"player_id": p["id"], "pin": pin_of(p["name"])}).status_code == 200


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
        assert a.status_code == 200 and a.json()["phase"] == "banished"
        hist_len = len(a.json()["history"])
        b = adv("roundtable")
        assert b.json()["phase"] == "banished" and len(b.json()["history"]) == hist_len == 1

    def test_banished_double_tap(self):
        a = adv("banished")
        assert a.status_code == 200 and a.json()["phase"] == "night"
        b = adv("banished")  # second phone, same button
        assert b.json()["phase"] == "night"
        assert state()["turns_done"] == 0

    def test_night_double_tap(self):
        night_all()
        a = adv("night")
        assert a.status_code == 200 and a.json()["phase"] == "reveal"
        hist_len = len(a.json()["history"])
        b = adv("night")
        assert b.json()["phase"] == "reveal" and len(b.json()["history"]) == hist_len == 1

    def test_reveal_double_tap_does_not_skip_day2(self):
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
        r = S.post(f"{G()}/advance?expected=")
        assert r.status_code == 400

    def test_cleanup(self):
        del_game()
        assert S.get(f"{G()}").status_code == 404


# Several phones taking turns at the same moment must not lose turns (read-modify-write race on the game doc)
class TestConcurrentTurns:
    def test_parallel_setup_turns_all_recorded(self):
        from concurrent.futures import ThreadPoolExecutor
        import requests
        lost = []
        for _ in range(3):
            del_game()
            g, r = setup_game(12)
            fa = [p for p in g["players"] if r[p["id"]] == "faithful"]

            def turn(p):
                return requests.post(f"{G()}/turn", json={"player_id": p["id"], "pin": pin_of(p["name"])}).status_code

            with ThreadPoolExecutor(len(fa)) as ex:
                codes = list(ex.map(turn, fa))
            assert codes == [200] * len(fa)
            lost.append(len(fa) - state()["turns_done"])
        del_game()
        assert lost == [0, 0, 0], f"turns lost per trial (all returned 200): {lost}"
