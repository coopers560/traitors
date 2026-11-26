"""In-process tests (mongomock) for the follow-up batch: "Seen by" in the Traitors' chat (older
games included), the same visible result of pressing send for every role, ClaudAI changing the
murder gap, always five different murder methods (older 3-4 item custom lists topped up), the
throttle on wrong host PINs when nominating a ClaudAI host, and event-log wording that doesn't
say "night" for a plot at an Evening Round Table."""
import asyncio
import os
import sys
from datetime import datetime, timedelta, timezone

import pytest

pytest.importorskip("mongomock_motor")
os.environ.setdefault("MONGO_URL", "mongodb://localhost")
os.environ.setdefault("DB_NAME", "traitors_followups_test")
import motor.motor_asyncio as m  # noqa: E402
from mongomock_motor import AsyncMongoMockClient  # noqa: E402

m.AsyncIOMotorClient = AsyncMongoMockClient
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import server  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

PASS = "Coral#Reef42"
NAMES = ["Ada", "Ben", "Cleo", "Dev", "Esme", "Finn", "Gus", "Hana"]
PIN = {n: f"{3000 + i}" for i, n in enumerate(NAMES)}


def run(coro):
    return asyncio.run(coro)


def get_doc(code):
    return run(server.db.games.find_one({"code": code}, {"_id": 0}))


def patch(code, fn):
    async def go():
        doc = await server.db.games.find_one({"code": code})
        fn(doc)
        await server.db.games.replace_one({"code": code}, doc)
    run(go())


class Table:
    """One game driven in-process: players by name, their roles, and short-hand calls."""

    def __init__(self, c, n=8, **extra):
        self.c = c
        body = {"players": [{"name": NAMES[i], "pin": PIN[NAMES[i]]} for i in range(n)], "murder_gap_hours": 0, **extra}
        r = c.post("/api/games", json=body)
        assert r.status_code == 200, r.text
        self.g = r.json()
        self.code = self.g["code"]
        self.ids = {p["name"]: p["id"] for p in self.g["players"]}
        self.names = list(self.ids)
        self.role = {n: self.private(n)["role"] for n in self.names}
        self.T = [n for n in self.names if self.role[n] == "traitor"]
        self.F = [n for n in self.names if self.role[n] == "faithful"]

    def body(self, n, **kw):
        return {"player_id": self.ids[n], "pin": PIN[n], **kw}

    def private(self, n):
        return self.c.post(f"/api/games/{self.code}/private", json=self.body(n)).json()

    def turn(self, n, **kw):
        return self.c.post(f"/api/games/{self.code}/turn", json=self.body(n, **kw))

    def adv(self):
        r = self.c.post(f"/api/games/{self.code}/advance")
        assert r.status_code == 200, r.text
        return r.json()

    def send(self, n, text):
        return self.c.post(f"/api/games/{self.code}/chat/send", json=self.body(n, text=text))

    def read(self, n):
        return self.c.post(f"/api/games/{self.code}/chat", json=self.body(n))

    def mod(self, secret=PASS):
        return self.c.post(f"/api/games/{self.code}/moderator", json={"passphrase": secret})

    def sched(self, **body):
        return self.c.post(f"/api/games/{self.code}/moderator/schedule", json=body)

    def log(self):
        return self.mod().json()["event_log"]

    def to_day(self):
        for n in self.names:
            self.turn(n)
        assert self.adv()["phase"] == "day"


def seen(res):
    return [(m["text"], m["seen_by"]) for m in res.json()["messages"]]


