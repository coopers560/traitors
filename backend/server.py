from fastapi import FastAPI, APIRouter, HTTPException
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import asyncio
import functools
import logging
import math
import random
import re
import hashlib
import hmac
import uuid
from collections import Counter
from pathlib import Path
from pydantic import BaseModel, Field, model_validator
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

TOTAL_DAYS = 12  # calendar days of the holiday; the Traitors win if they survive the last one
MAX_TRAITORS = 2  # recruiting never takes the Traitors above this many still in the game
START_LIVES = 1  # one hit — a murder or a banishment — puts a player out
HIDE_ROLE_AT = 6  # once this many (or fewer) remain, a banished player's role stays secret
ENDGAME_AT = 4  # at this many (or fewer) remain, each round is a "banish again or end the game" vote
CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"  # no 0/O, 1/I/L mix-ups
CODE_LEN = 5
MAX_MURDER_GAP_HOURS = 24.0  # ClaudAI may set the minimum time between murders from 0 to this
# After everyone has taken their plot turn, the Round Table stays shut this long, so the Traitors
# always have time to carry out the murder in plain sight. ClaudAI can change it (0 to the max).
DEFAULT_MURDER_WINDOW_MIN = 30.0
MAX_MURDER_WINDOW_MIN = 120.0
ACTION_CHOICES = 5  # secret murder methods a Traitor chooses from each night (always this many, all different)

# ClaudAI (the moderator god-view) has no master key: each game nominates its own host,
# who opens that game's ClaudAI with that game's ClaudAI passphrase. The passphrase is only
# ever stored as a salted, slow hash and there is no reset or recovery path.

# Round Tables per day: 1 (as before), or 2 — one at lunch and one at 8pm.
SESSIONS = {"lunch": "Lunch", "evening": "Evening"}

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


PASSPHRASE_RULE = "Use at least 8 characters with upper and lower case letters, a number and a symbol"
PBKDF2_PREFIX = "pbkdf2_sha256"
PBKDF2_ITERATIONS = 200_000


def passphrase_problem(s: Optional[str]) -> Optional[str]:
    """Why a NEW ClaudAI passphrase isn't strong enough (the same rule as the app), or None."""
    ok = (
        bool(s) and len(s) >= 8
        and re.search(r"[A-Z]", s) and re.search(r"[a-z]", s)
        and re.search(r"[0-9]", s) and re.search(r"[^A-Za-z0-9]", s)
    )
    return None if ok else PASSPHRASE_RULE


def hash_passphrase(secret: str) -> str:
    """A salted, slow hash of a ClaudAI passphrase (stored in Game.moderator_pin_hash)."""
    salt = os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", secret.encode(), salt, PBKDF2_ITERATIONS).hex()
    return f"{PBKDF2_PREFIX}${PBKDF2_ITERATIONS}${salt.hex()}${digest}"


def verify_secret(stored: Optional[str], secret: Optional[str]) -> bool:
    """Does `secret` match the stored ClaudAI hash? Accepts the salted passphrase hash and, for
    games set up before passphrases, the old plain hash of a 4-digit ClaudAI PIN."""
    if not stored or not secret:
        return False
    if stored.startswith(PBKDF2_PREFIX + "$"):
        try:
            _, iterations, salt, digest = stored.split("$")
            calc = hashlib.pbkdf2_hmac("sha256", secret.encode(), bytes.fromhex(salt), int(iterations)).hex()
        except ValueError:
            return False
        return hmac.compare_digest(calc, digest)
    return hmac.compare_digest(hash_pin(secret), stored)


def label_for(tables_per_day: int, cal_day: int, session: str) -> str:
    """What a round is called: "Day 3 · Lunch" / "Day 3 · Evening", or "Day 3" at one a day."""
    if tables_per_day == 2 and session in SESSIONS:
        return f"Day {cal_day} · {SESSIONS[session]}"
    return f"Day {cal_day}"


# ---------------- Models ----------------
class Player(BaseModel):
    id: str = Field(default_factory=lambda: uuid.uuid4().hex[:8])
    name: str
    pin_hash: str
    role: str  # "traitor" | "faithful"
    lives: int = START_LIVES
    role_revealed: bool = True  # set False when eliminated while roles are being kept secret
    # The role dealt at the start (None for players stored before this was tracked — the
    # story infers it), and the round they were recruited into the Traitors, if they were.
    started_as: Optional[str] = None
    recruited_label: Optional[str] = None


