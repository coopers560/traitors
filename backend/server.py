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
from datetime import datetime, timedelta, timezone


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

# ClaudAI (the moderator god-view) has no master key: each game nominates its own host,
# who opens that game's ClaudAI with a 4-digit ClaudAI PIN.

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
    # Tie-break: the players tied on the most votes. Set when a Round Table ties; while the
    # tie is being revealed ("banished") a revote is pending, and during "roundtable" everyone
    # votes again but may only choose between these players. Cleared once the revote resolves.
    revote_ids: List[str] = []
    target_id: Optional[str] = None
    action: Optional[str] = None
    action_choices: List[str] = []  # the five options a Traitor picks tonight's action from
    recruit_id: Optional[str] = None  # a Faithful the Traitors recruit tonight (instead of murdering)
    # Recruits the Traitors have earned: +1 each time a Traitor is banished, -1 when they use it.
    recruit_credits: int = 0
    # Optional per-game ClaudAI login: a 4-digit PIN (hashed) that opens this game's god-view.
    moderator_pin_hash: Optional[str] = None
    # The Traitors' secret group chat. Only Traitors still in the game can read or post; never
    # sent in the public state. The moderator sees it.
    traitor_chat: List[dict] = []
    next_target_id: Optional[str] = None
    next_action: Optional[str] = None
    used_actions: List[str] = []
    history: List[dict] = []
    # Who voted for whom at each Round Table — kept for the moderator only and never
    # put in the public history, so secret ballots stay secret to the players.
    vote_log: List[dict] = []
    # Everything that happens, in order — the moderator's ("Claudia's") log. Never sent to
    # players. Each entry has a full `text` and a role-neutral `neutral` text (or None) so the
    # moderator can follow along with roles hidden without anyone being given away.
    event_log: List[dict] = []
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

    def pick_actions(self, actions: List[str], n: int = 5) -> List[str]:
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
    # One group plays one game at a time: when set, refuse while another game is in progress.
    single: bool = False
    # Optional ClaudAI PIN for this game (a host who sees everything).
    moderator_pin: Optional[str] = None



class AuthIn(BaseModel):
    player_id: str
    pin: str


class ChatIn(AuthIn):
    text: Optional[str] = None


class ModeratorIn(BaseModel):
    pin: Optional[str] = None  # this game's ClaudAI PIN


class ModeratorPinIn(ModeratorIn):
    new_pin: str


class TurnIn(AuthIn):
    vote_target_id: Optional[str] = None
    end_vote: Optional[bool] = None  # endgame: vote to end the game instead of banishing
    murder_done: Optional[bool] = None
    target_id: Optional[str] = None
    action: Optional[str] = None  # the chosen murder action (one of the five offered)
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
        "revote": _revote_info(g),
        "claudai": bool(g.moderator_pin_hash),  # whether this game has a ClaudAI host (never the PIN)
        "turns_needed": len(g.players) if g.phase == "setup" else len(g.alive()),
        "turns_done": len(g.turns_done),
        # never reveal which secret action was used (strip from older records too);
        # a day's murder is None until the night step has resolved it
        "history": [_public_history(h, ended) for h in g.history],
    }


def _revote_info(g: Game) -> Optional[dict]:
    """The tie-break, if one is pending (tie being revealed) or under way (revote voting)."""
    if not g.revote_ids or g.phase not in ("banished", "roundtable"):
        return None
    return {
        "ids": list(g.revote_ids),
        "names": [name_of(g, pid) for pid in g.revote_ids],
        "active": g.phase == "roundtable",
    }


def _tie_leaders(banish: Optional[dict]) -> List[str]:
    """The player ids tied on the most votes in a resolved Round Table."""
    if not banish or not banish.get("tie") or not banish.get("tally"):
        return []
    top = banish["tally"][0]["votes"]
    return [t["player_id"] for t in banish["tally"] if t["votes"] == top]


def _public_history(h: dict, reveal_actions: bool = False) -> dict:
    m = h.get("murder")
    if m is None:
        pub = None
    elif reveal_actions:
        pub = m  # the game is over: the murder methods may now be listed
    else:
        pub = {k: v for k, v in m.items() if k != "action"}  # keep the method secret during play
    return {**h, "murder": pub}


