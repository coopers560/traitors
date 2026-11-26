"""Murders can't come in quick succession (in-process, mongomock)."""
import asyncio
import os
import sys
from datetime import datetime, timedelta, timezone

import pytest

pytest.importorskip("mongomock_motor")
os.environ.setdefault("MONGO_URL", "mongodb://localhost")
os.environ.setdefault("DB_NAME", "traitors_gap_test")
import motor.motor_asyncio as m  # noqa: E402
from mongomock_motor import AsyncMongoMockClient  # noqa: E402

m.AsyncIOMotorClient = AsyncMongoMockClient
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import server  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

NAMES = ["Ada", "Ben", "Cleo", "Dev", "Esme", "Finn", "Gus", "Hana"]


def _murder_day_one(c, gap=None):
    body = {"players": [{"name": n, "pin": f"{1000 + i}"} for i, n in enumerate(NAMES)]}
    if gap is not None:
        body["murder_gap_hours"] = gap
    g = c.post("/api/games", json=body).json()
    code = g["code"]
    ids = {p["name"]: p["id"] for p in g["players"]}
    pin = {n: f"{1000 + i}" for i, n in enumerate(NAMES)}
    turn = lambda n, **kw: c.post(f"/api/games/{code}/turn", json={"player_id": ids[n], "pin": pin[n], **kw})
    adv = lambda: c.post(f"/api/games/{code}/advance")
    role = {n: c.post(f"/api/games/{code}/private", json={"player_id": ids[n], "pin": pin[n]}).json()["role"] for n in NAMES}
    T = [n for n in NAMES if role[n] == "traitor"]
    F = [n for n in NAMES if role[n] == "faithful"]
    for n in NAMES:
        turn(n)
    adv(); adv()  # day -> night
    r = turn(T[0], target_id=ids[F[0]]).json()
    turn(T[0], action=r["action_choices"][0])
    for n in NAMES:
        if n != T[0]:
            turn(n)
    adv()  # gather
    for n in NAMES:
        if n != F[0]:
            turn(n, murder_done=True) if n in T else turn(n)
    turn(F[0])
    assert adv().json()["history"][-1]["murder"]["success"] is True
    adv()  # -> roundtable
    alive = [n for n in NAMES if n != F[0]]
    for n in alive:
        turn(n, vote_target_id=ids[F[1] if n != F[1] else F[2]])
    adv(); adv()  # banished -> day 2
    return code, adv


def test_next_night_waits_for_the_gap():
    with TestClient(server.app) as c:
        code, adv = _murder_day_one(c)  # default gap: 3 hours
        st = c.get(f"/api/games/{code}").json()
        assert st["phase"] == "day" and st["next_plot_at"] and st["murder_gap_hours"] == 3
        r = adv()
        assert r.status_code == 400 and "Too soon after the last murder" in r.json()["detail"]
        # three hours later the Traitors may plot again
        async def age():
            doc = await server.db.games.find_one({"code": code})
            doc["last_murder_at"] = (datetime.now(timezone.utc) - timedelta(hours=3, minutes=1)).isoformat()
            await server.db.games.replace_one({"code": code}, doc)
        asyncio.run(age())
        assert c.get(f"/api/games/{code}").json()["next_plot_at"] is None
        assert adv().json()["phase"] == "night"


def test_games_from_before_the_rule_use_the_event_log():
    with TestClient(server.app) as c:
        code, adv = _murder_day_one(c)
        async def legacy():
            doc = await server.db.games.find_one({"code": code})
            doc.pop("last_murder_at", None)  # stored before last_murder_at existed
            await server.db.games.replace_one({"code": code}, doc)
        asyncio.run(legacy())
        assert c.get(f"/api/games/{code}").json()["next_plot_at"]  # found in the event log
        assert adv().status_code == 400


def test_zero_gap_never_waits():
    with TestClient(server.app) as c:
        code, adv = _murder_day_one(c, gap=0)
        assert c.get(f"/api/games/{code}").json()["next_plot_at"] is None
        assert adv().json()["phase"] == "night"
