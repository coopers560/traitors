import Ionicons from "@react-native-vector-icons/ionicons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type Href, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, ApiError, DayResult, exitOf, GameState, passphraseProblem, personalise, PublicPlayer, roundLabel } from "@/src/api";
import { ConfirmSheet } from "@/src/components/confirm-sheet";
import { HoldRole } from "@/src/components/hold-reveal";
import { PinPad } from "@/src/components/pin-pad";
import { QrCode } from "@/src/components/qr-code";
import { VoteBoard } from "@/src/components/vote-board";
import { Body, Button, ErrorText, Eyebrow, Title } from "@/src/components/ui";
import { useGameCode } from "@/src/game-code";
import { useMe } from "@/src/me";
import { inviteLink, shareInvite, shareToWhatsApp } from "@/src/utils/invite";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

import { SHOW_CLAUDAI } from "@/src/features";
import { claimFromLobby, useDeviceId } from "@/src/lobby";
import Setup from "./setup";

type ActiveGame = Extract<GameState, { exists: true }>;

// The archive's story screen (app/story.tsx). Cast so this file type-checks even before the
// generated typed-routes list has caught up with it.
const storyHref = (code: string) => `/story?code=${encodeURIComponent(code)}` as Href;

/** "Day 3 of 12 · Lunch": the current round's label with the length of the holiday. */
function dayOf(g: { day: number; label?: string; cal_day?: number; total_days: number }): string {
  const label = roundLabel(g);
  const prefix = `Day ${g.cal_day ?? g.day}`;
  return label.startsWith(prefix) ? `${prefix} of ${g.total_days}${label.slice(prefix.length)}` : `${label} of ${g.total_days}`;
}

/** How and when (by round label) a player left the game. */
function exitWithLabel(history: DayResult[], playerId: string): { how: "murdered" | "banished"; label: string } | null {
  const e = exitOf(history, playerId);
  if (!e) return null;
  const h = history.find((x) => x.day === e.day);
  return { how: e.how, label: h ? roundLabel(h) : `Day ${e.day}` };
}

export default function Home() {
  const styles = useStyles();
  const { colors } = useTheme();
  const { data, isLoading, refetch, error } = useQuery({
    queryKey: ["game"],
    queryFn: api.getGame,
    refetchInterval: 4000, // keeps every phone in sync
  });
  const [pulling, setPulling] = useState(false);
  const onRefresh = async () => {
    setPulling(true);
    await refetch();
    setPulling(false);
  };

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.brand} size="large" testID="home-loading" />
      </View>
    );
  }
  if (error || !data) {
    return (
      <View style={[styles.center, { padding: spacing.lg, gap: spacing.md }]}>
        <ErrorText testID="home-error" message="Could not reach the castle. Check your connection." />
        <Button testID="home-retry-button" label="Try again" onPress={() => refetch()} />
      </View>
    );
  }
  if (!data.exists) return <NoGame gone={!!data.gone} />;
  return <Dashboard game={data} refreshing={pulling} onRefresh={onRefresh} />;
}

/**
 * This phone has no game: go straight in. One group, one game — join the game in progress if
 * there is one, otherwise straight into New game setup (shown right here, so there is nothing
 * to go back to). If a game is started on another phone while this one is on setup, it joins.
 */
function NoGame({ gone }: { gone: boolean }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const { code, setCode } = useGameCode();
  // The game this phone was in has been ended on another phone: forget its code (setup then
  // says so, from the game-code context's `gone` flag).
  const forgetting = gone && !!code;
  useEffect(() => {
    if (forgetting) void setCode(null, { gone: true });
  }, [forgetting, setCode]);
  const { data: current, error, refetch, isFetching, isFetchedAfterMount } = useQuery({
    queryKey: ["current-boot"],
    queryFn: api.currentGame,
    enabled: !forgetting,
    refetchInterval: 10000,
    staleTime: 0,
    gcTime: 0,
  });
  // Only ever act on an answer fetched now, never on a cached one from before.
  const live = isFetchedAfterMount && current?.code ? current.code : null;
  const device = useDeviceId();
  const { setMe } = useMe();
  useEffect(() => {
    if (!live || !device) return;
    // A game made from the sign-up: this phone becomes its player's phone (if it signed up one).
    void claimFromLobby(device, live, setMe).then(() => setCode(live));
  }, [live, device, setCode, setMe]);

  if (!forgetting && isFetchedAfterMount && error && !current) {
    return (
      <View style={[styles.center, { padding: spacing.lg, gap: spacing.md }]} testID="home-current-error-screen">
        <ErrorText testID="home-current-error" message="Could not reach the castle to find your game. Check your connection." />
        <Button testID="home-current-retry" label="Try again" loading={isFetching} onPress={() => refetch()} />
      </View>
    );
  }
  if (forgetting || !isFetchedAfterMount || live) {
    return (
      <View style={[styles.center, { gap: spacing.md }]} testID={live ? "home-joining" : "home-finding"}>
        <ActivityIndicator color={colors.brand} size="large" />
        <Text style={styles.joiningText}>{live ? "Joining the game…" : "Finding your game…"}</Text>
      </View>
    );
  }
  return <Setup />;
}

