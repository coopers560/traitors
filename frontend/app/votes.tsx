import Ionicons from "@react-native-vector-icons/ionicons";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, BanishResult, GameState } from "@/src/api";
import { ScreenHeader } from "@/src/components/screen-header";
import { Body, Eyebrow, Title } from "@/src/components/ui";
import { VoteBoard } from "@/src/components/vote-board";
import { makeStyles, radius, spacing, useTheme } from "@/src/theme";

type Game = Extract<GameState, { exists: true }>;
type Round = { key: string; day: number; label: string; vote: BanishResult; result: string };

/**
 * Every Round Table vote that has been REVEALED, in order. A result still waiting to be
 * opened on the reveal screen (phase "banished") is left out so the reveal isn't spoiled;
 * a vote in progress is never in the public state at all.
 */
function revealedRounds(game: Game): { rounds: Round[]; revealing: boolean } {
  const rounds: Round[] = [];
  let revealing = false;
  game.history.forEach((h, i) => {
    const latest = i === game.history.length - 1 && game.phase === "banished";
    if (h.tie_vote) {
      rounds.push({ key: `${h.day}-1`, day: h.day, label: `Day ${h.day} · first vote`, vote: h.tie_vote, result: "Tied — so everyone voted again" });
    }
    if (h.banish) {
      if (latest) {
        revealing = true;
        return;
      }
      const firstOfRevote = h.banish.tie && !!h.banish.revote_ids?.length && h.banish.round !== 2;
      const label = h.tie_vote ? `Day ${h.day} · revote` : firstOfRevote ? `Day ${h.day} · first vote` : `Day ${h.day}`;
      rounds.push({ key: `${h.day}-${h.tie_vote ? 2 : 1}`, day: h.day, label, vote: h.banish, result: resultText(h.banish) });
    }
  });
  return { rounds, revealing };
}

function resultText(b: BanishResult): string {
  if (b.tie && b.revote_ids?.length && b.round !== 2) {
    return `Tied — revote between ${(b.revote_names ?? []).filter(Boolean).join(" and ")}`;
  }
  if (b.tie || !b.target_id) return b.round === 2 ? "Tied again — nobody banished" : "Tied — nobody banished";
  if (b.already_dead) return `${b.name} got the most votes (already out)`;
  if (b.eliminated) {
    return `${b.name} was banished — ${b.role_hidden ? "allegiance kept secret" : b.role === "traitor" ? "a Traitor" : "Faithful"}`;
  }
  return `${b.name} lost a life`;
}

const topIds = (b: BanishResult) => {
  const top = b.tally[0]?.votes ?? 0;
  return b.tally.filter((t) => t.votes === top).map((t) => t.player_id);
};

export default function Votes() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { data } = useQuery({ queryKey: ["game"], queryFn: api.getGame, refetchInterval: 4000 });
  const [view, setView] = useState<"rounds" | "players">("rounds");
  const game = data?.exists ? data : null;
  const { rounds, revealing } = game ? revealedRounds(game) : { rounds: [], revealing: false };
  // While a banishment is waiting to be revealed, don't let an "out" tag give it away.
  const last = game?.history.length ? game.history[game.history.length - 1] : null;
  const unrevealedOut = revealing && last?.banish?.eliminated ? last.banish.target_id : null;

  return (
    <View style={styles.root} testID="votes-screen">
      <ScreenHeader title="Votes so far" testID="votes" help="history" />
      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.lg }]}>
        <View style={{ gap: spacing.sm }}>
          <Eyebrow>The Round Table record</Eyebrow>
          <Title>Votes so far</Title>
          <Body>Every vote that has been revealed — round by round, or player by player. Who keeps voting together?</Body>
        </View>

        <View style={styles.tabs}>
          <Tab label="By Round Table" icon="flame-outline" on={view === "rounds"} onPress={() => setView("rounds")} testID="votes-tab-rounds" />
          <Tab label="By player" icon="people-outline" on={view === "players"} onPress={() => setView("players")} testID="votes-tab-players" />
        </View>

        {revealing ? (
          <View style={styles.note} testID="votes-revealing">
            <Ionicons name="mail-outline" size={18} color={colors.onBrandTertiary} />
            <Text style={styles.noteText}>The latest vote is being revealed — it appears here once the game moves on.</Text>
          </View>
        ) : null}

        {rounds.length === 0 ? (
          <Body testID="votes-empty">No votes have been revealed yet. They appear here after each Round Table reveal.</Body>
        ) : view === "rounds" ? (
          [...rounds].reverse().map((r, i) => (
            <Animated.View key={r.key} entering={FadeInDown.delay(Math.min(i, 6) * 50).duration(350)} style={{ gap: spacing.sm }} testID={`votes-round-${r.key}`}>
              <View style={styles.roundHead}>
                <Text style={styles.roundLabel}>{r.label}</Text>
                <Text style={styles.roundResult}>{r.result}</Text>
              </View>
              <VoteBoard vote={r.vote} title="The votes" highlight={topIds(r.vote)} collapsible={i > 0} testID={`votes-board-${r.key}`} />
            </Animated.View>
          ))
        ) : (
          game?.players.map((p) => <PlayerRecord key={p.id} name={p.name} alive={p.alive || p.id === unrevealedOut} playerId={p.id} rounds={rounds} />)
        )}
      </ScrollView>
    </View>
  );
}