# ---------------- 1. "Seen by" in the Traitors' chat ----------------
def test_seen_by_lists_the_other_traitors_who_have_read_since():
    with TestClient(server.app) as c:
        t = Table(c, claudai_passphrase=PASS)
        a, b = t.T
        f = t.F[0]
        t.to_day()
        r = t.send(a, "hello")
        assert r.status_code == 200 and seen(r) == [("hello", [])]
        assert r.json()["messages"][0]["label"] == "Day 1"
        assert seen(t.read(a)) == [("hello", [])]  # never the sender
        assert seen(t.read(b)) == [("hello", [b])]
        assert seen(t.send(b, "hi back")) == [("hello", [b]), ("hi back", [])]
        assert seen(t.read(a)) == [("hello", [b]), ("hi back", [a])]
        # the read times are stored per Traitor (never for anyone else, and not in public)
        doc = get_doc(t.code)
        assert set(doc["chat_read"]) == {t.ids[a], t.ids[b]}
        assert t.read(f).json() == {"allowed": False, "messages": []}
        assert set(get_doc(t.code)["chat_read"]) == {t.ids[a], t.ids[b]}
        pub = c.get(f"/api/games/{t.code}").json()
        assert "chat_read" not in pub and "traitor_chat" not in pub
        assert "chat_read" not in t.private(f) and "chat_read" not in t.private(a)
        # ClaudAI sees "Seen by" too
        assert [(m["text"], m["seen_by"]) for m in t.mod().json()["traitor_chat"]] == [("hello", [b]), ("hi back", [a])]


def test_a_banished_traitors_last_read_still_counts_but_they_cannot_read_on():
    with TestClient(server.app) as c:
        t = Table(c)
        a, b = t.T
        t.to_day()
        t.send(a, "one")
        t.read(b)
        t.send(a, "two")
        patch(t.code, lambda d: [p.update(lives=0) for p in d["players"] if p["id"] == t.ids[b]])
        assert t.read(b).json() == {"allowed": False, "messages": []}
        r = t.send(b, "from beyond")
        assert r.status_code == 200 and r.json() == {"allowed": False, "messages": []}
        assert seen(t.read(a)) == [("one", [b]), ("two", [])]


def test_older_games_without_read_times_or_labels():
    with TestClient(server.app) as c:
        t = Table(c)
        a, b = t.T
        t.to_day()

        def legacy(d):
            d.pop("chat_read", None)  # stored before read times existed
            d["traitor_chat"] = [
                # no label, and a time without microseconds
                {"id": "old1", "t": "2026-01-01T00:00:00+00:00", "day": 1, "from_id": t.ids[a], "from_name": a, "text": "old"},
                {"id": "old2", "t": "not a time", "day": 1, "from_id": t.ids[a], "from_name": a, "text": "odd"},
            ]
        patch(t.code, legacy)
        r = t.read(a)
        assert r.status_code == 200 and seen(r) == [("old", []), ("odd", [])]
        assert "label" not in r.json()["messages"][0]
        assert seen(t.read(b)) == [("old", [b]), ("odd", [])]  # an unreadable time is never "seen"
        assert c.get(f"/api/games/{t.code}").status_code == 200
        # and the game plays on: the next save keeps the read times
        t.adv()
        assert set(get_doc(t.code)["chat_read"]) == {t.ids[a], t.ids[b]}


def test_a_read_never_overwrites_a_message_saved_at_the_same_time():
    """The read time is written on its own ($set under the game's lock), so a message sent
    while a read is in flight is never lost."""
    with TestClient(server.app) as c:
        t = Table(c)
        a, b = t.T
        t.to_day()
        real_load = server.load_game

        async def slow_load(code):
            g = await real_load(code)
            await asyncio.sleep(0.02)  # give the other request every chance to load the same state
            return g

        async def interleave():
            # A read and a send for the same game started together.
            ra = server.read_chat(code=t.code, data=server.AuthIn(player_id=t.ids[b], pin=PIN[b]))
            sa = server.send_chat(code=t.code, data=server.ChatIn(player_id=t.ids[a], pin=PIN[a], text="kept"))
            return await asyncio.gather(ra, sa)

        loop = asyncio.new_event_loop()
        try:
            server.load_game = slow_load
            server.GAME_LOCKS.pop(t.code, None)  # a lock for this test's event loop
            loop.run_until_complete(interleave())
        finally:
            server.load_game = real_load
            server.GAME_LOCKS.pop(t.code, None)
            loop.close()
        doc = get_doc(t.code)
        assert [m["text"] for m in doc["traitor_chat"]] == ["kept"]
        assert set(doc["chat_read"]) == {t.ids[a], t.ids[b]}