const PHASE_COPY: Record<string, { eyebrow: string; title: string; body: string }> = {
  setup: {
    eyebrow: "The Gathering",
    title: "Discover your role",
    body: "Tap your name, enter your PIN and secretly see your role.",
  },
  day: {
    eyebrow: "During the day",
    title: "Enjoy the holiday",
    body: "Relax — and watch everyone closely.",
  },
  roundtable: {
    eyebrow: "This evening",
    title: "The Round Table",
    body: "Accuse, defend — then vote in secret.",
  },
  banished: {
    eyebrow: "The verdict",
    title: "The banishment",
    body: "Gather round to see who's banished.",
  },
  night: {
    eyebrow: "The plot",
    title: "The Traitors are plotting",
    body: "Act natural. Anyone can check their secret at any time.",
  },
  gather: {
    eyebrow: "This evening",
    title: "Check in for the Round Table",
    body: "Everyone checks in — then the murder is revealed.",
  },
  reveal: {
    eyebrow: "This evening",
    title: "Who did the Traitors take?",
    body: "Gather round before you open the envelope.",
  },
};

function Dashboard({ game, refreshing, onRefresh }: { game: ActiveGame; refreshing: boolean; onRefresh: () => void }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [menu, setMenu] = useState(false);
  const [invite, setInvite] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [nominate, setNominate] = useState(false);
  // Reconfirm the big "move the whole game on" taps so no one skips a stage by accident.
  const [confirmGo, setConfirmGo] = useState<{ label: string; run: () => void } | null>(null);
  const [endPin, setEndPin] = useState("");
  const [peekMode, setPeekMode] = useState(false);
  const { setCode } = useGameCode();
  const { me: boundMe, clearMe } = useMe();
  const boundPlayer = boundMe ? game.players.find((p) => p.id === boundMe.playerId) : null;

  const advance = useMutation({
    mutationFn: (force?: boolean) => api.advance(game.phase, game.day, force),
    onSuccess: (s) => {
      qc.setQueryData(["game"], s);
      setConfirmGo(null);
      if (s.exists && (s.phase === "banished" || s.phase === "reveal")) router.push("/reveal");
    },
    onError: () => setConfirmGo(null),
  });
  const endGame = useMutation({
    mutationFn: (pin: string) => api.deleteGame({ player_id: game.host_id ?? "", pin }),
    onSuccess: async () => {
      setConfirmEnd(false);
      setEndPin("");
      await setCode(null);
    },
    onError: () => setEndPin(""), // wrong PIN: clear so they can try again
  });

  // Auto-submit once the host's 4-digit PIN is entered in the end-game sheet.
  useEffect(() => {
    if (confirmEnd && endPin.length === 4 && !endGame.isPending) endGame.mutate(endPin);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endPin, confirmEnd]);
  const openInvite = () => { setMenu(false); setInvite(true); };

  const { phase } = game;
  const allDone = game.turns_done >= game.turns_needed;
  const tied = (game.revote?.names ?? []).filter(Boolean).join(" and ");
  // During a revote everyone can see the tied first vote (it was already revealed to all).
  const lastResult = game.history.length ? game.history[game.history.length - 1] : null;
  const firstVote = phase === "roundtable" && game.revote?.active && lastResult?.day === game.day && lastResult.banish?.tie ? lastResult.banish : null;
  let copy =
    phase === "roundtable" && game.revote?.active
      ? {
          eyebrow: "Tie-break revote",
          title: "Vote again",
          body: `Tied between ${tied} — vote again, only between them.`,
        }
      : phase === "banished" && game.revote && !game.revote.active
      ? {
          eyebrow: "The verdict",
          title: "The table is divided",
          body: "Open the reveal to see the tie — then everyone votes again.",
        }
      : phase === "roundtable" && game.endgame
      ? {
          eyebrow: "The final vote",
          title: "Banish, or end the game",
          body: "Banish one more, or end it — if a Traitor's still here, they win.",
        }
      : PHASE_COPY[phase];
  // Two Round Tables a day: the lunch table's stages happen at lunch, not "this evening".
  if (phase !== "ended" && game.session === "lunch" && copy.eyebrow === "This evening") copy = { ...copy, eyebrow: "At lunch" };
  if (copy === PHASE_COPY.banished && game.session === "lunch") {
    copy = { ...copy, body: "Gather round to see who's banished. Next Round Table about 8pm." };
  }
  // The day's body fits the session (one table a day keeps the night-time wording) and the endgame.
  if (copy === PHASE_COPY.day) {
    if (game.endgame) {
      copy = { ...copy, body: "No more murders — the final vote decides it." };
    } else if (game.session === "lunch") {
      copy = { ...copy, body: "Relax — the Traitors strike before lunch." };
    } else if (game.session === "evening") {
      copy = { ...copy, body: "Relax — the Traitors strike this afternoon." };
    }
  }
  const startLabel = game.tables_per_day === 2 ? "Begin Day 1 · Lunch" : "Begin Day 1";
  const plotLabel = game.endgame ? "Gather for the final vote" : "Start the plot";
  // Only the Traitors take part in the plot (from their menu), so nobody takes a turn then and the
  // list shows no ticks — a tick would point straight at a Traitor.
  const takingTurns = phase === "setup" || phase === "gather" || phase === "roundtable";
  const alive = game.players.filter((p) => p.alive);
  const out = game.players.filter((p) => !p.alive);
  // Progress through the holiday's calendar days (a lunch table is half way through its day).
  const calDay = game.cal_day ?? game.day;
  const progressDays = game.tables_per_day === 2 && game.session === "lunch" ? calDay - 0.5 : calDay;

  const onPlayer = (p: PublicPlayer) => {
    if (phase === "ended") return;
    const mode = takingTurns && !peekMode && p.alive ? "turn" : "peek";
    if (phase === "setup" && !peekMode) {
      router.push({ pathname: "/player/[id]", params: { id: p.id, mode: "turn" } });
      return;
    }
    if (!p.alive && !peekMode) return;
    setPeekMode(false);
    router.push({ pathname: "/player/[id]", params: { id: p.id, mode } });
  };

  return (
    <View style={styles.root} testID="dashboard-screen">
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <View style={{ flex: 1 }}>
          <Eyebrow>{phase === "setup" ? "Before Day 1" : phase === "ended" ? "Game over" : dayOf(game)}</Eyebrow>
          <Text style={styles.headerTitle} testID="dashboard-day-title">
            {phase === "ended" ? "The Final Verdict" : copy.eyebrow}
          </Text>
        </View>
        <Pressable testID="dashboard-invite-button" onPress={openInvite} style={styles.iconBtn} hitSlop={8} accessibilityLabel="Invite players">
          <Ionicons name="qr-code-outline" size={22} color={colors.brand} />
        </Pressable>
        <Pressable testID="dashboard-menu-button" onPress={() => setMenu((m) => !m)} style={styles.iconBtn} hitSlop={8}>
          <Ionicons name={menu ? "close" : "ellipsis-horizontal"} size={26} color={colors.onSurface} />
        </Pressable>
      </View>
      {phase !== "setup" && phase !== "ended" ? (
        <View style={styles.progress}>
          <View style={[styles.progressFill, { width: `${Math.min(100, (progressDays / game.total_days) * 100)}%` }]} />
        </View>
      ) : null}

      {menu ? (
        <View style={styles.menu} testID="dashboard-menu">
          <Button testID="menu-help-button" label="Help · what do I tap?" variant="secondary" icon="help-circle-outline" onPress={() => { setMenu(false); router.push({ pathname: "/help", params: { from: "main" } }); }} />
          <Button testID="menu-how-to-play-button" label="How to play" variant="secondary" icon="book-outline" onPress={() => { setMenu(false); router.push("/how-to-play"); }} />
          <Button testID="menu-history-button" label="Day history" variant="secondary" icon="time-outline" onPress={() => { setMenu(false); router.push("/history"); }} />
          <Button testID="menu-votes-button" label="Votes so far" variant="secondary" icon="podium-outline" onPress={() => { setMenu(false); router.push("/votes"); }} />
          <Button testID="menu-actions-button" label="Secret actions" variant="secondary" icon="list-outline" onPress={() => { setMenu(false); router.push("/actions"); }} />
          <Button testID="menu-share-code-button" label="Invite players (QR & link)" variant="secondary" icon="qr-code-outline" onPress={openInvite} />
          {boundPlayer ? (
            <Button testID="menu-forget-me-button" label={`Forget me on this phone (${boundPlayer.name})`} variant="secondary" icon="phone-portrait-outline" onPress={() => { setMenu(false); clearMe(); }} />
          ) : null}
          {SHOW_CLAUDAI ? (
            <Button testID="menu-claudai-button" label="ClaudAI (host)" variant="secondary" icon="shield-half" onPress={() => { setMenu(false); router.push("/moderator"); }} />
          ) : null}
          {SHOW_CLAUDAI && !game.claudai && phase !== "ended" ? (
            <Button testID="menu-nominate-claudai-button" label="Nominate a ClaudAI host" variant="secondary" icon="shield-half-outline" onPress={() => { setMenu(false); setNominate(true); }} />
          ) : null}
          <Button testID="menu-end-game-button" label="End this game for everyone" variant="danger" icon="trash-outline" onPress={() => { setMenu(false); setEndPin(""); endGame.reset(); setConfirmEnd(true); }} />
        </View>
      ) : null}

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.lg }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} />}
      >
        {boundPlayer ? (
          <View style={styles.boundCard} testID="bound-banner">
            <Ionicons name="phone-portrait" size={20} color={colors.brand} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.boundName} numberOfLines={1}>This phone: {boundPlayer.name}</Text>
              <Text style={styles.boundSub} numberOfLines={1}>
                {phase === "ended"
                  ? "Game over"
                  : !boundPlayer.alive
                    ? (() => { const e = exitWithLabel(game.history, boundPlayer.id); return e ? `${e.how === "murdered" ? "Murdered" : "Banished"} · ${e.label} — tap to peek` : "You're out — tap to peek"; })()
                    : takingTurns
                      ? boundPlayer.turn_done ? "You've taken your turn" : "Your turn · no PIN"
                      : "Tap to check your secret"}
              </Text>
            </View>
            {takingTurns && boundPlayer.alive && !boundPlayer.turn_done ? (
              <Button testID="bound-take-turn" label="Turn" icon="arrow-forward" onPress={() => onPlayer(boundPlayer)} style={{ minHeight: 44, paddingHorizontal: spacing.md }} />
            ) : (
              <Pressable testID="bound-peek" onPress={() => router.push({ pathname: "/player/[id]", params: { id: boundPlayer.id, mode: "peek" } })} style={styles.iconBtn} hitSlop={8}>
                <Ionicons name="eye-outline" size={22} color={colors.brand} />
              </Pressable>
            )}
          </View>
        ) : null}

        {phase === "ended" ? (
          <>
            <NextGameBanner endedCode={game.code} />
            <EndedCard game={game} />
          </>
        ) : (
          <Animated.View entering={FadeInDown.duration(500)} style={styles.phaseCard} testID="phase-card">
            <Title style={styles.phaseTitle}>{copy.title}</Title>
            <Body>{copy.body}</Body>
            {takingTurns ? (
              <View style={styles.turnRow} testID="turn-progress">
                <Ionicons name="people" size={20} color={colors.brand} />
                <Text style={styles.turnText}>
                  {game.turns_done} of {game.turns_needed} have taken their turn
                </Text>
              </View>
            ) : null}
            {firstVote ? (
              <VoteBoard vote={firstVote} title="The first vote — tied" highlight={game.revote?.ids} collapsible testID="first-vote" />
            ) : null}
            <ErrorText testID="advance-error" message={advance.error?.message} />
            {phase === "setup" ? (
              <Button testID="advance-start-day-button" label={startLabel} icon="sunny" disabled={!allDone} loading={advance.isPending} onPress={() => setConfirmGo({ label: startLabel, run: () => advance.mutate() })} />
            ) : phase === "day" ? (
              <Button testID="advance-round-table-button" label={plotLabel} icon={game.endgame ? "flame" : "moon"} loading={advance.isPending} onPress={() => setConfirmGo({ label: plotLabel, run: () => advance.mutate() })} />
            ) : phase === "roundtable" ? (
              <>
                <Button testID="advance-reveal-button" label={allDone ? (game.revote?.active ? "Reveal the revote" : game.endgame ? "Reveal the vote" : "Reveal the banishment") : "Everyone must vote first…"} icon="mail-open" disabled={!allDone} loading={advance.isPending && allDone} onPress={() => setConfirmGo({ label: game.revote?.active ? "Reveal the revote" : game.endgame ? "Reveal the vote" : "Reveal the banishment", run: () => advance.mutate() })} />
                {!allDone ? (
                  <Text style={styles.waitNote} testID="roundtable-wait-note">Everyone must vote first.</Text>
                ) : null}
              </>
            ) : phase === "night" ? (
              // Lights up once the Traitors have sealed their plan and had their time to strike. It
              // never shows when they sealed it — that would point at whoever was on their phone.
              <>
                <Button testID="advance-murder-button" label={game.plot_ready ? "Everyone to the Round Table" : "Awaiting treachery…"} icon="flame" disabled={!game.plot_ready} loading={advance.isPending && !!game.plot_ready} onPress={() => setConfirmGo({ label: "Everyone to the Round Table", run: () => advance.mutate() })} />
                {!game.plot_ready ? (
                  <Text style={styles.waitNote} testID="murder-window-note">
                    Opens at least {game.murder_window_minutes ?? 30} minutes after the Traitors seal their plan.
                  </Text>
                ) : null}
              </>
            ) : phase === "gather" ? (
              <>
                <Button testID="advance-gather-button" label={allDone ? "Reveal the murder" : "Everyone must check in first…"} icon="mail-open" disabled={!allDone} loading={advance.isPending && allDone} onPress={() => setConfirmGo({ label: "Reveal the murder", run: () => advance.mutate() })} />
                {!allDone ? (
                  <Text style={styles.waitNote} testID="gather-wait-note">Everyone must check in first.</Text>
                ) : null}
              </>
            ) : phase === "banished" ? (
              <Button testID="open-banishment-button" label="Open the banishment" icon="mail" onPress={() => router.push("/reveal")} />
            ) : (
              <Button testID="open-reveal-button" label="Open the envelope" icon="mail" onPress={() => router.push("/reveal")} />
            )}
          </Animated.View>
        )}

        {game.history.some((h) => h.banish || h.tie_vote) ? (
          <Button testID="votes-so-far-button" label="Votes so far" variant="secondary" icon="podium-outline" onPress={() => router.push("/votes")} />
        ) : null}

        <Pressable testID="dashboard-help-button" accessibilityRole="button" onPress={() => router.push({ pathname: "/help", params: { from: "main" } })} style={styles.helpLink} hitSlop={6}>
          <Ionicons name="help-circle-outline" size={20} color={colors.brand} />
          <Text style={styles.helpLinkText}>Not sure what to tap? Help</Text>
        </Pressable>

        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>
            {peekMode ? "Who is checking?" : takingTurns ? "Tap your name to take your turn" : "The players"}
          </Text>
          {phase !== "ended" ? (
            <Pressable testID="check-my-secret-button" onPress={() => setPeekMode((v) => !v)} style={[styles.chip, peekMode && styles.chipOn]}>
              <Ionicons name={peekMode ? "close" : "eye-off-outline"} size={16} color={peekMode ? colors.onBrandPrimary : colors.brand} />
              <Text style={[styles.chipText, peekMode && { color: colors.onBrandPrimary }]}>{peekMode ? "Cancel" : "Check my secret"}</Text>
            </Pressable>
          ) : null}
        </View>

        <View style={{ gap: spacing.sm }}>
          {alive.map((p, i) => (
            <PlayerRow key={p.id} p={p} index={i} showTurn={takingTurns && !peekMode} onPress={() => onPlayer(p)} disabled={phase === "ended"} />
          ))}
        </View>

        {out.length ? (
          <>
            <Text style={[styles.sectionTitle, { marginTop: spacing.lg }]}>Eliminated</Text>
            <View style={{ gap: spacing.sm }}>
              {out.map((p, i) => (
                <PlayerRow key={p.id} p={p} index={i} showTurn={false} onPress={() => onPlayer(p)} disabled={!peekMode} exit={exitWithLabel(game.history, p.id)} holdRole={phase !== "ended"} />
              ))}
            </View>
          </>
        ) : null}
      </ScrollView>

      <InviteSheet visible={invite} onClose={() => setInvite(false)} />

      <ConfirmSheet
        visible={!!confirmGo}
        title="Move the game on?"
        message={`This advances the game on every phone: "${confirmGo?.label}". Make sure everyone is together and ready — you can't go back a stage.`}
        confirmLabel={confirmGo?.label ?? "Continue"}
        loading={advance.isPending}
        onConfirm={() => confirmGo?.run()}
        onCancel={() => setConfirmGo(null)}
      />

      {nominate ? <NominateSheet hostId={game.host_id ?? ""} hostName={game.host_name ?? "the host"} onClose={() => setNominate(false)} /> : null}
      <EndGameSheet
        visible={confirmEnd}
        hostName={game.host_name ?? "the host"}
        value={endPin}
        onChange={setEndPin}
        loading={endGame.isPending}
        error={endGame.error?.message}
        onCancel={() => { setConfirmEnd(false); setEndPin(""); endGame.reset(); }}
      />
    </View>
  );
}

