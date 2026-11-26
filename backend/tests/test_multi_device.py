# Multi-phone sync: /game/advance?expected=<phase> idempotency tests (single global game, run with -n 0)
from test_traitors_game import API, S, G, setup_game, setup_game_traitors, pin_of, private, del_game


def adv(expected=None):
    url = f"{G()}/advance" + (f"?expected={expected}" if expected else "")
    return S.post(url)


def state():
    return S.get(f"{G()}").json()


def seed_setup_done():
    del_game()
    g, r = setup_game_traitors(8, 2)  # a murder + a banishment leaves 2 v 4: the chain never ends early
    for p in g["players"]:
        S.post(f"{G()}/turn", json={"player_id": p["id"], "pin": pin_of(p["name"])})
    return g, r


def roles_now():
    g = state()
    return {p["id"]: private(p["id"], pin_of(p["name"])).json().get("role") for p in g["players"]}


def vote_all():
    # Banish a Faithful (not the Traitor) so a single-elimination game keeps going. The
    # Traitor also confirms the planned murder was carried out, so it lands at the reveal.
    r = roles_now()
    g = state()
    alive = [p for p in g["players"] if p["alive"]]
    target = next(p for p in alive if r[p["id"]] == "faithful")
    for p in alive:
        vt = target["id"] if p["id"] != target["id"] else next(x["id"] for x in alive if x["id"] != p["id"])
        assert S.post(f"{G()}/turn", json={"player_id": p["id"], "pin": pin_of(p["name"]), "vote_target_id": vt}).status_code == 200


def gather_all():
    # Everyone checks in; the Traitor confirms the planned murder was carried out.
    r = roles_now()
    for p in [x for x in state()["players"] if x["alive"]]:
        body = {"player_id": p["id"], "pin": pin_of(p["name"])}
        if r[p["id"]] == "traitor":
            body["murder_done"] = True
        assert S.post(f"{G()}/turn", json=body).status_code == 200


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
        # New order: the day opens with the night (Traitors plot before the Round Table)
        assert adv("day").json()["phase"] == "night"
        assert adv("day").json()["phase"] == "night"
        s = state()
        assert s["phase"] == "night" and s["turns_done"] == 0

    def test_night_double_tap(self):
        night_all()  # the Traitors plan their murder; nothing is revealed at night
        a = adv("night")
        assert a.status_code == 200 and a.json()["phase"] == "gather"
        b = adv("night")
        assert b.json()["phase"] == "gather" and len(b.json()["history"]) == 0
        s = state()
        assert s["phase"] == "gather" and s["turns_done"] == 0

    def test_gather_double_tap(self):
        gather_all()
        a = adv("gather")
        assert a.status_code == 200 and a.json()["phase"] == "reveal"
        b = adv("gather")
        assert b.json()["phase"] == "reveal" and len(b.json()["history"]) == 1

    def test_reveal_double_tap(self):
        a = adv("reveal")
        assert a.json()["phase"] == "roundtable"
        b = adv("reveal")
        assert b.json()["phase"] == "roundtable"
        assert state()["turns_done"] == 0

    def test_roundtable_double_tap(self):
        vote_all()
        a = adv("roundtable")
        assert a.status_code == 200 and a.json()["phase"] == "banished"
        hist_len = len(a.json()["history"])
        b = adv("roundtable")
        assert b.json()["phase"] == "banished" and len(b.json()["history"]) == hist_len == 1

    def test_banished_double_tap_begins_day2(self):
        a = adv("banished")
        assert a.status_code == 200 and a.json()["phase"] == "day" and a.json()["day"] == 2
        b = adv("banished")  # stale banishment screen tapping finish
        assert b.json()["phase"] == "day" and b.json()["day"] == 2
        s = state()
        assert s["phase"] == "day" and s["day"] == 2 and len(s["history"]) == 1

    def test_no_param_still_advances(self):
        r = adv()
        assert r.status_code == 200 and r.json()["phase"] == "night" and r.json()["day"] == 2

    def test_invalid_expected_value_noop(self):
        r = adv("bogus")
        assert r.status_code == 200 and r.json()["phase"] == "night"

    def test_empty_expected_treated_as_none(self):
        # ?expected= (empty) behaves like no param -> night without turns must 400
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
