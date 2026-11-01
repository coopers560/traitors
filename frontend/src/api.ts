const BASE = `${process.env.EXPO_PUBLIC_BACKEND_URL}/api`;

export type Role = "traitor" | "faithful";
export type Phase = "setup" | "day" | "roundtable" | "reveal" | "ended";

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
  | { exists: false }
  | {
      exists: true;
      day: number;
      total_days: number;
      phase: Phase;
      winner: "faithful" | "traitors" | null;
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
  next_target?: { id: string; name: string } | null;
  next_action?: string | null;
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
    throw new Error(detail);
  }
  return data as T;
}

export const api = {
  getGame: () => request<GameState>("/game"),
  createGame: (players: { name: string; pin: string }[]) => request<GameState>("/game", "POST", { players }),
  deleteGame: () => request<GameState>("/game", "DELETE"),
  privateView: (player_id: string, pin: string) => request<PrivateView>("/game/private", "POST", { player_id, pin }),
  takeTurn: (body: {
    player_id: string;
    pin: string;
    vote_target_id?: string;
    murder_done?: boolean;
    target_id?: string;
  }) => request<PrivateView>("/game/turn", "POST", body),
  advance: () => request<GameState>("/game/advance", "POST"),
};
