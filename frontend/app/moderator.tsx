import Ionicons from "@react-native-vector-icons/ionicons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState, type ComponentProps } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, ModeratorView, VoteLogEntry } from "@/src/api";
import { ConfirmSheet } from "@/src/components/confirm-sheet";
import { ScreenHeader } from "@/src/components/screen-header";
import { Body, Button, ErrorText, Eyebrow, Title } from "@/src/components/ui";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

// The moderator ("Claudia") god-view. Reached only by a long press on a help
// button, then a passphrase the server checks (never stored in this bundle).
// It reveals every role, so it must never be opened in front of the players.

export default function Moderator() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const [pass, setPass] = useState("");
  const [unlockedPass, setUnlockedPass] = useState<string | null>(null);
  const [codeInput, setCodeInput] = useState("");
  const [code, setCode] = useState<string | null>(null);

  const unlock = useMutation({
    mutationFn: () => api.moderatorUnlock(pass),
    onSuccess: async () => {
      // One group, one game: go straight to the game in progress ("Watch another game" still lists them all).
      const cur = await api.currentGame().catch(() => null);
      if (cur?.code) setCode(cur.code);
      setUnlockedPass(pass);
    },
  });

  if (!unlockedPass) {
    return (
      <View style={styles.root} testID="moderator-screen">
        <ScreenHeader title="ClaudAI" testID="moderator" />
        <KeyboardAwareScrollView bottomOffset={24} keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.lg }]}>
          <View style={styles.lockIcon}>
            <Ionicons name="shield-half" size={40} color="#D4AF37" />
          </View>
          <View style={{ gap: spacing.sm }}>
            <Eyebrow>Hosts only · sees everything</Eyebrow>
            <Title testID="claudai-title">Claud<Text style={{ color: colors.traitor }}>AI</Text></Title>
            <Body>Like Claudia, but it never forgets. Enter the passphrase — ClaudAI sees every role and every move, so never open it where players can see.</Body>
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
      <ScreenHeader title="ClaudAI" testID="moderator" />
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

