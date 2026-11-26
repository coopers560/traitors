"""In-process rules tests (mongomock): the day cap, games stored before this change, the
ClaudAI passphrase against older 4-digit PIN hashes, the recruit cap, the live-game window
and the published story's inference for older games."""
import asyncio
import hashlib
import os
import sys
from datetime import datetime, timedelta, timezone

import pytest

pytest.importorskip("mongomock_motor")
os.environ.setdefault("MONGO_URL", "mongodb://localhost")
os.environ.setdefault("DB_NAME", "traitors_inprocess_test")
import motor.motor_asyncio as m  # noqa: E402
from mongomock_motor import AsyncMongoMockClient  # noqa: E402

m.AsyncIOMotorClient = AsyncMongoMockClient
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import server  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

PASS = "Harbour#Lights7"
NAMES = ["Ada", "Ben", "Cleo", "Dev", "Esme", "Finn", "Gus", "Ann", "Anna"]


def run(coro):
    return asyncio.run(coro)


def get_doc(code):
    return run(server.db.games.find_one({"code": code}, {"_id": 0}))


def patch(code, fn):
    """Edit a stored game document directly (to build states that take many rounds to reach,
    or to make a game look like one stored before this change)."""
    async def go():
        doc = await server.db.games.find_one({"code": code})
        fn(doc)
        await server.db.games.replace_one({"code": code}, doc)
    run(go())


def clear():
    run(server.db.games.delete_many({}))


def new_game(c, n=8, **extra):
    players = [{"name": NAMES[i], "pin": f"{2000 + i}"} for i in range(n)]
    r = c.post("/api/games", json={"players": players, **extra})
    assert r.status_code == 200, r.text
    return r.json()


def adv(c, code):
    r = c.post(f"/api/games/{code}/advance")
    assert r.status_code == 200, r.text
    return r.json()


def mod_view(c, code, secret=PASS):
    return c.post(f"/api/games/{code}/moderator", json={"passphrase": secret})


# ---------------- The day cap: Traitors win at the end of the last round of Day 12 ----------------
def test_day_cap_after_the_evening_table_of_day_12():
    with TestClient(server.app) as c:
        g = new_game(c, tables_per_day=2, claudai_passphrase=PASS)
        code = g["code"]
        patch(code, lambda d: d.update(phase="banished", day=23, cal_day=12, session="lunch", winner=None, revote_ids=[]))
        assert "Day 12 · Evening" in mod_view(c, code).json()["now"]["next"]
        st = adv(c, code)  # Day 12 · Lunch is not the last round: on to the evening
        assert (st["phase"], st["day"], st["cal_day"], st["session"]) == ("day", 24, 12, "evening")
        assert st["label"] == "Day 12 · Evening" and st["winner"] is None
        patch(code, lambda d: d.update(phase="banished"))
        assert mod_view(c, code).json()["now"]["next"] == "Game over after this reveal"
        st = adv(c, code)
        assert st["phase"] == "ended" and st["winner"] == "traitors"
        log = mod_view(c, code).json()["event_log"]
        assert "survived to the end of Day 12" in log[-1]["text"] and log[-1]["label"] == "Day 12 · Evening"


def test_day_cap_at_one_table_a_day():
    with TestClient(server.app) as c:
        g = new_game(c)
        code = g["code"]
        patch(code, lambda d: d.update(phase="banished", day=11, cal_day=11, winner=None, revote_ids=[]))
        st = adv(c, code)
        assert (st["phase"], st["day"], st["cal_day"], st["session"], st["label"]) == ("day", 12, 12, "", "Day 12")
        patch(code, lambda d: d.update(phase="banished"))
        st = adv(c, code)
        assert st["phase"] == "ended" and st["winner"] == "traitors"


def test_evening_of_day_11_goes_to_lunch_of_day_12():
    with TestClient(server.app) as c:
        g = new_game(c, tables_per_day=2)
        code = g["code"]
        patch(code, lambda d: d.update(phase="banished", day=22, cal_day=11, session="evening", winner=None, revote_ids=[]))
        st = adv(c, code)
        assert (st["phase"], st["day"], st["label"]) == ("day", 23, "Day 12 · Lunch")


# ---------------- Games stored before this change keep working ----------------
def _make_legacy(d, day):
    """Strip every field this change added, as a game stored before it would look."""
    d.update(day=day, winner=None, revote_ids=[])
    for k in ("cal_day", "session", "tables_per_day", "archived"):
        d.pop(k, None)
    for p in d["players"]:
        p.pop("started_as", None)
        p.pop("recruited_label", None)
    for e in d["event_log"]:
        e.pop("label", None)


