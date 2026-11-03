# Proxy-vote feature: POST /api/games/{code}/proxy-vote {player_id, vote_target_id, by_id, pin}. Only player 1, only at Round Table.
import pytest
from test_traitors_game import S
from test_skip_vote import G, new_game, state, to_roundtable, vote, skip, pl, NAMES, HOST, CODES
from test_traitors_game import pin_of


@pytest.fixture(scope="module", autouse=True)
def cleanup():
    yield
    for c in CODES:
        S.delete(f"{G(c)}")


def proxy(code, pid, target_id, by=None, pin=None):
    by_id = by or HOST[code]
    body = {"player_id": pid, "vote_target_id": target_id, "by_id": by_id,
            "pin": pin if pin is not None else pin_of(NAMES[by_id])}
    return S.post(f"{G(code)}/proxy-vote", json=body)


# Phase / auth rules
class TestProxyRules:
    def test_rejected_outside_roundtable(self):
        g, r = new_game(5)
        code, ps = g["code"], g["players"]
        res = proxy(code, ps[2]["id"], ps[3]["id"])
        assert res.status_code == 400, res.text
        assert "Round Table" in res.json()["detail"]

    def test_non_host_403_wrong_pin_401_missing_400(self):
        code, ps, r, tr, fa = to_roundtable(5)
        host = ps[0]
        res = proxy(code, ps[2]["id"], ps[3]["id"], by=ps[1]["id"])
        assert res.status_code == 403, res.text
        assert res.json()["detail"] == f"Only {host['name']} (player 1) can enter a vote for someone"
        res = proxy(code, ps[2]["id"], ps[3]["id"], pin="9999" if pin_of(host["name"]) != "9999" else "8888")
        assert res.status_code == 401, res.text
        res = S.post(f"{G(code)}/proxy-vote", json={"player_id": ps[2]["id"], "vote_target_id": ps[3]["id"]})
        assert res.status_code in (400, 422), res.text
        s = state(code)
        assert s["turns_done"] == 0 and pl(s, ps[2]["id"])["proxy_by"] is None

    def test_self_and_bad_targets_400(self):
        code, ps, r, tr, fa = to_roundtable(5)
        assert proxy(code, ps[0]["id"], ps[1]["id"]).status_code == 400  # host for self
        assert proxy(code, ps[2]["id"], ps[2]["id"]).status_code == 400  # self target
        assert proxy(code, ps[2]["id"], "nope").status_code == 400  # unknown target
        assert proxy(code, "nope", ps[1]["id"]).status_code == 400  # unknown absent player

    def test_already_voted_400(self):
        code, ps, r, tr, fa = to_roundtable(5)
        assert vote(code, ps[2], ps[3]).status_code == 200
        res = proxy(code, ps[2]["id"], ps[4]["id"])
        assert res.status_code == 400, res.text
        assert res.json()["detail"] == f"{ps[2]['name']} has already voted"