function NowRow({ icon, label, text, tone, testID }: { icon: ComponentProps<typeof Ionicons>["name"]; label: string; text: string; tone?: "wait" | "ready"; testID: string }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const color = tone === "wait" ? colors.traitor : tone === "ready" ? colors.brand : colors.onSurface;
  return (
    <View style={styles.nowRow}>
      <Ionicons name={icon} size={20} color={tone ? color : colors.brand} style={{ marginTop: 2 }} />
      <View style={{ flex: 1 }}>
        <Text style={styles.nowLabel}>{label}</Text>
        <Text style={[styles.nowText, { color }]} testID={testID}>{text}</Text>
      </View>
    </View>
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
  // Re-run the last tied Round Table as a revote (also for ties settled before revotes existed).
  const qc = useQueryClient();
  const [confirmRevote, setConfirmRevote] = useState(false);
  const revote = useMutation({
    mutationFn: () => api.moderatorRevote(code, passphrase),
    onSuccess: (v) => {
      qc.setQueryData(["moderator", code], v);
      setConfirmRevote(false);
    },
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
        <ScreenHeader title="ClaudAI" testID="moderator" />
        <View style={[styles.scroll, { gap: spacing.md }]}>
          <ErrorText testID="moderator-view-error" message={`No game found with the code ${code}. Check the letters and try again.`} />
          <Button testID="moderator-change-game-button" label="Try another code" icon="arrow-back" onPress={onChangeGame} />
        </View>
      </View>
    );
  }

  const m: ModeratorView = data;
  const lastEntry = m.history.length ? m.history[m.history.length - 1] : null;
  const lastTie = lastEntry?.banish?.tie ? lastEntry.banish : null;
  const lastDay = lastEntry?.day;
  // The players with the most votes in that tie: the only ones who can be chosen in the revote.
  const topVotes = lastTie?.tally[0]?.votes ?? 0;
  const topList = (lastTie?.tally ?? []).filter((t) => t.votes === topVotes).map((t) => t.name);
  const topNames = topList.join(" and ");
  const traitors = m.players.filter((p) => p.role === "traitor");
  const faithful = m.players.filter((p) => p.role === "faithful");
  const voteByDay = new Map<number, VoteLogEntry>(m.vote_log.map((v) => [v.day, v]));
  const eyebrow = m.phase === "ended" ? "Game over" : m.phase === "setup" ? "Before Day 1" : `Day ${m.day} of ${m.total_days}`;

  return (
    <View style={styles.root} testID="moderator-screen">
      <View style={[styles.topbar, { paddingTop: insets.top + spacing.sm }]}>
        <Ionicons name="shield-half" size={20} color="#D4AF37" />
        <Text style={styles.topbarText}>Claud<Text style={{ color: colors.traitor }}>AI</Text> · game {m.code}</Text>
        <Text style={styles.live}>{isRefetching ? "…" : "● live"}</Text>
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.lg }]}>
        {/* The one-glance answer: what's happening, who we're waiting for, what's next */}
        <View style={styles.nowCard} testID="moderator-now">
          <NowRow icon="radio-button-on" label="Right now" text={m.now.doing} testID="moderator-now-doing" />
          {m.now.waiting_for ? (
            <NowRow
              icon="hourglass-outline"
              label="Waiting for"
              text={m.now.waiting_on.length ? `${m.now.waiting_on.join(", ")} ${m.now.waiting_for}` : "Nobody — all done ✓"}
              tone={m.now.waiting_on.length ? "wait" : "ready"}
              testID="moderator-now-waiting"
            />
          ) : null}
          <NowRow icon="arrow-forward-circle" label="Next" text={m.now.next} testID="moderator-now-next" />
        </View>

        {m.revote_available ? (
          <View style={styles.revoteCard} testID="moderator-revote-card">
            <Text style={[styles.cardLabel, { color: colors.brand }]}>The last Round Table was a tie</Text>
            <Text style={styles.planText} testID="moderator-revote-desc">
              Re-run it as a revote between the top-voted players only:{" "}
              <Text style={{ color: colors.onSurface, fontWeight: "700" }}>{topNames}</Text>
              {topVotes ? ` (${topVotes} vote${topVotes === 1 ? "" : "s"} each)` : ""}. Everyone votes again and can only choose one of them.
              {lastDay && m.day > lastDay ? ` This takes the game back to Day ${lastDay}'s Round Table.` : ""}
            </Text>
            {m.revote_note ? (
              <Text style={[styles.planText, { color: colors.traitor }]} testID="moderator-revote-note">{m.revote_note}</Text>
            ) : null}
            <ErrorText testID="moderator-revote-error" message={revote.error?.message} />
            <Button testID="moderator-revote-button" label="Re-run the tie as a revote" icon="refresh" onPress={() => setConfirmRevote(true)} />
          </View>
        ) : null}

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
        {["setup", "roundtable", "night", "gather"].includes(m.phase) ? (
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
            <Text style={styles.cardLabel}>{m.revote?.active ? "Tie-break revote — live" : "Round Table — live"}</Text>
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
            {!rolesShown ? (
              <Text style={[styles.planText, { color: colors.muted }]} testID="moderator-tonight-hidden">
                Hidden. Tap “Reveal roles” to see who the Traitors are after tonight.
              </Text>
            ) : m.tonight.recruit_name ? (
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
                <Text style={styles.planStatus}>
                  {!m.tonight.murder_confirmed
                    ? "Not yet planned"
                    : m.tonight.murder_done
                      ? "✓ Carried out in plain sight"
                      : "Planned — not yet confirmed carried out"}
                </Text>
              </>
            ) : (
              <Text style={styles.planText}>No victim chosen yet.</Text>
            )}
            {rolesShown && m.phase === "night" ? (
              <Text style={[styles.planText, { fontSize: 15, color: colors.muted }]} testID="moderator-recruit-rule">
                {m.tonight.recruit_allowed === "banished"
                  ? "Recruiting allowed tonight — a Traitor has been banished."
                  : m.tonight.recruit_allowed === "alone"
                    ? "Recruiting allowed tonight — only one Traitor left."
                    : "No recruiting tonight — no Traitor banished and more than one left."}
              </Text>
            ) : null}
          </View>
        ) : null}

        {/* The Traitors' secret chat — only with roles revealed (it names the Traitors) */}
        {rolesShown ? (
          <View style={styles.card} testID="moderator-chat">
            <Text style={[styles.cardLabel, { color: colors.traitor }]}>Traitors&apos; secret chat</Text>
            {m.traitor_chat?.length ? (
              m.traitor_chat.slice(-40).map((c) => (
                <View key={c.id} style={styles.chatRow}>
                  <Text style={styles.chatMeta}>
                    {new Date(c.t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })} · Day {c.day} ·{" "}
                    <Text style={{ color: colors.traitor, fontWeight: "700" }}>{c.from_name}</Text>
                  </Text>
                  <Text style={styles.chatText}>{c.text}</Text>
                </View>
              ))
            ) : (
              <Text style={styles.planText}>No messages yet.</Text>
            )}
          </View>
        ) : null}

        {/* Claudia's log: every action, newest first */}
        <EventLog events={m.event_log} currentDay={m.day} rolesShown={rolesShown} />

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
            {m.history.map((h) => <DayCard key={h.day} h={h} votes={voteByDay.get(h.day)} rolesShown={rolesShown} />)}
          </>
        ) : null}

        <View style={{ gap: spacing.sm, marginTop: spacing.lg }}>
          <Button testID="moderator-refresh-button" label="Refresh now" variant="secondary" icon="refresh" onPress={() => refetch()} />
          <Button testID="moderator-change-game-button" label="Watch another game" variant="ghost" icon="swap-horizontal" onPress={onChangeGame} />
          <Button testID="moderator-lock-button" label="Lock and leave" variant="ghost" icon="lock-closed" onPress={() => { onLock(); router.back(); }} />
        </View>
      </ScrollView>

      <ConfirmSheet
        visible={confirmRevote}
        title="Start the revote?"
        message={`Everyone goes back to the Round Table and votes again — only ${topList.join(" or ")} can be chosen. Make sure the group is ready.`}
        confirmLabel="Start the revote"
        loading={revote.isPending}
        onConfirm={() => revote.mutate()}
        onCancel={() => setConfirmRevote(false)}
      />
    </View>
  );
}

