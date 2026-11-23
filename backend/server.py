from fastapi import FastAPI, APIRouter, HTTPException
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import asyncio
import functools
import logging
import random
import hashlib
import uuid
from collections import Counter
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Dict
from datetime import datetime, timezone


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI()


@app.get("/health", include_in_schema=False)
@app.head("/health", include_in_schema=False)
async def health():
    return {"status": "ok"}


api_router = APIRouter(prefix="/api")

TOTAL_DAYS = 12
START_LIVES = 1  # one hit — a murder or a banishment — puts a player out
HIDE_ROLE_AT = 6  # once this many (or fewer) remain, a banished player's role stays secret
ENDGAME_AT = 4  # at this many (or fewer) remain, each round is a "banish again or end the game" vote
CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"  # no 0/O, 1/I/L mix-ups
CODE_LEN = 5

# The moderator ("Claudia") god-view passphrase. Kept out of the app bundle and
# checked only here on the server, so players can't see it in the frontend JS.
# Override it in deployment by setting MODERATOR_PASSPHRASE; this is the default.
MODERATOR_PASSPHRASE = os.environ.get("MODERATOR_PASSPHRASE", "!Uganda02!")

# Simple, family friendly "murders in plain sight" — subtle holiday small talk
# and gestures that look completely natural around a resort or by the pool.
ACTIONS = [
    "Offer them some sun cream",
    "Top up their water glass",
    "Ask them if they've been in the pool yet",
    "Mention how warm the sea is today",
    "Ask them how they slept",
    "Offer to save them a sunlounger",
    "Ask if they've tried the ice cream",
    "Compliment their sunhat or sunglasses",
    "Ask them what time breakfast finishes",
    "Point out a boat on the horizon to them",
    "Offer them a slice of fresh fruit",
    "Ask if they're coming down for dinner",
    "Mention that the pool bar is open",
    "Ask them to pass the sun lotion",
    "Recommend them a dish from the buffet",
    "Ask them how far the beach is",
    "Mention that it's nearly happy hour",
    "Ask if they've seen tonight's entertainment",
    "Offer them a sip of your cold drink",
    "Ask them what they ordered at the bar",
    "Suggest a shady spot out of the sun to them",
    "Ask if they remembered their room key",
    "Mention the lovely sunset later to them",
    "Offer them a cool towel or flannel",
    "Ask if they fancy a stroll along the front",
    "Wish them a lovely day by the pool",
    "Move their flip flops away from the sunbed",
    "Spill their full drink near the pool area",
    "Sing a song and ask them to tell you the next line",
    "Get them to do the actions to a song in mini disco",
    "Offer them a drink from the bar",
    "Drink their drink by mistake",
    "Sit next to them on their sunbed",
    "Use their suncream",
    "Get them to come to the shop with you",
    "Get them to say something in Egyptian",
    "Accuse them of cheating at cards",
    "Get Ivy to high five them first before others in the group",
    "Borrow money from them",
    "Get a group picture with them in the middle",
    "Ask them to take a photo",
    "Take a selfie with them",
    "Get a photo of them with a sibling or parent",
    "Put a note on their towel saying you have been murdered",
    "Put a note through their door saying you have been murdered",
    "Get them a coffee",
    "Get them some cake",
]


def hash_pin(pin: str) -> str:
    return hashlib.sha256(pin.encode()).hexdigest()


# ---------------- Models ----------------
class Player(BaseModel):
    id: str = Field(default_factory=lambda: uuid.uuid4().hex[:8])
    name: str
    pin_hash: str
    role: str  # "traitor" | "faithful"
    lives: int = START_LIVES
    role_revealed: bool = True  # set False when eliminated while roles are being kept secret


