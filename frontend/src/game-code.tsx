import { createContext, useCallback, useContext, useEffect, useState } from "react";

import { setApiCode } from "@/src/api";
import { queryClient } from "@/src/query-client";
import { storage } from "@/src/utils/storage";

const KEY = "game_code";

type Ctx = {
  code: string | null;
  /** True when this phone's game was ended elsewhere (shown once on Welcome). */
  gone: boolean;
  setCode: (code: string | null, opts?: { gone?: boolean }) => Promise<void>;
};
const GameCodeContext = createContext<Ctx>({ code: null, gone: false, setCode: async () => {} });

/** Remembers which game (join code) this phone is playing, across app restarts. */
export function GameCodeProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [code, setState] = useState<string | null>(null);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    storage.getItem(KEY, null).then((c) => {
      const saved = typeof c === "string" ? c : null;
      setApiCode(saved);
      setState(saved);
      setReady(true);
    });
  }, []);

  const setCode = useCallback(async (c: string | null, opts?: { gone?: boolean }) => {
    setApiCode(c);
    setState(c);
    setGone(!c && !!opts?.gone);
    if (c) await storage.setItem(KEY, c);
    else await storage.removeItem(KEY);
    queryClient.removeQueries({ queryKey: ["actions"] });
    await queryClient.resetQueries({ queryKey: ["game"] });
  }, []);

  if (!ready) return null;
  return <GameCodeContext.Provider value={{ code, gone, setCode }}>{children}</GameCodeContext.Provider>;
}

export const useGameCode = () => useContext(GameCodeContext);
