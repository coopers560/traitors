import Ionicons from "@react-native-vector-icons/ionicons";
import * as Haptics from "expo-haptics";
import { useEffect, useRef, useState } from "react";
import { Platform, Pressable, StyleProp, Text, View, ViewStyle } from "react-native";

import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

// Faithful / Traitor is only ever on screen while a finger is held down on it. Let go and
// it's covered again — so a glance from across the room never gives anyone away.

const noSelect = Platform.OS === "web" ? ({ userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none" } as object) : {};

/** How often a timed hold updates its countdown. */
const TICK_MS = 100;

function buzz() {
  if (Platform.OS !== "web") Haptics.selectionAsync();
}

/** Keep holding past the reveal to do something more (e.g. open the Traitors' menu). */
export type LongHold = {
  /** Total time held, from the first touch, before `onLongHold` runs. */
  afterMs: number;
  /** Shown under the revealed contents as soon as they appear. */
  hint: string;
  onLongHold: () => void;
};

/**
 * A panel whose contents show only while pressed. The cover keeps the same minimum height
 * whatever is underneath, so its size never hints at what it hides.
 *
 * With `revealAfterMs`, the cover counts the seconds (1… 2… 3…) and the contents appear only
 * once the finger has been held that long. With `longHold`, a hint and the continuing count
 * (4… 5… 6…) show under the contents, and holding on to `longHold.afterMs` runs
 * `onLongHold`. Letting go at any point hides everything and starts again from zero.
 * `onReveal` runs each time the contents are actually shown.
 */
export function HoldToReveal({
  children,
  label = "Press and hold to see",
  minHeight = 150,
  onReveal,
  revealAfterMs = 0,
  longHold,
  style,
  testID,
}: {
  children: React.ReactNode;
  label?: string;
  minHeight?: number;
  onReveal?: () => void;
  revealAfterMs?: number;
  longHold?: LongHold;
  style?: StyleProp<ViewStyle>;
  testID: string;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [held, setHeld] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const startedAt = useRef(0);
  // The latest props, read by the running timer without restarting it.
  const latest = useRef({ onReveal, longHold, revealAfterMs });
  useEffect(() => {
    latest.current = { onReveal, longHold, revealAfterMs };
  });

  const timed = revealAfterMs > 0 || !!longHold;
  useEffect(() => {
    if (!held || !timed) return;
    let revealed = latest.current.revealAfterMs <= 0; // an instant reveal already ran on press-in
    let longDone = false;
    const timer = setInterval(() => {
      const now = latest.current;
      const ms = Date.now() - startedAt.current;
      setElapsed(ms);
      if (!revealed && ms >= now.revealAfterMs) {
        revealed = true;
        buzz();
        now.onReveal?.();
      }
      if (now.longHold && !longDone && ms >= now.longHold.afterMs) {
        longDone = true;
        clearInterval(timer);
        buzz();
        setHeld(false);
        setElapsed(0);
        now.longHold.onLongHold();
      }
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [held, timed]);

  const revealed = held && elapsed >= revealAfterMs;
  // The second being counted: 1 from the first touch, 4 once a 3-second reveal has shown, …
  const count = Math.floor(elapsed / 1000) + 1;
  const holdSecs = Math.round(revealAfterMs / 1000);
  const longSpan = longHold ? Math.max(1, longHold.afterMs - revealAfterMs) : 1;
  const longProgress = longHold ? Math.min(1, Math.max(0, (elapsed - revealAfterMs) / longSpan)) : 0;

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPressIn={() => {
        startedAt.current = Date.now();
        setElapsed(0);
        setHeld(true);
        buzz();
        if (revealAfterMs <= 0) onReveal?.();
      }}
      onPressOut={() => {
        setHeld(false);
        setElapsed(0);
      }}
      // A no-op long press keeps a long hold alive on the web: without it, the browser's
      // long-press context menu (Android) ends the press after about half a second.
      onLongPress={() => {}}
      style={[{ minHeight }, noSelect, style]}
    >
      {revealed ? (
        <View testID={`${testID}-shown`} style={{ minHeight, justifyContent: "center" }} pointerEvents="none">
          {longHold ? (
            <>
              <View style={{ flexGrow: 1, justifyContent: "center" }}>{children}</View>
              <View style={styles.longHint} testID={`${testID}-long-hint`}>
                <Text style={styles.longCount} selectable={false} testID={`${testID}-long-count`}>
                  {count}…
                </Text>
                <View style={{ flex: 1, gap: 6 }}>
                  <Text style={styles.longText} selectable={false}>{longHold.hint}</Text>
                  <View style={styles.track}>
                    <View style={[styles.trackFill, { width: `${Math.round(longProgress * 100)}%` }]} />
                  </View>
                </View>
              </View>
            </>
          ) : (
            children
          )}
        </View>
      ) : (
        <View style={[styles.cover, { minHeight }]} testID={`${testID}-cover`} pointerEvents="none">
          {held ? (
            <Text style={styles.count} selectable={false} testID={`${testID}-count`}>
              {count}…
            </Text>
          ) : (
            <Ionicons name="finger-print" size={36} color={colors.brand} />
          )}
          <Text style={styles.coverText} selectable={false}>{held ? "Keep holding…" : label}</Text>
          <Text style={styles.coverSub} selectable={false}>
            {!held && holdSecs > 0 ? `Hold for ${holdSecs} seconds · let go to hide it again` : "Let go to hide it again"}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

/** An inline "hold to see" for a single Faithful / Traitor word, e.g. in a result line. */
export function HoldRole({ role, testID }: { role: "traitor" | "faithful" | string | null | undefined; testID: string }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [held, setHeld] = useState(false);
  const traitor = role === "traitor";
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel="Press and hold to see their allegiance"
      onPressIn={() => {
        setHeld(true);
        buzz();
      }}
      onPressOut={() => setHeld(false)}
      hitSlop={8}
      style={[styles.pill, held && { borderColor: traitor ? colors.traitor : colors.brand }, noSelect]}
    >
      {held ? (
        <Text testID={`${testID}-shown`} selectable={false} style={[styles.pillText, { color: traitor ? colors.traitor : colors.brand }]}>
          {traitor ? "a Traitor" : "Faithful"}
        </Text>
      ) : (
        <>
          <Ionicons name="finger-print" size={13} color={colors.muted} />
          <Text selectable={false} style={styles.pillHint}>hold to see</Text>
        </>
      )}
    </Pressable>
  );
}

const useStyles = makeStyles((c) => ({
  cover: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: c.brandSecondary,
    backgroundColor: c.surfaceTertiary,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    padding: spacing.md,
  },
  coverText: { color: c.onSurface, fontSize: 18, fontWeight: "700", textAlign: "center" },
  coverSub: { color: c.muted, fontSize: 14, textAlign: "center" },
  count: { fontFamily: fonts.display, fontSize: 60, lineHeight: 64, color: c.brand, textAlign: "center" },
  longHint: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginTop: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: c.divider,
  },
  longCount: { fontFamily: fonts.display, fontSize: 40, lineHeight: 44, color: c.brand, minWidth: 48, textAlign: "center" },
  longText: { color: c.onSurfaceSecondary, fontSize: 15, lineHeight: 20, fontWeight: "600" },
  track: { height: 4, borderRadius: 2, backgroundColor: c.surfaceTertiary, overflow: "hidden" },
  trackFill: { height: 4, borderRadius: 2, backgroundColor: c.brand },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
    minWidth: 104,
    justifyContent: "center",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.surfaceTertiary,
  },
  pillText: { fontSize: 15, fontWeight: "800" },
  pillHint: { color: c.muted, fontSize: 13, fontWeight: "600" },
}));
