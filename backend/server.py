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
START_LIVES = 2
CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"  # no 0/O, 1/I/L mix-ups
CODE_LEN = 5

# Simple, family friendly "murders in plain sight"
ACTIONS = [
    "Hand them a bottle of water",
    "Pass them a napkin or tissue",
    "Offer them some sun cream",
    "Ask them what time it is",
    "Hand them a towel",
    "Offer them a sweet or a mint",
    "Ask them \"Did you sleep well?\"",
    "Point at something and say \"Look at that!\"",
    "Ask them to pass the salt or pepper",
    "Compliment their hat, sunglasses or shoes",
    "Give them a high five",
    "Offer to take a photo of them",
    "Ask them \"Is it hot enough for you?\"",
    "Gently tap them on the shoulder",
    "Hand them a piece of fruit",
    "Ask them \"How was the pool today?\"",
    "Say the word \"pyramid\" to them",
    "Offer to fetch them a drink",
    "Ask them to hold something for you for a moment",
    "Show them a photo on your phone",
    "Hand them a menu",
    "Ask them \"What are you having for dinner?\"",
    "Wish them \"Good luck tonight\"",
    "Shake their hand",
    "Ask them to recommend a dish from the buffet",
    "Say \"Cheers!\" and clink glasses with them",
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


class Game(BaseModel):
    code: str
    actions: List[str] = Field(default_factory=lambda: list(ACTIONS))
    day: int = 1
    phase: str = "setup"  # setup | day | roundtable | reveal | ended
    players: List[Player]
    turns_done: List[str] = []
    skipped: List[str] = []  # players whose Round Table vote is skipped today
    skipped_by: Dict[str, str] = {}  # skipped player id -> id of the player who skipped them
    votes: Dict[str, str] = {}
    murder_confirmed: bool = False
    target_id: Optional[str] = None
    action: Optional[str] = None
    next_target_id: Optional[str] = None
    next_action: Optional[str] = None
    used_actions: List[str] = []
    history: List[dict] = []
    winner: Optional[str] = None
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

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


class PlayerIn(BaseModel):
    name: str
    pin: str


class CreateGameIn(BaseModel):
    players: List[PlayerIn]


class AuthIn(BaseModel):
    player_id: str
    pin: str


class SkipIn(BaseModel):
    player_id: str
    undo: bool = False
    by_id: Optional[str] = None  # who is doing the skipping (needs their PIN)
    pin: Optional[str] = None


class TurnIn(AuthIn):
    vote_target_id: Optional[str] = None
    murder_done: Optional[bool] = None
    target_id: Optional[str] = None


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
        "players": [
            {
                "id": p.id,
                "name": p.name,
                "lives": p.lives,
                "alive": p.lives > 0,
                "role": p.role if (p.lives == 0 or ended) else None,
                "turn_done": p.id in g.turns_done,
                "skipped": p.id in g.skipped,
                "skipped_by": name_of(g, g.skipped_by.get(p.id)) if p.id in g.skipped else None,
            }
            for p in g.players
        ],
        "turns_needed": len(g.players) if g.phase == "setup" else len(g.alive()),
        "turns_done": len(g.turns_done),
        # never reveal which secret action was used (strip from older records too)
        "history": [{**h, "murder": {k: v for k, v in h["murder"].items() if k != "action"}} for h in g.history],
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


def check_winner(g: Game) -> Optional[str]:
    traitors = [p for p in g.alive() if p.role == "traitor"]
    faithful = [p for p in g.alive() if p.role == "faithful"]
    if not traitors:
        return "faithful"
    if len(traitors) >= len(faithful) or g.day >= TOTAL_DAYS:
        return "traitors"
    return None


def resolve_day(g: Game) -> dict:
    result = {"day": g.day, "murder": None, "banish": None, "skipped": [name_of(g, pid) for pid in g.skipped],
              "skipped_by": {name_of(g, pid): name_of(g, g.skipped_by.get(pid)) for pid in g.skipped}}

    # 1. Murder in plain sight
    victim = g.player(g.target_id)
    if victim and victim.lives > 0 and g.murder_confirmed:
        victim.lives -= 1
        result["murder"] = {
            "success": True,
            "victim_id": victim.id,
            "victim_name": victim.name,
            "lives_left": victim.lives,
            "eliminated": victim.lives == 0,
            "role": victim.role if victim.lives == 0 else None,
        }
    else:
        result["murder"] = {"success": False}

    # 2. Round Table banishment
    tally = Counter(v for k, v in g.votes.items() if g.player(k))
    counts = [{"player_id": pid, "name": name_of(g, pid), "votes": n} for pid, n in tally.most_common()]
    banish = {"tally": counts, "tie": False, "target_id": None}
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
                banish["already_dead"] = False
            else:
                banish["already_dead"] = True
            banish["lives_left"] = t.lives
            banish["eliminated"] = t.lives == 0
            banish["role"] = t.role if t.lives == 0 else None
    result["banish"] = banish
    return result


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
    n_traitors = max(1, round(len(names) / 5))
    traitor_idx = set(random.sample(range(len(names)), n_traitors))
    players = [
        Player(name=names[i], pin_hash=hash_pin(p.pin), role="traitor" if i in traitor_idx else "faithful")
        for i, p in enumerate(data.players)
    ]
    g = Game(code=await new_code(), players=players)
    await save(g)
    return public_state(g)


@api_router.delete("/games/{code}")
@locked
async def delete_game(code: str):
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
    }
    if p.role == "traitor":
        out["fellow_traitors"] = [x.name for x in g.players if x.role == "traitor" and x.id != p.id]
        out["target"] = {"id": g.target_id, "name": name_of(g, g.target_id)} if g.target_id else None
        out["action"] = g.action
        out["next_target"] = {"id": g.next_target_id, "name": name_of(g, g.next_target_id)} if g.next_target_id else None
        out["next_action"] = g.next_action
        out["murder_confirmed"] = g.murder_confirmed
    return out