class Game(BaseModel):
    code: str
    host_id: Optional[str] = None  # the creator; only they may end a game in progress
    actions: List[str] = Field(default_factory=lambda: list(ACTIONS))
    day: int = 1
    phase: str = "setup"  # setup | day | roundtable | reveal | ended
    players: List[Player]
    turns_done: List[str] = []
    votes: Dict[str, str] = {}
    murder_confirmed: bool = False  # the Traitors have planned & sealed tonight's murder
    murder_done: bool = False  # the murder was confirmed carried out in plain sight, at the Round Table
    end_votes: List[str] = []  # endgame: players who voted to end the game instead of banishing
    target_id: Optional[str] = None
    action: Optional[str] = None
    action_choices: List[str] = []  # the three options a Traitor picks tonight's action from
    recruit_id: Optional[str] = None  # a Faithful the Traitors recruit tonight (instead of murdering)
    next_target_id: Optional[str] = None
    next_action: Optional[str] = None
    used_actions: List[str] = []
    history: List[dict] = []
    # Who voted for whom at each Round Table — kept for the moderator only and never
    # put in the public history, so secret ballots stay secret to the players.
    vote_log: List[dict] = []
    winner: Optional[str] = None
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    @classmethod
    def from_mongo(cls, doc: dict) -> "Game":
        doc = dict(doc)
        doc.pop("_id", None)
        return cls(**doc)

    def to_mongo(self) -> dict:
        return self.model_dump()

    def player(self, pid: Optional[str]) -> Optional[Player]:
        return next((p for p in self.players if p.id == pid), None)

    def alive(self) -> List[Player]:
        return [p for p in self.players if p.lives > 0]

    def pick_action(self, actions: List[str]) -> str:
        pool = [a for a in actions if a not in self.used_actions] or actions
        a = random.choice(pool)
        self.used_actions.append(a)
        return a

    def pick_actions(self, actions: List[str], n: int = 3) -> List[str]:
        """Offer n fresh action options (not yet used) for the Traitor to choose from."""
        pool = [a for a in actions if a not in self.used_actions]
        if len(pool) < n:
            pool = list(actions)
        random.shuffle(pool)
        return pool[:n]


class PlayerIn(BaseModel):
    name: str
    pin: str


class CreateGameIn(BaseModel):
    players: List[PlayerIn]


class AuthIn(BaseModel):
    player_id: str
    pin: str


class ModeratorIn(BaseModel):
    passphrase: str


class TurnIn(AuthIn):
    vote_target_id: Optional[str] = None
    end_vote: Optional[bool] = None  # endgame: vote to end the game instead of banishing
    murder_done: Optional[bool] = None
    target_id: Optional[str] = None
    action: Optional[str] = None  # the chosen murder action (one of the three offered)
    recruit_id: Optional[str] = None  # a Faithful to recruit into the Traitors


# ---------------- Helpers ----------------
CREATE_LOCK = asyncio.Lock()
GAME_LOCKS: Dict[str, asyncio.Lock] = {}


def locked(fn):
    """Serialise writes per game so turns sent from several phones at once are never lost."""
    @functools.wraps(fn)
    async def wrapper(*args, **kwargs):
        code = kwargs.get("code")
        lock = GAME_LOCKS.setdefault(code.strip().upper(), asyncio.Lock()) if code else CREATE_LOCK
        async with lock:
            return await fn(*args, **kwargs)
    return wrapper


async def load_game(code: str) -> Optional[Game]:
    doc = await db.games.find_one({"code": code.strip().upper()}, {"_id": 0})
    return Game.from_mongo(doc) if doc else None


class ActionsIn(BaseModel):
    actions: List[str]


async def require_game(code: str) -> Game:
    g = await load_game(code)
    if not g:
        raise HTTPException(404, "No game found with that code")
    return g


async def save(g: Game):
    g.updated_at = datetime.now(timezone.utc).isoformat()  # track last activity for the moderator list
    await db.games.replace_one({"code": g.code}, g.to_mongo(), upsert=True)


async def new_code() -> str:
    while True:
        code = "".join(random.choice(CODE_CHARS) for _ in range(CODE_LEN))
        if not await db.games.find_one({"code": code}, {"_id": 1}):
            return code


def name_of(g: Game, pid: Optional[str]) -> Optional[str]:
    p = g.player(pid)
    return p.name if p else None


