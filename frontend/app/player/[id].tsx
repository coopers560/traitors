import Ionicons from "@react-native-vector-icons/ionicons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, PrivateView, PublicPlayer } from "@/src/api";
import { PinPad } from "@/src/components/pin-pad";
import { Backdrop, Body, Button, ErrorText, Eyebrow, IMAGES, Title } from "@/src/components/ui";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

export default function PlayerTurn() {
  const styles = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id, mode } = useLocalSearchParams<{ id: string; mode: "turn" | "peek" }>();
  const { data: game } = useQuery({ queryKey: ["game"], queryFn: api.getGame });
  const qc = useQueryClient();

  const [pin, setPin] = useState("");
  const [view, setView] = useState<PrivateView | null>(null);
  const [sealed, setSealed] = useState(false);

  const players = game?.exists ? game.players : [];
  const me = players.find((p) => p.id === id);

  const verify = useMutation({
    mutationFn: () => api.privateView(id, pin),
    onSuccess: setView,
    onError: () => setPin(""),
  });

  useEffect(() => {
    if (pin.length === 4 && !verify.isPending && !view) verify.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin]);

  const leave = () => {
    qc.invalidateQueries({ queryKey: ["game"] });
    router.back();
  };

  const bg = view?.role === "traitor" ? IMAGES.hood : IMAGES.candle;

  return (
    <View style={styles.root} testID="player-screen">
      <Backdrop image={bg} strong={!!view} />
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="player-close-button" onPress={leave} style={styles.iconBtn} hitSlop={8}>
          <Ionicons name="close" size={26} color={colors.onSurface} />
        </Pressable>
      </View>

      {!view ? (
        <View style={[styles.pinWrap, { paddingBottom: insets.bottom + spacing.lg }]}>
          <Animated.View entering={FadeInDown.duration(500)} style={{ alignItems: "center", gap: spacing.sm }}>
            <Eyebrow>Hand the phone to</Eyebrow>
            <Title testID="player-name-title" style={{ textAlign: "center", fontSize: 48, lineHeight: 52 }}>
              {me?.name ?? "…"}
            </Title>
            <Body style={{ textAlign: "center" }}>Make sure nobody is looking, then enter your PIN.</Body>
          </Animated.View>
          <ErrorText testID="pin-error" message={verify.error?.message} />
          <PinPad value={pin} onChange={setPin} disabled={verify.isPending} />
        </View>
      ) : sealed ? (
        <Sealed onDone={leave} />
      ) : (
        <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.lg }]}>
          <RoleCard view={view} />
          {mode === "turn" && view.phase === "setup" ? (
            <SetupTurn view={view} pin={pin} players={players} onSealed={() => setSealed(true)} />
          ) : mode === "turn" && view.phase === "roundtable" && view.alive ? (
            <RoundTableTurn view={view} pin={pin} players={players} onSealed={() => setSealed(true)} />
          ) : (
            <>
              {view.role === "traitor" && view.phase === "day" && view.alive && !view.target ? (
                <DayRepick view={view} pin={pin} players={players} onPicked={setView} />
              ) : view.role === "traitor" ? (
                <TraitorBrief view={view} />
              ) : (
                <FaithfulBrief view={view} />
              )}
              <Button testID="player-hide-button" label="Hide & pass the phone back" icon="eye-off" onPress={leave} />
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}

function RoleCard({ view }: { view: PrivateView }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const traitor = view.role === "traitor";
  return (
    <Animated.View entering={FadeIn.duration(800)} style={[styles.roleCard, traitor && { borderColor: colors.traitor }]} testID="role-card">
      <Eyebrow>{view.name}, you are</Eyebrow>
      <Text testID="role-title" style={[styles.roleTitle, { color: traitor ? colors.traitor : colors.brand }]}>
        {traitor ? "A Traitor" : "Faithful"}
      </Text>
      {traitor && view.fellow_traitors ? (
        <Body testID="fellow-traitors">
          {view.fellow_traitors.length
            ? `Your fellow Traitor${view.fellow_traitors.length > 1 ? "s" : ""}: ${view.fellow_traitors.join(", ")}`
            : "You are the only Traitor."}
        </Body>
      ) : !traitor ? (
        <Body>Find the Traitors and banish them at the Round Table.</Body>
      ) : null}
      {!view.alive ? <Body style={{ color: colors.muted }}>You have been eliminated, but please keep the secrets.</Body> : null}
    </Animated.View>
  );
}

function TraitorBrief({ view }: { view: PrivateView }) {
  const styles = useStyles();
  if (!view.target) return <Body>No murder is planned right now.</Body>;
  return (
    <View style={styles.brief} testID="traitor-brief">
      <Eyebrow>Today&apos;s murder · Day {view.day}</Eyebrow>
      <Text style={styles.briefTarget} testID="traitor-target-name">{view.target.name}</Text>
      <Text style={styles.briefLabel}>Your secret action — do it in plain sight:</Text>
      <Text style={styles.briefAction} testID="traitor-action">{view.action}</Text>
      <Body style={{ fontSize: 15 }}>Any Traitor may do it. Be natural — don&apos;t get caught!</Body>
    </View>
  );
}

function FaithfulBrief({ view }: { view: PrivateView }) {
  return (
    <Body testID="faithful-brief">
      {view.alive ? "Stay alert today. The Traitors are hiding a simple action in everyday moments." : "Watch quietly and enjoy the drama."}
    </Body>
  );
}

function VictimPicker({
  label,
  players,
  selected,
  onSelect,
  excludeId,
  prefix,
}: {
  label: string;
  players: PublicPlayer[];
  selected: string | null;
  onSelect: (id: string) => void;
  excludeId?: string;
  prefix: string;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={styles.pickLabel}>{label}</Text>
      {players
        .filter((p) => p.alive && p.id !== excludeId)
        .map((p) => {
          const on = selected === p.id;
          return (
            <Pressable
              key={p.id}
              testID={`${prefix}-${p.id}`}
              onPress={() => onSelect(p.id)}
              style={[styles.pick, on && styles.pickOn]}
            >
              <Text style={[styles.pickText, on && { color: colors.onBrandPrimary }]}>{p.name}</Text>
              <Ionicons name={on ? "radio-button-on" : "radio-button-off"} size={24} color={on ? colors.onBrandPrimary : colors.borderStrong} />
            </Pressable>
          );
        })}
    </View>
  );
}

function DayRepick({ view, pin, players, onPicked }: { view: PrivateView; pin: string; players: PublicPlayer[]; onPicked: (v: PrivateView) => void }) {
  const [target, setTarget] = useState<string | null>(null);
  const submit = useMutation({
    mutationFn: () => api.takeTurn({ player_id: view.player_id, pin, target_id: target ?? undefined }),
    onSuccess: onPicked,
  });
  const traitorIds = new Set<string>();
  players.forEach((p) => (view.fellow_traitors?.includes(p.name) || p.id === view.player_id) && traitorIds.add(p.id));
  return (
    <>
      <Body testID="day-repick-info">Your planned victim is gone. Choose someone new for today — you will get a fresh secret action.</Body>
      <VictimPicker label={`Day ${view.day} victim`} prefix="day-victim" players={players.filter((p) => !traitorIds.has(p.id))} selected={target} onSelect={setTarget} />
      <ErrorText testID="turn-error" message={submit.error?.message} />
      <Button testID="day-repick-submit-button" label="Seal the victim" icon="skull" disabled={!target} loading={submit.isPending} onPress={() => submit.mutate()} />
    </>
  );
}

function SetupTurn({ view, pin, players, onSealed }: { view: PrivateView; pin: string; players: PublicPlayer[]; onSealed: () => void }) {
  const [target, setTarget] = useState<string | null>(view.target?.id ?? null);
  const [result, setResult] = useState<PrivateView | null>(null);
  const submit = useMutation({
    mutationFn: () => api.takeTurn({ player_id: view.player_id, pin, target_id: target ?? undefined }),
    onSuccess: (v) => (view.role === "traitor" ? setResult(v) : onSealed()),
  });
  const traitorIds = new Set<string>();
  // Traitors cannot target each other; we only know fellow names, so filter by name
  players.forEach((p) => (view.fellow_traitors?.includes(p.name) || p.id === view.player_id) && traitorIds.add(p.id));

  if (view.role !== "traitor") {
    return (
      <>
        <FaithfulBrief view={view} />
        <ErrorText testID="turn-error" message={submit.error?.message} />
        <Button testID="setup-turn-confirm-button" label="I understand — hide it" icon="eye-off" loading={submit.isPending} onPress={() => submit.mutate()} />
      </>
    );
  }
  if (result) {
    return (
      <>
        <TraitorBrief view={result} />
        <Button testID="setup-turn-done-button" label="Hide & pass the phone" icon="eye-off" onPress={onSealed} />
      </>
    );
  }
  return (
    <>
      <Body>
        {view.target ? `Victim chosen so far: ${view.target.name}. You can keep it or change it.` : "Choose who you will murder on Day 1. You will then get a secret action to perform on them."}
      </Body>
      <VictimPicker
        label="Day 1 victim"
        prefix="setup-victim"
        players={players.filter((p) => !traitorIds.has(p.id))}
        selected={target}
        onSelect={setTarget}
      />
      <ErrorText testID="turn-error" message={submit.error?.message} />
      <Button testID="setup-turn-submit-button" label="Seal the victim" icon="skull" disabled={!target} loading={submit.isPending} onPress={() => submit.mutate()} />
    </>
  );
}

function RoundTableTurn({ view, pin, players, onSealed }: { view: PrivateView; pin: string; players: PublicPlayer[]; onSealed: () => void }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const traitor = view.role === "traitor";
  const lastDay = view.day >= 12;
  const [vote, setVote] = useState<string | null>(view.my_vote_id);
  const [done, setDone] = useState<boolean | null>(view.murder_confirmed ? true : null);
  const [next, setNext] = useState<string | null>(view.next_target?.id ?? null);

  const traitorIds = new Set<string>();
  players.forEach((p) => (view.fellow_traitors?.includes(p.name) || p.id === view.player_id) && traitorIds.add(p.id));
  const needsMurder = traitor && !!view.target;
  const needsNext = traitor && !lastDay;
  const ready = !!vote && (!needsMurder || done !== null) && (!needsNext || !!next);

  const submit = useMutation({
    mutationFn: () =>
      api.takeTurn({
        player_id: view.player_id,
        pin,
        vote_target_id: vote ?? undefined,
        murder_done: needsMurder ? !!done : undefined,
        target_id: needsNext ? next ?? undefined : undefined,
      }),
    onSuccess: onSealed,
  });

  return (
    <>
      {needsMurder ? (
        <View style={styles.brief} testID="murder-confirm">
          <Eyebrow>Today&apos;s murder</Eyebrow>
          <Text style={styles.briefLabel}>
            Did a Traitor &quot;{view.action}&quot; to {view.target?.name} today?
          </Text>
          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            <Pressable testID="murder-done-yes" onPress={() => setDone(true)} style={[styles.pick, { flex: 1 }, done === true && styles.pickOn]}>
              <Text style={[styles.pickText, done === true && { color: colors.onBrandPrimary }]}>Yes, done</Text>
            </Pressable>
            <Pressable testID="murder-done-no" onPress={() => setDone(false)} style={[styles.pick, { flex: 1 }, done === false && styles.pickOn]}>
              <Text style={[styles.pickText, done === false && { color: colors.onBrandPrimary }]}>No</Text>
            </Pressable>
          </View>
          {view.murder_confirmed ? <Body style={{ fontSize: 15 }}>A fellow Traitor already confirmed it.</Body> : null}
        </View>
      ) : null}

      <VictimPicker label="Who do you vote to banish?" prefix="vote-option" players={players} selected={vote} onSelect={setVote} excludeId={view.player_id} />

      {needsNext ? (
        <View style={{ marginTop: spacing.md }}>
          <VictimPicker
            label={`Traitors only: tomorrow's victim (Day ${view.day + 1})`}
            prefix="next-victim"
            players={players.filter((p) => !traitorIds.has(p.id))}
            selected={next}
            onSelect={setNext}
          />
        </View>
      ) : null}

      <ErrorText testID="turn-error" message={submit.error?.message} />
      <Button testID="vote-submit-button" label="Seal my vote" icon="lock-closed" disabled={!ready} loading={submit.isPending} onPress={() => submit.mutate()} />
    </>
  );
}

function Sealed({ onDone }: { onDone: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <Animated.View
      entering={FadeIn.duration(500)}
      style={{ flex: 1, justifyContent: "center", padding: spacing.lg, gap: spacing.lg, paddingBottom: insets.bottom + spacing.lg }}
      testID="turn-sealed"
    >
      <Eyebrow>Sealed</Eyebrow>
      <Title>Your secret is safe.</Title>
      <Body>Pass the phone back and tap the next person&apos;s name.</Body>
      <Button testID="turn-sealed-done-button" label="Back to the castle" icon="home" onPress={onDone} />
    </Animated.View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  header: { paddingHorizontal: spacing.md, flexDirection: "row", justifyContent: "flex-end" },
  iconBtn: { width: 48, height: 48, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", backgroundColor: c.surfaceSecondary },
  pinWrap: { flex: 1, justifyContent: "space-evenly", alignItems: "center", paddingHorizontal: spacing.lg, gap: spacing.md },
  scroll: { padding: spacing.lg, gap: spacing.lg },
  roleCard: {
    gap: spacing.sm,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: c.brandSecondary,
    backgroundColor: c.surfaceSecondary,
  },
  roleTitle: { fontFamily: fonts.display, fontSize: 56, lineHeight: 60 },
  brief: { gap: spacing.sm, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: c.brandTertiary },
  briefTarget: { fontFamily: fonts.display, fontSize: 40, lineHeight: 44, color: c.onSurface },
  briefLabel: { color: c.onSurfaceSecondary, fontSize: 17, lineHeight: 24, fontWeight: "600" },
  briefAction: { fontFamily: fonts.displaySemi, fontSize: 30, lineHeight: 34, color: c.brand },
  pickLabel: { color: c.brand, fontSize: 15, fontWeight: "700", letterSpacing: 0.5 },
  pick: {
    minHeight: 60,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: c.surfaceSecondary,
    borderWidth: 1,
    borderColor: c.border,
  },
  pickOn: { backgroundColor: c.brandPrimary, borderColor: c.brandPrimary },
  pickText: { color: c.onSurface, fontSize: 19, fontWeight: "600" },
}));
