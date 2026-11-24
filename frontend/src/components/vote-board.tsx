import Ionicons from "@react-native-vector-icons/ionicons";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withTiming } from "react-native-reanimated";

import { BanishResult } from "@/src/api";
import { makeStyles, radius, spacing, useTheme } from "@/src/theme";

/**
 * One Round Table vote that has already been revealed to everyone, as a chart: a bar per
 * player who got votes, with the people who voted for them as little avatars underneath.
 * It shows that round only — never compares players across rounds.
 */
export function VoteBoard({
  vote,
  title,
  highlight,
  collapsible,
  testID,
}: {
  vote: BanishResult;
  title: string;
  /** Player ids to pick out (the top-voted players). */
  highlight?: string[];
  /** Start with the voters folded away behind a tap. */
  collapsible?: boolean;
  testID: string;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [open, setOpen] = useState(!collapsible);
  const max = Math.max(1, ...vote.tally.map((t) => t.votes));
  const total = vote.tally.reduce((n, t) => n + t.votes, 0);
  const hasBallots = !!vote.votes?.length;
  return (
    <View style={styles.card} testID={testID}>
      <View style={styles.head}>
        <Text style={styles.label}>{title}</Text>
        <Text style={styles.total}>{total} vote{total === 1 ? "" : "s"}</Text>
      </View>
      {vote.tally.map((t, i) => {
        const top = !!highlight?.includes(t.player_id);
        const voters = (vote.votes ?? []).filter((v) => v.target_id === t.player_id);
        return (
          <View key={t.player_id} style={styles.row} testID={`${testID}-row`}>
            <View style={styles.rowHead}>
              <Avatar name={t.name} size={30} on={top} />
              <Text style={[styles.name, top && styles.nameTop]} numberOfLines={1}>{t.name}</Text>
              <Text style={[styles.count, top && { color: colors.brand }]}>{t.votes}</Text>
            </View>
            <Bar pct={t.votes / max} color={top ? colors.brand : colors.borderStrong} delay={i * 90} />
            {open && voters.length ? (
              <View style={styles.voters} testID={`${testID}-voters`}>
                {voters.map((v) => (
                  <View key={v.voter_id} style={styles.voterChip}>
                    <Avatar name={v.voter_name ?? "?"} size={20} />
                    <Text style={styles.voterName} numberOfLines={1}>{v.voter_name}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        );
      })}
      {collapsible && hasBallots ? (
        <Pressable testID={`${testID}-toggle`} onPress={() => setOpen((o) => !o)} style={styles.toggle} hitSlop={6}>
          <Text style={styles.toggleText}>{open ? "Hide who voted for whom" : "Show who voted for whom"}</Text>
          <Ionicons name={open ? "chevron-up" : "chevron-down"} size={16} color={colors.brand} />
        </Pressable>
      ) : null}
    </View>
  );
}

function Bar({ pct, color, delay }: { pct: number; color: string; delay: number }) {
  const styles = useStyles();
  const w = useSharedValue(0);
  useEffect(() => {
    w.value = withDelay(delay, withTiming(pct, { duration: 700, easing: Easing.out(Easing.cubic) }));
  }, [pct, delay, w]);
  const anim = useAnimatedStyle(() => ({ width: `${Math.max(0.04, w.value) * 100}%` }));
  return (
    <View style={styles.track}>
      <Animated.View style={[styles.fill, { backgroundColor: color }, anim]} />
    </View>
  );
}

/** A round initial badge — the same look for everyone (never coloured by role). */
export function Avatar({ name, size = 28, on }: { name: string; size?: number; on?: boolean }) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.avatar,
        { width: size, height: size, borderRadius: size / 2 },
        on && { backgroundColor: colors.brand, borderColor: colors.brand },
      ]}
    >
      <Text style={[styles.avatarText, { fontSize: size * 0.46 }, on && { color: colors.onBrandPrimary }]}>
        {(name || "?").trim().charAt(0).toUpperCase()}
      </Text>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  card: { backgroundColor: c.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md, borderWidth: 1, borderColor: c.border },
  head: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
  label: { color: c.muted, fontSize: 12, letterSpacing: 1.5, textTransform: "uppercase", fontWeight: "700" },
  total: { color: c.muted, fontSize: 13, fontWeight: "600" },
  row: { gap: 6 },
  rowHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  name: { color: c.onSurfaceSecondary, fontSize: 17, flex: 1 },
  nameTop: { color: c.onSurface, fontWeight: "700" },
  count: { color: c.onSurfaceSecondary, fontSize: 20, fontWeight: "800", minWidth: 24, textAlign: "right" },
  track: { height: 14, borderRadius: 7, backgroundColor: c.surfaceTertiary, overflow: "hidden" },
  fill: { height: "100%", borderRadius: 7 },
  voters: { flexDirection: "row", flexWrap: "wrap", gap: 6, paddingLeft: 38 },
  voterChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingLeft: 2,
    paddingRight: 9,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: c.surfaceTertiary,
    borderWidth: 1,
    borderColor: c.border,
  },
  voterName: { color: c.onSurfaceSecondary, fontSize: 14, fontWeight: "600", maxWidth: 110 },
  avatar: { alignItems: "center", justifyContent: "center", backgroundColor: c.surfaceTertiary, borderWidth: 1, borderColor: c.borderStrong },
  avatarText: { color: c.onSurface, fontWeight: "800" },
  toggle: { flexDirection: "row", alignItems: "center", gap: spacing.xs, alignSelf: "flex-start", minHeight: 32 },
  toggleText: { color: c.brand, fontSize: 15, fontWeight: "600" },
}));