function PlayerRow({
  p,
  index,
  showTurn,
  onPress,
  disabled,
  exit,
  holdRole,
}: {
  p: PublicPlayer;
  index: number;
  showTurn: boolean;
  onPress: () => void;
  disabled?: boolean;
  exit?: { how: "murdered" | "banished"; label: string } | null;
  /** During the game an out player's allegiance shows only while held. */
  holdRole?: boolean;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <Animated.View entering={FadeInDown.delay(Math.min(index, 10) * 40).duration(400)}>
      <Pressable
        testID={`player-row-${p.id}`}
        onPress={onPress}
        disabled={disabled}
        style={({ pressed }) => [styles.row, !p.alive && styles.rowOut, pressed && styles.rowPressed]}
      >
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{p.name.charAt(0).toUpperCase()}</Text>
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[styles.rowName, !p.alive && { textDecorationLine: "line-through", color: colors.muted }]} numberOfLines={1}>
            {p.name}
          </Text>
          {!p.alive && exit && holdRole ? (
            <>
              <Text style={styles.rowExit} testID={`player-exit-${p.id}`}>
                {exit.how === "murdered" ? "Murdered" : "Banished"} · {exit.label}
              </Text>
              {p.role ? <HoldRole role={p.role} testID={`player-role-${p.id}`} /> : null}
            </>
          ) : !p.alive && exit ? (
            <Text style={styles.rowExit} testID={`player-exit-${p.id}`}>
              {exit.how === "murdered" ? "Murdered" : "Banished"} · {exit.label}
              {p.role ? (
                <Text style={{ color: p.role === "traitor" ? colors.traitor : colors.brand }} testID={`player-role-${p.id}`}>
                  {" · "}{p.role === "traitor" ? "Traitor" : "Faithful"}
                </Text>
              ) : null}
            </Text>
          ) : p.role ? (
            <Text style={[styles.rowRole, { color: p.role === "traitor" ? colors.traitor : colors.brand }]} testID={`player-role-${p.id}`}>
              {p.role === "traitor" ? "Traitor" : "Faithful"}
            </Text>
          ) : null}
        </View>
        {showTurn ? (
          <Ionicons
            testID={`player-turn-status-${p.id}`}
            name={p.turn_done ? "checkmark-circle" : "ellipse-outline"}
            size={26}
            color={p.turn_done ? colors.brand : colors.borderStrong}
          />
        ) : !p.alive ? (
          <Ionicons testID={`player-out-${p.id}`} name="skull" size={22} color={colors.muted} />
        ) : null}
      </Pressable>
    </Animated.View>
  );
}