def public_state(g: Game) -> dict:
    ended = g.phase == "ended"
    return {
        "exists": True,
        "code": g.code,
        "day": g.day,
        "total_days": TOTAL_DAYS,
        "phase": g.phase,
        "winner": g.winner,
        "endgame": in_endgame(g),
        "host_id": g.host_id,
        "host_name": name_of(g, g.host_id),
        "players": [
            {
                "id": p.id,
                "name": p.name,
                "lives": p.lives,
                "alive": p.lives > 0,
                # roles stay secret once few remain (role_revealed); all revealed when the game ends
                "role": p.role if ((p.lives == 0 and p.role_revealed) or ended) else None,
                "turn_done": p.id in g.turns_done,
            }
            for p in g.players
        ],
        "turns_needed": len(g.players) if g.phase == "setup" else len(g.alive()),
        "turns_done": len(g.turns_done),
        # never reveal which secret action was used (strip from older records too);
        # a day's murder is None until the night step has resolved it
        "history": [_public_history(h, ended) for h in g.history],
    }


def _public_history(h: dict, reveal_actions: bool = False) -> dict:
    m = h.get("murder")
    if m is None:
        pub = None
    elif reveal_actions:
        pub = m  # the game is over: the murder methods may now be listed
    else:
        pub = {k: v for k, v in m.items() if k != "action"}  # keep the method secret during play
    return {**h, "murder": pub}


def check_moderator(passphrase: Optional[str]):
    """Gate the god-view. Constant-time compare so the passphrase can't be timed out."""
    import hmac
    if not passphrase or not hmac.compare_digest(passphrase, MODERATOR_PASSPHRASE):
        raise HTTPException(403, "Wrong moderator passphrase")


STAGE_LABEL = {
    "setup": "The Gathering — roles being revealed",
    "day": "Daytime — the holiday goes on",
    "night": "The Traitors are choosing their victim",
    "gather": "Checking in for the Round Table",
    "reveal": "The murder is being revealed",
    "roundtable": "The Round Table — voting to banish",
    "banished": "The banishment is being revealed",
    "ended": "The game is over",
}


def snapshot_votes(g: Game) -> dict:
    """Freeze who voted for whom this Round Table, for the moderator-only vote log."""
    return {
        "day": g.day,
        "votes": [
            {"voter_id": vid, "voter_name": name_of(g, vid), "target_id": tid, "target_name": name_of(g, tid)}
            for vid, tid in g.votes.items()
        ],
        "end_votes": [name_of(g, pid) for pid in g.end_votes],
    }


def _next_step(g: Game) -> str:
    """A plain hint of what the host does next on the main app, to narrate the room."""
    alive_done = {p.id for p in g.alive()}.issubset(set(g.turns_done))
    all_seen = len(g.turns_done) >= len(g.players)
    return {
        "setup": "Everyone sees their role, then start Day 1." if all_seen else "Pass the phone round so each player sees their role.",
        "day": "Gather for the final vote." if in_endgame(g) else "Night falls — the Traitors choose their victim.",
        "night": "Everyone to the Round Table." if alive_done else "Waiting for the Traitors to plot.",
        "gather": "Reveal the murder." if alive_done else "Waiting for everyone to check in.",
        "reveal": "Show the murder, then the table votes." if not g.winner else "Show the murder — the game is won.",
        "roundtable": "Reveal the banishment." if alive_done else "Waiting for everyone to vote.",
        "banished": "Show the banishment, then begin the next day." if not g.winner else "Show the banishment — the game is won.",
        "ended": "The game is over.",
    }.get(g.phase, "")


def _win_note(g: Game) -> str:
    """How each side wins from here, given who's left."""
    if g.winner:
        return "The Traitors have won." if g.winner == "traitors" else "The Faithful have won."
    t = sum(1 for p in g.alive() if p.role == "traitor")
    f = sum(1 for p in g.alive() if p.role == "faithful")
    if t == 0:
        return "No Traitors remain — the Faithful win at the next reveal."
    need = max(0, f - t)  # Faithful to remove for the Traitors to reach parity
    faithful_part = f"Faithful win by banishing the {t} remaining Traitor{'s' if t != 1 else ''}."
    if need == 0:
        traitor_part = "Traitors are already at parity — they win at the next reveal."
    else:
        traitor_part = f"Traitors win by reaching {t} v {t} ({need} more Faithful out) or surviving to Day {TOTAL_DAYS}."
    return f"{faithful_part} {traitor_part}"


