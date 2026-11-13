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
    host_id: Optional[str] = None  # the creator; only they may end a game in progress
    actions: List[str] = Field(default_factory=lambda: list(ACTIONS))
    day: int = 1
    phase: str = "setup"  # setup | day | roundtable | reveal | ended
    players: List[Player]
    turns_done: List[str] = []
    votes: Dict[str, str] = {}
    murder_confirmed: bool = False
    target_id: Optional[str] = None
    action: Optional[str] = None
    action_choices: List[str] = []  # the three options a Traitor picks tonight's action from
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


class TurnIn(AuthIn):
    vote_target_id: Optional[str] = None
    murder_done: Optional[bool] = None
    target_id: Optional[str] = None
    action: Optional[str] = None  # the chosen murder action (one of the three offered)


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
        "host_id": g.host_id,
        "host_name": name_of(g, g.host_id),
        "players": [
            {
                "id": p.id,
                "name": p.name,
                "lives": p.lives,
                "alive": p.lives > 0,
                "role": p.role if (p.lives == 0 or ended) else None,
                "turn_done": p.id in g.turns_done,
            }
            for p in g.players
        ],
        "turns_needed": len(g.players) if g.phase == "setup" else len(g.alive()),
        "turns_done": len(g.turns_done),
        # never reveal which secret action was used (strip from older records too);
        # a day's murder is None until the night step has resolved it
        "history": [_public_history(h) for h in g.history],
    }


def _public_history(h: dict) -> dict:
    m = h.get("murder")
    pub = {k: v for k, v in m.items() if k != "action"} if m else None
    return {**h, "murder": pub}


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
    }
    if p.role == "traitor":
        out["fellow_traitors"] = [x.name for x in g.players if x.role == "traitor" and x.id != p.id]
        out["target"] = {"id": g.target_id, "name": name_of(g, g.target_id)} if g.target_id else None
        out["action"] = g.action
        out["action_choices"] = g.action_choices
        out["murder_confirmed"] = g.murder_confirmed
    return out


@api_router.post("/games/{code}/turn")
@locked
async def take_turn(code: str, data: TurnIn):
    g = await require_game(code)
    p = auth(g, data)
    is_traitor = p.role == "traitor"

    if g.phase == "setup":
        pass  # everyone just sees their role in private; nothing to choose yet
    elif g.phase == "roundtable":
        if p.lives <= 0:
            raise HTTPException(400, "You have been eliminated and cannot vote")
        tgt = g.player(data.vote_target_id)
        if not tgt or tgt.lives <= 0 or tgt.id == p.id:
            raise HTTPException(400, "Choose someone to banish")
        g.votes[p.id] = tgt.id
    elif g.phase == "night":
        # The murder happens after the Round Table, in two steps. A Traitor names
        # the victim and is offered three secret actions (step 1, not yet committed),
        # then picks one to confirm the murder (step 2). Everyone else — and a
        # Traitor lying low — just passes, so watching who taps never reveals them.
        if is_traitor and p.lives > 0 and data.target_id:
            # Step 1: choose the victim, get three action options (no turn taken yet)
            valid_victim(g, data.target_id)
            g.target_id = data.target_id
            g.action = None
            g.murder_confirmed = False
            g.action_choices = g.pick_actions(g.actions, 3)
            await save(g)
            return await private_view(code, AuthIn(player_id=data.player_id, pin=data.pin))
        if is_traitor and p.lives > 0 and data.action:
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
        g.phase = "roundtable"
        g.turns_done, g.votes = [], {}
    elif g.phase == "roundtable":
        alive_ids = {p.id for p in g.alive()}
        if not alive_ids.issubset(set(g.turns_done)):
            # A player can be missing at the Round Table: `force` skips the stragglers
            # and reveals the banishment on the votes cast so far (needs at least one).
            if not force:
                raise HTTPException(400, "Everyone must vote before the banishment")
            if not g.votes:
                raise HTTPException(400, "At least one player must vote before you can skip the rest")
        banish = resolve_banish(g)
        g.winner = winner_by_roles(g)  # a Traitor banished can end it before nightfall
        g.history.append({"day": g.day, "murder": None, "banish": banish, "winner": g.winner})
        g.phase = "banished"
    elif g.phase == "banished":
        # Banishment shown; now the Traitors murder — unless the game is already won.
        if g.winner:
            g.phase = "ended"
        else:
            g.phase = "night"
            g.turns_done, g.target_id, g.action, g.murder_confirmed, g.action_choices = [], None, None, False, []
    elif g.phase == "night":
        alive_ids = {p.id for p in g.alive()}
        if not alive_ids.issubset(set(g.turns_done)):
            raise HTTPException(400, "Everyone must take their turn before the reveal")
        murder = resolve_murder(g)
        g.winner = winner_by_roles(g)
        if not g.winner and g.day >= TOTAL_DAYS:
            g.winner = "traitors"  # they survived to the final day
        if g.history:
            g.history[-1]["murder"] = murder
            g.history[-1]["winner"] = g.winner
        g.phase = "reveal"
    elif g.phase == "reveal":
        if g.winner:
            g.phase = "ended"
        else:
            g.day += 1
            g.target_id, g.action, g.murder_confirmed, g.action_choices = None, None, False, []
            g.turns_done, g.votes = [], {}
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
