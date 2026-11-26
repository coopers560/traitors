"""A planned recruit turns at a random moment up to 10 minutes after the plot closes — before the
Round Table — so they can join the Traitors' chat (in-process, mongomock)."""
import asyncio
import os
import sys
from datetime import datetime, timedelta, timezone

import pytest

pytest.importorskip("mongomock_motor")
os.environ.setdefault("MONGO_URL", "mongodb://localhost")
os.environ.setdefault("DB_NAME", "traitors_recruit_delay")
import motor.motor_asyncio as m  # noqa: E402
from mongomock_motor import AsyncMongoMockClient  # noqa: E402

m.AsyncIOMotorClient = AsyncMongoMockClient
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import server  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

NAMES = [f"P{i}" for i in range(1, 11)]


def patch(code, fn):
    async def go():
        doc = await server.db.games.find_one({"code": code})
        fn(doc)
        await server.db.games.replace_one({"code": code}, doc)
    asyncio.run(go())


def _to_recruit_night(c):
    """10 players (2 Traitors). Night 1: lie low. Banish one Traitor. Night 2: the other recruits."""
    g = c.post("/api/games", json={"players": [{"name": n, "pin": f"{1000 + i}"} for i, n in enumerate(NAMES)]}).json()
    code = g["code"]; ids = {p["name"]: p["id"] for p in g["players"]}; pin = {n: f"{1000 + i}" for i, n in enumerate(NAMES)}
    priv = lambda n: c.post(f"/api/games/{code}/private", json={"player_id": ids[n], "pin": pin[n]}).json()
    role = {n: priv(n)["role"] for n in NAMES}
    T = [n for n in NAMES if role[n] == "traitor"]
    F = [n for n in NAMES if role[n] == "faithful"]
    assert len(T) == 2
    turn = lambda n, **kw: c.post(f"/api/games/{code}/turn", json={"player_id": ids[n], "pin": pin[n], **kw})
    adv = lambda: c.post(f"/api/games/{code}/advance")
    for n in NAMES:
        turn(n)
    adv(); adv()  # night 1
    for n in NAMES:
        turn(n)
    adv()  # gather
    for n in NAMES:
        turn(n)
    adv(); adv()  # reveal -> roundtable
    for n in NAMES:
        turn(n, vote_target_id=ids[T[1] if n != T[1] else F[0]])
    assert adv().json()["history"][-1]["banish"]["target_id"] == ids[T[1]]
    adv(); assert adv().json()["phase"] == "night"  # night 2
    assert turn(T[0], recruit_id=ids[F[0]]).status_code == 200
    alive = [n for n in NAMES if n != T[1]]
    for n in alive:
        if n != T[0]:
            turn(n)
    return code, ids, pin, T, F, alive, turn, adv, priv


def test_recruit_turns_at_a_random_moment_before_the_round_table():
    with TestClient(server.app) as c:
        code, ids, pin, T, F, alive, turn, adv, priv = _to_recruit_night(c)
        doc = asyncio.run(server.db.games.find_one({"code": code}))
        at = datetime.fromisoformat(doc["recruit_at"])
        assert timedelta(0) <= at - datetime.fromisoformat(doc["plot_done_at"]) <= timedelta(minutes=10, seconds=1)
        # not yet: still Faithful, no chat
        patch(code, lambda d: d.update(recruit_at=(datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat()))
        v = priv(F[0])
        assert v["role"] == "faithful" and v["recruited_now"] is False
        assert c.post(f"/api/games/{code}/chat", json={"player_id": ids[F[0]], "pin": pin[F[0]]}).json()["allowed"] is False
        # the moment comes: a Traitor now, told so, and in the chat — before the Round Table
        patch(code, lambda d: d.update(recruit_at=(datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat()))
        v = priv(F[0])
        assert v["role"] == "traitor" and v["recruited_now"] is True and T[0] in v["fellow_traitors"]
        assert c.post(f"/api/games/{code}/chat", json={"player_id": ids[F[0]], "pin": pin[F[0]]}).json()["allowed"] is True
        assert c.get(f"/api/games/{code}").json()["phase"] == "night"  # nothing public has changed
        # the reveal still announces it (once)
        adv()
        for n in alive:
            turn(n)
        rv = adv().json()
        assert rv["phase"] == "reveal" and rv["history"][-1]["recruited"] is True
        mod_log = asyncio.run(server.db.games.find_one({"code": code}))["event_log"]
        assert sum(1 for e in mod_log if e["kind"] == "recruit" and "turned" in e["text"]) == 1


def test_the_reveal_still_recruits_if_the_moment_never_came():
    with TestClient(server.app) as c:
        code, ids, pin, T, F, alive, turn, adv, priv = _to_recruit_night(c)
        patch(code, lambda d: d.update(recruit_at=(datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()))
        adv()
        for n in alive:
            turn(n)
        rv = adv().json()
        assert rv["history"][-1]["recruited"] is True
        v = priv(F[0])
        assert v["role"] == "traitor" and v["recruited_now"] is True
