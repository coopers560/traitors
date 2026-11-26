"""Traitors-only plot: nobody else takes a plot turn. The Traitors plan from their menu; the first
seal (a murder, a recruit or lying low) closes the plot for both, and the Round Table opens
murder_window_minutes later. Nothing public changes when a Traitor acts — no ticks, no Round
Table time, no role-neutral log entry. (In-process, mongomock.)"""
import asyncio
import os
import sys
from datetime import datetime, timedelta, timezone

import pytest

pytest.importorskip("mongomock_motor")
os.environ.setdefault("MONGO_URL", "mongodb://localhost")
os.environ.setdefault("DB_NAME", "traitors_plot_alone_test")
import motor.motor_asyncio as m  # noqa: E402
from mongomock_motor import AsyncMongoMockClient  # noqa: E402

m.AsyncIOMotorClient = AsyncMongoMockClient
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import server  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

NAMES = ["Ada", "Ben", "Cleo", "Dev", "Esme", "Finn", "Gus", "Hana"]
PASS = "Alone#Plot1"


def _game(c, window=30, alone=True):
    body = {"players": [{"name": n, "pin": f"{1000 + i}"} for i, n in enumerate(NAMES)], "murder_window_minutes": window,
            "claudai_passphrase": PASS, "skip_day": True, "traitors_plot_alone": alone}
    g = c.post("/api/games", json=body).json()
    code = g["code"]
    ids = {p["name"]: p["id"] for p in g["players"]}
    pin = {n: f"{1000 + i}" for i, n in enumerate(NAMES)}
    turn = lambda n, **kw: c.post(f"/api/games/{code}/turn", json={"player_id": ids[n], "pin": pin[n], **kw})
    view = lambda n: c.post(f"/api/games/{code}/private", json={"player_id": ids[n], "pin": pin[n]}).json()
    adv = lambda force=False: c.post(f"/api/games/{code}/advance" + ("?force=true" if force else ""))
    state = lambda: c.get(f"/api/games/{code}").json()
    role = {n: view(n)["role"] for n in NAMES}
    T = [n for n in NAMES if role[n] == "traitor"]
    F = [n for n in NAMES if role[n] == "faithful"]
    for n in NAMES:
        turn(n)
    assert adv().json()["phase"] == "night"
    return dict(code=code, ids=ids, T=T, F=F, turn=turn, view=view, adv=adv, state=state)


def _age(code, minutes):
    async def go():
        doc = await server.db.games.find_one({"code": code})
        shift = timedelta(minutes=minutes)
        for k in ("plot_done_at", "round_table_ready_at"):
            if doc.get(k):
                doc[k] = (datetime.fromisoformat(doc[k]) - shift).isoformat()
        await server.db.games.replace_one({"code": code}, doc)
    asyncio.run(go())


def _doc(code):
    return asyncio.run(server.db.games.find_one({"code": code}))


def _public_plot_signals(st):
    """Everything on the shared screen that could change when a Traitor acts."""
    return (st["turns_done"], [p["turn_done"] for p in st["players"]], st["round_table_at"], st["plot_ready"])


def test_nobody_else_takes_a_turn_and_nothing_public_changes_when_the_traitors_seal():
    with TestClient(server.app) as c:
        g = _game(c)
        before = _public_plot_signals(g["state"]())
        assert before[0] == 0 and not any(before[1]) and before[2] is None and before[3] is False
        assert g["turn"](g["F"][0], target_id=g["ids"][g["F"][1]]).status_code == 400  # nothing for the Faithful to do
        r = g["adv"]()
        assert r.status_code == 400  # nothing sealed yet
        refused_before = r.json()["detail"]
        neutral_before = [e["neutral"] for e in _doc(g["code"])["event_log"]]
        r = g["turn"](g["T"][0], target_id=g["ids"][g["F"][0]]).json()
        assert len(r["action_choices"]) == 5 and not r["plan_sealed"]
        sealed = g["turn"](g["T"][0], action=r["action_choices"][0]).json()
        assert sealed["plan_sealed"] and sealed["plan_sealed_at"] and sealed["murder_confirmed"]
        # The shared screen hasn't moved, and the role-neutral log has nothing new.
        assert _public_plot_signals(g["state"]()) == before
        log = _doc(g["code"])["event_log"]
        assert [e["neutral"] for e in log[:len(neutral_before)]] == neutral_before
        assert all(e["neutral"] is None for e in log[len(neutral_before):])
        # Sealed means sealed — for every Traitor.
        other = g["T"][1] if len(g["T"]) > 1 else g["T"][0]
        assert g["turn"](other, target_id=g["ids"][g["F"][1]]).status_code == 400
        r = g["turn"](other)  # a plain pass after the seal changes nothing
        assert r.status_code == 200 and r.json()["plan_sealed"] and r.json()["murder_confirmed"]
        if len(g["T"]) > 1:
            assert g["view"](other)["plan_sealed"] is True
        # The Round Table waits at least the 30 minutes, at a random moment up to 10 more.
        doc = _doc(g["code"])
        wait = (datetime.fromisoformat(doc["round_table_ready_at"]) - datetime.fromisoformat(doc["plot_done_at"])).total_seconds() / 60
        assert 30 <= wait <= 40
        # The refusal is word for word what it was before the seal.
        r = g["adv"]()
        assert r.status_code == 400 and r.json()["detail"] == refused_before
        assert g["adv"](force=True).status_code == 400  # forcing can't cut the Traitors' time
        _age(g["code"], 41)
        st = g["state"]()
        assert st["plot_ready"] is True and st["round_table_at"] is None
        assert g["adv"]().json()["phase"] == "gather"
        for n in NAMES:
            g["turn"](n, **({"murder_done": True} if n in g["T"] else {}))
        st = g["adv"]().json()
        assert st["phase"] == "reveal"
        assert st["history"][-1]["murder"]["victim_name"] == g["F"][0]