# Proxy happy path, tally, history, undo, override, reset
class TestProxyFlow:
    def test_proxy_records_and_counts_in_tally_and_history(self):
        code, ps, r, tr, fa = to_roundtable(5)
        host = ps[0]
        absent = ps[2]
        res = proxy(code, absent["id"], ps[3]["id"])
        assert res.status_code == 200, res.text
        s = res.json()
        a = pl(s, absent["id"])
        assert a["turn_done"] is True and a["proxy_by"] == host["name"] and a["skipped"] is False
        assert s["turns_done"] == 1
        # re-proxy (change) allowed and doesn't double count
        assert proxy(code, absent["id"], ps[4]["id"]).status_code == 200
        assert state(code)["turns_done"] == 1
        # everyone else votes for ps[4] too except to make the proxied vote matter: votes -> target ps[4]
        for p in ps:
            if p["id"] == absent["id"]:
                continue
            tgt = ps[4] if p["id"] != ps[4]["id"] else ps[1]
            body = {}
            if r[p["id"]] == "traitor":
                body["murder_done"] = True
            assert vote(code, p, tgt, **body).status_code == 200
        s = S.post(f"{G(code)}/advance").json()
        assert s["phase"] == "reveal"
        h = s["history"][-1]
        assert h["proxied"] == {absent["name"]: host["name"]}
        tally = {t["player_id"]: t["votes"] for t in h["banish"]["tally"]}
        assert tally[ps[4]["id"]] == 4  # 3 others + proxied
        # next day resets proxy
        s = S.post(f"{G(code)}/advance").json()
        if s["phase"] == "day":
            s = S.post(f"{G(code)}/advance").json()
            assert s["phase"] == "roundtable"
            assert all(p["proxy_by"] is None for p in s["players"])
            assert s["turns_done"] == 0

    def test_undo_removes_proxied_vote(self):
        code, ps, r, tr, fa = to_roundtable(5)
        absent = ps[3]
        assert proxy(code, absent["id"], ps[1]["id"]).status_code == 200
        # non-host undo 403
        assert skip(code, absent["id"], undo=True, by=ps[1]["id"]).status_code == 403
        res = skip(code, absent["id"], undo=True)
        assert res.status_code == 200, res.text
        a = pl(res.json(), absent["id"])
        assert a["proxy_by"] is None and a["turn_done"] is False and a["skipped"] is False
        assert res.json()["turns_done"] == 0
        # vote removed: everyone else votes ps[2]; tally must not include ps[1]
        for p in ps:
            if p["id"] != absent["id"]:
                tgt = ps[2] if p["id"] != ps[2]["id"] else ps[4]
                assert vote(code, p, tgt).status_code == 200
        assert S.post(f"{G(code)}/advance").status_code == 400  # absent not done
        assert skip(code, absent["id"]).status_code == 200
        s = S.post(f"{G(code)}/advance").json()
        h = s["history"][-1]
        assert h["proxied"] == {}
        assert ps[1]["id"] not in {t["player_id"] for t in h["banish"]["tally"]}

    def test_proxy_turns_skip_into_vote(self):
        code, ps, r, tr, fa = to_roundtable(5)
        absent = ps[2]
        assert skip(code, absent["id"]).status_code == 200
        res = proxy(code, absent["id"], ps[1]["id"])
        assert res.status_code == 200, res.text
        a = pl(res.json(), absent["id"])
        assert a["skipped"] is False and a["skipped_by"] is None and a["proxy_by"] == ps[0]["name"]
        assert res.json()["turns_done"] == 1

    def test_own_vote_replaces_proxy(self):
        code, ps, r, tr, fa = to_roundtable(5)
        absent = ps[2]
        assert proxy(code, absent["id"], ps[1]["id"]).status_code == 200
        assert vote(code, absent, ps[3]).status_code == 200
        s = state(code)
        a = pl(s, absent["id"])
        assert a["proxy_by"] is None and a["turn_done"] is True and s["turns_done"] == 1
        priv = S.post(f"{G(code)}/private", json={"player_id": absent["id"], "pin": pin_of(absent["name"])}).json()
        assert priv["my_vote_id"] == ps[3]["id"]
        # now proxy is blocked
        assert proxy(code, absent["id"], ps[4]["id"]).status_code == 400

    def test_proxy_for_traitor_does_not_confirm_murder(self):
        code, ps, r, tr, fa = to_roundtable(5)
        t = next((p for p in tr if p["id"] != ps[0]["id"]), None)
        if not t:
            pytest.skip("only traitor is host")
        tgt = next(p for p in ps if p["id"] not in (t["id"],))
        assert proxy(code, t["id"], tgt["id"]).status_code == 200
        priv = S.post(f"{G(code)}/private", json={"player_id": t["id"], "pin": pin_of(t["name"])}).json()
        assert priv["murder_confirmed"] is False
        assert priv["next_target"] is None
