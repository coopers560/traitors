import Ionicons from "@react-native-vector-icons/ionicons";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, ScrollView, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, ModeratorView, VoteLogEntry } from "@/src/api";
import { ScreenHeader } from "@/src/components/screen-header";
import { Body, Button, ErrorText, Eyebrow, Title } from "@/src/components/ui";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

// The moderator ("Claudia") god-view. Reached only by a long press on a help
// button, then a passphrase the server checks (never stored in this bundle).
// It reveals every role, so it must never be opened in front of the players.

export default function Moderator() {
  const styles = useStyles();
  const insets = useSafeAreaInsets();

  const [pass, setPass] = useState("");
  const [unlockedPass, setUnlockedPass] = useState<string | null>(null);
  const [codeInput, setCodeInput] = useState("");
  const [code, setCode] = useState<string | null>(null);

  const unlock = useMutation({
    mutationFn: () => api.moderatorUnlock(pass),
    onSuccess: () => setUnlockedPass(pass),
  });

  if (!unlockedPass) {
    return (
      <View style={styles.root} testID="moderator-screen">
        <ScreenHeader title="Moderator" testID="moderator" />
        <KeyboardAwareScrollView bottomOffset={24} keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.lg }]}>
          <View style={styles.lockIcon}>
            <Ionicons name="shield-half" size={40} color="#D4AF37" />
          </View>
          <View style={{ gap: spacing.sm }}>
            <Eyebrow>Hosts only</Eyebrow>
            <Title>The moderator&apos;s view</Title>
            <Body>Enter the moderator passphrase. This view shows every player&apos;s role — never open it where players can see.</Body>
          </View>
          <TextInput
            testID="moderator-pass-input"
            value={pass}
            onChangeText={(t) => { unlock.reset(); setPass(t); }}
            placeholder="Passphrase"
            placeholderTextColor="#8E989E"
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            returnKeyType="go"
            onSubmitEditing={() => pass && unlock.mutate()}
            style={styles.input}
          />
          <ErrorText testID="moderator-pass-error" message={unlock.error ? "That passphrase isn't right." : null} />
          <Button testID="moderator-unlock-button" label="Unlock" icon="lock-open" disabled={!pass} loading={unlock.isPending} onPress={() => unlock.mutate()} />
        </KeyboardAwareScrollView>
      </View>
    );
  }

  if (!code) {
    return (
      <View style={styles.root} testID="moderator-screen">
        <ScreenHeader title="Moderator" testID="moderator" />
        <KeyboardAwareScrollView bottomOffset={24} keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.lg }]}>
          <View style={{ gap: spacing.sm }}>
            <Eyebrow>Unlocked</Eyebrow>
            <Title>Which game?</Title>
            <Body>Enter the 5-character code of the game you want to watch over.</Body>
          </View>
          <TextInput
            testID="moderator-code-input"
            value={codeInput}
            onChangeText={(t) => setCodeInput(t.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 5))}
            placeholder="ABCDE"
            placeholderTextColor="#8E989E"
            autoCapitalize="characters"
            autoCorrect={false}
            autoFocus
            returnKeyType="go"
            onSubmitEditing={() => codeInput.length === 5 && setCode(codeInput)}
            style={[styles.input, styles.codeInput]}
          />
          <Button testID="moderator-reveal-button" label="Reveal everything" icon="eye" disabled={codeInput.length !== 5} onPress={() => setCode(codeInput)} />
        </KeyboardAwareScrollView>
      </View>
    );
  }

  return (
    <Breakdown
      code={code}
      passphrase={unlockedPass}
      onChangeGame={() => { setCode(null); setCodeInput(""); }}
      onLock={() => { setUnlockedPass(null); setPass(""); setCode(null); setCodeInput(""); }}
    />
  );
}

