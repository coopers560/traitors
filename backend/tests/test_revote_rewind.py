"""Re-running a tie that was resolved before revotes existed (in-process, mongomock)."""
import asyncio
import os
import sys

import pytest

pytest.importorskip("mongomock_motor")
os.environ.setdefault("MONGO_URL", "mongodb://localhost")
os.environ.setdefault("DB_NAME", "traitors_rewind_test")
import motor.motor_asyncio as m  # noqa: E402
from mongomock_motor import AsyncMongoMockClient  # noqa: E402

m.AsyncIOMotorClient = AsyncMongoMockClient
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import server  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

PASS = {"passphrase": server.MODERATOR_PASSPHRASE}
NAMES = ["Ada", "Ben", "Cleo", "Dev", "Esme", "Finn", "Gus", "Hana"]


def _legacy_tie(c):
    """Play to a tied Day 1 Round Table, then make it look like the old code resolved it
    (no revote pending) and the host began Day 2."""
    g = c.post("/api/games", json={"players": [{"name": n, "pin": f"{1000 + i}"} for i, n in enumerate(NAMES)], "murder_gap_hours": 0}).json()
    code = g["code"]
    ids = {p["name"]: p["id"] for p in g["players"]}
    pin = {n: f"{1000 + i}" for i, n in enumerate(NAMES)}
    turn = lambda n, **kw: c.post(f"/api/games/{code}/turn", json={"player_id": ids[n], "pin": pin[n], **kw})
    adv = lambda: c.post(f"/api/games/{code}/advance").json()
    role = {n: c.post(f"/api/games/{code}/private", json={"player_id": ids[n], "pin": pin[n]}).json()["role"] for n in NAMES}
    for n in NAMES:
        turn(n)
    adv()  # day
    adv()  # night
    for n in NAMES:
        turn(n)  # everyone lies low / passes
    adv()  # gather
    for n in NAMES:
        turn(n)
    adv()  # reveal
    adv()  # roundtable
    fa = [n for n in NAMES if role[n] == "faithful"]
    a, b = fa[0], fa[1]
    rest = [n for n in NAMES if n not in (a, b)]
    turn(a, vote_target_id=ids[b]); turn(b, vote_target_id=ids[a])
    for i, n in enumerate(rest):
        turn(n, vote_target_id=ids[a if i % 2 == 0 else b])
    assert adv()["phase"] == "banished"

    async def make_legacy():
        doc = await server.db.games.find_one({"code": code})
        doc["revote_ids"] = []
        for k in ("revote_ids", "revote_names"):
            doc["history"][-1]["banish"].pop(k, None)
        await server.db.games.replace_one({"code": code}, doc)
    asyncio.run(make_legacy())
    return code, ids, pin, a, b, rest, adv, turn


def test_rewind_next_day_into_a_revote():
    with TestClient(server.app) as c:
        code, ids, pin, a, b, rest, adv, turn = _legacy_tie(c)
        st = adv()
        assert st["phase"] == "day" and st["day"] == 2  # old behaviour: straight on
        mod = c.post(f"/api/games/{code}/moderator", json=PASS).json()
        assert mod["revote_available"] is True
        mod = c.post(f"/api/games/{code}/moderator/revote", json=PASS).json()
        assert mod["phase"] == "roundtable" and mod["day"] == 1 and set(mod["revote"]["ids"]) == {ids[a], ids[b]}
        turn(a, vote_target_id=ids[b]); turn(b, vote_target_id=ids[a])
        for n in rest:
            turn(n, vote_target_id=ids[b])
        st = adv()
        h = st["history"][-1]
        assert st["phase"] == "banished" and h["day"] == 1 and h["banish"]["round"] == 2
        assert h["banish"]["target_id"] == ids[b] and h["tie_vote"]["tie"]
        st = adv()
        assert st["phase"] == "day" and st["day"] == 2 and len(st["history"]) == 1
        # can't do it twice
        assert c.post(f"/api/games/{code}/moderator/revote", json=PASS).status_code == 400


def test_rewind_refused_once_the_night_has_started():
    with TestClient(server.app) as c:
        code, ids, pin, a, b, rest, adv, turn = _legacy_tie(c)
        adv()  # day 2
        adv()  # night 2
        assert c.post(f"/api/games/{code}/moderator/revote", json=PASS).status_code == 200  # nobody has moved yet


def test_rewind_during_the_night_clears_night_turns():
    with TestClient(server.app) as c:
        code, ids, pin, a, b, rest, adv, turn = _legacy_tie(c)
        adv(); adv()  # night 2
        for n in rest[:3]:
            turn(n)
        mod = c.post(f"/api/games/{code}/moderator", json=PASS).json()
        assert mod["revote_available"] is True and "3 night turns" in mod["revote_note"]
        mod = c.post(f"/api/games/{code}/moderator/revote", json=PASS).json()
        assert mod["phase"] == "roundtable" and mod["day"] == 1 and mod["turns_done"] == 0
        assert mod["tonight"] is None


def test_rewind_refused_once_the_round_table_gathers():
    with TestClient(server.app) as c:
        code, ids, pin, a, b, rest, adv, turn = _legacy_tie(c)
        adv(); adv()  # night 2
        for n in NAMES:
            turn(n)
        adv()  # gather: the murder may have been carried out for real
        r = c.post(f"/api/games/{code}/moderator/revote", json=PASS)
        assert r.status_code == 400 and "Too late" in r.json()["detail"]