function MurderMethods({ game }: { game: ActiveGame }) {
  const styles = useStyles();
  // Methods are only sent by the server once the game has ended.
  const murders = game.history.flatMap((h) => (h.murder?.success && h.murder.action ? [{ h, murder: h.murder }] : []));
  if (!murders.length) return null;
  return (
    <View style={styles.methodsCard} testID="murder-methods">
      <Text style={styles.methodsTitle}>How the murders were done</Text>
      {murders.map(({ h, murder }) => (
        <View key={h.day} style={styles.methodRow}>
          <Text style={styles.methodDay}>{roundLabel(h)}</Text>
          <Text style={styles.methodText}>
            <Text style={{ fontWeight: "700" }}>{murder.victim_name}</Text> — {personalise(murder.action, murder.victim_name)}
          </Text>
        </View>
      ))}
    </View>
  );
}

function EndedCard({ game }: { game: ActiveGame }) {
  const styles = useStyles();
  const { setCode } = useGameCode();
  const router = useRouter();
  const [confirmNew, setConfirmNew] = useState(false);
  const del = useMutation({ mutationFn: api.deleteGame, onSuccess: async () => { setConfirmNew(false); await setCode(null); } });
  const traitorsWin = game.winner === "traitors";
  const endedByVote = game.history[game.history.length - 1]?.ended_by_vote;
  return (
    <Animated.View entering={FadeInDown.duration(600)} style={styles.phaseCard} testID="ended-card">
      <Eyebrow>{traitorsWin ? "Treachery triumphs" : "Justice is served"}</Eyebrow>
      <Title testID="winner-title" style={styles.phaseTitle}>
        {traitorsWin ? "The Traitors win" : "The Faithful win"}
      </Title>
      {endedByVote ? <Body testID="ended-by-vote">The players voted to end the game.</Body> : null}
      <Body>All roles are now revealed below. Well played, everyone.</Body>
      <MurderMethods game={game} />
      <Button
        testID="ended-whole-story-button"
        label="The whole story"
        icon="book"
        onPress={() => router.push(storyHref(game.code))}
        style={{ minHeight: 72 }}
      />
      <Text style={styles.storyNote}>Every role, murder, vote and secret message — kept in Previous games for everyone.</Text>
      <Button testID="share-finale-button" label="Share the finale" variant="secondary" icon="share-social" onPress={() => router.push("/finale")} />
      <Button testID="ended-history-button" label="Day history" variant="secondary" icon="time-outline" onPress={() => router.push("/history")} />
      <Button testID="new-game-button" label="Start a new game" variant="ghost" icon="refresh" onPress={() => setConfirmNew(true)} />
      <ConfirmSheet
        visible={confirmNew}
        title="Start a new game?"
        message="This clears the finished game from the main screen. Its whole story stays in Previous games for everyone to look back on."
        confirmLabel="Yes, start fresh"
        loading={del.isPending}
        onConfirm={() => del.mutate()}
        onCancel={() => setConfirmNew(false)}
      />
    </Animated.View>
  );
}