# Wrong ClaudAI PINs per game, to stop anyone working through all 10,000 PINs.
PIN_FAILS: Dict[str, List[float]] = {}
PIN_FAIL_LIMIT = 8
PIN_FAIL_WINDOW = 10 * 60  # seconds


def _pin_locked(code: str) -> bool:
    now = datetime.now(timezone.utc).timestamp()
    recent = [t for t in PIN_FAILS.get(code, []) if now - t < PIN_FAIL_WINDOW]
    PIN_FAILS[code] = recent
    return len(recent) >= PIN_FAIL_LIMIT


def check_moderator_pin(g: "Game", pin: Optional[str]) -> None:
    import hmac
    if _pin_locked(g.code):
        raise HTTPException(429, "Too many wrong ClaudAI PINs — wait a few minutes and try again")
    if not g.moderator_pin_hash or not pin or not hmac.compare_digest(hash_pin(pin), g.moderator_pin_hash):
        PIN_FAILS.setdefault(g.code, []).append(datetime.now(timezone.utc).timestamp())
        raise HTTPException(403, "Wrong ClaudAI PIN")
    PIN_FAILS.pop(g.code, None)


def check_game_moderator(g: "Game", data: "ModeratorIn") -> None:
    """ClaudAI for one game: only that game's own ClaudAI PIN opens it."""
    check_moderator_pin(g, data.pin)


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


EVENT_LOG_CAP = 2000


def log(g: Game, kind: str, text: str, neutral: Optional[str] = "same") -> None:
    """Record a moderator-only event. `neutral` is what to show while roles are hidden:
    "same" reuses `text`; None means the event itself would give a Traitor away."""
    g.event_log.append({
        "t": datetime.now(timezone.utc).isoformat(),
        "day": g.day,
        "phase": g.phase,
        "kind": kind,
        "text": text,
        "neutral": text if neutral == "same" else neutral,
    })
    if len(g.event_log) > EVENT_LOG_CAP:
        del g.event_log[:-EVENT_LOG_CAP]


def _plan_text(g: Game) -> str:
    """Tonight's plan so far, for flagging when a Traitor overrides it ('' if none yet)."""
    if g.recruit_id:
        return f"recruit {name_of(g, g.recruit_id)}"
    if g.murder_confirmed and g.target_id:
        return f"murder {name_of(g, g.target_id)}"
    if g.target_id:
        return f"{name_of(g, g.target_id)} picked, not sealed"
    return ""


def _role(p: Player) -> str:
    return "Traitor" if p.role == "traitor" else "Faithful"


def snapshot_votes(g: Game) -> dict:
    """Freeze who voted for whom this Round Table, for the moderator-only vote log."""
    return {
        "day": g.day,
        "round": 2 if g.revote_ids else 1,
        "votes": [
            {"voter_id": vid, "voter_name": name_of(g, vid), "target_id": tid, "target_name": name_of(g, tid)}
            for vid, tid in g.votes.items()
        ],
        "end_votes": [name_of(g, pid) for pid in g.end_votes],
    }


def _stage(g: Game) -> str:
    if g.revote_ids and g.phase == "roundtable":
        return "Tie-break revote between " + " and ".join(n for n in (name_of(g, i) for i in g.revote_ids) if n)
    if g.revote_ids and g.phase == "banished":
        return "The tie is being revealed — a revote follows"
    return STAGE_LABEL.get(g.phase, g.phase)


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
        "banished": ("Show the tie, then start the revote." if g.revote_ids
                     else "Show the banishment, then begin the next day." if not g.winner else "Show the banishment — the game is won."),
        "ended": "The game is over.",
    }.get(g.phase, "")