def test_legacy_game_loads_with_defaults_and_plays_on():
    with TestClient(server.app) as c:
        g = new_game(c, claudai_passphrase=PASS)
        code = g["code"]
        patch(code, lambda d: (_make_legacy(d, 5), d.update(phase="banished")))
        assert "cal_day" not in get_doc(code)
        st = c.get(f"/api/games/{code}").json()
        assert (st["day"], st["cal_day"], st["session"], st["tables_per_day"], st["label"]) == (5, 5, "", 1, "Day 5")
        assert st["phase"] == "banished"
        st = adv(c, code)
        assert (st["phase"], st["day"], st["cal_day"], st["label"]) == ("day", 6, 6, "Day 6")
        doc = get_doc(code)
        assert doc["cal_day"] == 6 and doc["tables_per_day"] == 1 and doc["session"] == ""
        log = mod_view(c, code).json()["event_log"]
        assert log[-1]["text"] == "Day 6 began" and log[-1]["label"] == "Day 6"
        assert "label" not in log[0]  # older entries are left as they were


# ---------------- ClaudAI passphrase ----------------
def test_login_errors_and_no_game_in_progress():
    clear()
    with TestClient(server.app) as c:
        r = c.post("/api/moderator/login", json={"passphrase": PASS})
        assert r.status_code == 404
        assert c.post("/api/moderator/pin", json={"pin": PASS}).status_code == 404
        new_game(c)  # no ClaudAI host
        r = c.post("/api/moderator/login", json={"passphrase": PASS})
        assert r.status_code == 403
        assert r.json()["detail"] == "This game has no ClaudAI host yet — the game's host can nominate one from the ⋯ menu"


def test_login_with_the_passphrase_finds_the_game_in_progress():
    clear()
    with TestClient(server.app) as c:
        g = new_game(c, claudai_passphrase=PASS)
        code = g["code"]
        assert c.post("/api/moderator/login", json={"passphrase": PASS}).json() == {"code": code}
        # the older route and body still work
        assert c.post("/api/moderator/pin", json={"passphrase": PASS}).json() == {"code": code}
        assert c.post("/api/moderator/pin", json={"pin": PASS}).json() == {"code": code}
        assert c.post("/api/moderator/login", json={"pin": PASS}).json() == {"code": code}
        for body in ({"passphrase": "Nope#Nope1"}, {"passphrase": PASS.lower()}, {}):
            r = c.post("/api/moderator/login", json=body)
            assert r.status_code == 403 and r.json()["detail"] == "Wrong ClaudAI passphrase", body
        # 8 wrong guesses in 10 minutes lock it — even the right passphrase waits
        for i in range(6):  # (the empty body above isn't a guess; repeats of one wrong value count once)
            assert c.post("/api/moderator/login", json={"passphrase": f"Wrong#Guess{i}"}).status_code == 403
        r = c.post("/api/moderator/login", json={"passphrase": PASS})
        assert r.status_code == 429
        assert mod_view(c, code).status_code == 429
        server.PIN_FAILS.pop(code, None)
        assert c.post("/api/moderator/login", json={"passphrase": PASS}).json() == {"code": code}


def test_host_nominates_then_claudai_logs_in():
    clear()
    with TestClient(server.app) as c:
        g = new_game(c)
        code = g["code"]
        host = next(p for p in g["players"] if p["id"] == g["host_id"])
        host_pin = f"{2000 + NAMES.index(host['name'])}"
        r = c.post("/api/moderator/login", json={"passphrase": "Palm+Tree55"})
        assert r.status_code == 403 and "no ClaudAI host yet" in r.json()["detail"]
        r = c.post(f"/api/games/{code}/claudai", json={"player_id": host["id"], "pin": host_pin, "new_passphrase": "palm"})
        assert r.status_code == 400 and r.json()["detail"] == server.PASSPHRASE_RULE
        r = c.post(f"/api/games/{code}/claudai", json={"player_id": host["id"], "pin": host_pin, "new_passphrase": "Palm+Tree55"})
        assert r.status_code == 200 and r.json()["claudai"] is True
        assert get_doc(code)["moderator_pin_hash"].startswith("pbkdf2_sha256$")
        assert c.post("/api/moderator/login", json={"passphrase": "Palm+Tree55"}).json() == {"code": code}