/** After a game ends, the next game in progress (if one has started) is one tap away. */
function NextGameBanner({ endedCode }: { endedCode: string }) {
  const { setCode } = useGameCode();
  const { data } = useQuery({ queryKey: ["current"], queryFn: api.currentGame, refetchInterval: 10000 });
  if (!data?.code || data.code === endedCode) return null;
  const next = data.code;
  return <Button testID="join-next-game-button" label="A new game has started — join it" icon="enter-outline" onPress={() => setCode(next)} />;
}

function InviteSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} testID="invite-scrim" />
      <View style={[styles.inviteSheet, { paddingBottom: insets.bottom + spacing.lg }]} testID="invite-sheet">
        <Eyebrow>Invite players</Eyebrow>
        <Title style={{ fontSize: 28, lineHeight: 34, textAlign: "center" }}>Scan to join</Title>
        {visible ? (
          <View style={styles.qrWrap}>
            <QrCode value={inviteLink()} size={224} />
          </View>
        ) : null}
        <Body style={{ textAlign: "center" }}>Point a phone camera at the QR code to open the app — it goes straight into this game. No codes needed.</Body>
        <Button testID="invite-whatsapp-button" label="Share on WhatsApp" icon="logo-whatsapp" onPress={() => shareToWhatsApp()} />
        <Button testID="invite-share-button" label="Share another way" variant="secondary" icon="share-social-outline" onPress={() => shareInvite()} />
        <Button testID="invite-close-button" label="Done" variant="ghost" onPress={onClose} />
      </View>
    </Modal>
  );
}