def _now(g: Game) -> dict:
    """The dead-simple 'what's happening / who are we waiting for / what's next' for the
    moderator. Spoiler-free: during the night everyone takes a turn, so the waiting list
    never singles out a Traitor."""
    pool = g.players if g.phase == "setup" else g.alive()
    waiting = [p.name for p in pool if p.id not in g.turns_done]
    ready = not waiting
    tap = lambda label: f"Host taps “{label}” on the main screen"
    if g.phase == "setup":
        doing, what = "Everyone is looking at their secret role", "to see their role"
        nxt = tap("Begin Day 1") if ready else "Pass the phone round until everyone has seen their role"
    elif g.phase == "day":
        doing, what, waiting = f"Day {g.day} — enjoy the holiday", "", []
        nxt = tap("Gather for the final vote") if in_endgame(g) else tap("Night falls — the Traitors move")
    elif g.phase == "night":
        doing, what = "Night — everyone takes a turn while the Traitors secretly plot", "to take their night turn"
        nxt = tap("Everyone to the Round Table") if ready else "Everyone still listed takes their night turn"
    elif g.phase == "gather":
        doing, what = "Heading to the Round Table — everyone checks in", "to check in"
        nxt = tap("Reveal the murder") if ready else "Everyone still listed checks in"
    elif g.phase == "reveal":
        doing, what, waiting = "The murder reveal is on screen", "", []
        nxt = "Game over after this reveal" if g.winner else "Read the reveal together, then tap “On to the vote”"
    elif g.phase == "roundtable":
        doing, what = ("Tie-break revote — everyone votes again, only between "
                       + " and ".join(n for n in (name_of(g, i) for i in g.revote_ids) if n)
                       if g.revote_ids else "Round Table — everyone votes to banish"), "to vote"
        nxt = tap("Reveal the vote" if in_endgame(g) else "Reveal the banishment") if ready else "Everyone still listed casts their vote"
    elif g.phase == "banished":
        doing, what, waiting = ("The tie is on screen — a revote follows" if g.revote_ids else "The banishment reveal is on screen"), "", []
        nxt = ("Read the reveal together, then tap “Start the revote”" if g.revote_ids
               else "Game over after this reveal" if g.winner else f"Read the reveal together, then tap “Begin Day {g.day + 1}”")
    else:
        doing, what, waiting, nxt = "The game is over", "", [], "Nothing — the game has ended"
    return {"doing": doing, "waiting_on": waiting, "waiting_for": what, "next": nxt, "ready": ready}


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
            "recruit_allowed": recruit_reason(g),  # None | "banished" | "alone"
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
        "stage": _stage(g),
        "revote": _revote_info(g),
        "revote_available": _revote_available(g)[0],
        "revote_note": _revote_available(g)[1],
        "next_step": _next_step(g),
        "now": _now(g),
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
        "event_log": g.event_log,  # moderator-only: every action, in order
        "traitor_chat": g.traitor_chat,  # moderator-only: the Traitors' secret chat
        "has_moderator_pin": bool(g.moderator_pin_hash),
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
ACTION_CHOICES = 5  # secret murder methods a Traitor chooses from each night


def recruit_reason(g: Game) -> Optional[str]:
    """Why the Traitors may recruit tonight, or None if they may not. They may only recruit to
    replace a banished Traitor (one recruit per Traitor banished), or when only one Traitor is
    left — and only while at least six players are still in."""
    alive = g.alive()
    traitors = [p for p in alive if p.role == "traitor"]
    faithful = [p for p in alive if p.role == "faithful"]
    if len(alive) < RECRUIT_MIN_PLAYERS or not traitors or not faithful:
        return None
    if g.recruit_credits > 0:
        return "banished"
    if len(traitors) == 1:
        return "alone"
    return None


def recruitment_available(g: Game) -> bool:
    return recruit_reason(g) is not None


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
                if t.lives == 0 and t.role == "traitor":
                    g.recruit_credits += 1  # the Traitors may now recruit a replacement
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
    log(g, "actions", f"Secret actions list edited ({len(cleaned)} actions)")
    await save(g)
    return actions_out(g)


@api_router.delete("/games/{code}/actions")
@locked
async def reset_actions(code: str):
    g = await require_game(code)
    g.actions = list(ACTIONS)
    log(g, "actions", "Secret actions list reset to the original")
    await save(g)
    return actions_out(g)


@api_router.post("/games/{code}/moderator")
async def moderator_view(code: str, data: ModeratorIn):
    """The god-view for one game. Passphrase- or ClaudAI-PIN-gated; reveals every secret."""
    g = await require_game(code)
    check_game_moderator(g, data)
    return moderator_state(g)


@api_router.post("/moderator/pin")
async def moderator_pin_login(data: ModeratorIn):
    """ClaudAI login with the game's own PIN. There is only one game in progress, so the PIN
    is checked against it; returns its code so ClaudAI can open it."""
    d = await current_game_doc()
    if not d:
        raise HTTPException(404, "There is no game in progress")
    g = await require_game(d["code"])
    if not g.moderator_pin_hash:
        raise HTTPException(403, "This game has no ClaudAI host yet — the game's host can nominate one from the ⋯ menu")
    check_moderator_pin(g, data.pin)
    return {"code": g.code}


