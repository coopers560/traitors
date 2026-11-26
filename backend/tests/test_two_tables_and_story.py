# Two Round Tables a day (lunch and 8pm), the ClaudAI schedule switch, the recruit cap and the
# published story of a finished game (/api/archive). Runs against the live test server.
from test_traitors_game import (
    API, S, G, MOD, MOD_PASS, mk_players, pin_of, private, setup_game, setup_game_traitors,
    finish_setup, do_night, do_gather, cast_votes, banish_round,
)


def adv():
    r = S.post(f"{G()}/advance")
    assert r.status_code == 200, r.text
    return r.json()


def alive_players():
    return [p for p in S.get(G()).json()["players"] if p["alive"]]


def pass_night(skip=()):
    """Every alive player not in `skip` takes a plain night turn."""
    for p in alive_players():
        if p["id"] not in skip:
            assert S.post(f"{G()}/turn", json={"player_id": p["id"], "pin": pin_of(p["name"])}).status_code == 200


def vote_out(target_id):
    alive = alive_players()
    other = next(p["id"] for p in alive if p["id"] != target_id)
    cast_votes({p["id"]: (target_id if p["id"] != target_id else other) for p in alive})


class TestTwoTablesADay:
    def test_one_table_a_day_unless_asked(self):
        g, _ = setup_game(6)  # an older app sends no tables_per_day
        assert g["tables_per_day"] == 1 and g["session"] == "" and g["cal_day"] == 1 and g["day"] == 1
        assert g["label"] == "Day 1" and g["total_days"] == 12
        r = S.post(f"{API}/games", json={"players": mk_players(6), "tables_per_day": 3})
        assert r.status_code == 400 and "Round Tables a day" in r.json()["detail"]

    def test_labels_across_lunch_evening_and_the_next_day(self):
        g, roles = setup_game_traitors(8, 2, tables_per_day=2)
        assert (g["tables_per_day"], g["session"], g["cal_day"], g["day"]) == (2, "lunch", 1, 1)
        assert g["label"] == "Day 1 · Lunch"
        ps = g["players"]
        fa = [p for p in ps if roles[p["id"]] == "faithful"]
        finish_setup(ps)
        assert S.get(G()).json()["label"] == "Day 1 · Lunch"
        # Day 1 · Lunch: banish fa[0]
        r = banish_round(roles, fa[0]["id"])
        assert r["history"][-1]["label"] == "Day 1 · Lunch" and r["history"][-1]["day"] == 1
        assert r["label"] == "Day 1 · Lunch"
        # lunch -> the evening Round Table of the same day (the round counter still goes up)
        st = adv()
        assert (st["phase"], st["day"], st["cal_day"], st["session"]) == ("day", 2, 1, "evening")
        assert st["label"] == "Day 1 · Evening"
        r = banish_round(roles, fa[1]["id"])
        assert r["history"][-1]["label"] == "Day 1 · Evening" and r["history"][-1]["day"] == 2
        # evening -> lunch of the next day
        st = adv()
        assert (st["phase"], st["day"], st["cal_day"], st["session"]) == ("day", 3, 2, "lunch")
        assert st["label"] == "Day 2 · Lunch"
        # Day 2 · Lunch: a murder this time — its entry is labelled too
        assert adv()["phase"] == "night"
        do_night(roles, murder_target=fa[2]["id"])
        assert adv()["phase"] == "gather"
        do_gather(roles, murder_done=True)
        rv = adv()
        assert rv["phase"] == "reveal" and rv["history"][-1]["murder"]["victim_id"] == fa[2]["id"]
        assert [h["label"] for h in rv["history"]] == ["Day 1 · Lunch", "Day 1 · Evening", "Day 2 · Lunch"]
        assert [h["day"] for h in rv["history"]] == [1, 2, 3]
        mod = S.post(f"{G()}/moderator", json=MOD).json()
        assert (mod["label"], mod["cal_day"], mod["session"], mod["tables_per_day"]) == ("Day 2 · Lunch", 2, "lunch", 2)
        assert [v["label"] for v in mod["vote_log"]] == ["Day 1 · Lunch", "Day 1 · Evening"]
        began = [e["text"] for e in mod["event_log"] if e["kind"] == "stage" and e["text"].endswith(" began")]
        assert began == ["Day 1 · Lunch began", "Day 1 · Evening began", "Day 2 · Lunch began"]
        assert all(e.get("label") for e in mod["event_log"])
        assert {e["label"] for e in mod["event_log"] if e["kind"] == "victim"} == {"Day 2 · Lunch"}
        cur = S.get(f"{API}/current").json()
        assert cur["code"] == g["code"] and cur["label"] == "Day 2 · Lunch" and cur["day"] == 3

    def test_claudai_switches_the_schedule(self):
        g, roles = setup_game_traitors(8, 2)  # one Round Table a day
        ps = g["players"]
        fa = [p for p in ps if roles[p["id"]] == "faithful"]
        finish_setup(ps)
        sched = lambda **body: S.post(f"{G()}/moderator/schedule", json=body)
        assert sched(passphrase="Wrong#Pass1", tables_per_day=2, session="lunch").status_code == 403
        assert sched(tables_per_day=2, session="lunch").status_code == 403
        assert sched(**MOD, tables_per_day=2).status_code == 400  # which Round Table is this one?
        assert sched(**MOD, tables_per_day=2, session="brunch").status_code == 400
        assert sched(**MOD, tables_per_day=3).status_code == 400
        r = sched(**MOD, tables_per_day=2, session="evening")
        assert r.status_code == 200, r.text
        m = r.json()
        assert (m["tables_per_day"], m["session"], m["cal_day"], m["day"]) == (2, "evening", 1, 1)
        assert m["label"] == "Day 1 · Evening" and m["code"] == g["code"] and "event_log" in m
        assert S.get(G()).json()["label"] == "Day 1 · Evening"
        r = banish_round(roles, fa[0]["id"])
        assert r["history"][-1]["label"] == "Day 1 · Evening"
        st = adv()
        assert (st["day"], st["cal_day"], st["session"], st["label"]) == (2, 2, "lunch", "Day 2 · Lunch")
        # back to one a day: the session is cleared, the round counter untouched
        m = sched(**MOD, tables_per_day=1, session="lunch").json()
        assert (m["tables_per_day"], m["session"], m["day"], m["cal_day"], m["label"]) == (1, "", 2, 2, "Day 2")
        banish_round(roles, fa[1]["id"])
        st = adv()
        assert (st["day"], st["cal_day"], st["session"], st["label"]) == (3, 3, "", "Day 3")
        # the older {pin} body works too
        assert sched(pin=MOD_PASS, tables_per_day=2, session="lunch").json()["label"] == "Day 3 · Lunch"
        log = S.post(f"{G()}/moderator", json=MOD).json()["event_log"]
        switches = [e["text"] for e in log if e["kind"] == "schedule"]
        assert len(switches) == 3
        assert "two Round Tables a day" in switches[0] and "Day 1 is now Day 1 · Evening" in switches[0]
        assert "one Round Table a day" in switches[1] and "Day 2 · Lunch is now Day 2" in switches[1]


