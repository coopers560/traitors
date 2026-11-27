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
  /** The round number (unique, ever-increasing). Show `label` to people, not this. */
  day: number;
  /** e.g. "Day 3 · Lunch" / "Day 3 · Evening" / "Day 3". Missing on entries made before labels existed. */
  label?: string;
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
      /** Whether this game has a ClaudAI host (a ClaudAI passphrase is set). */
      claudai?: boolean;
      /** The current round's label, e.g. "Day 3 · Lunch". */
      label?: string;
      /** The calendar day of the holiday (1..total_days); `day` is the round number. */
      cal_day?: number;
      session?: "" | "lunch" | "evening";
      /** Round Tables per day: 1, or 2 (lunch and 8pm). */
      tables_per_day?: number;
      /** Retired (always null): murders used to have to be hours apart. */
      next_plot_at?: string | null;
      murder_gap_hours?: number;
      /** The Traitors get time to carry out the murder: the Round Table opens at this time (ISO), if still waiting. */
      round_table_at?: string | null;
      /** Minutes the Round Table stays shut after the plan is sealed. */
      murder_window_minutes?: number;
      /** Only the Traitors take part in the plot (from the Traitors' menu); nobody else takes a turn. */
      traitors_plot_alone?: boolean;
      /** A Traitors-only plot is sealed and its time to strike has passed: the Round Table can open. */
      plot_ready?: boolean;
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
  /** Unread messages in the Traitors' chat (always 0 for anyone who can't use it). */
  chat_unread?: number;
  /** This player was recruited into the Traitors today (only ever sent to them). */
  recruited_now?: boolean;
  endgame?: boolean;
  /** Fellow Traitors still in the game (Traitors only). */
  fellow_traitors?: string[];
  /** Fellow Traitors who are out — banished (Traitors only). */
  fellow_traitors_out?: string[];
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
  /** Only the Traitors take part in the plot. */
  traitors_plot_alone?: boolean;
  /** Tonight's plan is final — sealed by a Traitor (Traitors only), and when (ISO). */
  plan_sealed?: boolean;
  plan_sealed_at?: string | null;
  /** When the Round Table can open, once sealed (Traitors only). */
  plan_ready_at?: string | null;
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
  label?: string;
  phase: Phase;
  kind: string;
  text: string;
  neutral: string | null;
};

export type VoteLogEntry = {
  day: number;
  label?: string;
  round?: number;
  votes: VoteEdge[];
  end_votes: (string | null)[];
};

