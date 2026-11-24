import Ionicons from "@react-native-vector-icons/ionicons";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { BanishResult } from "@/src/api";
import { makeStyles, radius, spacing, useTheme } from "@/src/theme";

/**
 * A Round Table vote that has already been revealed to everyone: the tally, and who voted
 * for whom. Used during a tie-break revote so the whole table can see the tied first vote.
 * Only ever pass a vote that has already been revealed — never a vote in progress.
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
  /** Player ids to pick out in the tally (the top-voted players in a tie). */
  highlight?: string[];
  /** Start with "who voted for whom" folded away behind a tap. */
  collapsible?: boolean;
  testID: string;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [open, setOpen] = useState(!collapsible);
  const max = Math.max(1, ...vote.tally.map((t) => t.votes));
  return (
    <View style={styles.card} testID={testID}>
      <Text style={styles.label}>{title}</Text>
      {vote.tally.map((t) => {
        const top = highlight?.includes(t.player_id);
        return (
          <View key={t.player_id} style={styles.row}>
            <Text style={[styles.name, top && { color: colors.onSurface, fontWeight: "700" }]} numberOfLines={1}>
              {t.name}
            </Text>
            <View style={styles.track}>
              <View style={[styles.fill, { width: `${(t.votes / max) * 100}%`, backgroundColor: top ? colors.brand : colors.borderStrong }]} />
            </View>
            <Text style={[styles.count, top && { color: colors.brand }]}>{t.votes}</Text>
          </View>
        );
      })}
      {vote.votes && vote.votes.length ? (
        <>
          {collapsible ? (
            <Pressable testID={`${testID}-toggle`} onPress={() => setOpen((v) => !v)} style={styles.toggle} hitSlop={6}>
              <Text style={styles.toggleText}>{open ? "Hide who voted for whom" : "Show who voted for whom"}</Text>
              <Ionicons name={open ? "chevron-up" : "chevron-down"} size={16} color={colors.brand} />
            </Pressable>
          ) : (
            <Text style={[styles.label, { marginTop: spacing.sm }]}>Who voted for whom</Text>
          )}
          {open
            ? vote.votes.map((v) => (
                <View key={v.voter_id} style={styles.ballot} testID={`${testID}-ballot`}>
                  <Text style={styles.voter} numberOfLines={1}>{v.voter_name}</Text>
                  <Ionicons name="arrow-forward" size={14} color={colors.muted} />
                  <Text style={styles.target} numberOfLines={1}>{v.target_name}</Text>
                </View>
              ))
            : null}
        </>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  card: { backgroundColor: c.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.xs, borderWidth: 1, borderColor: c.border },
  label: { color: c.muted, fontSize: 12, letterSpacing: 1.5, textTransform: "uppercase", fontWeight: "700", marginBottom: 2 },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 3 },
  name: { color: c.onSurfaceSecondary, fontSize: 16, width: 92 },
  track: { flex: 1, height: 12, borderRadius: 6, backgroundColor: c.surfaceTertiary, overflow: "hidden" },
  fill: { height: "100%", borderRadius: 6 },
  count: { color: c.onSurfaceSecondary, fontSize: 16, fontWeight: "700", width: 22, textAlign: "right" },
  toggle: { flexDirection: "row", alignItems: "center", gap: spacing.xs, marginTop: spacing.sm, alignSelf: "flex-start", minHeight: 32 },
  toggleText: { color: c.brand, fontSize: 15, fontWeight: "600" },
  ballot: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 2 },
  voter: { color: c.onSurface, fontSize: 16, fontWeight: "600", flex: 1 },
  target: { color: c.onSurfaceSecondary, fontSize: 16, flex: 1, textAlign: "right" },
}));
