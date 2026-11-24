import Ionicons from "@react-native-vector-icons/ionicons";
import * as Haptics from "expo-haptics";
import { useState } from "react";
import { Platform, Pressable, StyleProp, Text, View, ViewStyle } from "react-native";

import { makeStyles, radius, spacing, useTheme } from "@/src/theme";

// Faithful / Traitor is only ever on screen while a finger is held down on it. Let go and
// it's covered again — so a glance from across the room never gives anyone away.

const noSelect = Platform.OS === "web" ? ({ userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none" } as object) : {};

function buzz() {
  if (Platform.OS !== "web") Haptics.selectionAsync();
}

/**
 * A panel whose contents show only while pressed. The cover keeps the same minimum height
 * whatever is underneath, so its size never hints at what it hides.
 */
export function HoldToReveal({
  children,
  label = "Press and hold to see",
  minHeight = 150,
  onReveal,
  style,
  testID,
}: {
  children: React.ReactNode;
  label?: string;
  minHeight?: number;
  onReveal?: () => void;
  style?: StyleProp<ViewStyle>;
  testID: string;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [held, setHeld] = useState(false);
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPressIn={() => {
        setHeld(true);
        buzz();
        onReveal?.();
      }}
      onPressOut={() => setHeld(false)}
      style={[{ minHeight }, noSelect, style]}
    >
      {held ? (
        <View testID={`${testID}-shown`} style={{ minHeight, justifyContent: "center" }} pointerEvents="none">
          {children}
        </View>
      ) : (
        <View style={[styles.cover, { minHeight }]} testID={`${testID}-cover`} pointerEvents="none">
          <Ionicons name="finger-print" size={36} color={colors.brand} />
          <Text style={styles.coverText} selectable={false}>{label}</Text>
          <Text style={styles.coverSub} selectable={false}>Let go to hide it again</Text>
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