@api_router.post("/games/{code}/turn")
@locked
async def take_turn(code: str, data: TurnIn):
    g = await require_game(code)
    p = auth(g, data)
    is_traitor = p.role == "traitor"

    if g.phase == "setup":
        if is_traitor:
            if data.target_id:
                valid_victim(g, data.target_id)
                g.target_id = data.target_id
                if not g.action:
                    g.action = g.pick_action(g.actions)
            elif not g.target_id:
                raise HTTPException(400, "Choose who to murder on Day 1")
    elif g.phase == "roundtable":
        if p.lives <= 0:
            raise HTTPException(400, "You have been eliminated and cannot vote")
        tgt = g.player(data.vote_target_id)
        if not tgt or tgt.lives <= 0 or tgt.id == p.id:
            raise HTTPException(400, "Choose someone to banish")
        g.votes[p.id] = tgt.id
        if p.id in g.skipped:  # they turned up after all
            g.skipped.remove(p.id)
            g.skipped_by.pop(p.id, None)
        if is_traitor:
            if g.target_id and data.murder_done is not None and data.murder_done:
                g.murder_confirmed = True
            if g.day < TOTAL_DAYS and data.target_id:
                valid_victim(g, data.target_id)
                g.next_target_id = data.target_id
                if not g.next_action:
                    g.next_action = g.pick_action(g.actions)
    elif g.phase == "day" and is_traitor and p.lives > 0 and data.target_id:
        # Traitors re-pick if their planned victim was eliminated overnight
        if g.target_id and g.player(g.target_id).lives > 0:
            raise HTTPException(400, "Today's victim is already chosen")
        valid_victim(g, data.target_id)
        g.target_id = data.target_id
        g.action = g.pick_action(g.actions)
        await save(g)
        return await private_view(code, AuthIn(player_id=data.player_id, pin=data.pin))
    else:
        raise HTTPException(400, "It is not time to take a turn")

    if p.id not in g.turns_done:
        g.turns_done.append(p.id)
    await save(g)
    return await private_view(code, AuthIn(player_id=data.player_id, pin=data.pin))


@api_router.post("/games/{code}/skip")
@locked
async def skip_vote(code: str, data: SkipIn):
    """Skip (or un-skip) a player's Round Table vote for today, e.g. if they are away."""
    g = await require_game(code)
    if g.phase != "roundtable":
        raise HTTPException(400, "Votes can only be skipped at the Round Table")
    p = g.player(data.player_id)
    if not p or p.lives <= 0:
        raise HTTPException(400, "Choose a player who is still in the game")
    if data.undo:
        if p.id in g.skipped:
            g.skipped.remove(p.id)
            g.skipped_by.pop(p.id, None)
            g.turns_done.remove(p.id)
    else:
        if not data.by_id or not data.pin:
            raise HTTPException(400, "Choose your name and enter your PIN to skip a vote")
        by = auth(g, AuthIn(player_id=data.by_id, pin=data.pin))
        if by.lives <= 0:
            raise HTTPException(400, "Only players still in the game can skip a vote")
        if p.id not in g.turns_done:
            g.skipped.append(p.id)
            g.skipped_by[p.id] = by.id
            g.turns_done.append(p.id)
    await save(g)
    return public_state(g)


@api_router.post("/games/{code}/advance")
@locked
async def advance(code: str, expected: Optional[str] = None, expected_day: Optional[int] = None):
    g = await require_game(code)
    # Several phones may tap the same button: only the first one moves the game on
    if (expected and expected != g.phase) or (expected_day and expected_day != g.day):
        return public_state(g)
    if g.phase == "setup":
        if len(g.turns_done) < len(g.players):
            raise HTTPException(400, "Every player must see their role first")
        if not g.target_id:
            raise HTTPException(400, "The Traitors have not chosen a victim yet")
        g.phase = "day"
        g.turns_done = []
    elif g.phase == "day":
        g.phase = "roundtable"
        g.turns_done, g.votes, g.murder_confirmed, g.skipped, g.skipped_by = [], {}, False, [], {}
    elif g.phase == "roundtable":
        alive_ids = {p.id for p in g.alive()}
        if not alive_ids.issubset(set(g.turns_done)):
            raise HTTPException(400, "Everyone must vote before the reveal")
        result = resolve_day(g)
        g.winner = check_winner(g)
        result["winner"] = g.winner
        g.history.append(result)
        g.phase = "reveal"
    elif g.phase == "reveal":
        if g.winner:
            g.phase = "ended"
        else:
            g.day += 1
            nxt = g.player(g.next_target_id)
            if nxt and nxt.lives > 0:
                g.target_id, g.action = g.next_target_id, g.next_action
            else:
                g.target_id, g.action = None, None
            g.next_target_id, g.next_action = None, None
            g.turns_done, g.votes, g.murder_confirmed, g.skipped, g.skipped_by = [], {}, False, [], {}
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