function Breakdown({ code, passphrase, onChangeGame, onLock }: { code: string; passphrase: string; onChangeGame: () => void; onLock: () => void }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const { data, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: ["moderator", code],
    queryFn: () => api.moderatorView(code, passphrase),
    refetchInterval: 4000,
    retry: false,
  });

  if (isLoading) {
    return (
      <View style={[styles.root, styles.center]} testID="moderator-screen">
        <ActivityIndicator color={colors.brand} size="large" />
      </View>
    );
  }
  if (error || !data) {
    return (
      <View style={styles.root} testID="moderator-screen">
        <ScreenHeader title="Moderator" testID="moderator" />
        <View style={[styles.scroll, { gap: spacing.md }]}>
          <ErrorText testID="moderator-view-error" message={`No game found with the code ${code}. Check the letters and try again.`} />
          <Button testID="moderator-change-game-button" label="Try another code" icon="arrow-back" onPress={onChangeGame} />
        </View>
      </View>
    );
  }

  const m: ModeratorView = data;
  const traitors = m.players.filter((p) => p.role === "traitor");
  const faithful = m.players.filter((p) => p.role === "faithful");
  const voteByDay = new Map<number, VoteLogEntry>(m.vote_log.map((v) => [v.day, v]));
  const eyebrow = m.phase === "ended" ? "Game over" : m.phase === "setup" ? "Before Day 1" : `Day ${m.day} of ${m.total_days}`;

  return (
    <View style={styles.root} testID="moderator-screen">
      <View style={[styles.topbar, { paddingTop: insets.top + spacing.sm }]}>
        <Ionicons name="shield-half" size={20} color="#D4AF37" />
        <Text style={styles.topbarText}>Moderator · game {m.code}</Text>
        <Text style={styles.live}>{isRefetching ? "…" : "● live"}</Text>
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.lg }]}>
        <View style={styles.warn} testID="moderator-warn">
          <Ionicons name="eye-off" size={16} color={colors.onWarning} />
          <Text style={styles.warnText}>Every role is shown. Keep this screen to yourself.</Text>
        </View>

        {/* Stage */}
        <View style={styles.stageCard}>
          <Eyebrow>{eyebrow}</Eyebrow>
          <Text style={styles.stageTitle} testID="moderator-stage">{m.stage}</Text>
          {m.endgame && m.phase !== "ended" ? <Text style={styles.endgameTag}>⚑ Endgame — banish-or-end votes</Text> : null}
          {m.winner ? (
            <Text style={[styles.winner, { color: m.winner === "traitors" ? colors.traitor : colors.brand }]} testID="moderator-winner">
              {m.winner === "traitors" ? "The Traitors win" : "The Faithful win"}
            </Text>
          ) : null}
          {m.next_step ? (
            <View style={styles.nextStep}>
              <Ionicons name="arrow-forward-circle" size={18} color={colors.brand} />
              <Text style={styles.nextStepText}>Next: {m.next_step}</Text>
            </View>
          ) : null}
          <View style={styles.countRow}>
            <Count label="Still in" value={m.counts.alive} color={colors.onSurface} />
            <Count label="Traitors" value={m.counts.traitors_alive} color={colors.traitor} />
            <Count label="Faithful" value={m.counts.faithful_alive} color={colors.brand} />
            <Count label="Out" value={m.counts.out} color={colors.muted} />
          </View>
        </View>

        {/* Win tracker */}
        <View style={styles.winCard} testID="moderator-win-note">
          <Text style={styles.cardLabel}>The race to win</Text>
          <Text style={styles.winText}>{m.win_note}</Text>
        </View>

        {/* Where it's up to — only while turns are actually being taken */}
        {["setup", "roundtable", "night"].includes(m.phase) ? (
          <View style={styles.card} testID="moderator-progress">
            <Text style={styles.cardLabel}>Where it&apos;s up to</Text>
            <Text style={styles.progressText}>
              {m.turns_done} of {m.turns_needed} have taken their turn
            </Text>
            {m.outstanding.length ? (
              <Text style={styles.waiting}>Waiting on: {m.outstanding.join(", ")}</Text>
            ) : (
              <Text style={styles.ready}>Everyone done — ready to advance.</Text>
            )}
          </View>
        ) : null}

        {/* Live Round Table */}
        {m.round_table ? (
          <View style={styles.card} testID="moderator-votes">
            <Text style={styles.cardLabel}>Round Table — live</Text>
            {m.round_table.tally.length === 0 && m.round_table.end_votes.length === 0 ? (
              <Text style={styles.planText}>No votes cast yet.</Text>
            ) : (
              <View style={{ gap: spacing.sm }}>
                {m.round_table.tally.map((t) => (
                  <VoteBar key={t.target_id} name={t.name ?? "?"} votes={t.votes} max={m.counts.alive} />
                ))}
                {m.round_table.end_votes.length ? (
                  <Text style={styles.endVote}>End-the-game votes: {m.round_table.end_votes.join(", ")}</Text>
                ) : null}
              </View>
            )}
            {m.round_table.votes.length ? (
              <View style={styles.ballots}>
                <Text style={styles.ballotLabel}>Who voted for whom</Text>
                {m.round_table.votes.map((v) => (
                  <View key={v.voter_id} style={styles.voteRow}>
                    <Text style={styles.voteName}>{v.voter_name}</Text>
                    <Ionicons name="arrow-forward" size={13} color={colors.muted} />
                    <Text style={styles.voteTarget}>{v.target_name}</Text>
                  </View>
                ))}
              </View>
            ) : null}
            {m.round_table.not_voted.length ? (
              <Text style={styles.notVoted}>Yet to vote: {m.round_table.not_voted.join(", ")}</Text>
            ) : null}
          </View>
        ) : null}

        {/* Tonight's plan */}
        {m.tonight ? (
          <View style={[styles.card, { borderColor: colors.traitor }]} testID="moderator-tonight">
            <Text style={[styles.cardLabel, { color: colors.traitor }]}>Tonight&apos;s plan</Text>
            {m.tonight.recruit_name ? (
              <Text style={styles.planText}>
                Recruiting <Text style={styles.planName}>{m.tonight.recruit_name}</Text> — no murder.
              </Text>
            ) : m.tonight.victim_name ? (
              <>
                <Text style={styles.planText}>
                  Victim: <Text style={styles.planName}>{m.tonight.victim_name}</Text>
                </Text>
                <Text style={styles.planText}>
                  Method: <Text style={styles.planMethod}>{m.tonight.action ?? "not chosen yet"}</Text>
                </Text>
                <Text style={styles.planStatus}>{m.tonight.murder_confirmed ? "✓ Murder sealed" : "Not yet sealed"}</Text>
              </>
            ) : (
              <Text style={styles.planText}>No victim chosen yet.</Text>
            )}
          </View>
        ) : null}

        {/* Roster */}
        <Text style={styles.sectionTitle}>Traitors ({traitors.length})</Text>
        {traitors.map((p) => <PlayerRow key={p.id} p={p} />)}
        <Text style={[styles.sectionTitle, { marginTop: spacing.md }]}>Faithful ({faithful.length})</Text>
        {faithful.map((p) => <PlayerRow key={p.id} p={p} />)}

        {/* Day-by-day timeline */}
        {m.history.length ? (
          <>
            <Text style={[styles.sectionTitle, { marginTop: spacing.md }]}>Day by day</Text>
            {m.history.map((h) => <DayCard key={h.day} h={h} votes={voteByDay.get(h.day)} />)}
          </>
        ) : null}

        <View style={{ gap: spacing.sm, marginTop: spacing.lg }}>
          <Button testID="moderator-refresh-button" label="Refresh now" variant="secondary" icon="refresh" onPress={() => refetch()} />
          <Button testID="moderator-change-game-button" label="Watch another game" variant="ghost" icon="swap-horizontal" onPress={onChangeGame} />
          <Button testID="moderator-lock-button" label="Lock and leave" variant="ghost" icon="lock-closed" onPress={() => { onLock(); router.back(); }} />
        </View>
      </ScrollView>
    </View>
  );
}