def test_passphrase_is_stored_salted_and_slow_hashed():
    with TestClient(server.app) as c:
        a, b = new_game(c, claudai_passphrase=PASS), new_game(c, claudai_passphrase=PASS)
        ha, hb = get_doc(a["code"])["moderator_pin_hash"], get_doc(b["code"])["moderator_pin_hash"]
        assert ha.startswith("pbkdf2_sha256$") and hb.startswith("pbkdf2_sha256$")
        assert ha != hb  # salted: the same passphrase never hashes the same twice
        assert PASS not in ha and hashlib.sha256(PASS.encode()).hexdigest() not in ha
        assert mod_view(c, a["code"]).status_code == 200 and mod_view(c, b["code"]).status_code == 200
        assert server.verify_secret(ha, PASS) and not server.verify_secret(ha, PASS + "x")
        assert not server.verify_secret("pbkdf2_sha256$broken", PASS) and not server.verify_secret(None, PASS)
        # an older app's `moderator_pin` key still carries it (with the same strength rule)
        old = new_game(c, moderator_pin=PASS)
        assert old["claudai"] is True and mod_view(c, old["code"]).status_code == 200
        assert get_doc(old["code"])["moderator_pin_hash"].startswith("pbkdf2_sha256$")


def test_passphrase_rule():
    for ok in ["Abcdefg1!", "Sunny#Pool9", "aB3$aB3$", "Pass word1"]:
        assert server.passphrase_problem(ok) is None, ok
    for weak in [None, "", "Ab1!", "Abc1!xy", "abcdefg1!", "ABCDEFG1!", "Abcdefgh!", "Abcdefgh1", "12345678"]:
        assert server.passphrase_problem(weak) == server.PASSPHRASE_RULE, weak
    assert server.PASSPHRASE_RULE == "Use at least 8 characters with upper and lower case letters, a number and a symbol"


def test_legacy_four_digit_claudai_pin_still_opens_its_game():
    clear()
    with TestClient(server.app) as c:
        g = new_game(c)
        code = g["code"]
        patch(code, lambda d: d.update(moderator_pin_hash=hashlib.sha256(b"4321").hexdigest()))
        assert c.get(f"/api/games/{code}").json()["claudai"] is True
        assert c.post("/api/moderator/login", json={"passphrase": "4321"}).json() == {"code": code}
        assert c.post("/api/moderator/pin", json={"pin": "4321"}).json() == {"code": code}
        assert c.post(f"/api/games/{code}/moderator", json={"pin": "4321"}).status_code == 200
        assert mod_view(c, code, "4321").status_code == 200
        assert mod_view(c, code, "4322").status_code == 403
        # moving it on to a passphrase: the new one must be strong
        r = c.post(f"/api/games/{code}/moderator/pin", json={"pin": "4321", "new_pin": "5555"})
        assert r.status_code == 400 and r.json()["detail"] == server.PASSPHRASE_RULE
        r = c.post(f"/api/games/{code}/moderator/pin", json={"pin": "4321", "new_passphrase": "Fresh#Start1"})
        assert r.status_code == 200
        assert get_doc(code)["moderator_pin_hash"].startswith("pbkdf2_sha256$")
        assert mod_view(c, code, "Fresh#Start1").status_code == 200
        assert mod_view(c, code, "4321").status_code == 403


# ---------------- Never more than 2 Traitors ----------------
def _game(roles, credits=0, dead=()):
    players = [
        server.Player(name=f"P{i}", pin_hash="x", role=r, lives=0 if i in dead else 1)
        for i, r in enumerate(roles)
    ]
    return server.Game(code="UNIT1", players=players, recruit_credits=credits)


def test_recruit_cap():
    T, F = "traitor", "faithful"
    # an older game dealt 3 Traitors: one banished (a credit) still leaves 2 — no recruiting
    assert server.recruit_reason(_game([T, T, T] + [F] * 6, credits=1, dead={2})) is None
    # two still in: never, whatever credits are banked
    assert server.recruit_reason(_game([T, T] + [F] * 6, credits=2)) is None
    # one left with a banished Traitor to replace
    assert server.recruit_reason(_game([T, T] + [F] * 6, credits=1, dead={1})) == "banished"
    # an older game dealt a single Traitor among 8: the lone Traitor may recruit
    assert server.recruit_reason(_game([T] + [F] * 7)) == "alone"
    # fewer than six still in: never
    assert server.recruit_reason(_game([T, T] + [F] * 4, credits=1, dead={1})) is None


