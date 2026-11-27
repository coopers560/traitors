import { useEffect, useState } from "react";

import { api, Lobby } from "@/src/api";
import { storage } from "@/src/utils/storage";

// The sign-up sheet knows each phone by a random id kept on the phone. It's only used to lock a
// spot to the phone that made it — no account, nothing personal.
const KEY_DEVICE = "device_id";

function newDeviceId(): string {
  const rand = () => Math.random().toString(36).slice(2, 10);
  return `d${Date.now().toString(36)}${rand()}${rand()}`;
}

/** This phone's id for the sign-up sheet (null until loaded). */
export function useDeviceId(): string | null {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    (async () => {
      let d = (await storage.getItem(KEY_DEVICE, "")) as string;
      if (!d || !/^[A-Za-z0-9_-]{8,64}$/.test(d)) {
        d = newDeviceId();
        await storage.setItem(KEY_DEVICE, d);
      }
      if (active) setId(d);
    })();
    return () => { active = false; };
  }, []);
  return id;
}

// The PIN of the one player this phone signed up, as "slotId:pin" — kept only while it's this
// phone's only box, so a phone passed round never holds on to anyone else's PIN.
const KEY_PIN = "lobby_my_pin";

/**
 * Keep the PIN typed into this phone's box, so it can skip the PIN once the game starts — but only
 * if it's this phone's only box. A phone that signs up a second player forgets any PIN it kept.
 */
export async function rememberSpotPin(slotId: string, pin: string, onlyBox: boolean): Promise<void> {
  if (onlyBox) await storage.setItem(KEY_PIN, `${slotId}:${pin}`);
  else await storage.removeItem(KEY_PIN);
}

/**
 * The game has started: if this phone signed up exactly one player, it becomes that player's
 * phone ("remember me"), so they go straight to their own screen. A phone that signed up several
 * people (passed round) stays shared. Returns the game's code.
 */
export async function claimMyPlayer(
  lobby: Extract<Lobby, { exists: true }>,
  setMe: (playerId: string, pin: string, forCode?: string) => Promise<void>,
): Promise<string | null> {
  const code = lobby.started_code;
  if (!code) return null;
  const mine = Object.entries(lobby.my_players ?? {});
  const kept = String((await storage.getItem(KEY_PIN, "")) ?? "");
  await storage.removeItem(KEY_PIN); // used once, then gone either way
  if (mine.length === 1) {
    const [slotId, playerId] = mine[0];
    const [keptSlot, pin] = kept.split(":");
    if (keptSlot === slotId && /^\d{4}$/.test(pin ?? "")) await setMe(playerId, pin, code);
  }
  return code;
}

/** Called when a game the phone found on its own may have come from the sign-up. */
export async function claimFromLobby(
  device: string,
  code: string,
  setMe: (playerId: string, pin: string, forCode?: string) => Promise<void>,
): Promise<void> {
  try {
    const l = await api.lobby(device);
    if (l.exists && l.started_code === code) await claimMyPlayer(l, setMe);
  } catch {
    // no sign-up to claim from — fine
  }
}