function Tab({ label, icon, on, onPress, testID }: { label: string; icon: React.ComponentProps<typeof Ionicons>["name"]; on: boolean; onPress: () => void; testID: string }) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <Pressable testID={testID} onPress={onPress} style={[styles.tab, on && styles.tabOn]} accessibilityRole="tab" accessibilityState={{ selected: on }}>
      <Ionicons name={icon} size={18} color={on ? colors.onBrandPrimary : colors.brand} />
      <Text style={[styles.tabText, on && { color: colors.onBrandPrimary }]}>{label}</Text>
    </Pressable>
  );
}

function PlayerRecord({ name, alive, playerId, rounds }: { name: string; alive: boolean; playerId: string; rounds: Round[] }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const cast = rounds.map((r) => ({ r, v: r.vote.votes?.find((v) => v.voter_id === playerId) })).filter((x) => x.v);
  const against = rounds.reduce((n, r) => n + (r.vote.votes?.filter((v) => v.target_id === playerId).length ?? 0), 0);
  return (
    <View style={styles.player} testID={`votes-player-${playerId}`}>
      <View style={styles.playerHead}>
        <Text style={[styles.playerName, !alive && { color: colors.muted }]}>{name}</Text>
        {!alive ? <Text style={styles.outTag}>out</Text> : null}
        <View style={{ flex: 1 }} />
        <Text style={styles.against} testID={`votes-player-${playerId}-against`}>
          {against} vote{against === 1 ? "" : "s"} against
        </Text>
      </View>
      {cast.length ? (
        cast.map(({ r, v }) => (
          <View key={r.key} style={styles.castRow}>
            <Text style={styles.castLabel}>{r.label}</Text>
            <Ionicons name="arrow-forward" size={14} color={colors.muted} />
            <Text style={styles.castTarget} numberOfLines={1}>{v!.target_name}</Text>
          </View>
        ))
      ) : (
        <Text style={styles.castLabel}>No votes cast yet.</Text>
      )}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  scroll: { padding: spacing.lg, gap: spacing.md },
  tabs: { flexDirection: "row", gap: spacing.sm },
  tab: {
    flex: 1,
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: c.brandSecondary,
  },
  tabOn: { backgroundColor: c.brandPrimary, borderColor: c.brandPrimary },
  tabText: { color: c.brand, fontSize: 15, fontWeight: "700" },
  note: { flexDirection: "row", gap: spacing.sm, alignItems: "center", backgroundColor: c.brandTertiary, borderRadius: radius.md, padding: spacing.md },
  noteText: { color: c.onBrandTertiary, fontSize: 15, lineHeight: 21, flex: 1 },
  roundHead: { gap: 2, marginTop: spacing.sm },
  roundLabel: { color: c.brand, fontSize: 20, fontWeight: "700" },
  roundResult: { color: c.onSurface, fontSize: 16, lineHeight: 22 },
  player: { backgroundColor: c.surfaceSecondary, borderRadius: radius.lg, padding: spacing.md, gap: 4, borderWidth: 1, borderColor: c.border },
  playerHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: 2 },
  playerName: { color: c.onSurface, fontSize: 18, fontWeight: "700" },
  outTag: { color: c.muted, fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1 },
  against: { color: c.onSurfaceTertiary, fontSize: 14, fontWeight: "600" },
  castRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 1 },
  castLabel: { color: c.muted, fontSize: 15, width: 150 },
  castTarget: { color: c.onSurface, fontSize: 16, flex: 1, textAlign: "right" },
}));
