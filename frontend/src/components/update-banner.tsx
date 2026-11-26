import Ionicons from "@react-native-vector-icons/ionicons";
import { useEffect, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";

import { makeStyles, radius, spacing, useTheme } from "@/src/theme";

// When a new version of the app is deployed, phones that already have it open keep running
// the old code until they reload — and an old screen can show old rules. So the app keeps
// comparing its bundle with the live page's, and as soon as a new version is live it covers
// the screen and reloads itself: nobody can carry on playing on an old version.

const BUNDLE = /\/_expo\/static\/js\/web\/entry-[^"']+\.js/;
const CHECK_EVERY_MS = 60_000;
const RELOAD_AFTER_S = 8;

/** The app bundle this page is running, or null (development, or not on the web). */
function runningBundle(): string | null {
  if (Platform.OS !== "web" || typeof document === "undefined") return null;
  const el = document.querySelector<HTMLScriptElement>('script[src*="/_expo/static/js/web/entry-"]');
  const m = el?.getAttribute("src")?.match(BUNDLE);
  return m ? m[0] : null;
}

/** The app bundle the server is serving now, or null if it can't be told. */
export async function liveBundle(): Promise<string | null> {
  try {
    const res = await fetch(`/?_v=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return null;
    const m = (await res.text()).match(BUNDLE);
    return m ? m[0] : null;
  } catch {
    return null; // offline or flaky — try again next time
  }
}

export function UpdateBanner() {
  const styles = useStyles();
  const { colors } = useTheme();
  const [stale, setStale] = useState(false);
  const [left, setLeft] = useState(RELOAD_AFTER_S);

  useEffect(() => {
    const mine = runningBundle();
    if (!mine) return; // development build or native app: nothing to compare
    let cancelled = false;
    const check = async () => {
      const live = await liveBundle();
      if (!cancelled && live && live !== mine) setStale(true);
    };
    const id = setInterval(check, CHECK_EVERY_MS);
    // Check straight away, and whenever the app comes back to the foreground (phones sleep a lot).
    const onVisible = () => document.visibilityState === "visible" && check();
    document.addEventListener("visibilitychange", onVisible);
    check();
    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  // Once a new version is live, count down and reload — the old version can't be used.
  useEffect(() => {
    if (!stale) return;
    const id = setInterval(() => {
      setLeft((s) => {
        if (s <= 1) {
          clearInterval(id);
          window.location.reload();
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [stale]);

  if (!stale) return null;
  return (
    <View style={styles.cover} testID="update-banner">
      <View style={styles.card}>
        <Ionicons name="refresh-circle" size={56} color={colors.brand} />
        <Text style={styles.title}>A new version of the game is ready</Text>
        <Text style={styles.sub}>Updating in {left}s so everyone plays by the same rules. Anything you already sealed is safe.</Text>
        <Pressable testID="update-now-button" accessibilityRole="button" onPress={() => window.location.reload()} style={({ pressed }) => [styles.button, pressed && { opacity: 0.85 }]}>
          <Text style={styles.buttonText}>Update now</Text>
        </Pressable>
      </View>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  cover: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1000,
    backgroundColor: "rgba(0,0,0,0.82)",
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
  },
  card: {
    width: "100%",
    maxWidth: 420,
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: c.surfaceSecondary,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: c.brand,
    padding: spacing.lg,
  },
  title: { color: c.onSurface, fontSize: 22, fontWeight: "800", textAlign: "center" },
  sub: { color: c.onSurfaceSecondary, fontSize: 16, lineHeight: 22, textAlign: "center" },
  button: { alignSelf: "stretch", minHeight: 56, borderRadius: radius.lg, backgroundColor: c.brandPrimary, alignItems: "center", justifyContent: "center" },
  buttonText: { color: c.onBrandPrimary, fontSize: 18, fontWeight: "800" },
}));
