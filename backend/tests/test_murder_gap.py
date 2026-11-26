"""The Traitors get time to carry out the murder: after everyone has taken their plot turn, the
Round Table stays shut for murder_window_minutes (in-process, mongomock). The old 'hours between
murders' gap is retired and never blocks anything."""
import asyncio
import os
import sys
from datetime import datetime, timedelta, timezone

import pytest

pytest.importorskip("mongomock_motor")
os.environ.setdefault("MONGO_URL", "mongodb://localhost")
os.environ.setdefault("DB_NAME", "traitors_window_test")
import motor.motor_asyncio as m  # noqa: E402
from mongomock_motor import AsyncMongoMockClient  # noqa: E402

m.AsyncIOMotorClient = AsyncMongoMockClient
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import server  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

NAMES = ["Ada", "Ben", "Cleo", "Dev", "Esme", "Finn", "Gus", "Hana"]
PASS = "Window#Test1"


def _plot(c, window=30, murder=True):
    body = {"players": [{"name": n, "pin": f"{1000 + i}"} for i, n in enumerate(NAMES)], "murder_window_minutes": window,
            "claudai_passphrase": PASS}
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
    adv(); assert adv().json()["phase"] == "night"
    if murder:
        r = turn(T[0], target_id=ids[F[0]]).json()
        turn(T[0], action=r["action_choices"][0])
    for n in NAMES:
        if not (murder and n == T[0]):
            turn(n)
    return code, ids, pin, T, F, turn, adv


def _age(code, minutes):
    async def go():
        doc = await server.db.games.find_one({"code": code})
        doc["plot_done_at"] = (datetime.now(timezone.utc) - timedelta(minutes=minutes)).isoformat()
        await server.db.games.replace_one({"code": code}, doc)
    asyncio.run(go())


def test_round_table_waits_after_the_plot():
    with TestClient(server.app) as c:
        code, ids, pin, T, F, turn, adv = _plot(c)
        st = c.get(f"/api/games/{code}").json()
        assert st["phase"] == "night" and st["round_table_at"] and st["murder_window_minutes"] == 30
        r = adv()
        assert r.status_code == 400 and "The Round Table opens in" in r.json()["detail"]
        _age(code, 31)
        assert c.get(f"/api/games/{code}").json()["round_table_at"] is None
        assert adv().json()["phase"] == "gather"


def test_the_wait_is_the_same_when_the_traitors_lie_low():
    with TestClient(server.app) as c:
        code, *_rest, adv = _plot(c, murder=False)
        st = c.get(f"/api/games/{code}").json()
        assert st["round_table_at"]  # same wait — it never shows whether a murder was planned
        assert adv().status_code == 400


def test_the_plan_locks_once_everyone_has_gone():
    with TestClient(server.app) as c:
        code, ids, pin, T, F, turn, adv = _plot(c)
        r = turn(T[0], target_id=ids[F[1]])
        assert r.status_code == 400 and "locked" in r.json()["detail"]
        assert turn(F[0]).status_code == 200  # an ordinary (pass) turn is still fine


def test_claudai_can_change_the_wait_and_zero_never_waits():
    with TestClient(server.app) as c:
        code, *_rest, adv = _plot(c)
        r = c.post(f"/api/games/{code}/moderator/schedule", json={"passphrase": PASS, "murder_window_minutes": 0})
        assert r.status_code == 200 and r.json()["murder_window_minutes"] == 0 and r.json()["round_table_at"] is None
        assert adv().json()["phase"] == "gather"
        bad = c.post(f"/api/games/{code}/moderator/schedule", json={"passphrase": PASS, "murder_window_minutes": 500})
        assert bad.status_code == 400


def test_the_old_gap_between_murders_never_blocks():
    with TestClient(server.app) as c:
        code, ids, pin, T, F, turn, adv = _plot(c, window=0)
        assert adv().json()["phase"] == "gather"
        for n in NAMES:
            turn(n, murder_done=True) if n in T else turn(n)
        assert adv().json()["history"][-1]["murder"]["success"] is True
        adv()  # roundtable
        for n in [x for x in NAMES if x != F[0]]:
            turn(n, vote_target_id=ids[F[1] if n != F[1] else F[2]])
        adv(); st = adv().json()  # banished -> next round
        if st["phase"] == "day":
            assert st["next_plot_at"] is None
            assert adv().json()["phase"] == "night"  # straight away, no 3-hour wait