class Game(BaseModel):
    code: str
    host_id: Optional[str] = None  # the creator; only they may end a game in progress
    actions: List[str] = Field(default_factory=lambda: list(ACTIONS))
    # The ROUND counter: unique and ever-increasing (history/vote_log entries are keyed on it).
    # With two Round Tables a day there are two rounds per calendar day (cal_day).
    day: int = 1
    cal_day: int = 1  # the calendar day of the holiday (games stored before this load as cal_day = day)
    session: str = ""  # "" (one Round Table a day) | "lunch" | "evening"
    tables_per_day: int = 1  # Round Tables a day: 1, or 2 (lunch and 8pm)
    # A finished game someone has cleared from the main screen: kept for the archive (the
    # whole story stays published) but gone from play.
    archived: bool = False
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
    # When the last murder was revealed (ISO time), so murders can't come in quick succession.
    last_murder_at: Optional[str] = None
    murder_gap_hours: float = 3.0  # retired: no longer enforced (see murder_window_minutes)
    # When the last plot turn was taken this round (ISO), and how long the Round Table then
    # stays shut so the Traitors have time to carry out the murder.
    plot_done_at: Optional[str] = None
    murder_window_minutes: float = DEFAULT_MURDER_WINDOW_MIN
    # Optional per-game ClaudAI login: the hashed ClaudAI passphrase that opens this game's
    # god-view (games from before passphrases may hold the plain hash of a 4-digit PIN).
    moderator_pin_hash: Optional[str] = None
    # The Traitors' secret group chat. Only Traitors still in the game can read or post; never
    # sent in the public state. The moderator sees it.
    traitor_chat: List[dict] = []
    # When each Traitor last read the chat (player id -> ISO time), for "Seen by" under each
    # message. Never sent in the public state. Games stored before this load with none.
    chat_read: Dict[str, str] = {}
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

    @model_validator(mode="before")
    @classmethod
    def _legacy_defaults(cls, data):
        # Games stored before calendar days existed: every round was its own day.
        if isinstance(data, dict) and data.get("cal_day") is None:
            data = {**data, "cal_day": data.get("day", 1)}
        return data

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

    def pick_actions(self, actions: List[str], n: int = ACTION_CHOICES) -> List[str]:
        """Offer n DIFFERENT action options for the Traitor to choose from: fresh ones (not used
        yet this game) first, then used ones. A list too short to offer n (custom lists of 3 or 4
        saved before the minimum was raised) is topped up from the default ACTIONS."""
        used = {a.strip().lower() for a in self.used_actions if isinstance(a, str)}
        picked: List[str] = []
        seen = set()

        def take(pool: List[str]) -> None:
            pool = list(pool)
            random.shuffle(pool)
            for a in pool:
                key = a.strip().lower()
                if len(picked) < n and key and key not in seen:
                    seen.add(key)
                    picked.append(a)

        own = [a for a in actions if isinstance(a, str)]
        take([a for a in own if a.strip().lower() not in used])  # fresh
        take([a for a in own if a.strip().lower() in used])  # then ones already used
        own_keys = {a.strip().lower() for a in own}
        extra = [a for a in ACTIONS if a.strip().lower() not in own_keys]
        take([a for a in extra if a.strip().lower() not in used])  # top up from the defaults
        take([a for a in extra if a.strip().lower() in used])
        return picked


class PlayerIn(BaseModel):
    name: str
    pin: str


class CreateGameIn(BaseModel):
    players: List[PlayerIn]
    # One group plays one game at a time: when set, refuse while another game is in progress.
    single: bool = False
    # Optional ClaudAI passphrase for this game (a host who sees everything).
    claudai_passphrase: Optional[str] = None
    moderator_pin: Optional[str] = None  # older apps' name for it (the same strength rule applies)
    tables_per_day: int = 1  # Round Tables a day: 1, or 2 (lunch and 8pm)
    # Minimum hours between murders (default 3). Tests set 0.
    murder_gap_hours: Optional[float] = None
    # Minutes the Round Table stays shut after the plot. Left out = 0 (API/tests); the app sends 30.
    murder_window_minutes: Optional[float] = None


class AuthIn(BaseModel):
    player_id: str
    pin: str


class ChatIn(AuthIn):
    text: Optional[str] = None


class ModeratorIn(BaseModel):
    passphrase: Optional[str] = None  # this game's ClaudAI passphrase
    pin: Optional[str] = None  # older apps sent it under this name

    def secret(self) -> Optional[str]:
        return self.passphrase or self.pin


class ModeratorPinIn(ModeratorIn):
    new_passphrase: Optional[str] = None
    new_pin: Optional[str] = None  # older apps' name for it

    def new_secret(self) -> Optional[str]:
        return self.new_passphrase if self.new_passphrase is not None else self.new_pin


class ScheduleIn(ModeratorIn):
    tables_per_day: Optional[int] = None  # 1 or 2; leave out to keep the schedule as it is
    session: Optional[str] = None  # which Round Table the CURRENT round is, when switching to 2
    murder_gap_hours: Optional[float] = None  # minimum hours between murders (0-24); leave out to keep it
    murder_window_minutes: Optional[float] = None  # minutes to carry out the murder after the plot (0-120)


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
    if not g or g.archived:
        raise HTTPException(404, "No game found with that code")
    return g


def round_label(g: Game) -> str:
    """The current round's label, e.g. "Day 3 · Lunch" (two a day) or "Day 3" (one a day)."""
    return label_for(g.tables_per_day, g.cal_day, g.session)


def next_round(g: Game) -> tuple:
    """(cal_day, session) of the round after this one."""
    if g.tables_per_day == 2:
        if g.session == "lunch":
            return g.cal_day, "evening"
        return g.cal_day + 1, "lunch"
    return g.cal_day + 1, ""


def prev_round(g: Game) -> tuple:
    """(cal_day, session) of the round before this one (for rewinding into a tied round)."""
    if g.tables_per_day == 2:
        if g.session == "evening":
            return g.cal_day, "lunch"
        return max(1, g.cal_day - 1), "evening"
    return max(1, g.cal_day - 1), ""


def is_final_round(g: Game) -> bool:
    """The last Round Table of the last calendar day: the Traitors win if they survive it."""
    return g.cal_day >= TOTAL_DAYS and (g.tables_per_day != 2 or g.session != "lunch")