const EVENT_ICON: Record<string, { icon: ComponentProps<typeof Ionicons>["name"]; tone: "traitor" | "gold" | "muted" }> = {
  setup: { icon: "flag", tone: "gold" },
  role: { icon: "eye-outline", tone: "muted" },
  stage: { icon: "time-outline", tone: "gold" },
  victim: { icon: "skull-outline", tone: "traitor" },
  murder: { icon: "skull", tone: "traitor" },
  recruit: { icon: "person-add", tone: "traitor" },
  lielow: { icon: "moon-outline", tone: "traitor" },
  pass: { icon: "moon-outline", tone: "muted" },
  plan: { icon: "document-text-outline", tone: "traitor" },
  checkin: { icon: "checkmark-circle-outline", tone: "muted" },
  confirm: { icon: "checkmark-done", tone: "traitor" },
  reveal: { icon: "mail-open-outline", tone: "gold" },
  vote: { icon: "hand-left-outline", tone: "muted" },
  banish: { icon: "flame", tone: "gold" },
  end: { icon: "trophy", tone: "gold" },
  actions: { icon: "list-outline", tone: "muted" },
};

const SECRET_NIGHT_KINDS = new Set(["murder", "recruit", "lielow", "pass"]);

function EventLog({ events, currentDay, rolesShown }: { events: ModeratorView["event_log"]; currentDay: number; rolesShown: boolean }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [showAll, setShowAll] = useState(false);
  // With roles hidden, show the role-neutral wording and drop events that would give a Traitor away.
  const visible = events
    .map((e) => ({ ...e, shown: rolesShown ? e.text : e.neutral }))
    .filter((e): e is typeof e & { shown: string } => !!e.shown)
    .reverse();
  const rows = showAll ? visible : visible.filter((e) => e.day === currentDay);
  const hiddenCount = visible.length - rows.length;
  const byDay: { day: number; items: typeof rows }[] = [];
  for (const e of rows) {
    const last = byDay[byDay.length - 1];
    if (last && last.day === e.day) last.items.push(e);
    else byDay.push({ day: e.day, items: [e] });
  }
  const tone = (t: "traitor" | "gold" | "muted") => (t === "traitor" ? colors.traitor : t === "gold" ? colors.brand : colors.muted);
  return (
    <View style={styles.card} testID="moderator-log">
      <View style={styles.logHead}>
        <Text style={styles.cardLabel}>Everything that&apos;s happened</Text>
        <Text style={styles.logCount}>{visible.length} events</Text>
      </View>
      {!rolesShown ? <Text style={styles.logHint}>Roles hidden: secret Traitor moves are left out. Tap “Reveal roles” for the full log.</Text> : null}
      {byDay.map((d) => (
        <View key={d.day} style={{ gap: 2 }}>
          <Text style={styles.logDay}>Day {d.day}</Text>
          {d.items.map((e, i) => {
            // With roles hidden every night turn must look identical — a Traitor's move
            // (murder / recruit / lying low) shows exactly like a Faithful's pass.
            const kind = !rolesShown && SECRET_NIGHT_KINDS.has(e.kind) ? "pass" : e.kind;
            const ic = EVENT_ICON[kind] ?? { icon: "ellipse-outline", tone: "muted" as const };
            const time = new Date(e.t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
            return (
              <View key={`${e.t}-${i}`} style={styles.logRow} testID={`moderator-log-${kind}`}>
                <Text style={styles.logTime}>{time}</Text>
                <Ionicons name={ic.icon} size={15} color={tone(ic.tone)} style={{ marginTop: 2 }} />
                <Text style={[styles.logText, e.kind === "stage" && { color: colors.brand, fontWeight: "700" }]}>{e.shown}</Text>
              </View>
            );
          })}
        </View>
      ))}
      {hiddenCount > 0 || showAll ? (
        <Pressable testID="moderator-log-toggle" onPress={() => setShowAll((v) => !v)} hitSlop={8}>
          <Text style={styles.logMore}>{showAll ? "Show today only" : `Show earlier days (${hiddenCount} more)`}</Text>
        </Pressable>
      ) : null}
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

function DayCard({ h, votes, rolesShown }: { h: ModeratorView["history"][number]; votes?: VoteLogEntry; rolesShown: boolean }) {
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
              {mu.victim_name} was murdered{rolesShown && mu.action ? ` — ${mu.action}` : ""}.
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
          {h.tie_vote ? (
            <View style={{ gap: 2 }} testID={`moderator-day-${h.day}-tie`}>
              <Text style={styles.dayTally}>First vote tied: {h.tie_vote.tally.map((t) => `${t.name} ${t.votes}`).join("  ·  ")}</Text>
              {h.tie_vote.votes?.map((v) => (
                <View key={v.voter_id} style={styles.voteRow}>
                  <Text style={styles.voteNameSm}>{v.voter_name}</Text>
                  <Ionicons name="arrow-forward" size={12} color={colors.muted} />
                  <Text style={styles.voteTargetSm}>{v.target_name}</Text>
                </View>
              ))}
              <Text style={[styles.dayTally, { marginTop: spacing.xs }]}>Revote:</Text>
            </View>
          ) : null}
          <Text style={styles.dayLine}>
            {b.tie && b.revote_ids?.length && b.round !== 2
              ? "Tied — revote next."
              : b.tie || !b.target_id
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
  chatRow: { gap: 2, paddingVertical: 4, borderTopWidth: 1, borderTopColor: c.divider },
  chatMeta: { color: c.muted, fontSize: 13 },
  chatText: { color: c.onSurface, fontSize: 16, lineHeight: 22 },
  revoteCard: { backgroundColor: c.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm, borderWidth: 2, borderColor: c.brand },
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
  nowCard: { backgroundColor: c.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md, borderWidth: 2, borderColor: c.brand },
  nowRow: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" },
  nowLabel: { color: c.muted, fontSize: 12, letterSpacing: 2, textTransform: "uppercase", fontWeight: "700" },
  nowText: { fontSize: 19, lineHeight: 25, fontWeight: "600" },
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
  logHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  logCount: { color: c.muted, fontSize: 12, fontWeight: "600" },
  logHint: { color: c.muted, fontSize: 13, lineHeight: 18, marginBottom: spacing.xs },
  logDay: { color: c.brand, fontSize: 12, letterSpacing: 1.5, textTransform: "uppercase", fontWeight: "800", marginTop: spacing.sm, marginBottom: 2 },
  logRow: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start", paddingVertical: 3 },
  logTime: { color: c.muted, fontSize: 12, width: 40, marginTop: 2, fontVariant: ["tabular-nums"] },
  logText: { color: c.onSurfaceSecondary, fontSize: 14, lineHeight: 20, flex: 1 },
  logMore: { color: c.brand, fontSize: 14, fontWeight: "700", marginTop: spacing.sm },
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