def moderator_state(g: Game) -> dict:
    """The full 'Claudia' god-view: every secret laid bare. Never sent to players."""
    alive = g.alive()
    traitors_alive = [p for p in alive if p.role == "traitor"]
    faithful_alive = [p for p in alive if p.role == "faithful"]
    turn_pool = g.players if g.phase == "setup" else alive
    outstanding = [p.name for p in turn_pool if p.id not in g.turns_done]

    tonight = None
    if g.phase in ("night", "gather"):
        tonight = {
            "victim_id": g.target_id,
            "victim_name": name_of(g, g.target_id),
            "action": g.action,  # the secret method, shown to the moderator only
            "murder_confirmed": g.murder_confirmed,  # planned & sealed at night
            "murder_done": g.murder_done,  # confirmed carried out at the gather check-in
            "recruit_id": g.recruit_id,
            "recruit_name": name_of(g, g.recruit_id),
        }

    # Live Round Table: individual ballots, a running tally, who hasn't voted, end-game votes.
    round_table = None
    if g.phase == "roundtable":
        tally = Counter(tid for tid in g.votes.values())
        voted_ids = set(g.votes.keys()) | set(g.end_votes)
        round_table = {
            "votes": [
                {"voter_id": vid, "voter_name": name_of(g, vid), "target_id": tid, "target_name": name_of(g, tid)}
                for vid, tid in g.votes.items()
            ],
            "tally": [
                {"target_id": tid, "name": name_of(g, tid), "votes": n} for tid, n in tally.most_common()
            ],
            "end_votes": [name_of(g, pid) for pid in g.end_votes],
            "not_voted": [p.name for p in alive if p.id not in voted_ids],
        }

    return {
        "exists": True,
        "code": g.code,
        "day": g.day,
        "total_days": TOTAL_DAYS,
        "phase": g.phase,
        "stage": STAGE_LABEL.get(g.phase, g.phase),
        "next_step": _next_step(g),
        "win_note": _win_note(g),
        "endgame": in_endgame(g),
        "winner": g.winner,
        "host_id": g.host_id,
        "host_name": name_of(g, g.host_id),
        "counts": {
            "total": len(g.players),
            "alive": len(alive),
            "out": len(g.players) - len(alive),
            "traitors_alive": len(traitors_alive),
            "faithful_alive": len(faithful_alive),
            "traitors_total": sum(1 for p in g.players if p.role == "traitor"),
        },
        "players": [
            {
                "id": p.id,
                "name": p.name,
                "role": p.role,  # the real role — always, for every player
                "lives": p.lives,
                "alive": p.lives > 0,
                "turn_done": p.id in g.turns_done,
                "is_host": p.id == g.host_id,
                "fellow_traitors": [x.name for x in g.players if x.role == "traitor" and x.id != p.id] if p.role == "traitor" else [],
            }
            for p in g.players
        ],
        "turns_done": len(g.turns_done),
        "turns_needed": len(turn_pool),
        "outstanding": outstanding,
        "tonight": tonight,
        "round_table": round_table,
        "vote_log": g.vote_log,  # moderator-only: who voted for whom, each past Round Table
        "history": g.history,  # the full record, murder methods included
    }


def auth(g: Game, data: AuthIn) -> Player:
    p = g.player(data.player_id)
    if not p:
        raise HTTPException(404, "Player not found")
    if p.pin_hash != hash_pin(data.pin):
        raise HTTPException(401, "Incorrect PIN. Try again.")
    return p


def valid_victim(g: Game, pid: Optional[str]) -> Player:
    v = g.player(pid)
    if not v or v.lives <= 0:
        raise HTTPException(400, "Choose a valid victim")
    if v.role == "traitor":
        raise HTTPException(400, "Traitors cannot murder a fellow Traitor")
    return v


def in_endgame(g: Game) -> bool:
    """Once few players remain, each round is a 'banish again or end the game' vote."""
    return len(g.alive()) <= ENDGAME_AT


RECRUIT_MIN_PLAYERS = 6


def recruitment_available(g: Game) -> bool:
    """Traitors may recruit on any night while at least six players are still in."""
    alive = g.alive()
    traitors = [p for p in alive if p.role == "traitor"]
    faithful = [p for p in alive if p.role == "faithful"]
    return len(alive) >= RECRUIT_MIN_PLAYERS and bool(traitors) and bool(faithful)


def winner_by_roles(g: Game) -> Optional[str]:
    """Winner decided purely by who is left alive (no day cap)."""
    traitors = [p for p in g.alive() if p.role == "traitor"]
    faithful = [p for p in g.alive() if p.role == "faithful"]
    if not traitors:
        return "faithful"
    if len(traitors) >= len(faithful):
        return "traitors"
    return None


