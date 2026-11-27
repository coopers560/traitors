"""The sign-up sheet: everyone adds themselves on their own phone, each spot locked to the phone
that made it, then the host chooses the Traitors and every phone learns which player it is.
(In-process, mongomock.)"""
import asyncio
import os
import sys
from datetime import datetime, timedelta, timezone

import pytest

pytest.importorskip("mongomock_motor")
os.environ.setdefault("MONGO_URL", "mongodb://localhost")
os.environ.setdefault("DB_NAME", "traitors_lobby_test")
import motor.motor_asyncio as m  # noqa: E402
from mongomock_motor import AsyncMongoMockClient  # noqa: E402

m.AsyncIOMotorClient = AsyncMongoMockClient
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import server  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

HOST = "device-host-0001"
PHONES = [f"device-phone-{i:04d}" for i in range(1, 8)]


def _clean():
    async def go():
        await server.db.lobbies.delete_many({})
        await server.db.games.delete_many({})
    asyncio.run(go())


def _lobby(c, device):
    return c.get(f"/api/lobby?device={device}").json()


def _mine_open(st):
    return next(s for s in st["slots"] if s["mine"] and not s["ready"])


def _sign_up(c, device, name, pin):
    st = c.post("/api/lobby/join", json={"device": device}).json()
    slot = _mine_open(st)
    r = c.post("/api/lobby/save", json={"device": device, "slot_id": slot["id"], "name": name, "pin": pin})
    assert r.status_code == 200, r.text
    return slot["id"]


def test_everyone_signs_up_on_their_own_phone_and_the_host_starts_the_game():
    _clean()
    with TestClient(server.app) as c:
        st = c.post("/api/lobby", json={"device": HOST}).json()
        assert st["you_host"] and len(st["slots"]) == 1 and st["slots"][0]["mine"]
        host_slot = st["slots"][0]["id"]
        c.post("/api/lobby/save", json={"device": HOST, "slot_id": host_slot, "name": "Dale", "pin": "1111"})
        # Another phone sees the sheet live, but not as host and not the host's spot as its own.
        other = _lobby(c, PHONES[0])
        assert other["exists"] and not other["you_host"] and other["host_name"] == "Dale"
        assert not other["slots"][0]["mine"] and other["slots"][0]["host"]
        slots = {}
        for i, ph in enumerate(PHONES[:5]):
            slots[ph] = _sign_up(c, ph, f"P{i}", f"{2000 + i}")
        # PINs never come back to anyone.
        assert all("pin_hash" not in s for s in _lobby(c, PHONES[0])["slots"])
        # Only the host can start it.
        assert c.post("/api/lobby/start", json={"device": PHONES[0]}).status_code == 403
        st = c.post("/api/lobby/start", json={"device": HOST}).json()
        code = st["started_code"]
        assert code and st["my_players"] and list(st["my_players"]) == [host_slot]
        game = c.get(f"/api/games/{code}").json()
        names = [p["name"] for p in game["players"]]
        assert names == ["Dale", "P0", "P1", "P2", "P3", "P4"]
        assert game["host_name"] == "Dale" and game["traitors_plot_alone"] is True
        # Each phone learns which player it signed up, and that player's PIN is the one typed.
        mine = _lobby(c, PHONES[2])["my_players"]
        pid = mine[slots[PHONES[2]]]
        v = c.post(f"/api/games/{code}/private", json={"player_id": pid, "pin": "2002"})
        assert v.status_code == 200 and v.json()["name"] == "P2"


def test_a_spot_is_locked_to_the_phone_that_made_it():
    _clean()
    with TestClient(server.app) as c:
        c.post("/api/lobby", json={"device": HOST})
        st = c.post("/api/lobby/join", json={"device": PHONES[0]}).json()
        slot = _mine_open(st)
        # Seen by others as taken, with no name yet.
        theirs = next(s for s in _lobby(c, PHONES[1])["slots"] if s["id"] == slot["id"])
        assert not theirs["mine"] and theirs["name"] is None and not theirs["ready"]
        r = c.post("/api/lobby/save", json={"device": PHONES[1], "slot_id": slot["id"], "name": "Sneaky", "pin": "1234"})
        assert r.status_code == 403
        # Joining twice before finishing gives the same spot back, not a second one.
        again = c.post("/api/lobby/join", json={"device": PHONES[0]}).json()
        assert sum(1 for s in again["slots"] if s["mine"]) == 1


