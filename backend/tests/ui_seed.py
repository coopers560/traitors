# Helper to drive a game via API for UI tests (join-code routes): python ui_seed.py <cmd> [code]
#   create            -> prints new game code (5 TEST_P players, PINs 0001..0005)
#   setup <code>      -> traitor picks a faithful victim, everyone sees role
#   vote <code>       -> every alive player votes (traitors confirm murder, pick next victim)
#   delete <code>     -> delete game
import sys
from test_traitors_game import API, S, G, mk_players, pin_of

cmd = sys.argv[1]
code = sys.argv[2] if len(sys.argv) > 2 else None


def roles(code):
    g = S.get(G(code)).json()
    r = {p["id"]: S.post(f"{G(code)}/private", json={"player_id": p["id"], "pin": pin_of(p["name"])}).json()["role"] for p in g["players"]}
    return g, r


if cmd == "create":
    print(S.post(f"{API}/games", json={"players": mk_players(5)}).json()["code"])
elif cmd == "setup":
    g, r = roles(code)
    fa = [p for p in g["players"] if r[p["id"]] == "faithful"]
    for p in g["players"]:
        body = {"player_id": p["id"], "pin": pin_of(p["name"])}
        if r[p["id"]] == "traitor":
            body["target_id"] = fa[0]["id"]
        print(p["name"], S.post(f"{G(code)}/turn", json=body).status_code)
elif cmd == "vote":
    g, r = roles(code)
    alive = [p for p in g["players"] if p["alive"]]
    fa = [p for p in alive if r[p["id"]] == "faithful"]
    target = fa[-1]
    for p in alive:
        vt = target["id"] if p["id"] != target["id"] else fa[0]["id"]
        body = {"player_id": p["id"], "pin": pin_of(p["name"]), "vote_target_id": vt}
        if r[p["id"]] == "traitor":
            body.update(murder_done=True, target_id=fa[0]["id"])
        print(p["name"], S.post(f"{G(code)}/turn", json=body).status_code)
elif cmd == "delete":
    print(S.delete(G(code)).json())