# ---------------- 2. Pressing send looks the same for every role ----------------
def test_send_gives_the_same_visible_result_for_every_role():
    with TestClient(server.app) as c:
        t = Table(c)
        a, f = t.T[0], t.F[0]
        # setup: refused for everyone, the same way
        ra, rf = t.send(a, "x"), t.send(f, "x")
        assert (ra.status_code, rf.status_code) == (403, 403) and ra.json() == rf.json()
        t.to_day()
        assert t.send(f, "hello?").json() == {"allowed": False, "messages": []}
        assert t.send(f, "hello?").status_code == 200
        assert t.send(a, "hello").json()["allowed"] is True
        for bad in ("", "   ", "x" * 501):
            ra, rf = t.send(a, bad), t.send(f, bad)
            assert (ra.status_code, rf.status_code) == (400, 400) and ra.json() == rf.json()
        bad_pin = c.post(f"/api/games/{t.code}/chat/send", json={"player_id": t.ids[f], "pin": "0000", "text": "hi"})
        assert bad_pin.status_code == 401
        assert [m["text"] for m in get_doc(t.code)["traitor_chat"]] == ["hello"]
        assert t.ids[f] not in get_doc(t.code)["chat_read"]


# ---------------- 3. ClaudAI changes the murder gap ----------------
def test_claudai_changes_the_murder_gap():
    with TestClient(server.app) as c:
        t = Table(c, claudai_passphrase=PASS)
        t.to_day()
        m0 = t.mod().json()
        assert m0["murder_gap_hours"] == 0 and m0["next_plot_at"] is None
        # a murder an hour ago
        patch(t.code, lambda d: d.update(last_murder_at=(datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()))
        assert t.sched(passphrase="Wrong#Pass9", murder_gap_hours=3).status_code == 403
        r = t.sched(passphrase=PASS, murder_gap_hours=3)
        assert r.status_code == 200, r.text
        mv = r.json()
        assert mv["murder_gap_hours"] == 3 and mv["next_plot_at"]
        wait = datetime.fromisoformat(mv["next_plot_at"]) - datetime.now(timezone.utc)
        assert timedelta(hours=1, minutes=58) < wait <= timedelta(hours=2)
        assert (mv["tables_per_day"], mv["label"]) == (1, "Day 1")  # the schedule itself is untouched
        pub = c.get(f"/api/games/{t.code}").json()
        assert pub["murder_gap_hours"] == 3 and pub["next_plot_at"] == mv["next_plot_at"]
        assert c.post(f"/api/games/{t.code}/advance").status_code == 400  # too soon now
        # half an hour: the hour since the murder is enough
        mv = t.sched(passphrase=PASS, murder_gap_hours=0.5).json()
        assert mv["murder_gap_hours"] == 0.5 and mv["next_plot_at"] is None
        # out of range or not a number: refused, nothing changed
        for bad in (-1, 24.5, 1000):
            r = t.sched(passphrase=PASS, murder_gap_hours=bad)
            assert r.status_code == 400 and "between 0 and 24" in r.json()["detail"], bad
        assert t.sched(passphrase=PASS, murder_gap_hours="soon").status_code == 422
        assert t.sched(passphrase=PASS).status_code == 400  # nothing to change
        assert t.sched(passphrase=PASS, murder_gap_hours=24).json()["murder_gap_hours"] == 24
        # both at once: the schedule and the gap (the older {pin} body works too)
        mv = t.sched(pin=PASS, tables_per_day=2, session="evening", murder_gap_hours=2.5).json()
        assert (mv["tables_per_day"], mv["label"], mv["murder_gap_hours"]) == (2, "Day 1 · Evening", 2.5)
        # a bad schedule refuses the whole change, the gap included
        assert t.sched(passphrase=PASS, tables_per_day=3, murder_gap_hours=1).status_code == 400
        assert t.mod().json()["murder_gap_hours"] == 2.5
        texts = [e["text"] for e in t.log() if e["kind"] == "schedule"]
        assert texts == [
            "ClaudAI changed the time between murders from 0 to 3 hours",
            "ClaudAI changed the time between murders from 3 to 0.5 hours",
            "ClaudAI changed the time between murders from 0.5 to 24 hours",
            "ClaudAI switched the game to two Round Tables a day (lunch and 8pm) — Day 1 is now Day 1 · Evening",
            "ClaudAI changed the time between murders from 24 to 2.5 hours",
        ]
        assert all(e["neutral"] == e["text"] for e in t.log() if e["kind"] == "schedule")


def test_next_plot_at_is_none_in_the_endgame_and_the_ended_game_refuses():
    with TestClient(server.app) as c:
        t = Table(c, claudai_passphrase=PASS)
        t.to_day()
        patch(t.code, lambda d: d.update(last_murder_at=datetime.now(timezone.utc).isoformat()))
        mv = t.sched(passphrase=PASS, murder_gap_hours=5).json()
        assert mv["next_plot_at"]
        keep = set(t.T) | set(t.F[:2])  # four left: the endgame (no murders)
        patch(t.code, lambda d: [p.update(lives=0) for p in d["players"] if p["name"] not in keep])
        mv = t.mod().json()
        assert mv["endgame"] is True and mv["next_plot_at"] is None and mv["murder_gap_hours"] == 5
        assert c.get(f"/api/games/{t.code}").json()["next_plot_at"] is None
        patch(t.code, lambda d: d.update(phase="ended", winner="traitors"))
        r = t.sched(passphrase=PASS, murder_gap_hours=1)
        assert r.status_code == 400 and r.json()["detail"] == "The game is over"


def test_older_games_get_the_default_gap_in_the_moderator_view():
    with TestClient(server.app) as c:
        t = Table(c, claudai_passphrase=PASS)
        patch(t.code, lambda d: d.pop("murder_gap_hours", None))
        mv = t.mod().json()
        assert mv["murder_gap_hours"] == 3 and mv["next_plot_at"] is None


# ---------------- 4. Always five different murder methods ----------------
def _game(actions, used=()):
    p = server.Player(name="X", pin_hash="", role="faithful")
    return server.Game(code="TESTX", players=[p], actions=list(actions), used_actions=list(used))


def test_pick_actions_offers_fresh_ones_first_then_used_ones():
    own = [f"Act {i}" for i in range(7)]
    used = own[:4]
    for _ in range(30):
        g = _game(own, used)
        ch = g.pick_actions(g.actions)
        assert len(ch) == server.ACTION_CHOICES == 5 and len(set(ch)) == 5
        assert set(ch[:3]) == set(own[4:])  # every fresh one, first
        assert set(ch[3:]) <= set(used)


def test_pick_actions_never_repeats_while_fresh_ones_remain():
    g = _game(server.ACTIONS)
    offered = []
    for _ in range(9):  # 9 nights x 5 = 45 of the 47 defaults
        ch = g.pick_actions(g.actions)
        assert len(set(ch)) == 5 and not set(ch) & set(g.used_actions)
        offered += ch
        g.used_actions += ch
    assert len(set(offered)) == 45


def test_pick_actions_tops_up_a_short_older_list_from_the_defaults():
    for own in (["Wave at them", "Hum a tune", "Tie a shoelace"], ["Wave at them", "Hum a tune", "Tie a shoelace", "Juggle"]):
        for used in ((), own[:1], own):
            g = _game(own, used)
            ch = g.pick_actions(g.actions)
            assert len(ch) == 5 and len({x.lower() for x in ch}) == 5, (own, used, ch)
            assert set(own) <= set(ch)  # every one of the game's own actions is offered
            extra = [x for x in ch if x not in own]
            assert extra and all(x in server.ACTIONS for x in extra)
    # a list that repeats (or overlaps the defaults) still gives five different ones
    g = _game(["Wave", "wave", "WAVE ", server.ACTIONS[0]])
    ch = g.pick_actions(g.actions)
    assert len(ch) == 5 and len({x.strip().lower() for x in ch}) == 5


def test_an_older_three_action_list_still_offers_five_in_play():
    with TestClient(server.app) as c:
        t = Table(c)
        own = ["Wave at them", "Hum a tune", "Tie a shoelace"]
        patch(t.code, lambda d: d.update(actions=own))  # saved before the minimum was five
        assert c.get(f"/api/games/{t.code}/actions").json() == {"actions": own, "is_default": False}
        t.to_day()
        assert t.adv()["phase"] == "night"
        a = t.T[0]
        r = t.turn(a, target_id=t.ids[t.F[0]])
        assert r.status_code == 200, r.text
        ch = r.json()["action_choices"]
        assert len(ch) == 5 and len(set(ch)) == 5 and set(own) <= set(ch)
        topup = next(x for x in ch if x not in own)
        r = t.turn(a, action=topup)
        assert r.status_code == 200 and r.json()["murder_confirmed"] is True and r.json()["action"] == topup
        assert topup in get_doc(t.code)["used_actions"]


def test_saving_needs_five_different_actions():
    with TestClient(server.app) as c:
        t = Table(c)
        put = lambda acts: c.put(f"/api/games/{t.code}/actions", json={"actions": acts})
        r = put(["One", "Two", "Three", "Four"])
        assert r.status_code == 400 and r.json()["detail"] == "Keep at least 5 secret actions"
        r = put(["One", "Two", "Three", "Four", "four ", ""])
        assert r.status_code == 400
        r = put(["One", "Two", "Three", "Four", "Five"])
        assert r.status_code == 200 and r.json()["actions"] == ["One", "Two", "Three", "Four", "Five"]


# ---------------- 5. Nominating a ClaudAI host: wrong host PINs are throttled ----------------
def test_wrong_host_pins_lock_the_nomination():
    with TestClient(server.app) as c:
        t = Table(c)  # no ClaudAI host yet
        host = t.names[0]
        other = t.names[1]
        url = f"/api/games/{t.code}/claudai"
        nominate = lambda n, pin: c.post(url, json={"player_id": t.ids[n], "pin": pin, "new_passphrase": PASS})
        # a non-host with their own right PIN isn't a guess (refused, not counted)
        for _ in range(10):
            assert nominate(other, PIN[other]).status_code == 403
        for i in range(8):
            assert nominate(host, f"{9000 + i}").status_code == 401
        r = nominate(host, PIN[host])
        assert r.status_code == 429 and "Too many wrong PINs" in r.json()["detail"]  # even the right PIN waits
        assert get_doc(t.code)["moderator_pin_hash"] is None
        # kept apart from the game's ClaudAI passphrase lockout
        assert t.code not in server.PIN_FAILS or not server._pin_locked(t.code)
        # ten minutes later it opens again
        key = server.host_fail_key(t.code)
        server.PIN_FAILS[key] = [x - server.PIN_FAIL_WINDOW - 1 for x in server.PIN_FAILS[key]]
        r = nominate(host, PIN[host])
        assert r.status_code == 200 and r.json()["claudai"] is True
        assert t.mod().status_code == 200
        # the moderator-only log has the nomination and a neutral line; nothing public
        log = t.log()
        assert any(e["text"] == f"{host} (host) nominated a ClaudAI host" for e in log)
        added = [e for e in log if e["text"] == "A ClaudAI host was added"]
        assert len(added) == 1 and added[0]["neutral"] == "A ClaudAI host was added"
        pub = c.get(f"/api/games/{t.code}").json()
        assert "event_log" not in pub and pub["history"] == []


def test_the_hosts_right_pin_forgets_earlier_misses():
    with TestClient(server.app) as c:
        t = Table(c)
        host = t.names[0]
        url = f"/api/games/{t.code}/claudai"
        for i in range(7):
            assert c.post(url, json={"player_id": t.ids[host], "pin": f"{9100 + i}", "new_passphrase": PASS}).status_code == 401
        # the right PIN with a weak passphrase: refused for the passphrase, but the misses are forgotten
        r = c.post(url, json={"player_id": t.ids[host], "pin": PIN[host], "new_passphrase": "weak"})
        assert r.status_code == 400
        for i in range(7):
            assert c.post(url, json={"player_id": t.ids[host], "pin": f"{9200 + i}", "new_passphrase": PASS}).status_code == 401
        assert c.post(url, json={"player_id": t.ids[host], "pin": PIN[host], "new_passphrase": PASS}).status_code == 200


# ---------------- 6. Event-log wording that doesn't say "night" at an Evening Round Table ----------------
def test_plot_pass_and_plan_lines_are_neutral_about_the_time_of_day():
    with TestClient(server.app) as c:
        t = Table(c, tables_per_day=2, claudai_passphrase=PASS)
        t.to_day()
        assert t.sched(passphrase=PASS, tables_per_day=2, session="evening").status_code == 200
        assert t.adv()["phase"] == "night"
        a, b = t.T
        r = t.turn(a, target_id=t.ids[t.F[0]])
        act = r.json()["action_choices"][0]
        t.turn(a, action=act)
        t.turn(b)
        for n in t.F:
            t.turn(n)
        assert t.adv()["phase"] == "gather"
        log = t.log()
        plot = [e for e in log if e["kind"] == "stage" and e["text"].startswith("The Traitors plot")]
        assert [e["text"] for e in plot] == ["The Traitors plot (Day 1 · Evening)"]
        passes = [e for e in log if e["kind"] == "pass"]
        assert {e["text"] for e in passes} == {f"{n} passed the phone on (nothing to do)" for n in t.F}
        plan = [e for e in log if e["kind"] == "plan"]
        assert [e["text"] for e in plan] == [f"{server.PLAN_PREFIX}murder {t.F[0]} with “{act}”"]
        assert plan[0]["text"].startswith("The plan: ") and plan[0]["neutral"] is None
        for e in plot + passes + plan:
            assert "night" not in e["text"].lower() and "tonight" not in e["text"].lower(), e["text"]
        # with roles hidden every night turn still reads exactly alike
        turn_kinds = ("pass", "murder", "lielow", "recruit")
        neutrals = {e["neutral"].split(" ", 1)[1] for e in log if e["kind"] in turn_kinds and e["neutral"]}
        assert neutrals == {"took their night turn"}


def test_the_plan_line_for_a_recruit_and_for_lying_low():
    with TestClient(server.app) as c:
        t = Table(c, claudai_passphrase=PASS)
        t.to_day()
        assert t.adv()["phase"] == "night"
        for n in t.names:
            t.turn(n)
        t.adv()
        assert [e["text"] for e in t.log() if e["kind"] == "plan"] == ["The plan: no murder — the Traitors lay low"]
        # a lone Traitor recruits
        t2 = Table(c, claudai_passphrase=PASS)
        lone, gone = t2.T
        patch(t2.code, lambda d: [p.update(lives=0) for p in d["players"] if p["name"] == gone])
        t2.to_day()
        assert t2.adv()["phase"] == "night"
        r = t2.turn(lone, recruit_id=t2.ids[t2.F[0]])
        assert r.status_code == 200, r.text
        for n in t2.names:
            if n not in (lone, gone):
                t2.turn(n)
        t2.adv()
        assert [e["text"] for e in t2.log() if e["kind"] == "plan"] == [f"The plan: recruit {t2.F[0]}"]


def test_an_older_games_tonights_plan_lines_are_kept_as_they_were():
    with TestClient(server.app) as c:
        t = Table(c)
        old = {"t": "2026-01-01T20:00:00+00:00", "day": 1, "label": "Day 1", "phase": "night", "kind": "plan",
               "text": "Tonight's plan: murder Ben with “Top up their water glass”", "neutral": None}
        patch(t.code, lambda d: d["event_log"].append(old))
        t.to_day()
        patch(t.code, lambda d: d.update(phase="ended", winner="traitors"))
        story = c.get(f"/api/archive/{t.code}").json()
        assert [e["text"] for e in story["event_log"] if e["kind"] == "plan"] == [old["text"]]
