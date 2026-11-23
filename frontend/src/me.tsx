import { createContext, useCallback, useContext, useEffect, useState } from "react";

import { useGameCode } from "@/src/game-code";
import { storage } from "@/src/utils/storage";

// "This phone is me." A per-device binding so a player on their own phone can
// skip the roster and PIN each turn. Convenience only: the 4-digit PIN is kept
// in local device storage (no biometrics on the web), scoped to the game code,
// and cleared when the phone joins a different game.
const KEY_CODE = "me_code";
const KEY_PID = "me_player";
const KEY_PIN = "me_pin";

type Me = { playerId: string; pin: string };
type Ctx = {
  me: Me | null;
  setMe: (playerId: string, pin: string) => Promise<void>;
  clearMe: () => Promise<void>;
};
const MeContext = createContext<Ctx>({ me: null, setMe: async () => {}, clearMe: async () => {} });

export function MeProvider({ children }: { children: React.ReactNode }) {
  const { code } = useGameCode();
  const [me, setMeState] = useState<Me | null>(null);

  // Load the binding for the current game; ignore one saved for a different game.
  useEffect(() => {
    let active = true;
    (async () => {
      const savedCode = await storage.getItem(KEY_CODE, "");
      if (!active) return;
      if (code && savedCode === code) {
        const pid = await storage.getItem(KEY_PID, "");
        const pin = await storage.getItem(KEY_PIN, "");
        if (active) setMeState(pid && pin ? { playerId: pid as string, pin: pin as string } : null);
      } else {
        setMeState(null);
      }
    })();
    return () => { active = false; };
  }, [code]);

  const setMe = useCallback(async (playerId: string, pin: string) => {
    setMeState({ playerId, pin });
    if (code) await storage.setItem(KEY_CODE, code);
    await storage.setItem(KEY_PID, playerId);
    await storage.setItem(KEY_PIN, pin);
  }, [code]);

  const clearMe = useCallback(async () => {
    setMeState(null);
    await storage.removeItem(KEY_CODE);
    await storage.removeItem(KEY_PID);
    await storage.removeItem(KEY_PIN);
  }, []);

  return <MeContext.Provider value={{ me, setMe, clearMe }}>{children}</MeContext.Provider>;
}

export const useMe = () => useContext(MeContext);
