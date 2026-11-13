import Ionicons from "@react-native-vector-icons/ionicons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, GameState, PublicPlayer } from "@/src/api";
import { ConfirmSheet } from "@/src/components/confirm-sheet";
import { PinPad } from "@/src/components/pin-pad";
import { QrCode } from "@/src/components/qr-code";
import { Backdrop, Body, Button, ErrorText, Eyebrow, IMAGES, Title } from "@/src/components/ui";
import { useGameCode } from "@/src/game-code";
import { inviteLink, shareInvite, shareToWhatsApp } from "@/src/utils/invite";
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
            Twelve days. Hidden among the family are Traitors who murder in plain sight. Find them
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
    title: "Enjoy the holiday",
    body: "Mingle, relax and watch everyone closely. The Traitors strike tonight — after the Round Table — so there is nothing to do yet but gather clues.",
  },
  roundtable: {
    eyebrow: "This evening",
    title: "The Round Table",
    body: "Argue, accuse, defend. Then everyone casts a secret vote to banish someone — on any phone, all at the same time if you like.",
  },
  banished: {
    eyebrow: "The verdict",
    title: "The banishment",
    body: "Gather everyone together to see who the table has banished — before the night falls.",
  },
  night: {
    eyebrow: "After dark",
    title: "The Traitors move",
    body: "Everyone taps their name in private. The Traitors secretly choose who to murder; everyone else simply passes the phone on — so no one can tell who acted.",
  },
  reveal: {
    eyebrow: "The morning after",
    title: "Who did the Traitors take?",
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
  const [invite, setInvite] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [confirmSkip, setConfirmSkip] = useState(false);
  const [endPin, setEndPin] = useState("");
  const [peekMode, setPeekMode] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const { setCode } = useGameCode();

  const advance = useMutation({
    mutationFn: (force?: boolean) => api.advance(game.phase, game.day, force),
    onSuccess: (s) => {
      qc.setQueryData(["game"], s);
      setConfirmSkip(false);
      if (s.exists && (s.phase === "banished" || s.phase === "reveal")) router.push("/reveal");
    },
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
  const copy =
    phase === "roundtable" && game.endgame
      ? {
          eyebrow: "The final vote",
          title: "Banish, or end the game",
          body: "Only a few of you remain. Each player votes to banish one more — or to end the game now. If everyone votes to end while a Traitor is still among you, the Traitors win.",
        }
      : PHASE_COPY[phase];
  const takingTurns = phase === "setup" || phase === "roundtable" || phase === "night";
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
        <Pressable testID="dashboard-share-code-button" onPress={openInvite} style={styles.codeChip} hitSlop={6} accessibilityLabel={`Game code ${game.code}, tap to invite players`}>
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
          <Button testID="menu-share-code-button" label="Invite players (QR & link)" variant="secondary" icon="qr-code-outline" onPress={openInvite} />
          <Button testID="menu-leave-game-button" label="Leave game on this phone" variant="secondary" icon="exit-outline" onPress={() => { setMenu(false); setConfirmLeave(true); }} />
          <Button testID="menu-end-game-button" label="End this game for everyone" variant="danger" icon="trash-outline" onPress={() => { setMenu(false); setEndPin(""); endGame.reset(); setConfirmEnd(true); }} />
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
              <Button testID="advance-round-table-button" label={game.endgame ? "Gather for the final vote" : "Gather at the Round Table"} icon="flame" loading={advance.isPending} onPress={() => advance.mutate()} />
            ) : phase === "roundtable" ? (
              <>
                <Button testID="advance-reveal-button" label={allDone ? (game.endgame ? "Reveal the vote" : "Reveal the banishment") : "Waiting for votes…"} icon="mail-open" disabled={!allDone} loading={advance.isPending && allDone} onPress={() => advance.mutate()} />
                {!allDone ? (
                  <Button testID="advance-skip-missing-button" label="Someone missing? Skip & reveal" variant="ghost" icon="play-skip-forward-outline" onPress={() => setConfirmSkip(true)} />
                ) : null}
              </>
            ) : phase === "night" ? (
              <Button testID="advance-murder-button" label={allDone ? "Reveal the murder" : "Waiting for the night…"} icon="moon" disabled={!allDone} loading={advance.isPending} onPress={() => advance.mutate()} />
            ) : phase === "banished" ? (
              <Button testID="open-banishment-button" label="Open the banishment" icon="mail" onPress={() => router.push("/reveal")} />
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
            <PlayerRow key={p.id} p={p} index={i} showTurn={takingTurns && !peekMode} onPress={() => onPlayer(p)} disabled={phase === "ended"} />
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

      <InviteSheet visible={invite} code={game.code} onClose={() => setInvite(false)} />

      <ConfirmSheet
        visible={confirmSkip}
        title="Skip missing players?"
        message={`${game.turns_done} of ${game.turns_needed} have voted. The banishment will be decided on the votes cast so far — anyone who hasn't voted is skipped.`}
        confirmLabel="Skip & reveal"
        danger
        loading={advance.isPending}
        onConfirm={() => advance.mutate(true)}
        onCancel={() => setConfirmSkip(false)}
      />

      <EndGameSheet
        visible={confirmEnd}
        hostName={game.host_name ?? "the host"}
        value={endPin}
        onChange={setEndPin}
        loading={endGame.isPending}
        error={endGame.error?.message}
        onCancel={() => { setConfirmEnd(false); setEndPin(""); endGame.reset(); }}
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

function PlayerRow({ p, index, showTurn, onPress, disabled }: { p: PublicPlayer; index: number; showTurn: boolean; onPress: () => void; disabled?: boolean }) {
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
  const murders = game.history.filter((h) => h.murder?.success && h.murder?.action);
  if (!murders.length) return null;
  return (
    <View style={styles.methodsCard} testID="murder-methods">
      <Text style={styles.methodsTitle}>How the murders were done</Text>
      {murders.map((h) => (
        <View key={h.day} style={styles.methodRow}>
          <Text style={styles.methodDay}>Day {h.day}</Text>
          <Text style={styles.methodText}>
            <Text style={{ fontWeight: "700" }}>{h.murder.victim_name}</Text> — {h.murder.action}
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

function InviteSheet({ visible, code, onClose }: { visible: boolean; code: string; onClose: () => void }) {
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
            <QrCode value={inviteLink(code)} size={224} />
          </View>
        ) : null}
        <Text style={styles.inviteCode} testID="invite-code">{code}</Text>
        <Body style={{ textAlign: "center" }}>Point a phone camera at the code, or open the app and enter the code above.</Body>
        <Button testID="invite-whatsapp-button" label="Share on WhatsApp" icon="logo-whatsapp" onPress={() => shareToWhatsApp(code)} />
        <Button testID="invite-share-button" label="Share another way" variant="secondary" icon="share-social-outline" onPress={() => shareInvite(code)} />
        <Button testID="invite-close-button" label="Done" variant="ghost" onPress={onClose} />
      </View>
    </Modal>
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
  methodDay: { color: c.muted, fontSize: 13, fontWeight: "700", minWidth: 46 },
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
  inviteCode: {
    textAlign: "center",
    color: c.brand,
    fontSize: 34,
    fontWeight: "800",
    letterSpacing: 6,
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
}));
