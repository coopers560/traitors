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

  // Always the same backdrop, whatever the role: a glance from across the room
  // must not reveal who is a Traitor. The role is shown only in text, up close.
  const bg = IMAGES.candle;

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
            <SetupTurn view={view} pin={pin} onSealed={() => setSealed(true)} />
          ) : mode === "turn" && view.phase === "roundtable" && view.alive ? (
            <RoundTableTurn view={view} pin={pin} players={players} onSealed={() => setSealed(true)} />
          ) : mode === "turn" && view.phase === "night" && view.alive ? (
            <NightTurn view={view} pin={pin} players={players} onSealed={() => setSealed(true)} />
          ) : (
            <>
              {view.role === "traitor" ? <TraitorBrief view={view} /> : <FaithfulBrief view={view} />}
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

function ActionChoices({ options, selected, onSelect }: { options: string[]; selected: string | null; onSelect: (a: string) => void }) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={styles.pickLabel}>Choose your secret action</Text>
      {options.map((a) => {
        const on = selected === a;
        return (
          <Pressable key={a} testID={`action-choice-${a}`} onPress={() => onSelect(a)} style={[styles.pick, { minHeight: 64 }, on && styles.pickOn]}>
            <Text style={[styles.pickText, { flex: 1 }, on && { color: colors.onBrandPrimary }]}>{a}</Text>
            <Ionicons name={on ? "radio-button-on" : "radio-button-off"} size={24} color={on ? colors.onBrandPrimary : colors.borderStrong} />
          </Pressable>
        );
      })}
    </View>
  );
}

function NightTurn({ view, pin, players, onSealed }: { view: PrivateView; pin: string; players: PublicPlayer[]; onSealed: () => void }) {
  const traitor = view.role === "traitor";
  const [target, setTarget] = useState<string | null>(view.target?.id ?? null);
  const [choices, setChoices] = useState<string[]>(view.action_choices ?? []);
  const [chosen, setChosen] = useState<string | null>(null);
  const [override, setOverride] = useState(false);
  const [result, setResult] = useState<PrivateView | null>(null);

  const traitorIds = new Set<string>();
  // Traitors cannot murder each other; we only know fellow names, so filter by name.
  players.forEach((p) => (view.fellow_traitors?.includes(p.name) || p.id === view.player_id) && traitorIds.add(p.id));

  const pickVictim = useMutation({
    mutationFn: (tid: string) => api.takeTurn({ player_id: view.player_id, pin, target_id: tid }),
    onSuccess: (v) => { setChoices(v.action_choices ?? []); setChosen(null); setOverride(false); },
  });
  const confirm = useMutation({
    mutationFn: (action: string) => api.takeTurn({ player_id: view.player_id, pin, action }),
    onSuccess: (v) => setResult(v),
  });
  const pass = useMutation({
    mutationFn: () => api.takeTurn({ player_id: view.player_id, pin }),
    onSuccess: () => onSealed(),
  });

  // Faithful (and eliminated players) have nothing to do; everyone still takes a
  // night turn so watching who taps never reveals the Traitors.
  if (!traitor) {
    return (
      <>
        <Body testID="night-faithful-note">
          The castle sleeps. There is nothing for you to do tonight — just pass the phone on, so no one can tell who the
          Traitors are.
        </Body>
        <ErrorText testID="turn-error" message={pass.error?.message} />
        <Button testID="night-pass-button" label="Pass the phone on" icon="eye-off" loading={pass.isPending} onPress={() => pass.mutate()} />
      </>
    );
  }
  // This phone just sealed the murder.
  if (result) {
    return (
      <>
        <TraitorBrief view={result} />
        <Button testID="night-done-button" label="Hide & pass the phone" icon="eye-off" onPress={onSealed} />
      </>
    );
  }
  // A fellow Traitor already planned tonight's murder.
  if (view.murder_confirmed && !override && choices.length === 0) {
    return (
      <>
        <TraitorBrief view={view} />
        <ErrorText testID="turn-error" message={pass.error?.message} />
        <Button testID="night-agree-button" label="Agreed — pass the phone" icon="eye-off" loading={pass.isPending} onPress={() => pass.mutate()} />
        <Button testID="night-change-button" label="Change the plan" variant="ghost" icon="create-outline" onPress={() => { setOverride(true); setChoices([]); }} />
      </>
    );
  }
  // Step 2: choose one of the three secret actions.
  if (choices.length > 0) {
    const victimName = players.find((p) => p.id === (target ?? view.target?.id))?.name ?? view.target?.name;
    return (
      <>
        <Body>Victim: {victimName}. Choose how you&apos;ll do it — pick one of these three secret actions to perform in plain sight:</Body>
        <ActionChoices options={choices} selected={chosen} onSelect={setChosen} />
        <ErrorText testID="turn-error" message={confirm.error?.message || pass.error?.message} />
        <Button testID="night-confirm-button" label="Seal the murder" icon="skull" disabled={!chosen} loading={confirm.isPending} onPress={() => chosen && confirm.mutate(chosen)} />
        <Button testID="night-skip-button" label="Lie low — no murder tonight" variant="ghost" loading={pass.isPending} onPress={() => pass.mutate()} />
      </>
    );
  }
  // Step 1: choose the victim.
  return (
    <>
      <Body>
        Now the Round Table is done, choose who the Traitors murder tonight — you&apos;ll then pick from three secret
        actions. Or lie low and spare everyone.
      </Body>
      <VictimPicker label={`Tonight's victim · Day ${view.day}`} prefix="night-victim" players={players.filter((p) => !traitorIds.has(p.id))} selected={target} onSelect={setTarget} />
      <ErrorText testID="turn-error" message={pickVictim.error?.message || pass.error?.message} />
      <Button testID="night-pick-button" label="Choose the method" icon="arrow-forward" disabled={!target} loading={pickVictim.isPending} onPress={() => target && pickVictim.mutate(target)} />
      <Button testID="night-skip-button" label="Lie low — no murder tonight" variant="ghost" loading={pass.isPending} onPress={() => pass.mutate()} />
    </>
  );
}

