import Ionicons from "@react-native-vector-icons/ionicons";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
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
    return <PickGame passphrase={unlockedPass} codeInput={codeInput} setCodeInput={setCodeInput} onPick={setCode} />;
  }

  return (
    <Breakdown
      key={code}
      code={code}
      passphrase={unlockedPass}
      onChangeGame={() => { setCode(null); setCodeInput(""); }}
      onLock={() => { setUnlockedPass(null); setPass(""); setCode(null); setCodeInput(""); }}
    />
  );
}

function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function PickGame({ passphrase, codeInput, setCodeInput, onPick }: { passphrase: string; codeInput: string; setCodeInput: (s: string) => void; onPick: (c: string) => void }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["moderator-games"],
    queryFn: () => api.moderatorGames(passphrase),
    refetchInterval: 8000, // keep the live list fresh
  });
  const games = data?.games ?? [];
  const live = games.filter((g) => g.live);
  const ended = games.filter((g) => !g.live).slice(0, 8);

  return (
    <View style={styles.root} testID="moderator-screen">
      <ScreenHeader title="Moderator" testID="moderator" />
      <KeyboardAwareScrollView bottomOffset={24} keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.lg }]}>
        <View style={{ gap: spacing.sm }}>
          <Eyebrow>Unlocked</Eyebrow>
          <Title>Which game?</Title>
          <Body>Tap a live game below, or enter a 5-character code.</Body>
        </View>

        <View style={styles.listHead}>
          <Text style={styles.listHeadText}>{isLoading ? "Loading games…" : live.length ? "Live games — most recent first" : "No live games right now"}</Text>
          <Pressable testID="moderator-games-refresh" onPress={() => refetch()} hitSlop={8}>
            <Ionicons name="refresh" size={18} color={isRefetching ? colors.muted : colors.brand} />
          </Pressable>
        </View>

        {live.map((g) => <GameRow key={g.code} g={g} onPick={onPick} />)}

        {ended.length ? (
          <>
            <Text style={[styles.listHeadText, { marginTop: spacing.sm }]}>Recently finished</Text>
            {ended.map((g) => <GameRow key={g.code} g={g} onPick={onPick} />)}
          </>
        ) : null}

        <View style={styles.orRow}><View style={styles.orLine} /><Text style={styles.orText}>or enter a code</Text><View style={styles.orLine} /></View>
        <TextInput
          testID="moderator-code-input"
          value={codeInput}
          onChangeText={(t) => setCodeInput(t.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 5))}
          placeholder="ABCDE"
          placeholderTextColor="#8E989E"
          autoCapitalize="characters"
          autoCorrect={false}
          returnKeyType="go"
          onSubmitEditing={() => codeInput.length === 5 && onPick(codeInput)}
          style={[styles.input, styles.codeInput]}
        />
        <Button testID="moderator-reveal-button" label="Reveal everything" icon="eye" disabled={codeInput.length !== 5} onPress={() => onPick(codeInput)} />
      </KeyboardAwareScrollView>
    </View>
  );
}

const SHORT_PHASE: Record<string, string> = {
  setup: "Before Day 1",
  day: "Daytime",
  roundtable: "Round Table",
  banished: "Banishment",
  night: "Night",
  reveal: "Morning reveal",
  ended: "Finished",
};

function GameRow({ g, onPick }: { g: import("@/src/api").ModeratorGame; onPick: (c: string) => void }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const sub = g.winner
    ? g.winner === "traitors" ? "Traitors won" : "Faithful won"
    : g.phase === "setup" ? "Before Day 1" : `Day ${g.day} · ${SHORT_PHASE[g.phase] ?? g.phase}`;
  return (
    <Pressable testID={`moderator-game-${g.code}`} onPress={() => onPick(g.code)} style={({ pressed }) => [styles.gameRow, pressed && { backgroundColor: colors.surfaceTertiary }]}>
      <View style={[styles.gameDot, { backgroundColor: g.live ? "#3E6950" : colors.border }]}>
        <Ionicons name={g.live ? "ellipse" : "flag"} size={g.live ? 10 : 14} color={g.live ? "#7FDFA6" : colors.muted} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.gameCode}>{g.code}</Text>
        <Text style={styles.gameSub} numberOfLines={1}>{sub}</Text>
      </View>
      <View style={{ alignItems: "flex-end", gap: 1 }}>
        <Text style={styles.gameTime}>{timeAgo(g.updated_at)}</Text>
        <Text style={styles.gameInCount}>{g.alive}/{g.players} in</Text>
        <Ionicons name="chevron-forward" size={18} color={colors.borderStrong} />
      </View>
    </Pressable>
  );
}