def new_history_entry(g: Game, **fields) -> dict:
    """A history entry for the current round, labelled at creation."""
    return {"day": g.day, "label": round_label(g), "cal_day": g.cal_day, "session": g.session, **fields}


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
        "label": round_label(g),
        "cal_day": g.cal_day,
        "session": g.session,
        "tables_per_day": g.tables_per_day,
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
        "claudai": bool(g.moderator_pin_hash),  # whether this game has a ClaudAI host (never the secret)
        # Murders can't come in quick succession: the next night can't start before this time.
        "next_plot_at": next_plot_iso(g),
        "murder_gap_hours": g.murder_gap_hours,
        # The Traitors get time to carry out the murder: the Round Table opens at this time.
        "round_table_at": (lambda t: t.isoformat() if t else None)(round_table_at(g)),
        "murder_window_minutes": g.murder_window_minutes,
        "turns_needed": len(g.players) if g.phase == "setup" else len(g.alive()),
        "turns_done": len(g.turns_done),
        # never reveal which secret action was used (strip from older records too);
        # a day's murder is None until the night step has resolved it
        "history": [_public_history(h, ended) for h in g.history],
    }


def _last_murder_time(g: Game) -> Optional[datetime]:
    """When the last murder was revealed. Games from before this was recorded fall back to the
    event log's last 'Murder revealed' entry."""
    t = g.last_murder_at
    if not t:
        for e in reversed(g.event_log):
            if e.get("kind") == "reveal" and str(e.get("text", "")).startswith("Murder revealed"):
                t = e.get("t")
                break
    try:
        return datetime.fromisoformat(t) if t else None
    except ValueError:
        return None


def next_plot_at(g: Game) -> Optional[datetime]:
    """The earliest the Traitors may plot again (the next night), or None if they may now.
    Murders must be at least murder_gap_hours apart."""
    # Retired: the owner wanted time between planning and carrying out a murder, not hours
    # between murders. Kept so older clients still get a field (always None now).
    return None


def round_table_at(g: Game) -> Optional[datetime]:
    """When the Round Table may open, if it must still wait: murder_window_minutes after the last
    plot turn. Measured from when EVERYONE had taken their turn (not from when a murder was
    sealed), so the wait looks the same whether the Traitors struck or lay low."""
    if g.phase != "night" or not g.plot_done_at or g.murder_window_minutes <= 0:
        return None
    try:
        done = datetime.fromisoformat(g.plot_done_at)
    except ValueError:
        return None
    t = done + timedelta(minutes=g.murder_window_minutes)
    return t if t > datetime.now(timezone.utc) else None


def next_plot_iso(g: Game) -> Optional[str]:
    """next_plot_at as an ISO time for the apps (None when the Traitors may plot now, and always
    None in the endgame, which has no murders)."""
    if in_endgame(g):
        return None
    t = next_plot_at(g)
    return t.isoformat() if t else None


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


# Wrong ClaudAI passphrases per game, to stop anyone working through guesses.
PIN_FAILS: Dict[str, List[float]] = {}
PIN_FAIL_LIMIT = 8
PIN_FAIL_WINDOW = 10 * 60  # seconds


def _pin_locked(code: str) -> bool:
    now = datetime.now(timezone.utc).timestamp()
    recent = [t for t in PIN_FAILS.get(code, []) if now - t < PIN_FAIL_WINDOW]
    PIN_FAILS[code] = recent
    return len(recent) >= PIN_FAIL_LIMIT


# Wrong secrets already seen per game (fingerprints). A phone left open on ClaudAI with an old or
# retired secret keeps re-sending the SAME wrong value every few seconds; that is not guessing,
# so a repeat is refused without counting towards the lockout (only new guesses count).
PIN_WRONG: Dict[str, Dict[str, float]] = {}


def _fingerprint(code: str, secret: str) -> str:
    return hashlib.sha256(f"{code}:{secret}".encode()).hexdigest()


def host_fail_key(code: str) -> str:
    """PIN_FAILS key for wrong host PINs when nominating a ClaudAI host (kept apart from the
    game's wrong ClaudAI passphrases, which are keyed on the bare code)."""
    return f"host:{code}"


def clear_pin_fails(code: str) -> None:
    """Forget wrong guesses for a game (after its ClaudAI secret is set or changed)."""
    PIN_FAILS.pop(code, None)
    PIN_WRONG.pop(code, None)


async def check_moderator_secret(g: "Game", secret: Optional[str]) -> None:
    # Nothing to check: no secret sent, or the game has none yet. Not a guess, so never counted.
    if not secret or not g.moderator_pin_hash:
        raise HTTPException(403, "Wrong ClaudAI passphrase")
    fp = _fingerprint(g.code, secret)
    if fp in PIN_WRONG.get(g.code, {}):
        raise HTTPException(403, "Wrong ClaudAI passphrase")  # the same wrong secret again: not a new guess
    if _pin_locked(g.code):
        raise HTTPException(429, "Too many wrong ClaudAI passphrases — wait a few minutes and try again")
    # Counted as a miss until proven right, so parallel guesses can't slip past the lockout
    # while the (deliberately slow) hash is being checked.
    stamp = datetime.now(timezone.utc).timestamp()
    PIN_FAILS.setdefault(g.code, []).append(stamp)
    if not await asyncio.to_thread(verify_secret, g.moderator_pin_hash, secret):
        wrong = PIN_WRONG.setdefault(g.code, {})
        wrong[fp] = stamp
        if len(wrong) > 200:  # keep it small
            for k in sorted(wrong, key=wrong.get)[:100]:
                wrong.pop(k, None)
        raise HTTPException(403, "Wrong ClaudAI passphrase")
    clear_pin_fails(g.code)