class TestArchiveAndStory:
    def test_the_whole_story_is_published_only_when_the_game_ends(self):
        g, roles = setup_game_traitors(8, 2, tables_per_day=2)
        code = g["code"]
        ps = g["players"]
        t1, t2 = [p for p in ps if roles[p["id"]] == "traitor"]
        fa = [p for p in ps if roles[p["id"]] == "faithful"]
        finish_setup(ps)
        # nothing is published while the game is in progress
        r = S.get(f"{API}/archive/{code}")
        assert r.status_code == 404
        assert code not in [x["code"] for x in S.get(f"{API}/archive").json()["games"]]
        assert S.get(f"{API}/archive/ZZZZ9").status_code == 404

        # Day 1 · Lunch: the table banishes Traitor t2 (8 -> 7: 1 Traitor v 6 Faithful)
        banish_round(roles, t2["id"])
        assert adv()["label"] == "Day 1 · Evening"
        # Day 1 · Evening: t1 replaces t2 by recruiting fa[0]
        assert adv()["phase"] == "night"
        v = private(t1["id"], pin_of(t1["name"])).json()
        assert v["can_recruit"] is True and v["recruit_reason"] == "banished"
        chat = S.post(f"{G()}/chat/send", json={"player_id": t1["id"], "pin": pin_of(t1["name"]), "text": "Recruit them?"})
        assert chat.status_code == 200 and chat.json()["messages"][-1]["label"] == "Day 1 · Evening"
        r = S.post(f"{G()}/turn", json={"player_id": t1["id"], "pin": pin_of(t1["name"]), "recruit_id": fa[0]["id"]})
        assert r.status_code == 200, r.text
        pass_night(skip={t1["id"]})
        assert adv()["phase"] == "gather"
        do_gather(roles)
        rv = adv()
        assert rv["phase"] == "reveal" and rv["history"][-1]["recruited"] is True
        # two Traitors again: the cap means nobody can recruit any more
        assert private(t1["id"], pin_of(t1["name"])).json()["can_recruit"] is False
        nv = private(fa[0]["id"], pin_of(fa[0]["name"])).json()
        assert nv["role"] == "traitor" and nv["can_recruit"] is False
        assert adv()["phase"] == "roundtable"
        vote_out(fa[1]["id"])  # 7 -> 6: 2 v 4
        assert adv()["phase"] == "banished"
        assert adv()["label"] == "Day 2 · Lunch"
        # Day 2 · Lunch: murder fa[2] (-> 2 v 3), banish fa[3] (-> 2 v 2): the Traitors win
        roles2 = {**roles, fa[0]["id"]: "traitor"}
        assert adv()["phase"] == "night"
        do_night(roles2, murder_target=fa[2]["id"])
        assert adv()["phase"] == "gather"
        do_gather(roles2, murder_done=True)
        assert adv()["phase"] == "reveal"
        assert S.get(f"{API}/archive/{code}").status_code == 404  # still not over
        assert adv()["phase"] == "roundtable"
        vote_out(fa[3]["id"])
        rb = adv()
        assert rb["phase"] == "banished" and rb["winner"] == "traitors"
        st = adv()
        assert st["phase"] == "ended"

        # the archive: finished games, newest first
        games = S.get(f"{API}/archive").json()["games"]
        assert 1 <= len(games) <= 50
        ends = [x["ended_at"] for x in games]
        assert ends == sorted(ends, reverse=True)
        entry = games[0]
        assert entry["code"] == code and entry["winner"] == "traitors" and entry["players"] == 8
        assert entry["label"] == "Day 2 · Lunch" and entry["created_at"] and entry["ended_at"]

        story = S.get(f"{API}/archive/{code.lower()}").json()
        assert story["code"] == code and story["winner"] == "traitors"
        assert story["tables_per_day"] == 2 and story["total_days"] == 12
        assert story["created_at"] == entry["created_at"] and story["ended_at"] == entry["ended_at"]
        by = {p["id"]: p for p in story["players"]}
        assert len(by) == 8
        rec = by[fa[0]["id"]]
        assert rec["role"] == "traitor" and rec["started_as"] == "faithful" and rec["recruited_label"] == "Day 1 · Evening"
        assert rec["exit"] is None
        assert by[t1["id"]]["started_as"] == "traitor" and by[t1["id"]]["recruited_label"] is None
        assert by[t2["id"]]["role"] == "traitor" and by[t2["id"]]["exit"] == {"how": "banished", "label": "Day 1 · Lunch"}
        assert by[fa[1]["id"]]["exit"] == {"how": "banished", "label": "Day 1 · Evening"}
        assert by[fa[2]["id"]]["exit"] == {"how": "murdered", "label": "Day 2 · Lunch"}
        assert by[fa[3]["id"]]["exit"] == {"how": "banished", "label": "Day 2 · Lunch"}
        assert by[fa[4]["id"]]["started_as"] == "faithful" and by[fa[4]["id"]]["exit"] is None
        assert [p["id"] for p in story["players"] if p["is_host"]] == [g["host_id"]]
        assert [h["label"] for h in story["rounds"]] == ["Day 1 · Lunch", "Day 1 · Evening", "Day 2 · Lunch"]
        assert story["rounds"][1]["recruited"] is True
        assert story["rounds"][2]["murder"]["action"]  # the murder methods are revealed
        assert story["rounds"][2]["banish"]["target_id"] == fa[3]["id"]
        assert [v["label"] for v in story["vote_log"]] == ["Day 1 · Lunch", "Day 1 · Evening", "Day 2 · Lunch"]
        assert [(m["text"], m["label"]) for m in story["traitor_chat"]] == [("Recruit them?", "Day 1 · Evening")]
        mod = S.post(f"{G(code)}/moderator", json=MOD).json()
        assert len(story["event_log"]) == len(mod["event_log"])  # every entry, in full
        assert [e["text"] for e in story["event_log"]] == [e["text"] for e in mod["event_log"]]
        assert any("Traitors:" in e["text"] for e in story["event_log"])
        assert any(f"{fa[0]['name']} was recruited" in e["text"] for e in story["event_log"])
        assert all(e["label"] for e in story["event_log"])
        assert "pin_hash" not in str(story) and MOD_PASS not in str(story)

        # clearing the finished game from the main screen keeps its story published
        assert S.delete(G(code)).json() == {"exists": False}
        assert S.get(G(code)).status_code == 404
        assert S.get(f"{API}/archive/{code}").json()["ended_at"] == entry["ended_at"]
        assert code in [x["code"] for x in S.get(f"{API}/archive").json()["games"]]
        assert S.delete(G(code)).json() == {"exists": False}  # clearing it again is harmless

    def test_a_stopped_game_is_not_published(self):
        g, _ = setup_game(6)
        code = g["code"]
        host = g["players"][0]
        assert S.delete(G(code), json={"player_id": host["id"], "pin": pin_of(host["name"])}).json() == {"exists": False}
        assert S.get(f"{API}/archive/{code}").status_code == 404
        assert code not in [x["code"] for x in S.get(f"{API}/archive").json()["games"]]