/**
 * The game's host nominates a ClaudAI host by giving the game its ClaudAI passphrase: first the
 * host's own PIN, then the phone goes to the ClaudAI host, who chooses the passphrase (typed
 * twice) without the host seeing it. Only possible while the game has none. The passphrase can
 * never be recovered — there is no master key.
 */
function NominateSheet({ hostId, hostName, onClose }: { hostId: string; hostName: string; onClose: () => void }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [hostPin, setHostPin] = useState("");
  const [pass, setPass] = useState("");
  const [pass2, setPass2] = useState("");
  // host PIN → hand the phone over → the ClaudAI host's passphrase. The host's PIN is always
  // followed by the hand-over, so the host never lands on the passphrase fields.
  const [step, setStep] = useState<"host" | "handoff" | "claudai">("host");
  const ok = !passphraseProblem(pass) && pass === pass2;
  const save = useMutation({
    mutationFn: () => api.nominateClaudai(hostId, hostPin, pass),
    onSuccess: (s) => {
      qc.setQueryData(["game"], s);
      onClose();
    },
    onError: (e) => {
      if (!(e instanceof ApiError)) return;
      // Someone got there first: nothing to do here — close and show the game as it is now.
      if (e.status === 400 && /already has a ClaudAI host/i.test(e.message)) {
        void qc.invalidateQueries({ queryKey: ["game"] });
        onClose();
        return;
      }
      // Wrong host PIN (or too many tries): back to the host's PIN, keeping the passphrase.
      // Anything else (e.g. the passphrase isn't strong enough) stays on this step to be fixed.
      if ([401, 404, 429].includes(e.status)) {
        setHostPin("");
        setStep("host");
      }
    },
  });
  const body =
    step === "host"
      ? pass
        ? `Hand the phone back to ${hostName} to enter the host PIN again — the passphrase that was typed is kept.`
        : `ClaudAI sees every role and move. Only ${hostName} (the host) can set it up — enter ${hostName}'s PIN.`
      : step === "handoff"
        ? "Hand the phone to your ClaudAI host — they choose the passphrase, unseen."
        : "Choose the ClaudAI passphrase — only you should know it. Type it twice: it can never be recovered or reset, so write it down somewhere safe.";
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <Pressable style={styles.scrim} onPress={onClose} testID="nominate-scrim" />
        <ScrollView
          style={styles.sheetScroll}
          contentContainerStyle={[styles.endSheetContent, { paddingBottom: insets.bottom + spacing.lg }]}
          keyboardShouldPersistTaps="handled"
          testID="nominate-sheet"
        >
          <Title style={{ fontSize: 28, lineHeight: 34 }}>Nominate a ClaudAI host</Title>
          <Body testID="nominate-step-text">{body}</Body>
          <ErrorText testID="nominate-error" message={save.error?.message} />
          {step === "host" ? (
            <PinPad
              value={hostPin}
              onChange={(v) => {
                save.reset();
                setHostPin(v);
                if (v.length === 4) setStep("handoff");
              }}
            />
          ) : step === "handoff" ? (
            <View style={styles.handoff} testID="nominate-handoff">
              <Ionicons name="phone-portrait-outline" size={36} color={colors.brand} style={{ alignSelf: "center" }} />
              <Button testID="nominate-handoff-continue" label="I'm the ClaudAI host — continue" icon="shield-half" onPress={() => setStep("claudai")} />
              <Button testID="nominate-back-button" label="Re-enter the host PIN" variant="ghost" icon="keypad-outline" onPress={() => { save.reset(); setHostPin(""); setStep("host"); }} />
            </View>
          ) : (
            <>
              <PassphraseFields
                testID="nominate-pass-input"
                value={pass}
                confirm={pass2}
                onChange={(t) => { save.reset(); setPass(t); }}
                onConfirmChange={(t) => { save.reset(); setPass2(t); }}
              />
              <Button testID="nominate-save-button" label="Set the ClaudAI passphrase" icon="shield-half" disabled={!ok} loading={save.isPending} onPress={() => save.mutate()} />
              <Button testID="nominate-back-button" label="Re-enter the host PIN" variant="ghost" icon="keypad-outline" onPress={() => { save.reset(); setHostPin(""); setStep("host"); }} />
            </>
          )}
          <Button testID="nominate-cancel-button" label="Cancel" variant="secondary" onPress={onClose} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const PASS_RULES: { label: string; ok: (s: string) => boolean }[] = [
  { label: "8+ characters", ok: (s) => s.length >= 8 },
  { label: "Upper case", ok: (s) => /[A-Z]/.test(s) },
  { label: "Lower case", ok: (s) => /[a-z]/.test(s) },
  { label: "A number", ok: (s) => /[0-9]/.test(s) },
  { label: "A symbol", ok: (s) => /[^A-Za-z0-9]/.test(s) },
];

/** A new ClaudAI passphrase typed twice, with a live checklist of what it still needs. */
function PassphraseFields({
  testID,
  value,
  confirm,
  onChange,
  onConfirmChange,
}: {
  testID: string;
  value: string;
  confirm: string;
  onChange: (v: string) => void;
  onConfirmChange: (v: string) => void;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [show, setShow] = useState(false);
  const strong = !passphraseProblem(value);
  const match = confirm.length > 0 && confirm === value;
  const missing = PASS_RULES.filter((r) => !r.ok(value)).map((r) => r.label.toLowerCase());
  const status = !value
    ? "At least 8 characters with upper and lower case letters, a number and a symbol."
    : !strong
      ? `Still needs: ${missing.join(", ")}.`
      : !confirm
        ? "Strong. Now type it again to confirm."
        : match
          ? "Strong, and both match ✓"
          : "The two don't match yet.";
  const field = {
    placeholderTextColor: colors.muted,
    style: styles.passInput,
    secureTextEntry: !show,
    autoCapitalize: "none" as const,
    autoCorrect: false,
    autoComplete: "off" as const,
    textContentType: "none" as const,
    spellCheck: false,
    maxLength: 64,
  };
  return (
    <View style={{ gap: spacing.sm }}>
      <TextInput testID={testID} value={value} onChangeText={onChange} placeholder="ClaudAI passphrase" autoFocus {...field} />
      <TextInput testID={`${testID.replace(/-input$/, "")}-confirm`} value={confirm} onChangeText={onConfirmChange} placeholder="Type it again to confirm" {...field} />
      <View style={styles.checks} testID={`${testID}-checks`}>
        {[...PASS_RULES.map((r) => ({ label: r.label, ok: r.ok(value) })), { label: "Both match", ok: match }].map((r) => (
          <View key={r.label} style={styles.check}>
            <Ionicons name={r.ok ? "checkmark-circle" : "ellipse-outline"} size={16} color={r.ok ? colors.brand : colors.muted} />
            <Text style={[styles.checkText, r.ok && { color: colors.onSurface }]}>{r.label}</Text>
          </View>
        ))}
      </View>
      <Text style={[styles.passStatus, strong && match && { color: colors.brand }]} testID={`${testID}-status`}>{status}</Text>
      <Pressable testID={`${testID}-show`} onPress={() => setShow((v) => !v)} style={styles.showRow} hitSlop={6}>
        <Ionicons name={show ? "eye-off-outline" : "eye-outline"} size={18} color={colors.brand} />
        <Text style={styles.showText}>{show ? "Hide what I typed" : "Show what I typed"}</Text>
      </Pressable>
    </View>
  );
}

function EndGameSheet({
  visible,
  hostName,
  value,
  onChange,
  loading,
  error,
  onCancel,
}: {
  visible: boolean;
  hostName: string;
  value: string;
  onChange: (v: string) => void;
  loading?: boolean;
  error?: string;
  onCancel: () => void;
}) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.scrim} onPress={onCancel} testID="end-game-scrim" />
      <View style={[styles.endSheet, { paddingBottom: insets.bottom + spacing.lg }]} testID="end-game-sheet">
        <Title style={{ fontSize: 28, lineHeight: 34 }}>End this game?</Title>
        <Body>
          Only {hostName} can end the game for everyone. Enter {hostName}&apos;s PIN to confirm — all roles
          and votes will be lost on every phone.
        </Body>
        <ErrorText testID="end-game-error" message={error} />
        <PinPad value={value} onChange={onChange} disabled={loading} />
        <Button testID="end-game-cancel-button" label="Cancel" variant="secondary" onPress={onCancel} />
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  center: { flex: 1, backgroundColor: c.surface, alignItems: "center", justifyContent: "center" },
  methodsCard: {
    backgroundColor: c.surfaceTertiary,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: c.brandTertiary,
  },
  methodsTitle: { color: c.brand, fontSize: 13, letterSpacing: 1.5, textTransform: "uppercase", fontWeight: "700" },
  methodRow: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" },
  methodDay: { color: c.muted, fontSize: 13, fontWeight: "700", minWidth: 46, maxWidth: 120 },
  storyNote: { color: c.muted, fontSize: 14, lineHeight: 20, textAlign: "center", marginTop: -spacing.xs },
  sheetScroll: {
    flexGrow: 0,
    flexShrink: 1,
    backgroundColor: c.surfaceSecondary,
    borderTopLeftRadius: radius.lg * 1.5,
    borderTopRightRadius: radius.lg * 1.5,
    borderTopWidth: 1,
    borderColor: c.brandSecondary,
  },
  endSheetContent: { padding: spacing.lg, gap: spacing.md },
  handoff: { gap: spacing.sm, alignItems: "stretch" },
  passInput: {
    height: 56,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.surfaceTertiary,
    color: c.onSurface,
    fontSize: 18,
    paddingHorizontal: spacing.md,
  },
  checks: { flexDirection: "row", flexWrap: "wrap", columnGap: spacing.md, rowGap: spacing.xs },
  check: { flexDirection: "row", alignItems: "center", gap: 4 },
  checkText: { color: c.muted, fontSize: 14, fontWeight: "600" },
  passStatus: { color: c.muted, fontSize: 14, lineHeight: 20 },
  showRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs, alignSelf: "flex-start", minHeight: 32 },
  showText: { color: c.brand, fontSize: 14, fontWeight: "700" },
  methodText: { color: c.onSurface, fontSize: 15, flex: 1, lineHeight: 21 },
  scrim: { flex: 1, backgroundColor: c.scrim },
  inviteSheet: {
    backgroundColor: c.surfaceSecondary,
    borderTopLeftRadius: radius.lg * 1.5,
    borderTopRightRadius: radius.lg * 1.5,
    padding: spacing.lg,
    gap: spacing.sm,
    alignItems: "stretch",
    borderTopWidth: 1,
    borderColor: c.brandSecondary,
  },
  qrWrap: {
    alignSelf: "center",
    padding: spacing.sm,
    backgroundColor: "#ffffff",
    borderRadius: radius.md,
    marginVertical: spacing.xs,
  },
  endSheet: {
    backgroundColor: c.surfaceSecondary,
    borderTopLeftRadius: radius.lg * 1.5,
    borderTopRightRadius: radius.lg * 1.5,
    padding: spacing.lg,
    gap: spacing.md,
    borderTopWidth: 1,
    borderColor: c.brandSecondary,
  },
  joiningText: { color: c.onSurfaceSecondary, fontSize: 17, fontWeight: "600" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    backgroundColor: c.surface,
    borderBottomWidth: 1,
    borderBottomColor: c.divider,
  },
  headerTitle: { fontFamily: fonts.display, fontSize: 32, lineHeight: 38, color: c.onSurface },
  iconBtn: {
    width: 48,
    height: 48,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: c.surfaceSecondary,
  },
  boundCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: c.brandTertiary, borderRadius: radius.lg, padding: spacing.md, borderWidth: 1, borderColor: c.brandSecondary },
  boundName: { color: c.onSurface, fontSize: 17, fontWeight: "700" },
  boundSub: { color: c.onBrandTertiary, fontSize: 13, marginTop: 1 },
  progress: { height: 3, backgroundColor: c.surfaceTertiary },
  progressFill: { height: 3, backgroundColor: c.brand },
  menu: { padding: spacing.md, gap: spacing.sm, backgroundColor: c.surfaceSecondary, borderBottomWidth: 1, borderBottomColor: c.border },
  scroll: { padding: spacing.lg, gap: spacing.md },
  phaseCard: {
    backgroundColor: c.surfaceSecondary,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
    borderWidth: 1,
    borderColor: c.brandTertiary,
  },
  phaseTitle: { fontSize: 36, lineHeight: 40, color: c.brand },
  helpLink: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, minHeight: 44 },
  helpLinkText: { color: c.brand, fontSize: 15, fontWeight: "700" },
  turnRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  turnText: { color: c.onSurfaceSecondary, fontSize: 16, fontWeight: "600" },
  sectionHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.sm, gap: spacing.sm },
  sectionTitle: { color: c.muted, fontSize: 15, fontWeight: "600", flex: 1 },
  waitNote: { color: c.muted, fontSize: 14, lineHeight: 20, textAlign: "center", paddingHorizontal: spacing.md },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 40,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: c.brandSecondary,
    flexShrink: 0,
  },
  chipOn: { backgroundColor: c.brandPrimary, borderColor: c.brandPrimary },
  chipText: { color: c.brand, fontSize: 14, fontWeight: "700" },
  row: {
    minHeight: 68,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
    backgroundColor: c.surfaceSecondary,
    borderWidth: 1,
    borderColor: c.border,
  },
  rowOut: { opacity: 0.6 },
  rowPressed: { backgroundColor: c.surfaceTertiary },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: c.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontFamily: fonts.display, fontSize: 24, color: c.brand },
  rowName: { fontSize: 19, fontWeight: "600", color: c.onSurface },
  rowRole: { fontSize: 13, fontWeight: "700", letterSpacing: 1.5, textTransform: "uppercase" },
  rowExit: { fontSize: 13, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase", color: c.muted },
}));