async def check_game_moderator(g: "Game", data: "ModeratorIn") -> None:
    """ClaudAI for one game: only that game's own ClaudAI passphrase opens it."""
    await check_moderator_secret(g, data.secret())


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


# The "plan" event's text starts with PLAN_PREFIX, then "recruit X", "murder X with “…”" or
# "no murder — the Traitors lay low". Games logged before this used "Tonight's plan: " instead
# (wrong for a plot at an Evening Round Table); the published story strips either prefix.
PLAN_PREFIX = "The plan: "

# Generous enough for a full 12-day game at two Round Tables a day (the whole story is
# published at the end).
EVENT_LOG_CAP = 4000


def log(g: Game, kind: str, text: str, neutral: Optional[str] = "same") -> None:
    """Record a moderator-only event. `neutral` is what to show while roles are hidden:
    "same" reuses `text`; None means the event itself would give a Traitor away."""
    g.event_log.append({
        "t": datetime.now(timezone.utc).isoformat(),
        "day": g.day,
        "label": round_label(g),
        "phase": g.phase,
        "kind": kind,
        "text": text,
        "neutral": text if neutral == "same" else neutral,
    })
    if len(g.event_log) > EVENT_LOG_CAP:
        del g.event_log[:-EVENT_LOG_CAP]


def _plan_text(g: Game) -> str:
    """The plan so far, for flagging when a Traitor overrides it ('' if none yet)."""
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
        "label": round_label(g),
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
                     else "Show the banishment — the game is won." if g.winner
                     else "Show the banishment — the Traitors have survived to the end." if is_final_round(g)
                     else f"Show the banishment, then begin {label_for(g.tables_per_day, *next_round(g))}."),
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
        doing, what, waiting = f"{round_label(g)} — enjoy the holiday", "", []
        wait = None if in_endgame(g) else next_plot_at(g)
        nxt = (tap("Gather for the final vote") if in_endgame(g)
               else f"Wait — murders must be {g.murder_gap_hours:g} hours apart (the dashboard shows when)" if wait
               else tap("Night falls — the Traitors move"))
    elif g.phase == "night":
        doing, what = "Night — everyone takes a turn while the Traitors secretly plot", "to take their night turn"
        nxt = ("Wait — the Round Table opens a while after the plot (the dashboard shows when)" if ready and round_table_at(g)
               else tap("Everyone to the Round Table") if ready else "Everyone still listed takes their night turn")
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
               else "Game over after this reveal" if g.winner or is_final_round(g)
               else f"Read the reveal together, then begin {label_for(g.tables_per_day, *next_round(g))}")
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
        traitor_part = f"Traitors win by reaching {t} v {t} ({need} more Faithful out) or surviving to the end of Day {TOTAL_DAYS}."
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
        "label": round_label(g),
        "cal_day": g.cal_day,
        "session": g.session,
        "tables_per_day": g.tables_per_day,
        # Minimum hours between murders, and when the Traitors may next plot (None if they may now).
        "murder_gap_hours": g.murder_gap_hours,
        "next_plot_at": next_plot_iso(g),
        "round_table_at": (lambda t: t.isoformat() if t else None)(round_table_at(g)),
        "murder_window_minutes": g.murder_window_minutes,
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
        "traitor_chat": chat_messages(g),  # moderator-only: the Traitors' secret chat (with "Seen by")
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


def recruit_reason(g: Game) -> Optional[str]:
    """Why the Traitors may recruit tonight, or None if they may not. They may only recruit to
    replace a banished Traitor (one recruit per Traitor banished), or when only one Traitor is
    left — only while at least six players are still in, and never above MAX_TRAITORS."""
    alive = g.alive()
    traitors = [p for p in alive if p.role == "traitor"]
    faithful = [p for p in alive if p.role == "faithful"]
    if len(alive) < RECRUIT_MIN_PLAYERS or not traitors or not faithful:
        return None
    if len(traitors) >= MAX_TRAITORS:
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
    if len(cleaned) < ACTION_CHOICES:
        # the Traitors are always offered ACTION_CHOICES different methods to choose from
        raise HTTPException(400, f"Keep at least {ACTION_CHOICES} secret actions")
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
    """The god-view for one game. Gated by the game's ClaudAI passphrase; reveals every secret."""
    g = await require_game(code)
    await check_game_moderator(g, data)
    return moderator_state(g)


@api_router.post("/moderator/login")
@api_router.post("/moderator/pin")  # the older name, kept working
async def moderator_login(data: ModeratorIn):
    """ClaudAI login with the game's own ClaudAI passphrase. There is only one game in progress,
    so the passphrase is checked against it; returns its code so ClaudAI can open it."""
    d = await current_game_doc()
    if not d:
        raise HTTPException(404, "There is no game in progress")
    g = await require_game(d["code"])
    if not g.moderator_pin_hash:
        raise HTTPException(403, "This game has no ClaudAI host yet — the game's host can nominate one from the ⋯ menu")
    await check_moderator_secret(g, data.secret())
    return {"code": g.code}


class NominateIn(AuthIn):
    new_passphrase: Optional[str] = None
    new_pin: Optional[str] = None  # older apps' name for it

    def new_secret(self) -> Optional[str]:
        return self.new_passphrase if self.new_passphrase is not None else self.new_pin