def test_a_recruit_never_lands_above_two_traitors():
    """Even a recruit already planned (e.g. by an older game's 3 Traitors) never resolves
    while 2 Traitors are still in."""
    with TestClient(server.app) as c:
        g = new_game(c)
        code = g["code"]
        doc = get_doc(code)
        traitors = [p["id"] for p in doc["players"] if p["role"] == "traitor"]
        target = next(p for p in doc["players"] if p["role"] == "faithful")
        assert len(traitors) == 2

        def planned(d):
            d.update(phase="gather", recruit_id=target["id"], recruit_credits=1,
                     turns_done=[p["id"] for p in d["players"]], target_id=None, murder_confirmed=False)
        patch(code, planned)
        st = adv(c, code)
        assert st["phase"] == "reveal" and st["history"][-1]["recruited"] is False
        assert next(p for p in get_doc(code)["players"] if p["id"] == target["id"])["role"] == "faithful"


# ---------------- One live game at a time, for up to 7 days of inactivity ----------------
def test_live_game_window_is_seven_days():
    clear()
    with TestClient(server.app) as c:
        g = new_game(c)
        code = g["code"]
        ago = lambda days: (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
        patch(code, lambda d: d.update(updated_at=ago(6)))
        assert c.get("/api/current").json() == {"code": code, "phase": "setup", "day": 1, "label": "Day 1", "players": 8}
        players = [{"name": n, "pin": f"{3000 + i}"} for i, n in enumerate(NAMES[:5])]
        assert c.post("/api/games", json={"players": players, "single": True}).status_code == 409
        patch(code, lambda d: d.update(updated_at=ago(8)))
        assert c.get("/api/current").json()["code"] is None
        r = c.post("/api/games", json={"players": players, "single": True, "tables_per_day": 2})
        assert r.status_code == 200
        cur = c.get("/api/current").json()
        assert cur["code"] == r.json()["code"] and cur["label"] == "Day 1 · Lunch"


# ---------------- The published story of an older game ----------------
def test_story_infers_started_as_and_recruits_for_older_games():
    with TestClient(server.app) as c:
        g = new_game(c, n=9)
        code = g["code"]
        ids = {p["name"]: p["id"] for p in g["players"]}
        assert c.get(f"/api/archive/{code}").status_code == 404  # not over yet

        def legacy_ended(d):
            _make_legacy(d, 4)
            role = {"Ada": "traitor", "Ben": "traitor", "Cleo": "traitor", "Anna": "traitor"}
            for p in d["players"]:
                p["role"] = role.get(p["name"], "faithful")
                p["lives"] = 0 if p["name"] in ("Dev", "Esme") else 1
            d["phase"], d["winner"] = "ended", "traitors"
            d["history"] = [
                {"day": 1, "murder": {"success": True, "victim_id": ids["Dev"], "victim_name": "Dev", "action": "Top up their water glass",
                                      "eliminated": True}, "banish": None, "winner": None},
                {"day": 2, "murder": {"success": False}, "recruited": True,
                 "banish": {"tally": [], "tie": False, "target_id": ids["Esme"], "name": "Esme", "eliminated": True,
                            "already_dead": False}, "winner": None},
            ]
            d["vote_log"] = [{"day": 2, "round": 1, "votes": [], "end_votes": []}]
            d["traitor_chat"] = [{"id": "x1", "t": "2026-01-01T00:00:00+00:00", "day": 2, "from_id": ids["Ada"],
                                  "from_name": "Ada", "text": "Ben next"}]
            d["event_log"] += [
                {"t": "2026-01-02T00:00:00+00:00", "day": 2, "label": "Day 2", "phase": "gather", "kind": "reveal",
                 "text": "No murder — Ben was recruited and is now a Traitor", "neutral": "Murder reveal: no murder — a Faithful was recruited"},
                {"t": "2026-01-03T00:00:00+00:00", "day": 3, "phase": "gather", "kind": "reveal",
                 "text": "No murder — Cleo was recruited and is now a Traitor", "neutral": "Murder reveal: no murder — a Faithful was recruited"},
                {"t": "2026-01-04T00:00:00+00:00", "day": 4, "phase": "gather", "kind": "reveal",
                 "text": "No murder — Anna was recruited and is now a Traitor", "neutral": "Murder reveal: no murder — a Faithful was recruited"},
            ]
        patch(code, legacy_ended)
        story = c.get(f"/api/archive/{code}").json()
        by = {p["name"]: p for p in story["players"]}
        assert (by["Ada"]["started_as"], by["Ada"]["recruited_label"]) == ("traitor", None)
        assert (by["Ben"]["role"], by["Ben"]["started_as"], by["Ben"]["recruited_label"]) == ("traitor", "faithful", "Day 2")
        assert (by["Cleo"]["started_as"], by["Cleo"]["recruited_label"]) == ("faithful", "Day 3")  # no label: "Day {day}"
        assert (by["Anna"]["started_as"], by["Anna"]["recruited_label"]) == ("faithful", "Day 4")
        assert (by["Ann"]["role"], by["Ann"]["started_as"], by["Ann"]["recruited_label"]) == ("faithful", "faithful", None)
        assert by["Dev"]["exit"] == {"how": "murdered", "label": "Day 1"}
        assert by["Esme"]["exit"] == {"how": "banished", "label": "Day 2"}
        assert by["Finn"]["exit"] is None
        assert [h["label"] for h in story["rounds"]] == ["Day 1", "Day 2"]
        assert story["rounds"][0]["murder"]["action"] == "Top up their water glass"
        assert story["vote_log"][0]["label"] == "Day 2" and story["traitor_chat"][0]["label"] == "Day 2"
        assert all(e["label"] for e in story["event_log"])
        assert story["tables_per_day"] == 1 and story["winner"] == "traitors"
        arch = c.get("/api/archive").json()["games"]
        assert any(x["code"] == code and x["label"] == "Day 4" and x["players"] == 9 for x in arch)


# ---------------- A tie re-run from the next round steps back to the tied round's label ----------------
@pytest.mark.parametrize("older_entry", [False, True])
def test_revote_rewind_restores_the_tied_round(older_entry):
    with TestClient(server.app) as c:
        g = new_game(c, tables_per_day=2, claudai_passphrase=PASS)
        code = g["code"]
        ids = {p["name"]: p["id"] for p in g["players"]}
        pin = {n: f"{2000 + i}" for i, n in enumerate(NAMES[:8])}
        turn = lambda n, **kw: c.post(f"/api/games/{code}/turn", json={"player_id": ids[n], "pin": pin[n], **kw})
        role = {n: c.post(f"/api/games/{code}/private", json={"player_id": ids[n], "pin": pin[n]}).json()["role"] for n in ids}
        for n in ids:
            turn(n)
        adv(c, code); adv(c, code)  # day -> night
        for n in ids:
            turn(n)
        adv(c, code)  # gather
        for n in ids:
            turn(n)
        adv(c, code); adv(c, code)  # reveal -> roundtable
        fa = [n for n in ids if role[n] == "faithful"]
        a, b = fa[0], fa[1]
        rest = [n for n in ids if n not in (a, b)]
        turn(a, vote_target_id=ids[b]); turn(b, vote_target_id=ids[a])
        for i, n in enumerate(rest):
            turn(n, vote_target_id=ids[a if i % 2 == 0 else b])
        assert adv(c, code)["history"][-1]["banish"]["tie"] is True

        def as_if_resolved_long_ago(d):
            d["revote_ids"] = []
            for k in ("revote_ids", "revote_names"):
                d["history"][-1]["banish"].pop(k, None)
            if older_entry:
                for k in ("cal_day", "session"):
                    d["history"][-1].pop(k, None)
        patch(code, as_if_resolved_long_ago)
        st = adv(c, code)
        assert (st["day"], st["label"]) == (2, "Day 1 · Evening")
        r = c.post(f"/api/games/{code}/moderator/revote", json={"passphrase": PASS})
        assert r.status_code == 200, r.text
        mod = r.json()
        assert (mod["phase"], mod["day"], mod["cal_day"], mod["session"], mod["label"]) == ("roundtable", 1, 1, "lunch", "Day 1 · Lunch")
        turn(a, vote_target_id=ids[b]); turn(b, vote_target_id=ids[a])
        for n in rest:
            turn(n, vote_target_id=ids[b])
        st = adv(c, code)
        assert st["phase"] == "banished" and st["history"][-1]["banish"]["round"] == 2 and st["label"] == "Day 1 · Lunch"
        st = adv(c, code)
        assert (st["phase"], st["day"], st["label"]) == ("day", 2, "Day 1 · Evening")
