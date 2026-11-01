# Helper to drive game state via API for UI tests: python ui_seed.py <cmd>
import sys
from test_traitors_game import API, S, setup_game, pin_of, private

cmd = sys.argv[1]


def roles():
    g = S.get(f"{API}/game").json()
    r = {p["id"]: private(p["id"], pin_of(p["name"])).json()["role"] for p in g["players"]}
    return g, r


def vote_all(g, r, target, next_target=None, murder=True):
    alive = [p for p in g["players"] if p["alive"]]
    for p in alive:
        vt = target["id"] if p["id"] != target["id"] else next(x["id"] for x in alive if x["id"] != p["id"])
        body = {"player_id": p["id"], "pin": pin_of(p["name"]), "vote_target_id": vt}
        if r[p["id"]] == "traitor":
            body["murder_done"] = murder
            if next_target:
                body["target_id"] = next_target["id"]
        print(S.post(f"{API}/game/turn", json=body).status_code, end=" ")
    print()


if cmd == "setup":  # 5 players, all roles seen, traitor picks victim -> still in setup
    S.delete(f"{API}/game")
    g, r = setup_game(5)
    ps = g["players"]
    tr = next(p for p in ps if r[p["id"]] == "traitor")
    fa = [p for p in ps if r[p["id"]] == "faithful"]
    S.post(f"{API}/game/turn", json={"player_id": tr["id"], "pin": pin_of(tr["name"]), "target_id": fa[0]["id"]})
    for p in ps:
        if p["id"] != tr["id"]:
            S.post(f"{API}/game/turn", json={"player_id": p["id"], "pin": pin_of(p["name"])})
    print("traitor", tr["name"], "victim", fa[0]["name"])
elif cmd == "votes":  # in roundtable: everyone votes first alive faithful (not victim)
    g, r = roles()
    alive_f = [p for p in g["players"] if p["alive"] and r[p["id"]] == "faithful"]
    vote_all(g, r, alive_f[-1], next_target=alive_f[0])
    print("banish target", alive_f[-1]["name"])
elif cmd == "to_end":  # loop rounds until game ended
    for _ in range(12):
        g = S.get(f"{API}/game").json()
        if g["phase"] == "ended":
            break
        if g["phase"] in ("day", "reveal"):
            S.post(f"{API}/game/advance"); continue
        if g["phase"] == "roundtable":
            g, r = roles()
            alive_f = [p for p in g["players"] if p["alive"] and r[p["id"]] == "faithful"]
            vote_all(g, r, alive_f[-1], next_target=alive_f[0])
            S.post(f"{API}/game/advance")
    g = S.get(f"{API}/game").json()
    print(g["phase"], g["winner"], len(g["history"]))
    for p in g["players"]:
        print(p["name"], p["role"], p["lives"])
elif cmd == "state":
    g = S.get(f"{API}/game").json()
    print(g.get("phase"), g.get("day"), g.get("turns_done"), "/", g.get("turns_needed"))
