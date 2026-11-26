const BASE = `${process.env.EXPO_PUBLIC_BACKEND_URL}/api`;

export type Role = "traitor" | "faithful";
export type Phase = "setup" | "day" | "night" | "gather" | "reveal" | "roundtable" | "banished" | "ended";

export type PublicPlayer = {
  id: string;
  name: string;
  lives: number;
  alive: boolean;
  role: Role | null;
  turn_done: boolean;
};

export type DayResult = {
  day: number;
  murder: {
    success: boolean;
    victim_id?: string;
    victim_name?: string;
    action?: string;
    lives_left?: number;
    eliminated?: boolean;
    role?: Role | null;
  } | null;
  banish: BanishResult | null;
  /** When the Round Table tied, the first (tied) vote; `banish` is then the revote. */
  tie_vote?: BanishResult | null;
  winner: "faithful" | "traitors" | null;
  recruited?: boolean;
  ended_by_vote?: boolean;
};

export type BanishResult = {
  tally: { player_id: string; name: string; votes: number }[];
  votes?: { voter_id: string; voter_name: string | null; target_id: string; target_name: string | null }[];
  tie: boolean;
  target_id: string | null;
  name?: string;
  lives_left?: number;
  eliminated?: boolean;
  already_dead?: boolean;
  role?: Role | null;
  role_hidden?: boolean;
  /** A first-round tie: everyone votes again, only between these players. */
  revote_ids?: string[];
  revote_names?: (string | null)[];
  /** 2 when this is the result of a tie-break revote. */
  round?: number;
};

/** A tie-break in progress: pending while the tie is revealed, active while everyone votes again. */
export type Revote = { ids: string[]; names: (string | null)[]; active: boolean };

export type GameState =
  | { exists: false; gone?: boolean }
  | {
      exists: true;
      code: string;
      day: number;
      total_days: number;
      phase: Phase;
      winner: "faithful" | "traitors" | null;
      endgame?: boolean;
      host_id: string | null;
      host_name: string | null;
      players: PublicPlayer[];
      turns_needed: number;
      turns_done: number;
      history: DayResult[];
      revote?: Revote | null;
    };

export type PrivateView = {
  player_id: string;
  name: string;
  role: Role;
  lives: number;
  alive: boolean;
  phase: Phase;
  day: number;
  turn_done: boolean;
  my_vote_id: string | null;
  my_end_vote?: boolean;
  /** During a tie-break revote: the only players who can be voted for. */
  revote_ids?: string[];
  /** This player was recruited into the Traitors today (only ever sent to them). */
  recruited_now?: boolean;
  endgame?: boolean;
  fellow_traitors?: string[];
  target?: { id: string; name: string } | null;
  action?: string | null;
  action_choices?: string[];
  murder_confirmed?: boolean;
  murder_done?: boolean;
  planned_murder?: boolean;
  can_recruit?: boolean;
  /** Why recruiting is allowed tonight: to replace a banished Traitor, or a lone Traitor. */
  recruit_reason?: "banished" | "alone" | null;
  recruit?: { id: string; name: string } | null;
};

export type ModeratorGame = {
  code: string;
  phase: Phase;
  stage: string;
  day: number;
  total_days: number;
  players: number;
  alive: number;
  winner: "faithful" | "traitors" | null;
  live: boolean;
  updated_at: string;
};

export type VoteEdge = { voter_id: string; voter_name: string | null; target_id: string; target_name: string | null };

export type ModeratorEvent = {
  t: string;
  day: number;
  phase: Phase;
  kind: string;
  text: string;
  neutral: string | null;
};

export type VoteLogEntry = {
  day: number;
  round?: number;
  votes: VoteEdge[];
  end_votes: (string | null)[];
};

export type ModeratorView = {
  exists: true;
  code: string;
  day: number;
  total_days: number;
  phase: Phase;
  stage: string;
  revote: Revote | null;
  revote_available: boolean;
  /** What re-running the tie will undo (e.g. night turns already taken), if anything. */
  revote_note?: string;
  next_step: string;
  now: { doing: string; waiting_on: string[]; waiting_for: string; next: string; ready: boolean };
  win_note: string;
  endgame: boolean;
  winner: "faithful" | "traitors" | null;
  host_id: string | null;
  host_name: string | null;
  counts: {
    total: number;
    alive: number;
    out: number;
    traitors_alive: number;
    faithful_alive: number;
    traitors_total: number;
  };
  players: {
    id: string;
    name: string;
    role: Role;
    lives: number;
    alive: boolean;
    turn_done: boolean;
    is_host: boolean;
    fellow_traitors: string[];
  }[];
  turns_done: number;
  turns_needed: number;
  outstanding: string[];
  tonight: {
    victim_id: string | null;
    victim_name: string | null;
    action: string | null;
    murder_confirmed: boolean;
    murder_done: boolean;
    recruit_id: string | null;
    recruit_name: string | null;
    recruit_allowed?: "banished" | "alone" | null;
  } | null;
  round_table: {
    votes: VoteEdge[];
    tally: { target_id: string; name: string | null; votes: number }[];
    end_votes: (string | null)[];
    not_voted: string[];
  } | null;
  vote_log: VoteLogEntry[];
  event_log: ModeratorEvent[];
  traitor_chat?: ChatMessage[];
  has_moderator_pin?: boolean;
  history: DayResult[];
};

