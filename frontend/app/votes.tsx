import Ionicons from "@react-native-vector-icons/ionicons";
import { useQuery } from "@tanstack/react-query";
import { ScrollView, Text, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, BanishResult, GameState, roundLabel } from "@/src/api";
import { HoldRole } from "@/src/components/hold-reveal";
import { ScreenHeader } from "@/src/components/screen-header";
import { Body, Eyebrow, Title } from "@/src/components/ui";
import { VoteBoard } from "@/src/components/vote-board";
import { makeStyles, radius, spacing, useTheme } from "@/src/theme";

type Game = Extract<GameState, { exists: true }>;
type Round = { key: string; day: number; label: string; revote: boolean; vote: BanishResult };

// Transparency, not analysis: each revealed Round Table is shown on its own, exactly as it
// happened. Nothing here compares or tallies players across rounds.

/**
 * Every Round Table vote that has been REVEALED, in order. A result still waiting on the
 * reveal screen (phase "banished") is held back so the reveal isn't spoiled; a vote in
 * progress is never in the public state at all.
 */
function revealedRounds(game: Game): { rounds: Round[]; revealing: boolean } {
  const rounds: Round[] = [];
  let revealing = false;
  game.history.forEach((h, i) => {
    const latest = i === game.history.length - 1 && game.phase === "banished";
    if (h.tie_vote) {
      rounds.push({ key: `${h.day}-1`, day: h.day, label: roundLabel(h), revote: false, vote: h.tie_vote });
    }
    if (h.banish) {
      if (latest) {
        revealing = true;
        return;
      }
      rounds.push({ key: `${h.day}-${h.tie_vote ? 2 : 1}`, day: h.day, label: roundLabel(h), revote: !!h.tie_vote, vote: h.banish });
    }
  });
  return { rounds, revealing };
}

export default function Votes() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { data } = useQuery({ queryKey: ["game"], queryFn: api.getGame, refetchInterval: 4000 });
  const game = data?.exists ? data : null;
  const { rounds, revealing } = game ? revealedRounds(game) : { rounds: [], revealing: false };

  return (
    <View style={styles.root} testID="votes-screen">
      <ScreenHeader title="Votes so far" testID="votes" help="history" />
      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.lg }]}>
        <View style={{ gap: spacing.sm }}>
          <Eyebrow>The Round Table record</Eyebrow>
          <Title>Votes so far</Title>
          <Body>Every vote that has been revealed, exactly as it happened — newest first.</Body>
        </View>

        {revealing ? (
          <View style={styles.note} testID="votes-revealing">
            <Ionicons name="mail-outline" size={18} color={colors.onBrandTertiary} />
            <Text style={styles.noteText}>The latest vote is being revealed — it appears here once the game moves on.</Text>
          </View>
        ) : null}

        {rounds.length === 0 ? (
          <Body testID="votes-empty">No votes have been revealed yet. They appear here after each Round Table reveal.</Body>
        ) : (
          [...rounds].reverse().map((r, i) => (
            <Animated.View key={r.key} entering={FadeInDown.delay(Math.min(i, 6) * 60).duration(380)} style={styles.round} testID={`votes-round-${r.key}`}>
              <View style={styles.roundHead}>
                <View style={styles.dayBadge}>
                  <Text style={styles.dayBadgeText}>{r.label}</Text>
                </View>
                {r.revote ? (
                  <View style={styles.revoteBadge}>
                    <Ionicons name="refresh" size={13} color={colors.onBrandTertiary} />
                    <Text style={styles.revoteText}>Revote</Text>
                  </View>
                ) : r.vote.tie && r.vote.revote_ids?.length && r.vote.round !== 2 ? (
                  <View style={styles.revoteBadge}>
                    <Text style={styles.revoteText}>First vote</Text>
                  </View>
                ) : null}
              </View>
              <Outcome b={r.vote} testID={`votes-outcome-${r.key}`} />
              <VoteBoard vote={r.vote} title="The votes" testID={`votes-board-${r.key}`} />
            </Animated.View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

/** The result of one vote. A banished player's allegiance shows only while held. */
function Outcome({ b, testID }: { b: BanishResult; testID: string }) {
  const styles = useStyles();
  const { colors } = useTheme();
  let icon: React.ComponentProps<typeof Ionicons>["name"] = "remove-circle-outline";
  let line: React.ReactNode;
  if (b.tie && b.revote_ids?.length && b.round !== 2) {
    icon = "git-compare-outline";
    line = `Tied — revote between ${(b.revote_names ?? []).filter(Boolean).join(" and ")}`;
  } else if (b.tie || !b.target_id) {
    line = b.round === 2 ? "Tied again — nobody banished" : "Tied — nobody banished";
  } else if (b.already_dead) {
    line = `${b.name} got the most votes (already out)`;
  } else if (b.eliminated) {
    icon = "exit-outline";
    line = (
      <>
        <Text style={styles.outcomeName}>{b.name}</Text> was banished
      </>
    );
  } else {
    line = `${b.name} lost a life`;
  }
  const showRole = !!b.eliminated && !b.already_dead && !b.tie && !!b.target_id;
  return (
    <View style={styles.outcome} testID={testID}>
      <Ionicons name={icon} size={22} color={colors.brand} />
      <View style={{ flex: 1, gap: spacing.xs }}>
        <Text style={styles.outcomeText}>{line}</Text>
        {showRole ? (
          b.role_hidden ? (
            <Text style={styles.secret}>Allegiance kept secret until the end</Text>
          ) : (
            <HoldRole role={b.role} testID={`${testID}-role`} />
          )
        ) : null}
      </View>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  scroll: { padding: spacing.lg, gap: spacing.lg },
  note: { flexDirection: "row", gap: spacing.sm, alignItems: "center", backgroundColor: c.brandTertiary, borderRadius: radius.md, padding: spacing.md },
  noteText: { color: c.onBrandTertiary, fontSize: 15, lineHeight: 21, flex: 1 },
  round: { gap: spacing.sm },
  roundHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  dayBadge: { backgroundColor: c.brandPrimary, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 5 },
  dayBadgeText: { color: c.onBrandPrimary, fontSize: 15, fontWeight: "800", letterSpacing: 0.5 },
  revoteBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: c.brandTertiary,
    borderWidth: 1,
    borderColor: c.brandSecondary,
  },
  revoteText: { color: c.onBrandTertiary, fontSize: 13, fontWeight: "700" },
  outcome: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" },
  outcomeText: { color: c.onSurface, fontSize: 18, lineHeight: 24 },
  outcomeName: { fontWeight: "800" },
  secret: { color: c.muted, fontSize: 14, fontStyle: "italic" },
}));
