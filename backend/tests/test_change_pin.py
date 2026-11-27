"""Players can change their own PIN during the game. (In-process, mongomock.)"""
import os
import sys

import pytest

pytest.importorskip("mongomock_motor")
os.environ.setdefault("MONGO_URL", "mongodb://localhost")
os.environ.setdefault("DB_NAME", "traitors_change_pin_test")
import motor.motor_asyncio as m  # noqa: E402
from mongomock_motor import AsyncMongoMockClient  # noqa: E402

m.AsyncIOMotorClient = AsyncMongoMockClient
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import server  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402


def test_change_pin():
    with TestClient(server.app) as c:
        g = c.post("/api/games", json={"players": [{"name": f"P{i}", "pin": f"{1000 + i}"} for i in range(5)]}).json()
        code, pid = g["code"], g["players"][1]["id"]
        url = f"/api/games/{code}/pin"
        assert c.post(url, json={"player_id": pid, "pin": "9999", "new_pin": "4321"}).status_code == 401
        assert c.post(url, json={"player_id": pid, "pin": "1001", "new_pin": "43a1"}).status_code == 400
        assert c.post(url, json={"player_id": pid, "pin": "1001", "new_pin": "4321"}).json() == {"ok": True}
        priv = f"/api/games/{code}/private"
        assert c.post(priv, json={"player_id": pid, "pin": "1001"}).status_code == 401
        assert c.post(priv, json={"player_id": pid, "pin": "4321"}).json()["name"] == "P1"