def resolve_banish(g: Game) -> dict:
    """The Round Table vote — resolved first, before the Traitors murder."""
    alive_before = len(g.alive())  # roles stay secret once few players remain
    tally = Counter(v for k, v in g.votes.items() if g.player(k))
    counts = [{"player_id": pid, "name": name_of(g, pid), "votes": n} for pid, n in tally.most_common()]
    # Who voted for whom — shown to everyone when the banishment is revealed.
    votes = [
        {"voter_id": vid, "voter_name": name_of(g, vid), "target_id": tid, "target_name": name_of(g, tid)}
        for vid, tid in g.votes.items()
        if g.player(vid)
    ]
    banish = {"tally": counts, "votes": votes, "tie": False, "target_id": None}
    if counts:
        top = counts[0]["votes"]
        leaders = [c for c in counts if c["votes"] == top]
        if len(leaders) > 1:
            banish["tie"] = True
        else:
            t = g.player(leaders[0]["player_id"])
            banish["target_id"] = t.id
            banish["name"] = t.name
            if t.lives > 0:
                t.lives -= 1
                t.role_revealed = alive_before > HIDE_ROLE_AT
                banish["already_dead"] = False
            else:
                banish["already_dead"] = True
            banish["lives_left"] = t.lives
            banish["eliminated"] = t.lives == 0
            revealed = t.lives == 0 and t.role_revealed
            banish["role"] = t.role if revealed else None
            banish["role_hidden"] = t.lives == 0 and not t.role_revealed
    return banish


def resolve_murder(g: Game) -> dict:
    """The Traitors' murder — chosen and resolved after the banishment, at night."""
    victim = g.player(g.target_id)
    if victim and victim.lives > 0 and g.murder_confirmed:
        victim.lives -= 1
        return {
            "success": True,
            "victim_id": victim.id,
            "victim_name": victim.name,
            "action": g.action,  # kept hidden until the game ends (see _public_history)
            "lives_left": victim.lives,
            "eliminated": victim.lives == 0,
            "role": victim.role if victim.lives == 0 else None,
        }
    return {"success": False}


# ---------------- Routes ----------------
@api_router.get("/")
async def root():
    return {"message": "The Traitors"}


def actions_out(g: Game) -> dict:
    return {"actions": g.actions, "is_default": g.actions == ACTIONS}


@api_router.get("/games/{code}/actions")
async def list_actions(code: str):
    return actions_out(await require_game(code))


@api_router.put("/games/{code}/actions")
@locked
async def save_actions(code: str, data: ActionsIn):
    g = await require_game(code)
    cleaned, seen = [], set()
    for a in data.actions:
        a = a.strip()
        if a and a.lower() not in seen and len(a) <= 120:
            cleaned.append(a)
            seen.add(a.lower())
    if len(cleaned) < 3:
        raise HTTPException(400, "Keep at least 3 actions so the Traitors have choices")
    g.actions = cleaned
    await save(g)
    return actions_out(g)


@api_router.delete("/games/{code}/actions")
@locked
async def reset_actions(code: str):
    g = await require_game(code)
    g.actions = list(ACTIONS)
    await save(g)
    return actions_out(g)


@api_router.post("/moderator/unlock")
async def moderator_unlock(data: ModeratorIn):
    """Check the moderator passphrase alone, so the view can gate before a code is entered."""
    check_moderator(data.passphrase)
    return {"ok": True}


@api_router.post("/moderator/games")
async def moderator_games(data: ModeratorIn):
    """List games for the moderator, most recently played first (live games on top)."""
    check_moderator(data.passphrase)
    docs = await db.games.find(
        {"code": {"$exists": True}},
        {"_id": 0, "code": 1, "phase": 1, "day": 1, "players": 1, "winner": 1, "updated_at": 1, "created_at": 1},
    ).to_list(500)

    def sort_key(d):
        return d.get("updated_at") or d.get("created_at") or ""

    out = []
    for d in sorted(docs, key=sort_key, reverse=True):
        players = d.get("players", [])
        out.append({
            "code": d.get("code"),
            "phase": d.get("phase"),
            "stage": STAGE_LABEL.get(d.get("phase"), d.get("phase")),
            "day": d.get("day"),
            "total_days": TOTAL_DAYS,
            "players": len(players),
            "alive": sum(1 for p in players if p.get("lives", 0) > 0),
            "winner": d.get("winner"),
            "live": d.get("phase") != "ended",
            "updated_at": d.get("updated_at") or d.get("created_at"),
        })
    return {"games": out}


