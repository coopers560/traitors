import Ionicons from "@react-native-vector-icons/ionicons";
import { useEffect, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { makeStyles, radius, spacing, useTheme } from "@/src/theme";

// When a new version of the app is deployed, phones that already have it open keep running
// the old code until they reload — and an old screen can show old rules. Every so often we
// fetch the live page and compare its app bundle with the one this phone is running; if they
// differ, a banner offers a one-tap update.

const BUNDLE = /\/_expo\/static\/js\/web\/entry-[^"']+\.js/;
const CHECK_EVERY_MS = 60_000;

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
  const insets = useSafeAreaInsets();
  const [stale, setStale] = useState(false);

  useEffect(() => {
    const mine = runningBundle();
    if (!mine) return; // development build or native app: nothing to compare
    let cancelled = false;
    const check = async () => {
      const live = await liveBundle();
      if (!cancelled && live && live !== mine) setStale(true);
    };
    const id = setInterval(check, CHECK_EVERY_MS);
    // Also check whenever the app comes back to the foreground (phones sleep a lot).
    const onVisible = () => document.visibilityState === "visible" && check();
    document.addEventListener("visibilitychange", onVisible);
    check();
    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  if (!stale) return null;
  return (
    <View style={[styles.wrap, { paddingTop: insets.top + spacing.xs }]} pointerEvents="box-none">
      <Pressable
        testID="update-banner"
        accessibilityRole="button"
        onPress={() => window.location.reload()}
        style={({ pressed }) => [styles.banner, pressed && { opacity: 0.85 }]}
      >
        <Ionicons name="refresh-circle" size={24} color={colors.onBrandPrimary} />
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>A new version of the game is ready</Text>
          <Text style={styles.sub}>Tap to update — finish your turn first if you&apos;re in the middle of one.</Text>
        </View>
      </Pressable>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  wrap: { position: "absolute", top: 0, left: 0, right: 0, paddingHorizontal: spacing.md, zIndex: 1000 },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: c.brandPrimary,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    boxShadow: "0px 6px 18px rgba(0,0,0,0.45)",
  },
  title: { color: c.onBrandPrimary, fontSize: 16, fontWeight: "800" },
  sub: { color: c.onBrandPrimary, fontSize: 13, lineHeight: 17, opacity: 0.85 },
}));