function SetupTurn({ view, pin, onSealed }: { view: PrivateView; pin: string; onSealed: () => void }) {
  const submit = useMutation({
    mutationFn: () => api.takeTurn({ player_id: view.player_id, pin }),
    onSuccess: () => onSealed(),
  });
  return (
    <>
      {view.role === "traitor" ? (
        <Body testID="setup-traitor-note">
          Remember your fellow Traitors. You&apos;ll choose who to murder after the first Round Table — not before.
        </Body>
      ) : (
        <FaithfulBrief view={view} />
      )}
      <ErrorText testID="turn-error" message={submit.error?.message} />
      <Button testID="setup-turn-confirm-button" label="I understand — hide it" icon="eye-off" loading={submit.isPending} onPress={() => submit.mutate()} />
    </>
  );
}

function RoundTableTurn({ view, pin, players, onSealed }: { view: PrivateView; pin: string; players: PublicPlayer[]; onSealed: () => void }) {
  const [vote, setVote] = useState<string | null>(view.my_vote_id);
  const submit = useMutation({
    mutationFn: () => api.takeTurn({ player_id: view.player_id, pin, vote_target_id: vote ?? undefined }),
    onSuccess: onSealed,
  });
  return (
    <>
      <VictimPicker label="Who do you vote to banish?" prefix="vote-option" players={players} selected={vote} onSelect={setVote} excludeId={view.player_id} />
      <ErrorText testID="turn-error" message={submit.error?.message} />
      <Button testID="vote-submit-button" label="Seal my vote" icon="lock-closed" disabled={!vote} loading={submit.isPending} onPress={() => submit.mutate()} />
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