export type ModeratorView = {
  exists: true;
  code: string;
  day: number;
  label?: string;
  cal_day?: number;
  session?: "" | "lunch" | "evening";
  tables_per_day?: number;
  /** Minimum hours between murders, and when the Traitors may next plot (ISO), if still waiting. */
  murder_gap_hours?: number;
  next_plot_at?: string | null;
  round_table_at?: string | null;
  plot_ready?: boolean;
  traitors_plot_alone?: boolean;
  murder_window_minutes?: number;
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

/** One spot on the sign-up sheet. A spot still being filled in has no name yet. */
export type LobbySlot = { id: string; pos: number; name: string | null; ready: boolean; mine: boolean; host: boolean };

/** The sign-up sheet, as this phone sees it. */
export type Lobby =
  | { exists: false }
  | {
      exists: true;
      you_host: boolean;
      host_name: string | null;
      /** The host's phone has gone (and they never added themselves): anyone can take over. */
      host_away: boolean;
      tables_per_day: number;
      slots: LobbySlot[];
      ready_count: number;
      max_players: number;
      /** Set once the host has chosen the Traitors: the game to go to. */
      started_code: string | null;
      /** Once started: this phone's spots -> the players they became. */
      my_players: Record<string, string>;
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
  createGame: (players: { name: string; pin: string }[], opts: { claudaiPassphrase?: string; tablesPerDay?: number } = {}) =>
    request<GameState>("/games", "POST", {
      players,
      single: true,
      tables_per_day: opts.tablesPerDay ?? 2,
      murder_window_minutes: 30, // the Traitors get 30 minutes to carry out each murder
      skip_day: true, // straight from the start / the banishment into the next plot
      traitors_plot_alone: true, // only the Traitors take part in the plot, from their menu
      ...(opts.claudaiPassphrase ? { claudai_passphrase: opts.claudaiPassphrase } : {}),
    }),
  /** The group's game in progress, if any — phones join it without a code. */
  currentGame: () => request<CurrentGame>("/current"),
  /** The sign-up sheet (everyone adds themselves on their own phone). */
  lobby: (device: string) => request<Lobby>(`/lobby?device=${encodeURIComponent(device)}`),
  /** Start a sign-up, hosted by this phone (or see the one already open). */
  lobbyOpen: (device: string, tablesPerDay = 2) => request<Lobby>("/lobby", "POST", { device, tables_per_day: tablesPerDay }),
  /** Hold a box for this phone straight away (the one tapped, or the first free one). */
  lobbyJoin: (device: string, pos?: number) => request<Lobby>("/lobby/join", "POST", { device, ...(pos !== undefined ? { pos } : {}) }),
  lobbySave: (device: string, slot_id: string, name: string, pin: string) =>
    request<Lobby>("/lobby/save", "POST", { device, slot_id, name, pin }),
  lobbyRemove: (device: string, slot_id: string) => request<Lobby>("/lobby/remove", "POST", { device, slot_id }),
  lobbySettings: (device: string, tablesPerDay: 1 | 2) =>
    request<Lobby>("/lobby/settings", "POST", { device, tables_per_day: tablesPerDay }),
  /** The host chooses the Traitors: the sign-up becomes the game. */
  lobbyStart: (device: string, claudaiPassphrase?: string) =>
    request<Lobby>("/lobby/start", "POST", { device, ...(claudaiPassphrase ? { claudai_passphrase: claudaiPassphrase } : {}) }),
  /** Become the host on this phone (the host on a new phone gives their PIN). */
  lobbyTakeOver: (device: string, pin?: string) => request<Lobby>("/lobby/host", "POST", { device, ...(pin ? { pin } : {}) }),
  lobbyCancel: (device: string) => request<Lobby>(`/lobby?device=${encodeURIComponent(device)}`, "DELETE"),
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
  /** The game's host nominates a ClaudAI host by giving the game its first ClaudAI PIN. */
  nominateClaudai: (player_id: string, pin: string, new_passphrase: string) =>
    request<GameState>(`/games/${currentCode}/claudai`, "POST", { player_id, pin, new_passphrase }),
  moderatorRevote: (code: string, auth: ModAuth) =>
    request<ModeratorView>(`/games/${encodeURIComponent(code.trim().toUpperCase())}/moderator/revote`, "POST", auth),
  moderatorView: (code: string, auth: ModAuth) =>
    request<ModeratorView>(`/games/${encodeURIComponent(code.trim().toUpperCase())}/moderator`, "POST", auth),
  /** ClaudAI login with the game's own ClaudAI passphrase; returns the game in progress. */
  moderatorLogin: (passphrase: string) => request<{ code: string }>("/moderator/login", "POST", { passphrase }),
  moderatorSetPassphrase: (code: string, auth: ModAuth, newPassphrase: string) =>
    request<ModeratorView>(`/games/${encodeURIComponent(code.trim().toUpperCase())}/moderator/pin`, "POST", { ...auth, new_passphrase: newPassphrase }),
  /** Switch a game between one Round Table a day and two (lunch and 8pm). */
  /** Change how long the Traitors get to carry out the murder after the plot (0–120 minutes). */
  moderatorMurderWindow: (code: string, auth: ModAuth, minutes: number) =>
    request<ModeratorView>(`/games/${encodeURIComponent(code.trim().toUpperCase())}/moderator/schedule`, "POST", {
      ...auth,
      murder_window_minutes: minutes,
    }),
  /** Change the minimum hours between murders (0–24). Retired: no longer enforced. */
  moderatorMurderGap: (code: string, auth: ModAuth, hours: number) =>
    request<ModeratorView>(`/games/${encodeURIComponent(code.trim().toUpperCase())}/moderator/schedule`, "POST", {
      ...auth,
      murder_gap_hours: hours,
    }),
  moderatorSchedule: (code: string, auth: ModAuth, tablesPerDay: 1 | 2, session?: "lunch" | "evening") =>
    request<ModeratorView>(`/games/${encodeURIComponent(code.trim().toUpperCase())}/moderator/schedule`, "POST", {
      ...auth,
      tables_per_day: tablesPerDay,
      ...(session ? { session } : {}),
    }),
  /** Finished games, newest first. */
  archive: () => request<{ games: ArchiveGame[] }>("/archive"),
  /** The whole story of a finished game (everything revealed). */
  story: (code: string) => request<Story>(`/archive/${encodeURIComponent(code.trim().toUpperCase())}`),
  getActions: () => request<ActionList>(`/games/${currentCode}/actions`),
  saveActions: (actions: string[]) => request<ActionList>(`/games/${currentCode}/actions`, "PUT", { actions }),
  resetActions: () => request<ActionList>(`/games/${currentCode}/actions`, "DELETE"),
};

export type ActionList = { actions: string[]; is_default: boolean };

/** ClaudAI access: the game's own ClaudAI passphrase (there is no master key). */
export type ModAuth = { passphrase: string };

/** A finished game in the archive. */
export type ArchiveGame = {
  code: string;
  created_at: string;
  ended_at: string;
  winner: "faithful" | "traitors" | null;
  players: number;
  label: string;
};

/** Everything that happened in a finished game. */
export type Story = {
  code: string;
  created_at: string;
  ended_at: string;
  winner: "faithful" | "traitors" | null;
  tables_per_day: number;
  total_days: number;
  players: {
    id: string;
    name: string;
    role: Role;
    started_as: Role;
    recruited_label: string | null;
    exit: { how: "murdered" | "banished"; label: string } | null;
    is_host: boolean;
  }[];
  rounds: DayResult[];
  vote_log: VoteLogEntry[];
  traitor_chat: ChatMessage[];
  event_log: ModeratorEvent[];
};

/** The label to show for a round: its stored label, or "Day N" for older entries. */
/**
 * A murder method with "them / their / they" replaced by the victim's name, so a Traitor knows
 * exactly who it means: "Sit next to them on their sunbed" → "Sit next to Ben on Ben's sunbed".
 */
export function personalise(action: string | null | undefined, victim: string | null | undefined): string {
  if (!action) return "";
  if (!victim) return action;
  return action
    .replace(/\btheirs\b/g, `${victim}'s`)
    .replace(/\btheir\b/g, `${victim}'s`)
    .replace(/\bThem\b/g, victim)
    .replace(/\bthem\b/g, victim)
    .replace(/\bthemselves\b/g, victim);
}

export function roundLabel(x: { day: number; label?: string }): string {
  return x.label || `Day ${x.day}`;
}

/** Why a new ClaudAI passphrase isn't strong enough, or null if it's fine. */
export function passphraseProblem(s: string): string | null {
  const ok = s.length >= 8 && /[A-Z]/.test(s) && /[a-z]/.test(s) && /[0-9]/.test(s) && /[^A-Za-z0-9]/.test(s);
  return ok ? null : "Use at least 8 characters with upper and lower case letters, a number and a symbol";
}

export type CurrentGame = { code: string | null; phase?: Phase; day?: number; players?: number };

export type ChatMessage = {
  id: string;
  t: string;
  day: number;
  label?: string;
  from_id: string;
  from_name: string;
  text: string;
  /** Names of the other Traitors who have opened the chat since this was sent (not the sender). */
  seen_by?: string[];
};
export type ChatState = { allowed: boolean; messages: ChatMessage[] };

/** How and when a player left the game, from the public history. */
export function exitOf(history: DayResult[], playerId: string): { how: "murdered" | "banished"; day: number } | null {
  for (const h of history) {
    if (h.murder?.success && h.murder.eliminated && h.murder.victim_id === playerId) return { how: "murdered", day: h.day };
    if (h.banish?.target_id === playerId && h.banish.eliminated && !h.banish.already_dead) return { how: "banished", day: h.day };
  }
  return null;
}