def test_lying_low_seals_the_plot_with_no_murder():
    with TestClient(server.app) as c:
        g = _game(c, window=0)
        g["turn"](g["T"][0], target_id=g["ids"][g["F"][0]])
        v = g["turn"](g["T"][0]).json()
        assert v["plan_sealed"] and v["target"] is None and not v["murder_confirmed"] and v["plan_ready_at"]
        # Even with no time to strike set, it never lights up the moment a Traitor seals.
        assert g["state"]()["plot_ready"] is False
        _age(g["code"], 21)
        assert g["state"]()["plot_ready"] is True
        assert g["adv"]().json()["phase"] == "gather"
        for n in NAMES:
            g["turn"](n)
        st = g["adv"]().json()
        assert st["phase"] == "reveal" and not (st["history"][-1].get("murder") or {}).get("success")


def test_no_skipping_the_traitors():
    with TestClient(server.app) as c:
        g = _game(c)
        g["turn"](g["T"][0], target_id=g["ids"][g["F"][0]])  # picked, not sealed yet
        assert g["adv"]().status_code == 400
        assert g["adv"](force=True).status_code == 400  # the Round Table always waits for the Traitors
        assert g["state"]()["phase"] == "night"


def test_recruit_seals_the_plot():
    with TestClient(server.app) as c:
        g = _game(c, window=0)
        # Make recruiting allowed: one Traitor left.
        async def solo():
            doc = await server.db.games.find_one({"code": g["code"]})
            for p in doc["players"]:
                if p["role"] == "traitor" and p["name"] != g["T"][0]:
                    p["role"] = "faithful"
            await server.db.games.replace_one({"code": g["code"]}, doc)
        asyncio.run(solo())
        v = g["turn"](g["T"][0], recruit_id=g["ids"][g["F"][0]]).json()
        assert v["plan_sealed"] and v["recruit"]["name"] == g["F"][0]
        assert _doc(g["code"])["recruit_at"]


def test_a_plan_sealed_under_the_old_rule_starts_its_time_now():
    with TestClient(server.app) as c:
        g = _game(c)
        async def old_seal():
            doc = await server.db.games.find_one({"code": g["code"]})
            doc.update(target_id=g["ids"][g["F"][0]], action="x", murder_confirmed=True, plot_done_at=None,
                       turns_done=[g["ids"][g["F"][1]]])
            await server.db.games.replace_one({"code": g["code"]}, doc)
        asyncio.run(old_seal())
        st = g["state"]()
        assert not any(p["turn_done"] for p in st["players"])  # old ticks are hidden
        assert g["adv"]().status_code == 400  # the 30 minutes start now
        assert _doc(g["code"])["plot_done_at"]


def test_moderator_now_has_no_waiting_list_during_the_plot():
    with TestClient(server.app) as c:
        g = _game(c)
        mod = c.post(f"/api/games/{g['code']}/moderator", json={"passphrase": PASS}).json()
        assert mod["now"]["waiting_on"] == [] and mod["outstanding"] == []


def test_api_games_without_the_flag_keep_everyone_taking_a_turn():
    with TestClient(server.app) as c:
        g = _game(c, window=0, alone=False)
        assert g["turn"](g["F"][0]).status_code == 200
        assert g["state"]()["turns_done"] == 1


def test_a_plain_pass_from_someone_with_nothing_to_do_changes_nothing():
    """Phones on an older app still send the decoy turn: it quietly does nothing, for everyone alike."""
    with TestClient(server.app) as c:
        g = _game(c)
        before = _public_plot_signals(g["state"]())
        r = g["turn"](g["F"][0])
        assert r.status_code == 200 and r.json()["role"] == "faithful"
        assert g["turn"](g["F"][0], target_id=g["ids"][g["F"][1]]).status_code == 400
        assert _public_plot_signals(g["state"]()) == before
        assert not _doc(g["code"])["plot_done_at"]


def test_moderator_never_sees_the_round_table_time_during_the_plot():
    with TestClient(server.app) as c:
        g = _game(c)
        g["turn"](g["T"][0])  # lie low: sealed
        mod = c.post(f"/api/games/{g['code']}/moderator", json={"passphrase": PASS}).json()
        assert mod["round_table_at"] is None and mod["plot_ready"] is False