def test_names_must_differ_and_pins_be_four_digits():
    _clean()
    with TestClient(server.app) as c:
        c.post("/api/lobby", json={"device": HOST})
        _sign_up(c, PHONES[0], "Ada", "1234")
        st = c.post("/api/lobby/join", json={"device": PHONES[1]}).json()
        slot = _mine_open(st)
        assert c.post("/api/lobby/save", json={"device": PHONES[1], "slot_id": slot["id"], "name": "ada", "pin": "1234"}).status_code == 400
        assert c.post("/api/lobby/save", json={"device": PHONES[1], "slot_id": slot["id"], "name": "Ben", "pin": "12a4"}).status_code == 400
        assert c.post("/api/lobby/save", json={"device": PHONES[1], "slot_id": slot["id"], "name": "Ben", "pin": "1234"}).status_code == 200


def test_one_phone_can_sign_up_several_players_and_the_host_can_remove_spots():
    _clean()
    with TestClient(server.app) as c:
        st = c.post("/api/lobby", json={"device": HOST}).json()
        c.post("/api/lobby/save", json={"device": HOST, "slot_id": st["slots"][0]["id"], "name": "Host", "pin": "1111"})
        a = _sign_up(c, PHONES[0], "A", "1000")
        b = _sign_up(c, PHONES[0], "B", "1001")
        assert sum(1 for s in _lobby(c, PHONES[0])["slots"] if s["mine"]) == 2
        # Someone can't remove another phone's spot; the host can.
        assert c.post("/api/lobby/remove", json={"device": PHONES[1], "slot_id": a}).status_code == 403
        assert c.post("/api/lobby/remove", json={"device": HOST, "slot_id": a}).status_code == 200
        assert [s["id"] for s in _lobby(c, HOST)["slots"] if not s["host"]] == [b]


def test_start_waits_for_half_filled_spots_and_needs_four():
    _clean()
    with TestClient(server.app) as c:
        st = c.post("/api/lobby", json={"device": HOST}).json()
        c.post("/api/lobby/save", json={"device": HOST, "slot_id": st["slots"][0]["id"], "name": "Host", "pin": "1111"})
        _sign_up(c, PHONES[0], "A", "1000")
        _sign_up(c, PHONES[1], "B", "1001")
        r = c.post("/api/lobby/start", json={"device": HOST})
        assert r.status_code == 400 and "4" in r.json()["detail"]
        _sign_up(c, PHONES[2], "C", "1002")
        c.post("/api/lobby/join", json={"device": PHONES[3]})  # still typing
        r = c.post("/api/lobby/start", json={"device": HOST})
        assert r.status_code == 400 and "Wait" in r.json()["detail"]

        # A spot left half-filled for too long frees up by itself.
        async def age():
            doc = await server.db.lobbies.find_one({"id": "current"})
            for sl in doc["slots"]:
                if not sl["ready"]:
                    sl["touched_at"] = (datetime.now(timezone.utc) - timedelta(minutes=11)).isoformat()
            await server.db.lobbies.replace_one({"id": "current"}, doc)
        asyncio.run(age())
        assert c.post("/api/lobby/start", json={"device": HOST}).json()["started_code"]


def test_only_one_game_and_a_new_sign_up_after_it_ends():
    _clean()
    with TestClient(server.app) as c:
        st = c.post("/api/lobby", json={"device": HOST}).json()
        c.post("/api/lobby/save", json={"device": HOST, "slot_id": st["slots"][0]["id"], "name": "Host", "pin": "1111"})
        for i in range(3):
            _sign_up(c, PHONES[i], f"P{i}", f"{3000 + i}")
        code = c.post("/api/lobby/start", json={"device": HOST}).json()["started_code"]
        # While the game is on, nobody can open another sign-up.
        assert c.post("/api/lobby", json={"device": PHONES[4]}).status_code == 409
        # Starting a second sign-up through someone else's phone while one is open just shows it.

        async def end():
            await server.db.games.update_one({"code": code}, {"$set": {"phase": "ended"}})
        asyncio.run(end())
        assert _lobby(c, HOST) == {"exists": False}
        st = c.post("/api/lobby", json={"device": PHONES[4]}).json()
        assert st["you_host"] and len(st["slots"]) == 1