@api_router.post("/games/{code}/claudai")
@locked
async def nominate_claudai(code: str, data: NominateIn):
    """The game's host nominates a ClaudAI host by giving the game its ClaudAI passphrase — for
    a game set up without one. Once set, only the ClaudAI passphrase itself can change it."""
    g = await require_game(code)
    # Wrong PINs here are throttled like wrong ClaudAI passphrases (8 in 10 minutes, then wait),
    # so nobody can work through the host's 4-digit PIN to take over ClaudAI.
    key = host_fail_key(g.code)
    if _pin_locked(key):
        raise HTTPException(429, "Too many wrong PINs — wait a few minutes and try again")
    try:
        p = auth(g, data)
    except HTTPException as e:
        if e.status_code == 401:
            PIN_FAILS.setdefault(key, []).append(datetime.now(timezone.utc).timestamp())
        raise
    if p.id != g.host_id:
        raise HTTPException(403, "Only the game's host can nominate a ClaudAI host")
    PIN_FAILS.pop(key, None)  # the host's own PIN: forget earlier misses
    if g.moderator_pin_hash:
        raise HTTPException(400, "This game already has a ClaudAI host — change the passphrase from ClaudAI")
    new = data.new_secret()
    if passphrase_problem(new):
        raise HTTPException(400, PASSPHRASE_RULE)
    g.moderator_pin_hash = await asyncio.to_thread(hash_passphrase, new)
    clear_pin_fails(g.code)  # earlier wrong guesses were against a different (or no) secret
    log(g, "stage", f"{p.name} (host) nominated a ClaudAI host")
    log(g, "stage", "A ClaudAI host was added", "A ClaudAI host was added")
    await save(g)
    return public_state(g)


@api_router.post("/games/{code}/moderator/pin")
@locked
async def moderator_set_pin(code: str, data: ModeratorPinIn):
    """Change this game's ClaudAI passphrase (needs the current one). There is no reset."""
    g = await require_game(code)
    await check_game_moderator(g, data)
    new = data.new_secret()
    if passphrase_problem(new):
        raise HTTPException(400, PASSPHRASE_RULE)
    g.moderator_pin_hash = await asyncio.to_thread(hash_passphrase, new)
    clear_pin_fails(g.code)  # earlier wrong guesses were against a different (or no) secret
    log(g, "stage", "The ClaudAI passphrase was changed")
    await save(g)
    return moderator_state(g)


@api_router.post("/games/{code}/moderator/schedule")
@locked
async def moderator_schedule(code: str, data: ScheduleIn):
    """Switch between one Round Table a day and two (lunch and 8pm). `session` says which of
    the two the CURRENT round is; the round counter (day) is never touched."""
    g = await require_game(code)
    await check_game_moderator(g, data)
    if g.phase == "ended":
        raise HTTPException(400, "The game is over")
    gap = data.murder_gap_hours
    window = data.murder_window_minutes
    # Everything is checked before anything changes.
    if data.tables_per_day is None and gap is None and window is None:
        raise HTTPException(400, "Choose one or two Round Tables a day")
    if window is not None and not (math.isfinite(window) and 0 <= window <= MAX_MURDER_WINDOW_MIN):
        raise HTTPException(400, f"Choose between 0 and {MAX_MURDER_WINDOW_MIN:g} minutes to carry out the murder")
    if gap is not None and not (math.isfinite(gap) and 0 <= gap <= MAX_MURDER_GAP_HOURS):
        raise HTTPException(400, f"Choose between 0 and {MAX_MURDER_GAP_HOURS:g} hours between murders")
    if data.tables_per_day is not None:
        if data.tables_per_day not in (1, 2):
            raise HTTPException(400, "Choose one or two Round Tables a day")
        if data.tables_per_day == 2:
            if data.session not in SESSIONS:
                raise HTTPException(400, "Say whether this round is the lunch or the evening Round Table")
            session = data.session
        else:
            session = ""
        before = round_label(g)
        g.tables_per_day, g.session = data.tables_per_day, session
        plan = "two Round Tables a day (lunch and 8pm)" if g.tables_per_day == 2 else "one Round Table a day"
        log(g, "schedule", f"ClaudAI switched the game to {plan} — {before} is now {round_label(g)}")
    if window is not None:
        old_w, g.murder_window_minutes = g.murder_window_minutes, float(window)
        log(g, "schedule", f"ClaudAI changed the time to carry out the murder from {old_w:g} to {g.murder_window_minutes:g} minutes")
    if gap is not None:
        old, g.murder_gap_hours = g.murder_gap_hours, float(gap)
        log(g, "schedule", f"ClaudAI changed the time between murders from {old:g} to {g.murder_gap_hours:g} hours")
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
    await check_game_moderator(g, data)
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
        if h.get("cal_day") is not None:
            g.cal_day, g.session = h["cal_day"], h.get("session") or ""
        else:  # an entry from before calendar days were stored
            g.cal_day, g.session = prev_round(g)
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


def _parse_time(t) -> Optional[datetime]:
    """A stored ISO time, or None if missing or unreadable (older records)."""
    try:
        dt = datetime.fromisoformat(t) if isinstance(t, str) and t else None
    except ValueError:
        return None
    if dt and dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def chat_messages(g: Game) -> List[dict]:
    """The Traitors' chat, each message with "seen_by": the names of the OTHER Traitors (never
    the sender; in the game or not) whose last read of the chat came at or after it was sent."""
    reads = []
    for pl in g.players:  # in player order, so the names come out in a steady order
        rt = _parse_time(g.chat_read.get(pl.id)) if pl.role == "traitor" else None
        if rt:
            reads.append((pl.id, pl.name, rt))
    out = []
    for msg in g.traitor_chat:
        mt = _parse_time(msg.get("t"))
        seen = [name for pid, name, rt in reads if pid != msg.get("from_id") and mt is not None and rt >= mt]
        out.append({**msg, "seen_by": seen})
    return out