function Breakdown({ code, passphrase, onChangeGame, onLock }: { code: string; passphrase: string; onChangeGame: () => void; onLock: () => void }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  // Roles start hidden so you can follow the game without being spoiled; tap to unmask.
  const [rolesShown, setRolesShown] = useState(false);
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
          <Text style={styles.warnText}>
            {rolesShown ? "Roles are showing. Keep this screen to yourself." : "Roles are hidden. You can follow the game without being spoiled."}
          </Text>
        </View>

        <Button
          testID="moderator-roles-toggle"
          label={rolesShown ? "Hide roles" : "Reveal roles"}
          icon={rolesShown ? "eye-off" : "eye"}
          variant={rolesShown ? "secondary" : "primary"}
          onPress={() => setRolesShown((v) => !v)}
        />

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
            {rolesShown ? (
              <>
                <Count label="Traitors" value={m.counts.traitors_alive} color={colors.traitor} />
                <Count label="Faithful" value={m.counts.faithful_alive} color={colors.brand} />
              </>
            ) : null}
            <Count label="Out" value={m.counts.out} color={colors.muted} />
          </View>
        </View>

        {/* Win tracker — reveals the traitor count, so only when roles are shown */}
        <View style={styles.winCard} testID="moderator-win-note">
          <Text style={styles.cardLabel}>The race to win</Text>
          {rolesShown ? (
            <Text style={styles.winText}>{m.win_note}</Text>
          ) : (
            <Text style={[styles.winText, { color: colors.muted }]}>Tap “Reveal roles” to see the race to win and how many Traitors remain.</Text>
          )}
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

        {/* Roster — grouped by allegiance when revealed, one neutral list when hidden */}
        {rolesShown ? (
          <>
            <Text style={styles.sectionTitle}>Traitors ({traitors.length})</Text>
            {traitors.map((p) => <PlayerRow key={p.id} p={p} masked={false} />)}
            <Text style={[styles.sectionTitle, { marginTop: spacing.md }]}>Faithful ({faithful.length})</Text>
            {faithful.map((p) => <PlayerRow key={p.id} p={p} masked={false} />)}
          </>
        ) : (
          <>
            <Text style={styles.sectionTitle}>Players ({m.counts.alive}/{m.counts.total} in)</Text>
            {m.players.map((p) => <PlayerRow key={p.id} p={p} masked />)}
          </>
        )}

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

function PlayerRow({ p, masked }: { p: ModeratorView["players"][number]; masked: boolean }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const traitor = p.role === "traitor";
  const badgeBg = masked ? colors.surfaceTertiary : traitor ? colors.traitor : colors.brandTertiary;
  return (
    <View style={[styles.playerRow, !p.alive && styles.playerOut]} testID={`moderator-player-${p.id}`}>
      <View style={[styles.badge, { backgroundColor: badgeBg }]}>
        <Ionicons
          name={masked ? "help" : traitor ? "skull" : "shield-checkmark"}
          size={16}
          color={masked ? colors.muted : traitor ? "#FFFFFF" : colors.brand}
        />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[styles.playerName, !p.alive && styles.struck]} numberOfLines={1}>
          {p.name}{p.is_host ? " · host" : ""}
        </Text>
        {masked ? (
          <Text style={[styles.playerRole, { color: colors.muted }]}>Role hidden · {p.alive ? "in the game" : "out"}</Text>
        ) : (
          <Text style={[styles.playerRole, { color: traitor ? colors.traitor : colors.brand }]}>
            {traitor ? "Traitor" : "Faithful"} · {p.alive ? "in the game" : "out"}
          </Text>
        )}
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

      {/* The murder comes first in the day now (chosen at night, before the Round Table) */}
      {mu ? (
        <View style={styles.daySection}>
          <View style={styles.dayRow}>
            <Ionicons name="moon" size={15} color={colors.traitor} />
            <Text style={styles.dayLabel}>The murder</Text>
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
  listHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  listHeadText: { color: c.muted, fontSize: 13, letterSpacing: 1.5, textTransform: "uppercase", fontWeight: "700" },
  gameRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: c.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: c.border },
  gameDot: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  gameCode: { color: c.brand, fontSize: 20, fontWeight: "800", letterSpacing: 2 },
  gameSub: { color: c.onSurfaceTertiary, fontSize: 14, marginTop: 1 },
  gameTime: { color: c.muted, fontSize: 12, fontWeight: "600" },
  gameInCount: { color: c.onSurfaceTertiary, fontSize: 12, fontWeight: "600" },
  orRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginTop: spacing.sm },
  orLine: { flex: 1, height: 1, backgroundColor: c.divider },
  orText: { color: c.muted, fontSize: 13 },
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