def test_the_host_sets_the_round_tables_and_can_cancel():
    _clean()
    with TestClient(server.app) as c:
        c.post("/api/lobby", json={"device": HOST})
        assert c.post("/api/lobby", json={"device": PHONES[0]}).json()["you_host"] is False  # the open one, not a new one
        assert c.post("/api/lobby/settings", json={"device": PHONES[0], "tables_per_day": 1}).status_code == 403
        assert c.post("/api/lobby/settings", json={"device": HOST, "tables_per_day": 1}).json()["tables_per_day"] == 1
        assert c.delete(f"/api/lobby?device={PHONES[0]}").status_code == 403
        assert c.delete(f"/api/lobby?device={HOST}").json() == {"exists": False}
        assert _lobby(c, PHONES[0]) == {"exists": False}


def test_bad_device_ids_are_refused():
    _clean()
    with TestClient(server.app) as c:
        assert c.get("/api/lobby?device=x").status_code == 400
        assert c.post("/api/lobby", json={"device": "bad id!"}).status_code == 400


def _age_holds(seconds):
    async def go():
        doc = await server.db.lobbies.find_one({"id": "current"})
        for sl in doc["slots"]:
            if not sl["ready"]:
                sl["touched_at"] = (datetime.now(timezone.utc) - timedelta(seconds=seconds)).isoformat()
        await server.db.lobbies.replace_one({"id": "current"}, doc)
    asyncio.run(go())


def test_tapping_a_box_holds_it_and_a_taken_box_is_refused():
    _clean()
    with TestClient(server.app) as c:
        c.post("/api/lobby", json={"device": HOST})
        st = c.post("/api/lobby/join", json={"device": PHONES[0], "pos": 4}).json()
        mine = next(s for s in st["slots"] if s["mine"])
        assert mine["pos"] == 4 and not mine["ready"]
        r = c.post("/api/lobby/join", json={"device": PHONES[1], "pos": 4})
        assert r.status_code == 409  # someone is already in that box
        # Tapping another box moves this phone's hold there instead of taking two.
        st = c.post("/api/lobby/join", json={"device": PHONES[0], "pos": 6}).json()
        assert [s["pos"] for s in st["slots"] if s["mine"]] == [6]
        assert c.post("/api/lobby/join", json={"device": PHONES[1], "pos": 4}).status_code == 200
        assert c.post("/api/lobby/join", json={"device": PHONES[2], "pos": 15}).status_code == 400


def test_leaving_without_saving_frees_the_box_and_staying_keeps_it():
    _clean()
    with TestClient(server.app) as c:
        c.post("/api/lobby", json={"device": HOST})
        c.post("/api/lobby/join", json={"device": PHONES[0], "pos": 1})
        c.post("/api/lobby/join", json={"device": PHONES[1], "pos": 2})
        _age_holds(25)
        _lobby(c, PHONES[0])  # phone 0 is still on the sign-up: its refresh renews the hold
        async def age_only(device, seconds):
            doc = await server.db.lobbies.find_one({"id": "current"})
            for sl in doc["slots"]:
                if not sl["ready"] and sl["device"] == device:
                    sl["touched_at"] = (datetime.now(timezone.utc) - timedelta(seconds=seconds)).isoformat()
            await server.db.lobbies.replace_one({"id": "current"}, doc)
        asyncio.run(age_only(PHONES[1], 40))  # phone 1 left 40 seconds ago
        st = _lobby(c, HOST)
        held = sorted(s["pos"] for s in st["slots"])
        assert 1 in held and 2 not in held


