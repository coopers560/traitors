const BASE = `${process.env.EXPO_PUBLIC_BACKEND_URL}/api`;

export type Role = "traitor" | "faithful";
export type Phase = "setup" | "day" | "roundtable" | "banished" | "night" | "reveal" | "ended";

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
  };
  banish: {
    tally: { player_id: string; name: string; votes: number }[];
    tie: boolean;
    target_id: string | null;
    name?: string;
    lives_left?: number;
    eliminated?: boolean;
    already_dead?: boolean;
    role?: Role | null;
  };
  winner: "faithful" | "traitors" | null;
};

export type GameState =
  | { exists: false; gone?: boolean }
  | {
      exists: true;
      code: string;
      day: number;
      total_days: number;
      phase: Phase;
      winner: "faithful" | "traitors" | null;
      host_id: string | null;
      host_name: string | null;
      players: PublicPlayer[];
      turns_needed: number;
      turns_done: number;
      history: DayResult[];
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
  fellow_traitors?: string[];
  target?: { id: string; name: string } | null;
  action?: string | null;
  murder_confirmed?: boolean;
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
  createGame: (players: { name: string; pin: string }[]) => request<GameState>("/games", "POST", { players }),
  deleteGame: (auth?: { player_id: string; pin: string }) =>
    request<GameState>(`/games/${currentCode}`, "DELETE", auth),
  privateView: (player_id: string, pin: string) =>
    request<PrivateView>(`/games/${currentCode}/private`, "POST", { player_id, pin }),
  takeTurn: (body: {
    player_id: string;
    pin: string;
    vote_target_id?: string;
    murder_done?: boolean;
    target_id?: string;
  }) => request<PrivateView>(`/games/${currentCode}/turn`, "POST", body),
  advance: (expected: Phase, day: number, force?: boolean) =>
    request<GameState>(`/games/${currentCode}/advance?expected=${expected}&expected_day=${day}${force ? "&force=true" : ""}`, "POST"),
  getActions: () => request<ActionList>(`/games/${currentCode}/actions`),
  saveActions: (actions: string[]) => request<ActionList>(`/games/${currentCode}/actions`, "PUT", { actions }),
  resetActions: () => request<ActionList>(`/games/${currentCode}/actions`, "DELETE"),
};

export type ActionList = { actions: string[]; is_default: boolean };

/** How and when a player left the game, from the public history. */
export function exitOf(history: DayResult[], playerId: string): { how: "murdered" | "banished"; day: number } | null {
  for (const h of history) {
    if (h.murder.success && h.murder.eliminated && h.murder.victim_id === playerId) return { how: "murdered", day: h.day };
    if (h.banish.target_id === playerId && h.banish.eliminated && !h.banish.already_dead) return { how: "banished", day: h.day };
  }
  return null;
}
