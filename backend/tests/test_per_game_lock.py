# Per-game-code lock: parallel turns in two different games (and mixed-case codes) never lose turns
import time
from concurrent.futures import ThreadPoolExecutor

import pytest
import requests

from test_traitors_game import API, G, mk_players, pin_of

CREATED = []


def _create(n):
    r = requests.post(f"{API}/games", json={"players": mk_players(n)})
    assert r.status_code == 200, r.text
    g = r.json()
    CREATED.append(g["code"])
    return g


def _roles(code, g):
    return {p["id"]: requests.post(f"{G(code)}/private", json={"player_id": p["id"], "pin": pin_of(p["name"])}).json()["role"] for p in g["players"]}


@pytest.fixture(scope="module", autouse=True)
def cleanup():
    yield
    for c in CREATED:
        requests.delete(f"{API}/games/{c}")
        r = requests.get(f"{API}/games/{c}")
        assert r.status_code == 404 or r.json().get("exists") is False


def test_parallel_turns_two_games_no_lost_turns():
    games = [_create(12), _create(12)]
    jobs = []
    for g in games:
        code = g["code"]
        roles = _roles(code, g)
        fa = [p for p in g["players"] if roles[p["id"]] == "faithful"]
        for i, p in enumerate(g["players"]):
            body = {"player_id": p["id"], "pin": pin_of(p["name"])}
            if roles[p["id"]] == "traitor":
                body["target_id"] = fa[0]["id"]
            # Mix upper/lower case codes: both must map to the same lock
            url_code = code.lower() if i % 2 else code
            jobs.append((f"{API}/games/{url_code}/turn", body))

    def post(job):
        return requests.post(job[0], json=job[1], timeout=30)

    t0 = time.time()
    with ThreadPoolExecutor(max_workers=24) as ex:
        results = list(ex.map(post, jobs))
    elapsed = time.time() - t0
    print(f"24 parallel turns across 2 games took {elapsed:.2f}s")
    assert all(r.status_code == 200 for r in results), [r.text for r in results if r.status_code != 200]
    for g in games:
        st = requests.get(f"{API}/games/{g['code']}").json()
        assert st["turns_done"] == 12, st["turns_done"]
        assert all(p["turn_done"] for p in st["players"])
    assert elapsed < 20


def test_create_games_in_parallel_unique_codes():
    with ThreadPoolExecutor(max_workers=6) as ex:
        res = list(ex.map(lambda _: requests.post(f"{API}/games", json={"players": mk_players(4)}, timeout=30), range(6)))
    assert all(r.status_code == 200 for r in res), [r.text for r in res]
    codes = [r.json()["code"] for r in res]
    CREATED.extend(codes)
    assert len(set(codes)) == 6
