import Ionicons from "@react-native-vector-icons/ionicons";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { BanishResult } from "@/src/api";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

/**
 * The result of one Round Table vote that has already been revealed to everyone: the
 * most-voted player(s) as big tiles, everyone else who got votes as small chips, and the
 * individual ballots behind a tap (listed by voter, never grouped). One round only.
 */
export function VoteBoard({
  vote,
  title,
  collapsible = true,
  testID,
}: {
  vote: BanishResult;
  title: string;
  /** Hide the individual ballots behind a tap (default). */
  collapsible?: boolean;
  /** Kept for older call sites; the top-voted players are always picked out. */
  highlight?: string[];
  testID: string;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [open, setOpen] = useState(!collapsible);
  const topVotes = vote.tally[0]?.votes ?? 0;
  const top = vote.tally.filter((t) => t.votes === topVotes && topVotes > 0);
  const rest = vote.tally.filter((t) => !top.includes(t));
  const total = vote.tally.reduce((n, t) => n + t.votes, 0);
  const ballots = [...(vote.votes ?? [])].sort((a, b) => (a.voter_name ?? "").localeCompare(b.voter_name ?? ""));
  const plural = (n: number) => `${n} vote${n === 1 ? "" : "s"}`;

  return (
    <View style={styles.card} testID={testID}>
      <View style={styles.head}>
        <Text style={[styles.label, { flex: 1 }]}>{title}</Text>
        <Text style={styles.total}>{plural(total)}</Text>
      </View>

      {top.length > 1 ? <Text style={styles.tied}>Tied on {plural(topVotes)}</Text> : null}
      <View style={styles.tiles}>
        {top.map((t) => (
          <View key={t.player_id} style={styles.tile} testID={`${testID}-top`}>
            <Text style={styles.tileName} numberOfLines={1}>{t.name}</Text>
            <View style={styles.tileCountRow}>
              <Text style={styles.tileCount}>{t.votes}</Text>
              <Text style={styles.tileUnit}>vote{t.votes === 1 ? "" : "s"}</Text>
            </View>
          </View>
        ))}
      </View>

      {rest.length ? (
        <View style={styles.chips}>
          {rest.map((t) => (
            <View key={t.player_id} style={styles.chip} testID={`${testID}-rest`}>
              <Text style={styles.chipName} numberOfLines={1}>{t.name}</Text>
              <Text style={styles.chipCount}>{t.votes}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {ballots.length ? (
        <>
          {collapsible ? (
            <Pressable testID={`${testID}-toggle`} onPress={() => setOpen((o) => !o)} style={styles.toggle} hitSlop={6}>
              <Text style={styles.toggleText}>{open ? "Hide who voted for whom" : "Show who voted for whom"}</Text>
              <Ionicons name={open ? "chevron-up" : "chevron-down"} size={16} color={colors.brand} />
            </Pressable>
          ) : (
            <Text style={styles.label}>Who voted for whom</Text>
          )}
          {open ? (
            <View style={styles.ballots}>
              {ballots.map((v) => (
                <View key={v.voter_id} style={styles.ballot} testID={`${testID}-ballot`}>
                  <Text style={styles.voter} numberOfLines={1}>{v.voter_name}</Text>
                  <Ionicons name="arrow-forward" size={14} color={colors.muted} />
                  <Text style={styles.target} numberOfLines={1}>{v.target_name}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  card: { backgroundColor: c.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md, borderWidth: 1, borderColor: c.border },
  head: { flexDirection: "row", alignItems: "baseline", gap: spacing.sm },
  label: { color: c.muted, fontSize: 12, letterSpacing: 1.5, textTransform: "uppercase", fontWeight: "700" },
  total: { color: c.muted, fontSize: 13, fontWeight: "600" },
  tied: { color: c.brand, fontSize: 14, fontWeight: "700", marginBottom: -spacing.xs },
  tiles: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  tile: {
    flexGrow: 1,
    flexBasis: "45%",
    minWidth: 0,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: c.brand,
    backgroundColor: c.brandTertiary,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    alignItems: "center",
    gap: 2,
  },
  tileName: { fontFamily: fonts.display, fontSize: 30, lineHeight: 34, color: c.onSurface },
  tileCountRow: { flexDirection: "row", alignItems: "baseline", gap: 5 },
  tileCount: { color: c.brand, fontSize: 30, fontWeight: "800" },
  tileUnit: { color: c.onBrandTertiary, fontSize: 15, fontWeight: "600" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingLeft: 12,
    paddingRight: 4,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: c.surfaceTertiary,
    borderWidth: 1,
    borderColor: c.border,
  },
  chipName: { color: c.onSurfaceSecondary, fontSize: 16, fontWeight: "600", maxWidth: 140 },
  chipCount: {
    color: c.onSurface,
    fontSize: 14,
    fontWeight: "800",
    minWidth: 26,
    textAlign: "center",
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: c.surfaceSecondary,
    overflow: "hidden",
  },
  toggle: { flexDirection: "row", alignItems: "center", gap: spacing.xs, alignSelf: "flex-start", minHeight: 32 },
  toggleText: { color: c.brand, fontSize: 15, fontWeight: "600" },
  ballots: { gap: 4, marginTop: -spacing.xs },
  ballot: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 2 },
  voter: { color: c.onSurface, fontSize: 16, fontWeight: "600", flex: 1 },
  target: { color: c.onSurfaceSecondary, fontSize: 16, flex: 1, textAlign: "right" },
}));