async function request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = typeof data?.detail === "string" ? data.detail : "Something went wrong";
    throw new ApiError(detail, res.status);
  }
  return data as T;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

// The join code of the game this phone is playing. Set by GameCodeProvider.
let currentCode: string | null = null;
export function setApiCode(code: string | null) {
  currentCode = code;
}

export const api = {
  getGame: async (): Promise<GameState> => {
    if (!currentCode) return { exists: false };
    try {
      return await request<GameState>(`/games/${currentCode}`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return { exists: false, gone: true };
      throw e;
    }
  },
  /** Look up a game by code without switching to it (used by the Join screen). */
  findGame: (code: string) => request<GameState>(`/games/${encodeURIComponent(code.trim().toUpperCase())}`),
  /** One group, one game: create only if no game is in progress (409 otherwise). */
  createGame: (players: { name: string; pin: string }[], moderatorPin?: string) =>
    request<GameState>("/games", "POST", { players, single: true, ...(moderatorPin ? { moderator_pin: moderatorPin } : {}) }),
  /** The group's game in progress, if any — phones join it without a code. */
  currentGame: () => request<CurrentGame>("/current"),
  readChat: (player_id: string, pin: string) => request<ChatState>(`/games/${currentCode}/chat`, "POST", { player_id, pin }),
  sendChat: (player_id: string, pin: string, text: string) =>
    request<ChatState>(`/games/${currentCode}/chat/send`, "POST", { player_id, pin, text }),
  deleteGame: (auth?: { player_id: string; pin: string }) =>
    request<GameState>(`/games/${currentCode}`, "DELETE", auth),
  privateView: (player_id: string, pin: string) =>
    request<PrivateView>(`/games/${currentCode}/private`, "POST", { player_id, pin }),
  takeTurn: (body: {
    player_id: string;
    pin: string;
    vote_target_id?: string;
    end_vote?: boolean;
    murder_done?: boolean;
    target_id?: string;
    action?: string;
    recruit_id?: string;
  }) => request<PrivateView>(`/games/${currentCode}/turn`, "POST", body),
  advance: (expected: Phase, day: number, force?: boolean) =>
    request<GameState>(`/games/${currentCode}/advance?expected=${expected}&expected_day=${day}${force ? "&force=true" : ""}`, "POST"),
  moderatorUnlock: (passphrase: string) => request<{ ok: boolean }>("/moderator/unlock", "POST", { passphrase }),
  moderatorGames: (passphrase: string) => request<{ games: ModeratorGame[] }>("/moderator/games", "POST", { passphrase }),
  moderatorRevote: (code: string, auth: ModAuth) =>
    request<ModeratorView>(`/games/${encodeURIComponent(code.trim().toUpperCase())}/moderator/revote`, "POST", auth),
  moderatorView: (code: string, auth: ModAuth) =>
    request<ModeratorView>(`/games/${encodeURIComponent(code.trim().toUpperCase())}/moderator`, "POST", auth),
  /** ClaudAI login with the game's own 4-digit PIN; returns the game in progress. */
  moderatorPinLogin: (pin: string) => request<{ code: string }>("/moderator/pin", "POST", { pin }),
  moderatorSetPin: (code: string, auth: ModAuth, newPin: string) =>
    request<ModeratorView>(`/games/${encodeURIComponent(code.trim().toUpperCase())}/moderator/pin`, "POST", { ...auth, new_pin: newPin }),
  getActions: () => request<ActionList>(`/games/${currentCode}/actions`),
  saveActions: (actions: string[]) => request<ActionList>(`/games/${currentCode}/actions`, "PUT", { actions }),
  resetActions: () => request<ActionList>(`/games/${currentCode}/actions`, "DELETE"),
};

export type ActionList = { actions: string[]; is_default: boolean };

/** ClaudAI access: the master passphrase (every game) or one game's ClaudAI PIN. */
export type ModAuth = { passphrase?: string; pin?: string };

export type CurrentGame = { code: string | null; phase?: Phase; day?: number; players?: number };

export type ChatMessage = { id: string; t: string; day: number; from_id: string; from_name: string; text: string };
export type ChatState = { allowed: boolean; messages: ChatMessage[] };

/** How and when a player left the game, from the public history. */
export function exitOf(history: DayResult[], playerId: string): { how: "murdered" | "banished"; day: number } | null {
  for (const h of history) {
    if (h.murder?.success && h.murder.eliminated && h.murder.victim_id === playerId) return { how: "murdered", day: h.day };
    if (h.banish?.target_id === playerId && h.banish.eliminated && !h.banish.already_dead) return { how: "banished", day: h.day };
  }
  return null;
}