class NominateIn(AuthIn):
    new_pin: str


@api_router.post("/games/{code}/claudai")
@locked
async def nominate_claudai(code: str, data: NominateIn):
    """The game's host nominates a ClaudAI host by giving the game its ClaudAI PIN — for a
    game set up without one. Once set, only the ClaudAI PIN itself can change it."""
    g = await require_game(code)
    p = auth(g, data)
    if p.id != g.host_id:
        raise HTTPException(403, "Only the game's host can nominate a ClaudAI host")
    if g.moderator_pin_hash:
        raise HTTPException(400, "This game already has a ClaudAI host — change the PIN from ClaudAI")
    if not (data.new_pin.isdigit() and len(data.new_pin) == 4):
        raise HTTPException(400, "The ClaudAI PIN must be 4 digits")
    if any(pl.pin_hash == hash_pin(data.new_pin) for pl in g.players):
        raise HTTPException(400, "Choose a ClaudAI PIN that no player is using")
    g.moderator_pin_hash = hash_pin(data.new_pin)
    log(g, "stage", f"{p.name} (host) nominated a ClaudAI host")
    await save(g)
    return public_state(g)


@api_router.post("/games/{code}/moderator/pin")
@locked
async def moderator_set_pin(code: str, data: ModeratorPinIn):
    """Change this game's ClaudAI PIN (needs the current ClaudAI PIN)."""
    g = await require_game(code)
    check_game_moderator(g, data)
    if not (data.new_pin.isdigit() and len(data.new_pin) == 4):
        raise HTTPException(400, "The ClaudAI PIN must be 4 digits")
    if any(p.pin_hash == hash_pin(data.new_pin) for p in g.players):
        raise HTTPException(400, "Choose a ClaudAI PIN that no player is using")
    g.moderator_pin_hash = hash_pin(data.new_pin)
    log(g, "stage", "The ClaudAI PIN was changed")
    await save(g)
    return moderator_state(g)


def _open_revote(g: Game) -> None:
    g.phase = "roundtable"
    g.turns_done, g.votes, g.end_votes = [], {}, []
    log(g, "stage", "Tie-break revote opened — everyone votes again, only between "
        + " and ".join(n for n in (name_of(g, i) for i in g.revote_ids) if n))


def _revote_available(g: Game) -> tuple:
    """Can the host re-run the most recent tied Round Table as a revote? (ok, reason)"""
    h = g.history[-1] if g.history else None
    b = h.get("banish") if h else None
    if not b or not b.get("tie"):
        return False, "The last Round Table was not a tie"
    if h.get("tie_vote") or b.get("round") == 2:
        return False, "That tie has already been revoted"
    if g.revote_ids:
        return False, "A revote is already pending"
    leaders = [pid for pid in _tie_leaders(b) if (pl := g.player(pid)) and pl.lives > 0]
    if len(leaders) < 2:
        return False, "Fewer than two of the tied players are still in"
    if g.phase == "banished" and g.day == h["day"]:
        return True, ""
    # The next day has begun. Up to the end of its night nothing real has happened yet (the
    # murder is only carried out after the night), so it can be rewound; night turns are cleared.
    if g.day == h["day"] + 1 and g.phase == "day":
        return True, ""
    if g.day == h["day"] + 1 and g.phase == "night":
        n = len(g.turns_done)
        return True, (f"The {n} night turn{'s' if n != 1 else ''} taken so far will be cleared — everyone retakes "
                      "their night turn after the revote, and the Traitors plan again." if n else "")
    return False, "Too late — the murder may already have been carried out"