def test_saved_box_is_kept_and_only_its_phone_or_the_host_can_remove_it():
    _clean()
    with TestClient(server.app) as c:
        c.post("/api/lobby", json={"device": HOST})
        sid = _sign_up(c, PHONES[0], "Ada", "1234")
        _age_holds(3600)
        assert any(s["id"] == sid for s in _lobby(c, PHONES[1])["slots"])  # saved boxes never expire
        assert c.post("/api/lobby/join", json={"device": PHONES[1], "pos": next(s["pos"] for s in _lobby(c, HOST)["slots"] if s["id"] == sid)}).status_code == 409
        assert c.post("/api/lobby/remove", json={"device": PHONES[1], "slot_id": sid}).status_code == 403
        assert c.post("/api/lobby/remove", json={"device": PHONES[0], "slot_id": sid}).status_code == 200


def test_the_host_on_a_new_phone_takes_over_with_their_pin():
    _clean()
    with TestClient(server.app) as c:
        st = c.post("/api/lobby", json={"device": HOST}).json()
        c.post("/api/lobby/save", json={"device": HOST, "slot_id": st["slots"][0]["id"], "name": "Dale", "pin": "1111"})
        new = "device-host-new-0002"
        assert c.post("/api/lobby/host", json={"device": new, "pin": "9999"}).status_code == 403
        st = c.post("/api/lobby/host", json={"device": new, "pin": "1111"}).json()
        assert st["you_host"] and st["slots"][0]["mine"] and st["host_name"] == "Dale"
        assert _lobby(c, HOST)["you_host"] is False


def test_anyone_takes_over_from_a_host_who_never_added_themselves_and_left():
    _clean()
    with TestClient(server.app) as c:
        c.post("/api/lobby", json={"device": HOST})
        assert c.post("/api/lobby/host", json={"device": PHONES[0]}).status_code == 403  # the host is still here

        async def gone():
            doc = await server.db.lobbies.find_one({"id": "current"})
            doc["host_seen_at"] = (datetime.now(timezone.utc) - timedelta(minutes=3)).isoformat()
            await server.db.lobbies.replace_one({"id": "current"}, doc)
        asyncio.run(gone())
        assert _lobby(c, PHONES[0])["host_away"] is True
        assert c.post("/api/lobby/host", json={"device": PHONES[0]}).json()["you_host"] is True


def test_the_host_needs_a_box_to_start():
    _clean()
    with TestClient(server.app) as c:
        st = c.post("/api/lobby", json={"device": HOST}).json()
        c.post("/api/lobby/remove", json={"device": HOST, "slot_id": st["slots"][0]["id"]})
        for i in range(4):
            _sign_up(c, PHONES[i], f"P{i}", f"{4000 + i}")
        r = c.post("/api/lobby/start", json={"device": HOST})
        assert r.status_code == 400 and "host" in r.json()["detail"]


def test_a_game_made_the_old_way_closes_the_open_sign_up():
    _clean()
    with TestClient(server.app) as c:
        c.post("/api/lobby", json={"device": HOST})
        r = c.post("/api/games", json={"players": [{"name": f"Q{i}", "pin": "1234"} for i in range(4)], "single": True})
        assert r.status_code == 200
        code = r.json()["code"]

        async def end():
            await server.db.games.update_one({"code": code}, {"$set": {"phase": "ended"}})
        asyncio.run(end())
        assert _lobby(c, HOST) == {"exists": False}  # the old sheet doesn't come back


def test_box_one_is_always_the_hosts():
    _clean()
    with TestClient(server.app) as c:
        st = c.post("/api/lobby", json={"device": HOST}).json()
        assert st["slots"][0]["pos"] == 0 and st["slots"][0]["mine"]
        c.post("/api/lobby/remove", json={"device": HOST, "slot_id": st["slots"][0]["id"]})
        assert c.post("/api/lobby/join", json={"device": PHONES[0], "pos": 0}).status_code == 409
        st = c.post("/api/lobby/join", json={"device": PHONES[0]}).json()
        assert [s["pos"] for s in st["slots"] if s["mine"]] == [1]  # never box 1
        st = c.post("/api/lobby/join", json={"device": HOST, "pos": 5}).json()
        assert [s["pos"] for s in st["slots"] if s["mine"]] == [0]  # the host goes back to box 1
