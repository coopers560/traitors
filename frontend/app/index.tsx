import Ionicons from "@react-native-vector-icons/ionicons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Share, Text, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, GameState, PublicPlayer } from "@/src/api";
import { ConfirmSheet } from "@/src/components/confirm-sheet";
import { SkipRequest, SkipSheet } from "@/src/components/skip-sheet";
import { Backdrop, Body, Button, ErrorText, Eyebrow, Hearts, IMAGES, Title } from "@/src/components/ui";
import { useGameCode } from "@/src/game-code";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

type ActiveGame = Extract<GameState, { exists: true }>;

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
  if (!data.exists) return <Welcome gone={!!data.gone} />;
  return <Dashboard game={data} refreshing={pulling} onRefresh={onRefresh} />;
}

function Welcome({ gone }: { gone: boolean }) {
  const styles = useStyles();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { code, gone: goneFlag, setCode } = useGameCode();
  // The game this phone was in has been ended on another phone: forget its code
  useEffect(() => {
    if (gone && code) setCode(null, { gone: true });
  }, [gone, code, setCode]);
  const showGone = gone || goneFlag;
  return (
    <View style={styles.root} testID="welcome-screen">
      <Backdrop image={IMAGES.castle} />
      <View style={[styles.welcome, { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.lg }]}>
        <Animated.View entering={FadeInDown.duration(700)} style={{ gap: spacing.sm }}>
          <Eyebrow>Holiday edition · Egypt</Eyebrow>
          <Title style={styles.heroTitle}>The Traitors</Title>
          <Body>
            Twelve days. Two lives each. Hidden among the family are Traitors who murder in plain sight. Find them
            before it&apos;s too late.
          </Body>
        </Animated.View>
        <Animated.View entering={FadeInDown.duration(400)} style={{ gap: spacing.md }}>
          {showGone ? <ErrorText testID="welcome-game-gone" message="Your game was ended on another phone." /> : null}
          <Button testID="welcome-new-game-button" label="Begin a new game" icon="flame" onPress={() => router.push("/setup")} />
          <Button testID="welcome-join-button" label="Join with a code" variant="secondary" icon="enter-outline" onPress={() => router.push("/join")} />
          <Button
            testID="welcome-how-to-play-button"
            label="How to play"
            variant="ghost"
            icon="book-outline"
            onPress={() => router.push("/how-to-play")}
          />
        </Animated.View>
      </View>
    </View>
  );
}

const PHASE_COPY: Record<string, { eyebrow: string; title: string; body: string }> = {
  setup: {
    eyebrow: "The Gathering",
    title: "Discover your role",
    body: "Pass the phone around, or use several phones at once. Each player taps their own name, enters their PIN and secretly learns if they are Faithful or a Traitor. Tip: to use your own secret actions, edit them in the ⋯ menu before anyone takes a turn.",
  },
  day: {
    eyebrow: "During the day",
    title: "Murder in plain sight",
    body: "The Traitors know their victim and a secret action to perform on them today. Enjoy the holiday — but watch who hands what to whom.",
  },
  roundtable: {
    eyebrow: "This evening",
    title: "The Round Table",
    body: "Argue, accuse, defend. Then everyone casts a secret vote to banish someone — on any phone, all at the same time if you like.",
  },
  reveal: {
    eyebrow: "The verdict",
    title: "The results are in",
    body: "Gather everyone together before you open the envelope.",
  },
};