@api_router.post("/games/{code}/moderator/revote")
@locked
async def moderator_revote(code: str, data: ModeratorIn):
    """Re-run the most recent tied Round Table as a tie-break revote (for a tie that was
    resolved before revotes existed, or the host wants it now). Rewinds an untouched next day."""
    g = await require_game(code)
    check_game_moderator(g, data)
    ok, why = _revote_available(g)
    if not ok:
        raise HTTPException(400, why)
    h = g.history[-1]
    g.revote_ids = [pid for pid in _tie_leaders(h["banish"]) if g.player(pid).lives > 0]
    h["banish"]["revote_ids"] = list(g.revote_ids)
    h["banish"]["revote_names"] = [name_of(g, pid) for pid in g.revote_ids]
    if g.day != h["day"]:
        # Step back into the tied day. Any night plan is discarded (the murder had not been
        # carried out yet); its action goes back into the pool so it can be offered again.
        if g.action and g.action in g.used_actions:
            g.used_actions.remove(g.action)
        g.day = h["day"]
        g.target_id, g.action, g.murder_confirmed, g.action_choices, g.recruit_id = None, None, False, [], None
        g.murder_done = False
    log(g, "stage", "Host re-ran the tied Round Table as a revote")
    _open_revote(g)
    await save(g)
    return moderator_state(g)


CHAT_CAP = 500
CHAT_MAX_LEN = 500


def chat_allowed(g: Game, p: Player) -> bool:
    return p.role == "traitor" and p.lives > 0 and g.phase != "setup"


@api_router.post("/games/{code}/chat")
async def read_chat(code: str, data: AuthIn):
    """The Traitors' secret chat. Anyone may ask (so asking gives nothing away); only a
    Traitor still in the game gets the messages."""
    g = await require_game(code)
    p = auth(g, data)
    if not chat_allowed(g, p):
        return {"allowed": False, "messages": []}
    return {"allowed": True, "messages": g.traitor_chat}


@api_router.post("/games/{code}/chat/send")
@locked
async def send_chat(code: str, data: ChatIn):
    g = await require_game(code)
    p = auth(g, data)
    if not chat_allowed(g, p):
        raise HTTPException(403, "Only the Traitors can send messages here")
    if g.phase != "night":
        raise HTTPException(400, "The Traitors' chat opens at night, while you plan")
    text = (data.text or "").strip()
    if not text:
        raise HTTPException(400, "Write a message first")
    if len(text) > CHAT_MAX_LEN:
        raise HTTPException(400, f"Keep it under {CHAT_MAX_LEN} characters")
    g.traitor_chat.append({
        "id": uuid.uuid4().hex[:10],
        "t": datetime.now(timezone.utc).isoformat(),
        "day": g.day,
        "from_id": p.id,
        "from_name": p.name,
        "text": text,
    })
    if len(g.traitor_chat) > CHAT_CAP:
        del g.traitor_chat[:-CHAT_CAP]
    await save(g)
    return {"allowed": True, "messages": g.traitor_chat}


@api_router.get("/games/{code}")
async def get_game(code: str):
    return public_state(await require_game(code))


# A game counts as "in progress" until it ends — unless nobody has touched it for this long
# (an abandoned game must never block the group from starting a new one).
LIVE_FOR = timedelta(days=4)


async def current_game_doc() -> Optional[dict]:
    """The group's game in progress: the most recently active game that hasn't ended."""
    since = (datetime.now(timezone.utc) - LIVE_FOR).isoformat()
    docs = await db.games.find(
        {"phase": {"$ne": "ended"}, "updated_at": {"$gte": since}},
        {"_id": 0, "code": 1, "phase": 1, "day": 1, "players": 1, "updated_at": 1},
    ).sort("updated_at", -1).to_list(1)
    return docs[0] if docs else None


@api_router.get("/current")
async def current_game():
    """No join codes: every phone simply joins the group's game in progress."""
    d = await current_game_doc()
    if not d:
        return {"code": None}
    return {"code": d["code"], "phase": d["phase"], "day": d.get("day", 1), "players": len(d.get("players", []))}