@api_router.post("/games/{code}/moderator")
async def moderator_view(code: str, data: ModeratorIn):
    """The god-view for one game. Passphrase-gated; reveals every role and secret."""
    check_moderator(data.passphrase)
    return moderator_state(await require_game(code))


@api_router.get("/games/{code}")
async def get_game(code: str):
    return public_state(await require_game(code))


@api_router.post("/games")
@locked
async def create_game(data: CreateGameIn):
    names = [p.name.strip() for p in data.players]
    if len(names) < 4 or len(names) > 15:
        raise HTTPException(400, "You need between 4 and 15 players")
    if any(not n for n in names):
        raise HTTPException(400, "Every player needs a name")
    if len({n.lower() for n in names}) != len(names):
        raise HTTPException(400, "Each player needs a different name")
    for p in data.players:
        if not (p.pin.isdigit() and len(p.pin) == 4):
            raise HTTPException(400, f"{p.name.strip()} needs a 4-digit PIN")
    # A random number of Traitors: 1 to 3, always a minority (fewer than the Faithful)
    n_traitors = random.randint(1, max(1, min(3, (len(names) - 1) // 2)))
    traitor_idx = set(random.sample(range(len(names)), n_traitors))
    players = [
        Player(name=names[i], pin_hash=hash_pin(p.pin), role="traitor" if i in traitor_idx else "faithful")
        for i, p in enumerate(data.players)
    ]
    g = Game(code=await new_code(), players=players)
    g.host_id = players[0].id  # the first player entered is the host/creator
    await save(g)
    return public_state(g)


class EndGameIn(BaseModel):
    player_id: Optional[str] = None
    pin: Optional[str] = None


@api_router.delete("/games/{code}")
@locked
async def delete_game(code: str, data: Optional[EndGameIn] = None):
    g = await load_game(code)
    # Ending a game that is still in progress is restricted to the host, so one
    # player can't wipe everyone's game. A finished game can be cleared by anyone.
    if g and g.host_id and g.phase != "ended":
        if not data or data.player_id != g.host_id:
            raise HTTPException(403, "Only the host can end the game")
        host = g.player(g.host_id)
        if not host or not data.pin or host.pin_hash != hash_pin(data.pin):
            raise HTTPException(401, "Incorrect host PIN. Try again.")
    GAME_LOCKS.pop(code.strip().upper(), None)
    await db.games.delete_many({"code": code.strip().upper()})
    return {"exists": False}


@api_router.post("/games/{code}/private")
async def private_view(code: str, data: AuthIn):
    g = await require_game(code)
    p = auth(g, data)
    out = {
        "player_id": p.id,
        "name": p.name,
        "role": p.role,
        "lives": p.lives,
        "alive": p.lives > 0,
        "phase": g.phase,
        "day": g.day,
        "turn_done": p.id in g.turns_done,
        "my_vote_id": g.votes.get(p.id),
        "my_end_vote": p.id in g.end_votes,
        "endgame": in_endgame(g),
    }
    if p.role == "traitor":
        out["fellow_traitors"] = [x.name for x in g.players if x.role == "traitor" and x.id != p.id]
        out["target"] = {"id": g.target_id, "name": name_of(g, g.target_id)} if g.target_id else None
        out["action"] = g.action
        out["action_choices"] = g.action_choices
        out["murder_confirmed"] = g.murder_confirmed
        out["murder_done"] = g.murder_done
        out["planned_murder"] = bool(g.target_id and g.murder_confirmed)
        out["can_recruit"] = recruitment_available(g)
        out["recruit"] = {"id": g.recruit_id, "name": name_of(g, g.recruit_id)} if g.recruit_id else None
    return out


@api_router.post("/games/{code}/turn")
@locked
async def take_turn(code: str, data: TurnIn):
    g = await require_game(code)
    p = auth(g, data)
    is_traitor = p.role == "traitor"

    if g.phase == "setup":
        pass  # everyone just sees their role in private; nothing to choose yet
    elif g.phase == "gather":
        # Everyone checks in before the murder is revealed. A Traitor also confirms whether
        # tonight's murder was carried out in plain sight; any Traitor's "yes" counts.
        if p.lives <= 0:
            raise HTTPException(400, "You have been eliminated")
        if is_traitor and data.murder_done:
            g.murder_done = True
    elif g.phase == "roundtable":
        if p.lives <= 0:
            raise HTTPException(400, "You have been eliminated and cannot vote")
        if in_endgame(g) and data.end_vote:
            # Endgame: this player votes to end the game now rather than banish
            g.votes.pop(p.id, None)
            if p.id not in g.end_votes:
                g.end_votes.append(p.id)
        else:
            tgt = g.player(data.vote_target_id)
            if not tgt or tgt.lives <= 0 or tgt.id == p.id:
                raise HTTPException(400, "Choose someone to banish")
            g.votes[p.id] = tgt.id
            if p.id in g.end_votes:
                g.end_votes.remove(p.id)
    elif g.phase == "night":
        # The murder is chosen BEFORE the Round Table, in two steps. A Traitor names
        # the victim and is offered three secret actions (step 1, not yet committed),
        # then picks one to confirm the murder (step 2). Everyone else — and a
        # Traitor lying low — just passes, so watching who taps never reveals them.
        if is_traitor and p.lives > 0 and data.recruit_id:
            # Recruit a Faithful to replace a lost Traitor (instead of murdering tonight)
            if not recruitment_available(g):
                raise HTTPException(400, "The Traitors are already up to strength")
            r = g.player(data.recruit_id)
            if not r or r.lives <= 0 or r.role != "faithful":
                raise HTTPException(400, "Choose a Faithful to recruit")
            g.recruit_id = data.recruit_id
            g.target_id = g.action = None
            g.action_choices = []
            g.murder_confirmed = False
        elif is_traitor and p.lives > 0 and data.target_id:
            # Step 1: choose the victim, get three action options (no turn taken yet)
            valid_victim(g, data.target_id)
            g.recruit_id = None
            g.target_id = data.target_id
            g.action = None
            g.murder_confirmed = False
            g.action_choices = g.pick_actions(g.actions, 3)
            await save(g)
            return await private_view(code, AuthIn(player_id=data.player_id, pin=data.pin))
        elif is_traitor and p.lives > 0 and data.action:
            # Step 2: commit one of the offered actions
            if not g.target_id:
                raise HTTPException(400, "Choose a victim first")
            if data.action not in g.action_choices:
                raise HTTPException(400, "Choose one of the offered actions")
            g.action = data.action
            if data.action not in g.used_actions:
                g.used_actions.append(data.action)
            g.action_choices = []
            g.murder_confirmed = True
    else:
        raise HTTPException(400, "It is not time to take a turn")

    if p.id not in g.turns_done:
        g.turns_done.append(p.id)
    await save(g)
    return await private_view(code, AuthIn(player_id=data.player_id, pin=data.pin))


@api_router.post("/games/{code}/advance")
@locked
async def advance(code: str, expected: Optional[str] = None, expected_day: Optional[int] = None, force: Optional[bool] = None):
    g = await require_game(code)
    # Several phones may tap the same button: only the first one moves the game on
    if (expected and expected != g.phase) or (expected_day and expected_day != g.day):
        return public_state(g)
    if g.phase == "setup":
        if len(g.turns_done) < len(g.players):
            raise HTTPException(400, "Every player must see their role first")
        g.phase = "day"
        g.turns_done = []
    elif g.phase == "day":
        # The Traitors now plot BEFORE the Round Table: each day opens with the night,
        # where they pick the victim and the plain-sight action (or recruit). In the
        # endgame there are no murders, so the day goes straight to the final vote.
        if in_endgame(g):
            g.phase = "roundtable"
            g.turns_done, g.votes, g.end_votes = [], {}, []
        else:
            g.phase = "night"
            g.turns_done, g.target_id, g.action, g.murder_confirmed, g.action_choices, g.recruit_id = [], None, None, False, [], None
            g.murder_done = False
    elif g.phase == "night":
        # The Traitors have planned their victim and action. The murder itself is carried
        # out in plain sight during the day; the group then gathers to check in.
        alive_ids = {p.id for p in g.alive()}
        if not alive_ids.issubset(set(g.turns_done)):
            raise HTTPException(400, "Everyone must take their turn before the Round Table")
        g.phase = "gather"
        g.turns_done = []
        g.murder_done = False
    elif g.phase == "gather":
        # Everyone checks in (the Traitors privately confirm whether the murder was carried
        # out) — all of them, so the confirmation never singles a Traitor out. Then the
        # murder is resolved and revealed BEFORE anyone votes.
        alive_ids = {p.id for p in g.alive()}
        if not alive_ids.issubset(set(g.turns_done)):
            missing = [name_of(g, pid) for pid in alive_ids - set(g.turns_done)]
            raise HTTPException(400, f"Everyone must check in first. Still to check in: {', '.join(n for n in missing if n)}")
        recruited = False
        rp = g.player(g.recruit_id)
        if rp and rp.lives > 0 and rp.role == "faithful":
            rp.role = "traitor"  # recruited instead of murdered
            recruited = True
            murder = {"success": False}
        elif g.murder_confirmed and g.murder_done:
            murder = resolve_murder(g)
        else:
            murder = {"success": False}
        g.winner = winner_by_roles(g)  # the murder alone can win it for the Traitors
        g.history.append({"day": g.day, "murder": murder, "banish": None, "recruited": recruited, "winner": g.winner})
        g.phase = "reveal"
    elif g.phase == "reveal":
        # The murder has been shown. If it won the game, stop; otherwise the table votes.
        if g.winner:
            g.phase = "ended"
        else:
            g.phase = "roundtable"
            g.turns_done, g.votes, g.end_votes = [], {}, []
    elif g.phase == "roundtable":
        alive_ids = {p.id for p in g.alive()}
        if not alive_ids.issubset(set(g.turns_done)):
            # Everyone still in must check in at the Round Table before it is revealed.
            # Skipping stragglers would leak the Traitors: a murder only lands if the
            # Traitor checked in, so a partial check-in narrows down who they are.
            missing = [name_of(g, pid) for pid in alive_ids - set(g.turns_done)]
            raise HTTPException(400, f"Everyone must check in first. Still to vote: {', '.join(n for n in missing if n)}")
        g.vote_log.append(snapshot_votes(g))  # moderator-only record of who voted for whom
        if in_endgame(g) and len(g.end_votes) == len(g.alive()):
            # Everyone voted to end the game: a Traitor still in means the Traitors win.
            g.winner = "traitors" if any(p.role == "traitor" for p in g.alive()) else "faithful"
            g.history.append({"day": g.day, "murder": None, "banish": None, "ended_by_vote": True, "winner": g.winner})
            g.phase = "ended"
        else:
            banish = resolve_banish(g)
            g.winner = winner_by_roles(g)
            # The gather/reveal opened this day's entry with the murder; add the banishment.
            # Endgame days have no murder, so they start their entry here.
            h = g.history[-1] if g.history else None
            if h and h.get("day") == g.day and h.get("banish") is None and not h.get("ended_by_vote"):
                h["banish"] = banish
                h["winner"] = g.winner
            else:
                g.history.append({"day": g.day, "murder": None, "banish": banish, "winner": g.winner})
            g.phase = "banished"
    elif g.phase == "banished":
        # The day is over. The game may be won; the Traitors also win if they survive to the
        # end of the final day. Otherwise a new day (and a new plot) begins.
        if g.winner:
            g.phase = "ended"
        elif g.day >= TOTAL_DAYS:
            g.winner = "traitors"  # they survived to the final day
            if g.history:
                g.history[-1]["winner"] = g.winner
            g.phase = "ended"
        else:
            g.day += 1
            g.target_id, g.action, g.murder_confirmed, g.action_choices, g.recruit_id = None, None, False, [], None
            g.murder_done = False
            g.turns_done, g.votes, g.end_votes = [], {}, []
            g.phase = "day"
    else:
        raise HTTPException(400, "The game is over")
    await save(g)
    return public_state(g)


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


@app.on_event("startup")
async def startup():
    await db.games.delete_many({"code": {"$exists": False}})  # games from before join codes
    await db.games.create_index("code", unique=True)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