def chat_unread(g: Game, p: Player) -> int:
    """How many of the Traitors' messages this player hasn't read yet (from the others, sent after
    their last read). Always 0 for anyone who can't use the chat, so the answer gives nothing away."""
    if not chat_allowed(g, p):
        return 0
    last = _parse_time(g.chat_read.get(p.id))
    n = 0
    for msg in g.traitor_chat:
        if msg.get("from_id") == p.id:
            continue
        mt = _parse_time(msg.get("t"))
        if mt is not None and (last is None or mt > last):
            n += 1
    return n


@api_router.post("/games/{code}/chat")
@locked
async def read_chat(code: str, data: AuthIn):
    """The Traitors' secret chat. Anyone may ask (so asking gives nothing away); only a
    Traitor still in the game gets the messages — and reading marks them as seen by them."""
    g = await require_game(code)
    p = auth(g, data)
    if not chat_allowed(g, p):
        return {"allowed": False, "messages": []}
    now = datetime.now(timezone.utc).isoformat()
    g.chat_read[p.id] = now
    # Only this reader's read time is written (a targeted $set, under the game's lock), so
    # it can never overwrite messages or anything else saved meanwhile.
    await db.games.update_one({"code": g.code}, {"$set": {f"chat_read.{p.id}": now}})
    return {"allowed": True, "messages": chat_messages(g)}


@api_router.post("/games/{code}/chat/send")
@locked
async def send_chat(code: str, data: ChatIn):
    """Post to the Traitors' chat. Every role gets the same visible result for the same input
    (a Faithful's message simply goes nowhere), so pressing send never gives a role away."""
    g = await require_game(code)
    p = auth(g, data)
    if g.phase == "setup":
        raise HTTPException(403, "The chat opens once the game begins")
    text = (data.text or "").strip()
    if not text:
        raise HTTPException(400, "Write a message first")
    if len(text) > CHAT_MAX_LEN:
        raise HTTPException(400, f"Keep it under {CHAT_MAX_LEN} characters")
    if not chat_allowed(g, p):
        return {"allowed": False, "messages": []}
    now = datetime.now(timezone.utc).isoformat()
    g.traitor_chat.append({
        "id": uuid.uuid4().hex[:10],
        "t": now,
        "day": g.day,
        "label": round_label(g),
        "from_id": p.id,
        "from_name": p.name,
        "text": text,
    })
    if len(g.traitor_chat) > CHAT_CAP:
        del g.traitor_chat[:-CHAT_CAP]
    g.chat_read[p.id] = now  # sending counts as having read everything up to now
    await save(g)
    return {"allowed": True, "messages": chat_messages(g)}


@api_router.get("/games/{code}")
async def get_game(code: str):
    return public_state(await require_game(code))


# A game counts as "in progress" until it ends (or the host stops it) — unless nobody has
# touched it for this long (an abandoned game must never block the group forever).
LIVE_FOR = timedelta(days=7)


def _doc_label(d: dict) -> str:
    """The current round label of a stored game document (older documents included)."""
    return label_for(d.get("tables_per_day") or 1, d.get("cal_day") or d.get("day", 1), d.get("session") or "")


async def current_game_doc() -> Optional[dict]:
    """The group's game in progress: the most recently active game that hasn't ended."""
    since = (datetime.now(timezone.utc) - LIVE_FOR).isoformat()
    docs = await db.games.find(
        {"phase": {"$ne": "ended"}, "updated_at": {"$gte": since}},
        {"_id": 0, "code": 1, "phase": 1, "day": 1, "cal_day": 1, "session": 1, "tables_per_day": 1,
         "players": 1, "updated_at": 1},
    ).sort("updated_at", -1).to_list(1)
    return docs[0] if docs else None


@api_router.get("/current")
async def current_game():
    """No join codes: every phone simply joins the group's game in progress."""
    d = await current_game_doc()
    if not d:
        return {"code": None}
    return {"code": d["code"], "phase": d["phase"], "day": d.get("day", 1), "label": _doc_label(d),
            "players": len(d.get("players", []))}


# ---------------- The archive: every finished game's whole story ----------------
ARCHIVE_LIMIT = 50


def _label_of(x: dict) -> str:
    """An entry's stored label, or "Day N" for entries made before labels existed."""
    return x.get("label") or f"Day {x.get('day', 1)}"


def _exit_of(g: Game, pid: str) -> Optional[dict]:
    """How and when a player left the game, from the history."""
    for h in g.history:
        m = h.get("murder") or {}
        if m.get("success") and m.get("eliminated") and m.get("victim_id") == pid:
            return {"how": "murdered", "label": _label_of(h)}
        b = h.get("banish") or {}
        if b.get("target_id") == pid and b.get("eliminated") and not b.get("already_dead"):
            return {"how": "banished", "label": _label_of(h)}
    return None