@api_router.post("/games")
@locked
async def create_game(data: CreateGameIn):
    if data.single and await current_game_doc():
        raise HTTPException(409, "A game is already in progress. Join it — or the host can end it from the ⋯ menu first.")
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
    if data.moderator_pin is not None:
        if not (data.moderator_pin.isdigit() and len(data.moderator_pin) == 4):
            raise HTTPException(400, "The ClaudAI PIN must be 4 digits")
        if any(p.pin == data.moderator_pin for p in data.players):
            raise HTTPException(400, "Choose a ClaudAI PIN that no player is using")
    # A random number of Traitors: 1 to 3, always a minority (fewer than the Faithful)
    n_traitors = random.randint(1, max(1, min(3, (len(names) - 1) // 2)))
    traitor_idx = set(random.sample(range(len(names)), n_traitors))
    players = [
        Player(name=names[i], pin_hash=hash_pin(p.pin), role="traitor" if i in traitor_idx else "faithful")
        for i, p in enumerate(data.players)
    ]
    g = Game(code=await new_code(), players=players)
    g.host_id = players[0].id  # the first player entered is the host/creator
    if data.moderator_pin:
        g.moderator_pin_hash = hash_pin(data.moderator_pin)
    traitors = ", ".join(pl.name for pl in players if pl.role == "traitor")
    log(g, "setup", f"Game created: {len(players)} players, host {players[0].name}. Traitors: {traitors}",
        f"Game created: {len(players)} players, host {players[0].name}")
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
        "revote_ids": list(g.revote_ids) if g.phase == "roundtable" else [],
        # Recruited into the Traitors today (resolved at the murder reveal). Only ever sent to
        # that player, and only once they really are a Traitor — never during the night plan.
        "recruited_now": bool(
            p.role == "traitor" and g.recruit_id == p.id and g.phase in ("reveal", "roundtable", "banished")
        ),
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
        out["recruit_reason"] = recruit_reason(g)
        out["recruit"] = {"id": g.recruit_id, "name": name_of(g, g.recruit_id)} if g.recruit_id else None
    return out


@api_router.post("/games/{code}/turn")
@locked
async def take_turn(code: str, data: TurnIn):
    g = await require_game(code)
    p = auth(g, data)
    is_traitor = p.role == "traitor"
    first_turn = p.id not in g.turns_done

    if g.phase == "setup":
        # everyone just sees their role in private; nothing to choose yet
        again = "" if first_turn else " again"
        log(g, "role", f"{p.name} saw their role{again} — {_role(p)}", f"{p.name} saw their role{again}")
    elif g.phase == "gather":
        # Everyone checks in before the murder is revealed. A Traitor also confirms whether
        # tonight's murder was carried out in plain sight; any Traitor's "yes" counts.
        if p.lives <= 0:
            raise HTTPException(400, "You have been eliminated")
        if is_traitor and data.murder_done is not None:
            victim = name_of(g, g.target_id) or "the victim"
            if data.murder_done:
                g.murder_done = True
                log(g, "confirm", f"{p.name} (Traitor) confirmed the murder of {victim} WAS carried out", None)
            else:
                log(g, "confirm", f"{p.name} (Traitor) said the murder of {victim} was NOT carried out", None)
        if first_turn:
            log(g, "checkin", f"{p.name} checked in for the Round Table")
    elif g.phase == "roundtable":
        if p.lives <= 0:
            raise HTTPException(400, "You have been eliminated and cannot vote")
        if g.revote_ids and data.end_vote:
            raise HTTPException(400, "This is a tie-break revote — choose one of the tied players")
        if in_endgame(g) and data.end_vote:
            # Endgame: this player votes to end the game now rather than banish
            g.votes.pop(p.id, None)
            if p.id not in g.end_votes:
                g.end_votes.append(p.id)
            log(g, "vote", f"{p.name} voted to END the game")
        else:
            tgt = g.player(data.vote_target_id)
            if not tgt or tgt.lives <= 0 or tgt.id == p.id:
                raise HTTPException(400, "Choose someone to banish")
            if g.revote_ids and tgt.id not in g.revote_ids:
                raise HTTPException(400, "This is a tie-break revote — choose one of the tied players")
            prev = g.votes.get(p.id)
            if prev and prev != tgt.id:
                log(g, "vote", f"{p.name} changed their vote from {name_of(g, prev)} to {tgt.name}")
            elif prev != tgt.id:
                log(g, "vote", f"{p.name} voted to banish {tgt.name}")
            g.votes[p.id] = tgt.id
            if p.id in g.end_votes:
                g.end_votes.remove(p.id)
    elif g.phase == "night":
        # The murder is chosen BEFORE the Round Table, in two steps. A Traitor names
        # the victim and is offered five secret actions (step 1, not yet committed),
        # then picks one to confirm the murder (step 2). Everyone else — and a
        # Traitor lying low — just passes, so watching who taps never reveals them.
        if is_traitor and p.lives > 0 and data.recruit_id:
            # Recruit a Faithful to replace a lost Traitor (instead of murdering tonight)
            if not recruitment_available(g):
                raise HTTPException(400, "You can only recruit to replace a banished Traitor, or when you are the only Traitor left")
            r = g.player(data.recruit_id)
            if not r or r.lives <= 0 or r.role != "faithful":
                raise HTTPException(400, "Choose a Faithful to recruit")
            before = _plan_text(g)
            g.recruit_id = data.recruit_id
            g.target_id = g.action = None
            g.action_choices = []
            g.murder_confirmed = False
            log(g, "recruit", f"{p.name} (Traitor) {'CHANGED the plan (was: ' + before + ') — now ' if before else 'chose to '}recruit {r.name} instead of murdering",
                f"{p.name} took their night turn" if first_turn else None)
        elif is_traitor and p.lives > 0 and data.target_id:
            # Step 1: choose the victim, get five action options (no turn taken yet)
            valid_victim(g, data.target_id)
            before = _plan_text(g)
            g.recruit_id = None
            g.target_id = data.target_id
            g.action = None
            g.murder_confirmed = False
            g.action_choices = g.pick_actions(g.actions, ACTION_CHOICES)
            log(g, "victim", f"{p.name} (Traitor) {'CHANGED the plan (was: ' + before + ') — now picking ' if before else 'picked '}{name_of(g, g.target_id)} as the victim — offered: "
                + " · ".join(f"“{a}”" for a in g.action_choices), None)
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
            log(g, "murder", f"{p.name} (Traitor) sealed the murder of {name_of(g, g.target_id)}: “{data.action}”",
                f"{p.name} took their night turn" if first_turn else None)
        elif is_traitor and p.lives > 0:
            # A Traitor passing: agreeing with a fellow Traitor's plan, or lying low
            if g.murder_confirmed or g.recruit_id:
                what = f"agreed to the plan ({'recruit ' + name_of(g, g.recruit_id) if g.recruit_id else 'murder ' + name_of(g, g.target_id)})"
            elif g.target_id:
                what = f"lay low after picking {name_of(g, g.target_id)} — nothing sealed"
            else:
                what = "lay low — no murder planned"
            log(g, "lielow", f"{p.name} (Traitor) {what}" + ("" if first_turn else " (again)"), f"{p.name} took their night turn" if first_turn else None)
        elif p.lives > 0 and first_turn:
            log(g, "pass", f"{p.name} passed the phone on (nothing to do tonight)", f"{p.name} took their night turn")
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
        log(g, "stage", "Day 1 began")
    elif g.phase == "day":
        # The Traitors now plot BEFORE the Round Table: each day opens with the night,
        # where they pick the victim and the plain-sight action (or recruit). In the
        # endgame there are no murders, so the day goes straight to the final vote.
        if in_endgame(g):
            g.phase = "roundtable"
            g.turns_done, g.votes, g.end_votes = [], {}, []
            log(g, "stage", "Endgame: straight to the final vote — banish one more, or end the game")
        else:
            g.phase = "night"
            g.turns_done, g.target_id, g.action, g.murder_confirmed, g.action_choices, g.recruit_id = [], None, None, False, [], None
            g.murder_done = False
            log(g, "stage", "Night fell — the Traitors plot")
    elif g.phase == "night":
        # The Traitors have planned their victim and action. The murder itself is carried
        # out in plain sight during the day; the group then gathers to check in.
        alive_ids = {p.id for p in g.alive()}
        if not alive_ids.issubset(set(g.turns_done)):
            raise HTTPException(400, "Everyone must take their turn before the Round Table")
        if g.recruit_id:
            plan = f"Tonight's plan: recruit {name_of(g, g.recruit_id)}"
        elif g.murder_confirmed:
            plan = f"Tonight's plan: murder {name_of(g, g.target_id)} with “{g.action}”"
        else:
            plan = "Tonight's plan: no murder — the Traitors lay low"
        log(g, "plan", plan, None)
        g.phase = "gather"
        g.turns_done = []
        g.murder_done = False
        log(g, "stage", "Everyone to the Round Table — check-in opened")
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
            if g.recruit_credits > 0:
                g.recruit_credits -= 1
            murder = {"success": False}
        elif g.murder_confirmed and g.murder_done:
            murder = resolve_murder(g)
        else:
            murder = {"success": False}
        g.winner = winner_by_roles(g)  # the murder alone can win it for the Traitors
        g.history.append({"day": g.day, "murder": murder, "banish": None, "recruited": recruited, "winner": g.winner})
        if recruited:
            log(g, "reveal", f"No murder — {rp.name} was recruited and is now a Traitor", "Murder reveal: no murder — a Faithful was recruited")
        elif murder.get("success"):
            v = g.player(murder["victim_id"])
            log(g, "reveal", f"Murder revealed: {v.name} ({_role(v)}) was murdered with “{murder.get('action')}”",
                f"Murder revealed: {v.name} was murdered")
        elif g.murder_confirmed:
            log(g, "reveal", f"Murder reveal: nobody died — the murder of {name_of(g, g.target_id)} was not carried out",
                "Murder reveal: nobody died")
        else:
            log(g, "reveal", "Murder reveal: nobody died — the Traitors lay low", "Murder reveal: nobody died")
        g.phase = "reveal"
    elif g.phase == "reveal":
        # The murder has been shown. If it won the game, stop; otherwise the table votes.
        if g.winner:
            g.phase = "ended"
            log(g, "end", f"Game over — the {g.winner.capitalize()} win")
        else:
            g.phase = "roundtable"
            g.turns_done, g.votes, g.end_votes = [], {}, []
            log(g, "stage", "Round Table voting opened")
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
            log(g, "end", f"Everyone voted to end the game — the {g.winner.capitalize()} win")
        else:
            revote = bool(g.revote_ids)
            banish = resolve_banish(g)
            g.winner = winner_by_roles(g)
            tally = " · ".join(f"{t['name']} {t['votes']}" for t in banish["tally"])
            h = g.history[-1] if g.history else None
            if revote and h and h.get("day") == g.day and h.get("banish"):
                # The tie-break: keep the tied first vote for the record, show this one.
                banish["round"] = 2
                h["tie_vote"] = h["banish"]
                h["banish"] = banish
                h["winner"] = g.winner
                g.revote_ids = []
            else:
                if banish["tie"]:
                    # A first-round tie: everyone votes again, only between the tied players.
                    leaders = _tie_leaders(banish)
                    g.revote_ids = leaders
                    banish["revote_ids"] = leaders
                    banish["revote_names"] = [name_of(g, pid) for pid in leaders]
                # The gather/reveal opened this day's entry with the murder; add the banishment.
                # Endgame days have no murder, so they start their entry here.
                if h and h.get("day") == g.day and h.get("banish") is None and not h.get("ended_by_vote"):
                    h["banish"] = banish
                    h["winner"] = g.winner
                else:
                    g.history.append({"day": g.day, "murder": None, "banish": banish, "winner": g.winner})
            if banish["tie"] and g.revote_ids:
                log(g, "banish", f"Round Table tied ({tally}) — revote between "
                    + " and ".join(banish["revote_names"]))
            elif banish["tie"] or not banish["target_id"]:
                log(g, "banish", f"{'Revote tied again' if revote else 'Banishment: tied vote'}, nobody banished ({tally})")
            else:
                bp = g.player(banish["target_id"])
                log(g, "banish", f"{'Revote' if revote else 'Banishment'}: {bp.name} was banished — {_role(bp)}"
                    + (" (kept secret from players)" if banish.get("role_hidden") else "") + f" ({tally})",
                    f"{'Revote' if revote else 'Banishment'}: {bp.name} was banished ({tally})")
            g.phase = "banished"
    elif g.phase == "banished" and g.revote_ids:
        # The tie has been shown: everyone votes again, only between the tied players.
        _open_revote(g)
    elif g.phase == "banished":
        # The day is over. The game may be won; the Traitors also win if they survive to the
        # end of the final day. Otherwise a new day (and a new plot) begins.
        if g.winner:
            g.phase = "ended"
            log(g, "end", f"Game over — the {g.winner.capitalize()} win")
        elif g.day >= TOTAL_DAYS:
            g.winner = "traitors"  # they survived to the final day
            if g.history:
                g.history[-1]["winner"] = g.winner
            g.phase = "ended"
            log(g, "end", f"Game over — the Traitors survived to the end of Day {TOTAL_DAYS} and win")
        else:
            g.day += 1
            g.target_id, g.action, g.murder_confirmed, g.action_choices, g.recruit_id = None, None, False, [], None
            g.murder_done = False
            g.turns_done, g.votes, g.end_votes = [], {}, []
            g.phase = "day"
            log(g, "stage", f"Day {g.day} began")
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
