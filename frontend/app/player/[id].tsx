import Ionicons from "@react-native-vector-icons/ionicons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, exitOf, PrivateView, PublicPlayer } from "@/src/api";
import { HelpButton } from "@/src/components/help-button";
import { PinPad } from "@/src/components/pin-pad";
import { Backdrop, Body, Button, ErrorText, Eyebrow, IMAGES, Title } from "@/src/components/ui";
import { useMe } from "@/src/me";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

export default function PlayerTurn() {
  const styles = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id, mode } = useLocalSearchParams<{ id: string; mode: "turn" | "peek" }>();
  const { data: game } = useQuery({ queryKey: ["game"], queryFn: api.getGame });
  const qc = useQueryClient();
  const { me: boundMe, setMe, clearMe } = useMe();

  const [pin, setPin] = useState("");
  const [view, setView] = useState<PrivateView | null>(null);
  const [sealed, setSealed] = useState(false);
  // Before every Round Table vote, everyone must privately check who they are now — the
  // Traitors may have recruited someone. Everyone does exactly the same taps, so a recruit
  // looking at their phone never stands out.
  const [roleChecked, setRoleChecked] = useState(false);
  const autoTried = useRef(false);

  const players = game?.exists ? game.players : [];
  const me = players.find((p) => p.id === id);
  const boundHere = boundMe?.playerId === id;

  const verify = useMutation({
    mutationFn: () => api.privateView(id, pin),
    onSuccess: setView,
    onError: () => setPin(""),
  });

  useEffect(() => {
    if (pin.length === 4 && !verify.isPending && !view) verify.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin]);

  // This phone is bound to this player: unlock straight away, no PIN pad. If the
  // saved PIN no longer works (e.g. it was changed), forget the binding and ask.
  useEffect(() => {
    if (view || autoTried.current || !boundMe || boundMe.playerId !== id) return;
    autoTried.current = true;
    api.privateView(id, boundMe.pin)
      .then((v) => { setPin(boundMe.pin); setView(v); })
      .catch(() => clearMe());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boundMe, id, view]);

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
        <HelpButton from="player" testID="player-help-button" />
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
      ) : mode === "turn" && view.phase === "roundtable" && view.alive && !roleChecked ? (
        <RoleCheck view={view} onDone={() => setRoleChecked(true)} />
      ) : (
        <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.lg }]}>
          <RoleCard view={view} exit={game?.exists ? exitOf(game.history, view.player_id) : null} />
          {boundHere ? (
            <Pressable testID="forget-me-button" onPress={() => clearMe()} style={styles.rememberOn}>
              <Ionicons name="checkmark-circle" size={18} color={colors.brand} />
              <Text style={styles.rememberOnText}>This is your phone — no PIN needed. Tap to forget.</Text>
            </Pressable>
          ) : (
            <Pressable testID="remember-me-button" onPress={() => setMe(id, pin)} style={styles.remember}>
              <Ionicons name="phone-portrait-outline" size={20} color={colors.brand} />
              <View style={{ flex: 1 }}>
                <Text style={styles.rememberText}>Remember me on this phone</Text>
                <Text style={styles.rememberSub}>Skip the PIN on your turn next time. Only on your own phone.</Text>
              </View>
            </Pressable>
          )}
          {mode === "turn" && view.phase === "setup" ? (
            <SetupTurn view={view} pin={pin} onSealed={() => setSealed(true)} />
          ) : mode === "turn" && view.phase === "gather" && view.alive ? (
            <GatherTurn view={view} pin={pin} onSealed={() => setSealed(true)} />
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

function RoleCheck({ view, onDone }: { view: PrivateView; onDone: () => void }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [shown, setShown] = useState(false);
  const traitor = view.role === "traitor";
  const fellows = view.fellow_traitors ?? [];
  return (
    <ScrollView contentContainerStyle={[styles.scroll, { flexGrow: 1, justifyContent: "center", paddingBottom: insets.bottom + spacing.lg }]} testID="role-check">
      <Animated.View entering={FadeInDown.duration(500)} style={{ gap: spacing.sm }}>
        <Eyebrow>Before you vote</Eyebrow>
        <Title>Who are you now?</Title>
        <Body>
          Everyone checks this in private before every Round Table — the Traitors may have recruited someone. Make sure
          nobody can see your screen.
        </Body>
      </Animated.View>
      {!shown ? (
        <Pressable testID="role-check-reveal" onPress={() => setShown(true)} style={styles.checkCover} accessibilityRole="button">
          <Ionicons name="eye" size={34} color={colors.brand} />
          <Text style={styles.checkCoverText}>Tap to see who you are</Text>
        </Pressable>
      ) : (
        <Animated.View entering={FadeIn.duration(400)} style={[styles.roleCard, traitor && { borderColor: colors.traitor }]} testID="role-check-card">
          {view.recruited_now ? (
            <>
              <Eyebrow style={{ color: colors.traitor }}>You have been recruited</Eyebrow>
              <Text testID="role-check-title" style={[styles.roleTitle, { color: colors.traitor }]}>You are now a Traitor</Text>
              <Body>
                The Traitors chose you. From now on you plot with them — and you win with them. Keep it secret.
              </Body>
            </>
          ) : (
            <>
              <Eyebrow>{view.name}, you are still</Eyebrow>
              <Text testID="role-check-title" style={[styles.roleTitle, { color: traitor ? colors.traitor : colors.brand }]}>
                {traitor ? "A Traitor" : "Faithful"}
              </Text>
            </>
          )}
          {traitor ? (
            <Body testID="role-check-fellows">
              {fellows.length ? `Your fellow Traitor${fellows.length > 1 ? "s" : ""}: ${fellows.join(", ")}` : "You are the only Traitor."}
            </Body>
          ) : (
            <Body>Nothing has changed for you. Find the Traitors.</Body>
          )}
        </Animated.View>
      )}
      <Button testID="role-check-done" label="Got it — hide it and vote" icon="eye-off" disabled={!shown} onPress={onDone} />
    </ScrollView>
  );
}

function RoleCard({ view, exit }: { view: PrivateView; exit: { how: "murdered" | "banished"; day: number } | null }) {
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
      {!view.alive ? (
        <View style={styles.outBox} testID="eliminated-how">
          <Text style={[styles.outTitle, { color: exit?.how === "murdered" ? colors.traitor : colors.brand }]}>
            {exit?.how === "murdered" ? "You were murdered" : exit?.how === "banished" ? "You were banished" : "You are out of the game"}
          </Text>
          <Body style={{ fontSize: 15, lineHeight: 21 }}>
            {exit?.how === "murdered"
              ? `The Traitors murdered you in plain sight on Day ${exit.day}.`
              : exit?.how === "banished"
                ? `The Round Table voted you out on Day ${exit.day}.`
                : "You have been eliminated."}{" "}
            Please keep the secrets — no hints to anyone still playing.
          </Body>
        </View>
      ) : null}
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
  const styles = useStyles();
  const { colors } = useTheme();
  const traitor = view.role === "traitor";
  const [target, setTarget] = useState<string | null>(view.target?.id ?? null);
  const [choices, setChoices] = useState<string[]>(view.action_choices ?? []);
  const [chosen, setChosen] = useState<string | null>(null);
  const [override, setOverride] = useState(false);
  const [result, setResult] = useState<PrivateView | null>(null);
  const [mode, setMode] = useState<"murder" | "recruit">("murder");
  const [recruitTarget, setRecruitTarget] = useState<string | null>(null);
  const [recruitedName, setRecruitedName] = useState<string | null>(null);

  const traitorIds = new Set<string>();
  // Traitors cannot murder/recruit each other; we only know fellow names, so filter by name.
  players.forEach((p) => (view.fellow_traitors?.includes(p.name) || p.id === view.player_id) && traitorIds.add(p.id));

  const pickVictim = useMutation({
    mutationFn: (tid: string) => api.takeTurn({ player_id: view.player_id, pin, target_id: tid }),
    onSuccess: (v) => { setChoices(v.action_choices ?? []); setChosen(null); setOverride(false); },
  });
  const confirm = useMutation({
    mutationFn: (action: string) => api.takeTurn({ player_id: view.player_id, pin, action }),
    onSuccess: (v) => setResult(v),
  });
  const recruit = useMutation({
    mutationFn: (rid: string) => api.takeTurn({ player_id: view.player_id, pin, recruit_id: rid }),
    onSuccess: () => setRecruitedName(players.find((p) => p.id === recruitTarget)?.name ?? "a new Traitor"),
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
  // This phone just recruited a new Traitor.
  if (recruitedName) {
    return (
      <>
        <View style={styles.brief} testID="recruit-done">
          <Eyebrow>A new Traitor joins you</Eyebrow>
          <Text style={styles.briefTarget}>{recruitedName}</Text>
          <Body style={{ fontSize: 15 }}>They will find out they have turned the next time they check their secret. No murder tonight.</Body>
        </View>
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
  // Step 1: choose the victim — or, if the Traitors are short, recruit instead.
  const candidates = players.filter((p) => !traitorIds.has(p.id));
  return (
    <>
      {view.can_recruit ? (
        <View style={{ flexDirection: "row", gap: spacing.sm }} testID="night-mode">
          <Pressable testID="night-mode-murder" onPress={() => setMode("murder")} style={[styles.pick, { flex: 1, justifyContent: "center" }, mode === "murder" && styles.pickOn]}>
            <Text style={[styles.pickText, mode === "murder" && { color: colors.onBrandPrimary }]}>Murder</Text>
          </Pressable>
          <Pressable testID="night-mode-recruit" onPress={() => setMode("recruit")} style={[styles.pick, { flex: 1, justifyContent: "center" }, mode === "recruit" && styles.pickOn]}>
            <Text style={[styles.pickText, mode === "recruit" && { color: colors.onBrandPrimary }]}>Recruit</Text>
          </Pressable>
        </View>
      ) : null}
      {view.can_recruit && mode === "recruit" ? (
        <>
          <Body>Recruit one of the Faithful to join the Traitors — instead of a murder tonight.</Body>
          <VictimPicker label={`New Traitor · Day ${view.day}`} prefix="night-recruit" players={candidates} selected={recruitTarget} onSelect={setRecruitTarget} />
          <ErrorText testID="turn-error" message={recruit.error?.message || pass.error?.message} />
          <Button testID="night-recruit-button" label="Seal the recruitment" icon="people" disabled={!recruitTarget} loading={recruit.isPending} onPress={() => recruitTarget && recruit.mutate(recruitTarget)} />
          <Button testID="night-no-recruit-button" label="Don't recruit — murder instead" variant="secondary" icon="skull-outline" onPress={() => { setMode("murder"); setRecruitTarget(null); }} />
          <Button testID="night-skip-button" label="Lie low — nothing tonight" variant="ghost" loading={pass.isPending} onPress={() => pass.mutate()} />
        </>
      ) : (
        <>
          <Body>
            The day begins. Choose who the Traitors will murder in plain sight today — you&apos;ll then pick from three
            secret actions to carry out before the Round Table. Or lie low and spare everyone.
          </Body>
          <VictimPicker label={`Tonight's victim · Day ${view.day}`} prefix="night-victim" players={candidates} selected={target} onSelect={setTarget} />
          <ErrorText testID="turn-error" message={pickVictim.error?.message || pass.error?.message} />
          <Button testID="night-pick-button" label="Choose the method" icon="arrow-forward" disabled={!target} loading={pickVictim.isPending} onPress={() => target && pickVictim.mutate(target)} />
          <Button testID="night-skip-button" label="Lie low — no murder tonight" variant="ghost" loading={pass.isPending} onPress={() => pass.mutate()} />
        </>
      )}
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
          Remember your fellow Traitors. Each day you&apos;ll choose a victim at night, carry out the murder in plain sight during the day, then confirm it at the Round Table.
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
  const styles = useStyles();
  const { colors } = useTheme();
  const [vote, setVote] = useState<string | null>(view.my_vote_id);
  // A tied Round Table goes to a revote: everyone votes again, only between the tied players.
  const revoteIds = view.revote_ids ?? [];
  const revote = revoteIds.length > 0;
  const choices = revote ? players.filter((p) => revoteIds.includes(p.id)) : players;
  const tiedNames = players.filter((p) => revoteIds.includes(p.id)).map((p) => p.name);
  const banish = useMutation({
    mutationFn: () => api.takeTurn({ player_id: view.player_id, pin, vote_target_id: vote ?? undefined }),
    onSuccess: onSealed,
  });
  const end = useMutation({
    mutationFn: () => api.takeTurn({ player_id: view.player_id, pin, end_vote: true }),
    onSuccess: onSealed,
  });
  return (
    <>
      {revote ? (
        <View style={styles.revoteCard} testID="revote-banner">
          <Eyebrow style={{ color: colors.traitor }}>Tie-break revote</Eyebrow>
          <Text style={styles.revoteNames}>{tiedNames.join(" or ")}</Text>
          <Text style={styles.carriedQ}>The vote was tied. Everyone votes again — this time you can only choose between them.</Text>
        </View>
      ) : view.endgame ? (
        <Body>Few of you remain. Vote to banish one more player, or vote to end the game now. If everyone votes to end and a Traitor is still among you, the Traitors win.</Body>
      ) : null}
      <VictimPicker label="Who do you vote to banish?" prefix="vote-option" players={choices} selected={vote} onSelect={setVote} excludeId={view.player_id} />
      <ErrorText testID="turn-error" message={banish.error?.message || end.error?.message} />
      <Button testID="vote-submit-button" label="Seal my vote to banish" icon="lock-closed" disabled={!vote} loading={banish.isPending} onPress={() => banish.mutate()} />
      {view.endgame && !revote ? (
        <Button testID="vote-end-button" label="Vote to end the game" variant="secondary" icon="flag" loading={end.isPending} onPress={() => end.mutate()} />
      ) : null}
    </>
  );
}

function GatherTurn({ view, pin, onSealed }: { view: PrivateView; pin: string; onSealed: () => void }) {
  // Everyone checks in before the murder is revealed. A Traitor who planned a murder also
  // confirms, privately, whether it was carried out — every turn looks the same from outside.
  const styles = useStyles();
  const { colors } = useTheme();
  const traitor = view.role === "traitor";
  const needsAnswer = traitor && !!view.planned_murder && !view.murder_done;
  const [carried, setCarried] = useState<boolean | null>(null);
  const checkIn = useMutation({
    mutationFn: () => api.takeTurn({ player_id: view.player_id, pin, murder_done: needsAnswer ? carried ?? false : undefined }),
    onSuccess: onSealed,
  });
  return (
    <>
      {needsAnswer ? (
        <View style={styles.carriedCard} testID="carried-card">
          <Eyebrow style={{ color: colors.traitor }}>Your murder in plain sight</Eyebrow>
          <Text style={styles.carriedVictim} testID="carried-victim">{view.target?.name}</Text>
          <Text style={styles.carriedAction}>{view.action}</Text>
          <Text style={styles.carriedQ}>Was it carried out — in plain sight, without being caught?</Text>
          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            <Pressable testID="carried-yes" onPress={() => setCarried(true)} style={[styles.pick, { flex: 1, justifyContent: "center" }, carried === true && styles.pickOn]}>
              <Text style={[styles.pickText, carried === true && { color: colors.onBrandPrimary }]}>Yes — it&apos;s done</Text>
            </Pressable>
            <Pressable testID="carried-no" onPress={() => setCarried(false)} style={[styles.pick, { flex: 1, justifyContent: "center" }, carried === false && styles.pickOn]}>
              <Text style={[styles.pickText, carried === false && { color: colors.onBrandPrimary }]}>No — it wasn&apos;t</Text>
            </Pressable>
          </View>
        </View>
      ) : traitor && view.murder_done ? (
        <Body testID="gather-already-confirmed">A fellow Traitor has already confirmed tonight&apos;s murder. Just check in.</Body>
      ) : traitor ? (
        <Body testID="gather-no-murder">No murder to confirm tonight. Just check in, like everyone else.</Body>
      ) : (
        <Body testID="gather-faithful-note">
          The Round Table gathers. Check in so the murder can be revealed — everyone does this, so nobody can tell who
          the Traitors are.
        </Body>
      )}
      <ErrorText testID="turn-error" message={checkIn.error?.message} />
      <Button testID="gather-checkin-button" label="Check in" icon="checkmark-circle" disabled={needsAnswer && carried === null} loading={checkIn.isPending} onPress={() => checkIn.mutate()} />
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
  header: { paddingHorizontal: spacing.md, flexDirection: "row", justifyContent: "space-between" },
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
  checkCover: {
    minHeight: 180,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: c.brandSecondary,
    backgroundColor: c.surfaceSecondary,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  checkCoverText: { color: c.onSurface, fontSize: 18, fontWeight: "600" },
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
  remember: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: c.surfaceSecondary, borderWidth: 1, borderColor: c.brandSecondary, borderRadius: radius.md, padding: spacing.md },
  rememberText: { color: c.onSurface, fontSize: 16, fontWeight: "700" },
  rememberSub: { color: c.muted, fontSize: 13, lineHeight: 18, marginTop: 1 },
  rememberOn: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xs },
  rememberOnText: { color: c.onSurfaceTertiary, fontSize: 14, flex: 1 },
  outBox: { marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: c.divider, gap: 4 },
  outTitle: { fontFamily: fonts.display, fontSize: 28, lineHeight: 32 },
  revoteCard: { gap: spacing.xs, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: c.surfaceSecondary, borderWidth: 1, borderColor: c.brand },
  revoteNames: { fontFamily: fonts.display, fontSize: 30, lineHeight: 34, color: c.onSurface },
  carriedCard: { gap: spacing.sm, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: c.surfaceSecondary, borderWidth: 1, borderColor: c.traitor },
  carriedVictim: { fontFamily: fonts.display, fontSize: 34, lineHeight: 38, color: c.onSurface },
  carriedAction: { fontFamily: fonts.displaySemi, fontSize: 22, lineHeight: 26, color: c.brand },
  carriedQ: { color: c.onSurfaceSecondary, fontSize: 16, lineHeight: 22, marginTop: spacing.xs },
}));