def _recruited_label_from_log(g: Game, name: str) -> Optional[str]:
    """For players stored before recruits were tracked: the round the event log says they were
    recruited (the murder reveal reads "No murder — {name} was recruited and is now a Traitor")."""
    pattern = re.compile(r"(?:^|— )" + re.escape(name) + r" was recruited")
    for e in g.event_log:
        if e.get("kind") == "reveal" and pattern.search(e.get("text") or ""):
            return _label_of(e)
    return None


def story_of(g: Game) -> dict:
    """Everything that happened in a finished game — every secret revealed."""
    players = []
    for p in g.players:
        recruited = p.recruited_label or _recruited_label_from_log(g, p.name)
        started = p.started_as or ("faithful" if recruited else p.role)
        players.append({
            "id": p.id,
            "name": p.name,
            "role": p.role,
            "started_as": started,
            "recruited_label": recruited,
            "exit": _exit_of(g, p.id),
            "is_host": p.id == g.host_id,
        })
    return {
        "code": g.code,
        "created_at": g.created_at,
        "ended_at": g.updated_at,
        "winner": g.winner,
        "label": round_label(g),
        "tables_per_day": g.tables_per_day,
        "total_days": TOTAL_DAYS,
        "players": players,
        "rounds": [{**h, "label": _label_of(h)} for h in g.history],  # murder methods included
        "vote_log": [{**v, "label": _label_of(v)} for v in g.vote_log],
        "traitor_chat": [{**m, "label": _label_of(m)} for m in g.traitor_chat],
        "event_log": [{**e, "label": _label_of(e)} for e in g.event_log],
    }


@api_router.get("/archive")
async def archive():
    """Finished games, newest first — everyone can look back at them."""
    docs = await db.games.find(
        {"phase": "ended"},
        {"_id": 0, "code": 1, "created_at": 1, "updated_at": 1, "winner": 1, "players": 1,
         "day": 1, "cal_day": 1, "session": 1, "tables_per_day": 1},
    ).sort("updated_at", -1).to_list(ARCHIVE_LIMIT)
    return {"games": [
        {
            "code": d["code"],
            "created_at": d.get("created_at"),
            "ended_at": d.get("updated_at"),
            "winner": d.get("winner"),
            "players": len(d.get("players") or []),
            "label": _doc_label(d),
        }
        for d in docs
    ]}


@api_router.get("/archive/{code}")
async def archive_story(code: str):
    """The whole story of one finished game. Nothing is shown until the game is over."""
    g = await load_game(code)
    if not g or g.phase != "ended":
        raise HTTPException(404, "No finished game found with that code")
    return story_of(g)


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
    secret = data.claudai_passphrase or data.moderator_pin  # optional; an empty one counts as none
    if secret and passphrase_problem(secret):
        raise HTTPException(400, PASSPHRASE_RULE)
    if data.tables_per_day not in (1, 2):
        raise HTTPException(400, "Choose one or two Round Tables a day")
    # One Traitor for a small group (5 or fewer), otherwise exactly two.
    n_traitors = 1 if len(names) <= 5 else 2
    traitor_idx = set(random.sample(range(len(names)), n_traitors))
    players = []
    for i, p in enumerate(data.players):
        role = "traitor" if i in traitor_idx else "faithful"
        players.append(Player(name=names[i], pin_hash=hash_pin(p.pin), role=role, started_as=role))
    g = Game(
        code=await new_code(), players=players, day=1, cal_day=1,
        tables_per_day=data.tables_per_day, session="lunch" if data.tables_per_day == 2 else "",
    )
    g.host_id = players[0].id  # the first player entered is the host/creator
    if secret:
        g.moderator_pin_hash = await asyncio.to_thread(hash_passphrase, secret)
    if data.murder_gap_hours is not None:
        g.murder_gap_hours = max(0.0, min(MAX_MURDER_GAP_HOURS, data.murder_gap_hours))
    g.murder_window_minutes = max(0.0, min(MAX_MURDER_WINDOW_MIN, data.murder_window_minutes or 0.0))
    traitors = ", ".join(pl.name for pl in players if pl.role == "traitor")
    tables = "two Round Tables a day (lunch and 8pm)" if g.tables_per_day == 2 else "one Round Table a day"
    log(g, "setup", f"Game created: {len(players)} players, host {players[0].name}, {tables}. Traitors: {traitors}",
        f"Game created: {len(players)} players, host {players[0].name}, {tables}")
    await save(g)
    return public_state(g)


class EndGameIn(BaseModel):
    player_id: Optional[str] = None
    pin: Optional[str] = None