function Count({ label, value, color }: { label: string; value: number; color: string }) {
  const styles = useStyles();
  return (
    <View style={styles.count}>
      <Text style={[styles.countValue, { color }]}>{value}</Text>
      <Text style={styles.countLabel}>{label}</Text>
    </View>
  );
}

function VoteBar({ name, votes, max }: { name: string; votes: number; max: number }) {
  const styles = useStyles();
  const pct = max > 0 ? Math.max(8, (votes / max) * 100) : 8;
  return (
    <View style={styles.barRow}>
      <Text style={styles.barName} numberOfLines={1}>{name}</Text>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${pct}%` }]} />
      </View>
      <Text style={styles.barCount}>{votes}</Text>
    </View>
  );
}

function PlayerRow({ p }: { p: ModeratorView["players"][number] }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const traitor = p.role === "traitor";
  return (
    <View style={[styles.playerRow, !p.alive && styles.playerOut]} testID={`moderator-player-${p.id}`}>
      <View style={[styles.badge, { backgroundColor: traitor ? colors.traitor : colors.brandTertiary }]}>
        <Ionicons name={traitor ? "skull" : "shield-checkmark"} size={16} color={traitor ? "#FFFFFF" : colors.brand} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[styles.playerName, !p.alive && styles.struck]} numberOfLines={1}>
          {p.name}{p.is_host ? " · host" : ""}
        </Text>
        <Text style={[styles.playerRole, { color: traitor ? colors.traitor : colors.brand }]}>
          {traitor ? "Traitor" : "Faithful"} · {p.alive ? "in the game" : "out"}
        </Text>
      </View>
      <Ionicons
        name={p.turn_done ? "checkmark-circle" : "ellipse-outline"}
        size={22}
        color={p.turn_done ? colors.brand : colors.borderStrong}
      />
    </View>
  );
}

function DayCard({ h, votes }: { h: ModeratorView["history"][number]; votes?: VoteLogEntry }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const b = h.banish;
  const mu = h.murder;
  const roleText = (r?: string | null) => (r === "traitor" ? "a Traitor" : "Faithful");

  return (
    <View style={styles.dayCard} testID={`moderator-day-${h.day}`}>
      <Text style={styles.dayHead}>Day {h.day}</Text>

      {h.ended_by_vote ? <Text style={styles.dayLine}>The players voted to end the game.</Text> : null}

      {/* Round Table */}
      {b ? (
        <View style={styles.daySection}>
          <View style={styles.dayRow}>
            <Ionicons name="flame" size={15} color={colors.brand} />
            <Text style={styles.dayLabel}>Round Table</Text>
          </View>
          <Text style={styles.dayLine}>
            {b.tie || !b.target_id
              ? "Tied — nobody banished."
              : b.already_dead
                ? `${b.name} got the most votes (already out).`
                : b.eliminated
                  ? `${b.name} was banished — ${b.role_hidden ? "allegiance kept secret" : roleText(b.role)}.`
                  : `${b.name} lost a life.`}
          </Text>
          {b.tally?.length ? (
            <Text style={styles.dayTally}>{b.tally.map((t) => `${t.name} ${t.votes}`).join("  ·  ")}</Text>
          ) : null}
          {votes && votes.votes.length ? (
            <View style={styles.ballots}>
              {votes.votes.map((v) => (
                <View key={v.voter_id} style={styles.voteRow}>
                  <Text style={styles.voteNameSm}>{v.voter_name}</Text>
                  <Ionicons name="arrow-forward" size={12} color={colors.muted} />
                  <Text style={styles.voteTargetSm}>{v.target_name}</Text>
                </View>
              ))}
            </View>
          ) : null}
          {votes && votes.end_votes.length ? <Text style={styles.dayTally}>Voted to end: {votes.end_votes.join(", ")}</Text> : null}
        </View>
      ) : null}

      {/* Night */}
      {mu ? (
        <View style={styles.daySection}>
          <View style={styles.dayRow}>
            <Ionicons name="moon" size={15} color={colors.traitor} />
            <Text style={styles.dayLabel}>Night</Text>
          </View>
          {mu.success ? (
            <Text style={styles.dayLine}>
              {mu.victim_name} was murdered{mu.action ? ` — ${mu.action}` : ""}.
            </Text>
          ) : h.recruited ? (
            <Text style={styles.dayLine}>No murder — a Faithful was recruited into the Traitors.</Text>
          ) : (
            <Text style={styles.dayLine}>No murder.</Text>
          )}
        </View>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  center: { alignItems: "center", justifyContent: "center" },
  scroll: { padding: spacing.lg, gap: spacing.md },
  lockIcon: { alignSelf: "center", width: 80, height: 80, borderRadius: 40, alignItems: "center", justifyContent: "center", backgroundColor: c.surfaceSecondary, borderWidth: 1, borderColor: c.brandSecondary, marginBottom: spacing.sm },
  input: {
    height: 64,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.surfaceSecondary,
    color: c.onSurface,
    fontSize: 20,
    paddingHorizontal: spacing.md,
  },
  codeInput: { fontSize: 36, fontWeight: "700", letterSpacing: 10, textAlign: "center", color: c.brand, borderColor: c.brandSecondary, height: 80 },
  topbar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    backgroundColor: "#1A1206",
    borderBottomWidth: 1,
    borderBottomColor: c.brandSecondary,
  },
  topbarText: { color: "#D4AF37", fontSize: 15, fontWeight: "700", flex: 1 },
  live: { color: c.traitor, fontSize: 12, fontWeight: "700" },
  warn: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: c.warning, borderRadius: radius.md, padding: spacing.sm },
  warnText: { color: c.onWarning, fontSize: 13, fontWeight: "600", flex: 1 },
  stageCard: { backgroundColor: c.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm, borderWidth: 1, borderColor: c.brandSecondary },
  stageTitle: { fontFamily: fonts.display, fontSize: 30, lineHeight: 34, color: c.onSurface },
  endgameTag: { color: c.traitor, fontSize: 14, fontWeight: "700" },
  winner: { fontFamily: fonts.display, fontSize: 34, lineHeight: 38 },
  nextStep: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: c.brandTertiary, borderRadius: radius.md, padding: spacing.sm },
  nextStepText: { color: c.onBrandTertiary, fontSize: 15, fontWeight: "600", flex: 1 },
  countRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.xs },
  count: { flex: 1, backgroundColor: c.surfaceTertiary, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: "center" },
  countValue: { fontFamily: fonts.display, fontSize: 30, lineHeight: 32 },
  countLabel: { color: c.muted, fontSize: 11, letterSpacing: 1, textTransform: "uppercase", fontWeight: "600" },
  winCard: { backgroundColor: c.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.xs, borderWidth: 1, borderColor: c.border },
  winText: { color: c.onSurfaceSecondary, fontSize: 16, lineHeight: 23 },
  card: { backgroundColor: c.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.xs, borderWidth: 1, borderColor: c.border },
  cardLabel: { color: c.muted, fontSize: 12, letterSpacing: 2, textTransform: "uppercase", fontWeight: "700", marginBottom: spacing.xs },
  progressText: { color: c.onSurface, fontSize: 18, fontWeight: "600" },
  waiting: { color: c.onSurfaceTertiary, fontSize: 15, lineHeight: 21 },
  ready: { color: c.brand, fontSize: 15, fontWeight: "600" },
  barRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  barName: { color: c.onSurface, fontSize: 15, fontWeight: "600", width: 84 },
  barTrack: { flex: 1, height: 18, borderRadius: radius.sm, backgroundColor: c.surfaceTertiary, overflow: "hidden" },
  barFill: { height: 18, borderRadius: radius.sm, backgroundColor: c.brand },
  barCount: { color: c.brand, fontSize: 15, fontWeight: "700", width: 20, textAlign: "right" },
  endVote: { color: c.onSurfaceTertiary, fontSize: 14, marginTop: spacing.xs },
  ballots: { marginTop: spacing.sm, gap: 2, borderTopWidth: 1, borderTopColor: c.divider, paddingTop: spacing.sm },
  ballotLabel: { color: c.muted, fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase", fontWeight: "600", marginBottom: 2 },
  notVoted: { color: c.onSurfaceTertiary, fontSize: 14, marginTop: spacing.sm },
  planText: { color: c.onSurfaceSecondary, fontSize: 17, lineHeight: 24 },
  planName: { color: c.onSurface, fontWeight: "700" },
  planMethod: { color: c.brand, fontWeight: "700" },
  planStatus: { color: c.muted, fontSize: 14, marginTop: 2 },
  voteRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 3 },
  voteName: { color: c.onSurface, fontSize: 16, fontWeight: "600" },
  voteTarget: { color: c.onSurfaceSecondary, fontSize: 16 },
  voteNameSm: { color: c.onSurface, fontSize: 14, fontWeight: "600" },
  voteTargetSm: { color: c.onSurfaceSecondary, fontSize: 14 },
  sectionTitle: { color: c.muted, fontSize: 13, letterSpacing: 2, textTransform: "uppercase", fontWeight: "700" },
  playerRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: c.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: c.border },
  playerOut: { opacity: 0.55 },
  badge: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  playerName: { color: c.onSurface, fontSize: 18, fontWeight: "700" },
  struck: { textDecorationLine: "line-through", color: c.muted },
  playerRole: { fontSize: 13, fontWeight: "700", letterSpacing: 0.5, marginTop: 1 },
  dayCard: { backgroundColor: c.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm, borderWidth: 1, borderColor: c.border },
  dayHead: { color: c.brand, fontSize: 16, fontWeight: "800", letterSpacing: 0.5 },
  daySection: { gap: 2 },
  dayRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  dayLabel: { color: c.muted, fontSize: 11, letterSpacing: 2, textTransform: "uppercase", fontWeight: "700" },
  dayLine: { color: c.onSurface, fontSize: 16, lineHeight: 23, fontWeight: "600" },
  dayTally: { color: c.onSurfaceTertiary, fontSize: 14, lineHeight: 20 },
}));