function Dashboard({ game, refreshing, onRefresh }: { game: ActiveGame; refreshing: boolean; onRefresh: () => void }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [menu, setMenu] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [peekMode, setPeekMode] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  // Skip and Undo both go through SkipSheet: only player 1 can do them, with their PIN
  const [skipping, setSkipping] = useState<SkipRequest | null>(null);
  const host = game.players.find((p) => p.id === game.host_id);
  const { setCode } = useGameCode();

  const advance = useMutation({
    mutationFn: () => api.advance(game.phase, game.day),
    onSuccess: (s) => {
      qc.setQueryData(["game"], s);
      if (s.exists && s.phase === "reveal") router.push("/reveal");
    },
  });
  const endGame = useMutation({
    mutationFn: api.deleteGame,
    onSuccess: async () => {
      setConfirmEnd(false);
      await setCode(null);
    },
  });
  const shareCode = async () => {
    try {
      await Share.share({
        message: `Join our Traitors game! Open the app, tap "Join with a code" and enter: ${game.code}`,
      });
    } catch {
      // sharing cancelled or not supported (web): the code is visible on screen anyway
    }
  };

  const { phase } = game;
  const allDone = game.turns_done >= game.turns_needed;
  const copy = PHASE_COPY[phase];
  const takingTurns = phase === "setup" || phase === "roundtable";
  const alive = game.players.filter((p) => p.alive);
  const out = game.players.filter((p) => !p.alive);

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
          <Eyebrow>{phase === "setup" ? "Before Day 1" : phase === "ended" ? "Game over" : `Day ${game.day} of ${game.total_days}`}</Eyebrow>
          <Text style={styles.headerTitle} testID="dashboard-day-title">
            {phase === "ended" ? "The Final Verdict" : copy.eyebrow}
          </Text>
        </View>
        <Pressable testID="dashboard-share-code-button" onPress={shareCode} style={styles.codeChip} hitSlop={6} accessibilityLabel={`Game code ${game.code}, tap to share`}>
          <Text style={styles.codeLabel}>Code</Text>
          <Text style={styles.codeText} testID="dashboard-game-code">{game.code}</Text>
        </Pressable>
        <Pressable testID="dashboard-menu-button" onPress={() => setMenu((m) => !m)} style={styles.iconBtn} hitSlop={8}>
          <Ionicons name={menu ? "close" : "ellipsis-horizontal"} size={26} color={colors.onSurface} />
        </Pressable>
      </View>
      {phase !== "setup" && phase !== "ended" ? (
        <View style={styles.progress}>
          <View style={[styles.progressFill, { width: `${(game.day / game.total_days) * 100}%` }]} />
        </View>
      ) : null}

      {menu ? (
        <View style={styles.menu} testID="dashboard-menu">
          <Button testID="menu-how-to-play-button" label="How to play" variant="secondary" icon="book-outline" onPress={() => { setMenu(false); router.push("/how-to-play"); }} />
          <Button testID="menu-history-button" label="Day history" variant="secondary" icon="time-outline" onPress={() => { setMenu(false); router.push("/history"); }} />
          <Button testID="menu-actions-button" label="Secret actions" variant="secondary" icon="list-outline" onPress={() => { setMenu(false); router.push("/actions"); }} />
          <Button testID="menu-share-code-button" label={`Share join code ${game.code}`} variant="secondary" icon="share-social-outline" onPress={() => { setMenu(false); shareCode(); }} />
          <Button testID="menu-leave-game-button" label="Leave game on this phone" variant="secondary" icon="exit-outline" onPress={() => { setMenu(false); setConfirmLeave(true); }} />
          <Button testID="menu-end-game-button" label="End this game for everyone" variant="danger" icon="trash-outline" onPress={() => { setMenu(false); setConfirmEnd(true); }} />
        </View>
      ) : null}

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.lg }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} />}
      >
        {phase === "ended" ? (
          <EndedCard game={game} />
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
            <ErrorText testID="advance-error" message={advance.error?.message} />
            {phase === "setup" ? (
              <Button testID="advance-start-day-button" label="Begin Day 1" icon="sunny" disabled={!allDone} loading={advance.isPending} onPress={() => advance.mutate()} />
            ) : phase === "day" ? (
              <Button testID="advance-round-table-button" label="Gather at the Round Table" icon="flame" loading={advance.isPending} onPress={() => advance.mutate()} />
            ) : phase === "roundtable" ? (
              <Button testID="advance-reveal-button" label={allDone ? "Reveal the results" : "Waiting for votes…"} icon="mail-open" disabled={!allDone} loading={advance.isPending} onPress={() => advance.mutate()} />
            ) : (
              <Button testID="open-reveal-button" label="Open the envelope" icon="mail" onPress={() => router.push("/reveal")} />
            )}
          </Animated.View>
        )}

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
            <PlayerRow
              key={p.id}
              p={p}
              index={i}
              showTurn={takingTurns && !peekMode}
              onPress={() => onPlayer(p)}
              disabled={phase === "ended"}
              onSkip={phase === "roundtable" ? () => setSkipping({ player: p, undo: false }) : undefined}
              onUnskip={() => setSkipping({ player: p, undo: true })}
            />
          ))}
        </View>

        {out.length ? (
          <>
            <Text style={[styles.sectionTitle, { marginTop: spacing.lg }]}>Eliminated</Text>
            <View style={{ gap: spacing.sm }}>
              {out.map((p, i) => (
                <PlayerRow key={p.id} p={p} index={i} showTurn={false} onPress={() => onPlayer(p)} disabled={!peekMode} />
              ))}
            </View>
          </>
        ) : null}
      </ScrollView>

      <ConfirmSheet
        visible={confirmEnd}
        title="End this game?"
        message="All roles, lives and votes will be lost on every phone. This cannot be undone."
        confirmLabel="Yes, end the game"
        danger
        loading={endGame.isPending}
        onConfirm={() => endGame.mutate()}
        onCancel={() => setConfirmEnd(false)}
      />
      <SkipSheet
        request={skipping}
        host={host}
        onDone={(s) => {
          setSkipping(null);
          qc.setQueryData(["game"], s);
        }}
        onError={() => qc.invalidateQueries({ queryKey: ["game"] })}
        onCancel={() => setSkipping(null)}
      />
      <ConfirmSheet
        visible={confirmLeave}
        title="Leave on this phone?"
        message={`The game carries on for everyone else. You can come back any time with the code ${game.code}.`}
        confirmLabel="Leave this game"
        onConfirm={() => { setConfirmLeave(false); setCode(null); }}
        onCancel={() => setConfirmLeave(false)}
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
  onSkip,
  onUnskip,
}: {
  p: PublicPlayer;
  index: number;
  showTurn: boolean;
  onPress: () => void;
  disabled?: boolean;
  onSkip?: () => void;
  onUnskip?: () => void;
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
          {p.role ? (
            <Text style={[styles.rowRole, { color: p.role === "traitor" ? colors.traitor : colors.brand }]} testID={`player-role-${p.id}`}>
              {p.role === "traitor" ? "Traitor" : "Faithful"}
            </Text>
          ) : null}
          {showTurn && p.skipped ? (
            <Text style={styles.skippedText} testID={`player-skipped-label-${p.id}`}>
              Not voting today{p.skipped_by ? ` · skipped by ${p.skipped_by}` : ""}
            </Text>
          ) : null}
        </View>
        {showTurn && onSkip && !p.turn_done ? (
          <Pressable testID={`player-skip-button-${p.id}`} onPress={onSkip} style={styles.skipBtn} hitSlop={6}>
            <Text style={styles.skipText}>Skip</Text>
          </Pressable>
        ) : null}
        {showTurn && p.skipped ? (
          <Pressable testID={`player-unskip-button-${p.id}`} onPress={onUnskip} style={styles.skipBtn} hitSlop={6}>
            <Text style={styles.skipText}>Undo</Text>
          </Pressable>
        ) : null}
        {showTurn ? (
          <Ionicons
            testID={`player-turn-status-${p.id}`}
            name={p.skipped ? "remove-circle-outline" : p.turn_done ? "checkmark-circle" : "ellipse-outline"}
            size={26}
            color={p.skipped ? colors.muted : p.turn_done ? colors.brand : colors.borderStrong}
          />
        ) : (
          <Hearts lives={p.lives} />
        )}
      </Pressable>
    </Animated.View>
  );
}

