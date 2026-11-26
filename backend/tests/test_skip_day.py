"""Games made in the app go straight from the start and from each banishment into the next plot
(no "the Traitors move" tap); in the endgame, straight to the final vote."""
import os
import sys

import pytest

pytest.importorskip("mongomock_motor")
os.environ.setdefault("MONGO_URL", "mongodb://localhost")
os.environ.setdefault("DB_NAME", "traitors_skip_day")
import motor.motor_asyncio as m  # noqa: E402
from mongomock_motor import AsyncMongoMockClient  # noqa: E402

m.AsyncIOMotorClient = AsyncMongoMockClient
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import server  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402


def _game(c, n, skip=True):
    names = [f"P{i}" for i in range(1, n + 1)]
    g = c.post("/api/games", json={"players": [{"name": x, "pin": f"{1000 + i}"} for i, x in enumerate(names)], "skip_day": skip}).json()
    code = g["code"]; ids = {p["name"]: p["id"] for p in g["players"]}; pin = {x: f"{1000 + i}" for i, x in enumerate(names)}
    turn = lambda x, **kw: c.post(f"/api/games/{code}/turn", json={"player_id": ids[x], "pin": pin[x], **kw})
    adv = lambda: c.post(f"/api/games/{code}/advance").json()
    for x in names:
        turn(x)
    return names, ids, turn, adv


def test_straight_into_the_plot_and_back_into_it_after_the_banishment():
    with TestClient(server.app) as c:
        names, ids, turn, adv = _game(c, 8)
        st = adv()
        assert st["phase"] == "night" and st["label"] == "Day 1"  # Begin Day 1 → the plot
        for x in names:
            turn(x)
        assert adv()["phase"] == "gather"
        for x in names:
            turn(x)
        assert adv()["phase"] == "reveal"
        assert adv()["phase"] == "roundtable"
        for x in names:
            turn(x, vote_target_id=ids[names[0] if x != names[0] else names[1]])
        assert adv()["phase"] == "banished"
        st = adv()
        if st["phase"] != "ended":
            assert st["phase"] == "night" and st["label"] == "Day 2"  # Begin Day 2 → the plot


def test_endgame_goes_straight_to_the_final_vote():
    with TestClient(server.app) as c:
        names, ids, turn, adv = _game(c, 4)
        assert adv()["phase"] == "roundtable"  # four players: no murders, straight to the vote


def test_without_skip_day_the_day_step_stays():
    with TestClient(server.app) as c:
        names, ids, turn, adv = _game(c, 8, skip=False)
        assert adv()["phase"] == "day"
        assert adv()["phase"] == "night"