@api_router.delete("/games/{code}")
@locked
async def delete_game(code: str, data: Optional[EndGameIn] = None):
    g = await load_game(code)
    # A finished game can be cleared from the main screen by anyone — but its whole story
    # stays published in the archive, so it is only marked as cleared, never deleted.
    if g and g.phase == "ended":
        if not g.archived:
            await db.games.update_one({"code": g.code}, {"$set": {"archived": True}})  # keeps ended_at
        GAME_LOCKS.pop(g.code, None)
        return {"exists": False}
    # Ending a game that is still in progress is restricted to the host, so one
    # player can't wipe everyone's game.
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
        # Unread messages in the Traitors' chat (always 0 for anyone who can't use it).
        "chat_unread": chat_unread(g, p),
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
        if g.plot_done_at and is_traitor and (data.recruit_id or data.target_id or data.action):
            # Everyone has gone: the plan is locked, so a late change can't cut the time to strike.
            raise HTTPException(400, "The plan is locked — everyone has taken their turn")
        if is_traitor and p.lives > 0 and data.recruit_id:
            # Recruit a Faithful to replace a lost Traitor (instead of murdering tonight)
            if not recruitment_available(g):
                raise HTTPException(400, "You can only recruit to replace a banished Traitor, or when you are the only Traitor left "
                                         f"— never more than {MAX_TRAITORS} Traitors, and only while 6 or more are still in")
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
            log(g, "pass", f"{p.name} passed the phone on (nothing to do)", f"{p.name} took their night turn")
    else:
        raise HTTPException(400, "It is not time to take a turn")

    if p.id not in g.turns_done:
        g.turns_done.append(p.id)
    if g.phase == "night" and not g.plot_done_at and {pl.id for pl in g.alive()}.issubset(set(g.turns_done)):
        # Everyone has taken their plot turn: the Traitors now get time to carry out the murder.
        g.plot_done_at = datetime.now(timezone.utc).isoformat()
        log(g, "stage", f"Everyone has taken their plot turn — the Round Table opens in {g.murder_window_minutes:g} minutes")
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
        log(g, "stage", f"{round_label(g)} began")
    elif g.phase == "day":
        # The Traitors now plot BEFORE the Round Table: each day opens with the night,
        # where they pick the victim and the plain-sight action (or recruit). In the
        # endgame there are no murders, so the day goes straight to the final vote.
        if in_endgame(g):
            g.phase = "roundtable"
            g.turns_done, g.votes, g.end_votes = [], {}, []
            log(g, "stage", "Endgame: straight to the final vote — banish one more, or end the game")
        else:
            wait = next_plot_at(g)
            if wait:
                raise HTTPException(
                    400,
                    f"Too soon after the last murder — the Traitors can strike again {g.murder_gap_hours:g} hours after it.",
                )
            g.phase = "night"
            g.turns_done, g.target_id, g.action, g.murder_confirmed, g.action_choices, g.recruit_id = [], None, None, False, [], None
            g.murder_done = False
            g.plot_done_at = None
            log(g, "stage", f"The Traitors plot ({round_label(g)})")
    elif g.phase == "night":
        # The Traitors have planned their victim and action. The murder itself is carried
        # out in plain sight during the day; the group then gathers to check in.
        alive_ids = {p.id for p in g.alive()}
        if not alive_ids.issubset(set(g.turns_done)):
            raise HTTPException(400, "Everyone must take their turn before the Round Table")
        wait = round_table_at(g)
        if wait:
            mins = max(1, math.ceil((wait - datetime.now(timezone.utc)).total_seconds() / 60))
            raise HTTPException(400, f"The Round Table opens in {mins} minute{'s' if mins != 1 else ''} — "
                                     f"the Traitors get {g.murder_window_minutes:g} minutes to carry out the murder.")
        if g.recruit_id:
            plan = f"{PLAN_PREFIX}recruit {name_of(g, g.recruit_id)}"
        elif g.murder_confirmed:
            plan = f"{PLAN_PREFIX}murder {name_of(g, g.target_id)} with “{g.action}”"
        else:
            plan = f"{PLAN_PREFIX}no murder — the Traitors lay low"
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
        traitors_in = sum(1 for p in g.alive() if p.role == "traitor")
        if rp and rp.lives > 0 and rp.role == "faithful" and traitors_in < MAX_TRAITORS:
            rp.role = "traitor"  # recruited instead of murdered
            rp.started_as = rp.started_as or "faithful"
            rp.recruited_label = round_label(g)
            recruited = True
            if g.recruit_credits > 0:
                g.recruit_credits -= 1
            murder = {"success": False}
        elif g.murder_confirmed and g.murder_done:
            murder = resolve_murder(g)
            if murder.get("success"):
                g.last_murder_at = datetime.now(timezone.utc).isoformat()
        else:
            murder = {"success": False}
        g.winner = winner_by_roles(g)  # the murder alone can win it for the Traitors
        g.history.append(new_history_entry(g, murder=murder, banish=None, recruited=recruited, winner=g.winner))
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
            if rp and not recruited:
                # A recruit was planned but not allowed (never more than two Traitors).
                log(g, "reveal", f"Murder reveal: nobody died — the recruit of {rp.name} was not allowed "
                    f"(never more than {MAX_TRAITORS} Traitors)", "Murder reveal: nobody died")
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
            g.history.append(new_history_entry(g, murder=None, banish=None, ended_by_vote=True, winner=g.winner))
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
                    g.history.append(new_history_entry(g, murder=None, banish=banish, winner=g.winner))
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
        # The round is over. The game may be won; the Traitors also win if they survive the
        # final Round Table of the final day. Otherwise the next round (and a new plot) begins:
        # at two a day, lunch -> evening of the same day, evening -> lunch of the next.
        if g.winner:
            g.phase = "ended"
            log(g, "end", f"Game over — the {g.winner.capitalize()} win")
        elif is_final_round(g):
            g.winner = "traitors"  # they survived to the end of the final day
            if g.history:
                g.history[-1]["winner"] = g.winner
            g.phase = "ended"
            log(g, "end", f"Game over — the Traitors survived to the end of Day {TOTAL_DAYS} and win")
        else:
            g.day += 1  # the round counter: never repeats
            g.cal_day, g.session = next_round(g)
            g.target_id, g.action, g.murder_confirmed, g.action_choices, g.recruit_id = None, None, False, [], None
            g.murder_done = False
            g.turns_done, g.votes, g.end_votes = [], {}, []
            g.phase = "day"
            log(g, "stage", f"{round_label(g)} began")
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