function EndedCard({ game }: { game: ActiveGame }) {
  const styles = useStyles();
  const { setCode } = useGameCode();
  const router = useRouter();
  const [confirmNew, setConfirmNew] = useState(false);
  const del = useMutation({ mutationFn: api.deleteGame, onSuccess: async () => { setConfirmNew(false); await setCode(null); } });
  const traitorsWin = game.winner === "traitors";
  return (
    <Animated.View entering={FadeInDown.duration(600)} style={styles.phaseCard} testID="ended-card">
      <Eyebrow>{traitorsWin ? "Treachery triumphs" : "Justice is served"}</Eyebrow>
      <Title testID="winner-title" style={styles.phaseTitle}>
        {traitorsWin ? "The Traitors win" : "The Faithful win"}
      </Title>
      <Body>All roles are now revealed below. Well played, everyone.</Body>
      <Button testID="share-finale-button" label="Share the finale" icon="share-social" onPress={() => router.push("/finale")} />
      <Button testID="ended-history-button" label="Day history" variant="secondary" icon="time-outline" onPress={() => router.push("/history")} />
      <Button testID="new-game-button" label="Start a new game" variant="ghost" icon="refresh" onPress={() => setConfirmNew(true)} />
      <ConfirmSheet
        visible={confirmNew}
        title="Start a new game?"
        message="This game's results and history will be cleared. Share the picture first if you want to keep it."
        confirmLabel="Yes, start fresh"
        loading={del.isPending}
        onConfirm={() => del.mutate()}
        onCancel={() => setConfirmNew(false)}
      />
    </Animated.View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  center: { flex: 1, backgroundColor: c.surface, alignItems: "center", justifyContent: "center" },
  welcome: { flex: 1, paddingHorizontal: spacing.lg, justifyContent: "space-between" },
  heroTitle: { fontSize: 64, lineHeight: 68, color: c.onSurface },
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
  codeChip: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: spacing.sm,
    marginRight: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: c.brandSecondary,
    backgroundColor: c.brandTertiary,
  },
  codeLabel: { color: c.onSurfaceTertiary, fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", fontWeight: "600" },
  codeText: { color: c.brand, fontSize: 17, fontWeight: "800", letterSpacing: 2 },
  iconBtn: {
    width: 48,
    height: 48,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: c.surfaceSecondary,
  },
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
  turnRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  turnText: { color: c.onSurfaceSecondary, fontSize: 16, fontWeight: "600" },
  sectionHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.sm, gap: spacing.sm },
  sectionTitle: { color: c.muted, fontSize: 15, fontWeight: "600", flex: 1 },
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
  skippedText: { fontSize: 13, color: c.muted, fontWeight: "600" },
  skipBtn: {
    minHeight: 40,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: c.borderStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  skipText: { color: c.onSurfaceSecondary, fontSize: 14, fontWeight: "700" },
}));
