import Ionicons from "@react-native-vector-icons/ionicons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState, type ComponentRef } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, DayResult, exitOf, PrivateView, PublicPlayer } from "@/src/api";
import { HelpButton } from "@/src/components/help-button";
import { HoldToReveal } from "@/src/components/hold-reveal";
import { PinPad } from "@/src/components/pin-pad";
import { VoteBoard } from "@/src/components/vote-board";
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
  const [roleSeen, setRoleSeen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
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

  // Not taking a turn (peeking, or nothing to do this phase): the brief shows in the held card.
  const isPeek =
    !!view &&
    !(
      mode === "turn" &&
      (view.phase === "setup" || (view.alive && (view.phase === "gather" || view.phase === "roundtable" || view.phase === "night")))
    );

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
      ) : chatOpen ? (
        <SecretChat view={view} pin={pin} onClose={() => setChatOpen(false)} />
      ) : mode === "turn" && view.phase === "roundtable" && view.alive && !roleChecked ? (
        <RoleCheck view={view} onDone={() => setRoleChecked(true)} />
      ) : (
        <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.lg }]}>
          <RoleCard view={view} exit={game?.exists ? exitOf(game.history, view.player_id) : null} onReveal={() => setRoleSeen(true)}>
            {mode === "turn" && view.phase === "setup" ? (
              view.role === "traitor" ? (
                <Body testID="setup-traitor-note">
                  Remember your fellow Traitors. Each day you&apos;ll choose a victim at night, carry out the murder in plain sight during the day, then confirm it at the Round Table.
                </Body>
              ) : (
                <FaithfulBrief view={view} />
              )
            ) : isPeek ? (
              view.role === "traitor" ? <TraitorBrief view={view} /> : <FaithfulBrief view={view} />
            ) : null}
          </RoleCard>
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
          {view.phase !== "setup" ? (
            <Pressable testID="secret-chat-button" onPress={() => setChatOpen(true)} style={styles.remember}>
              <Ionicons name="chatbubbles-outline" size={20} color={colors.brand} />
              <View style={{ flex: 1 }}>
                <Text style={styles.rememberText}>Secret chat</Text>
                <Text style={styles.rememberSub}>The Traitors&apos; private group chat.</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.muted} />
            </Pressable>
          ) : null}
          {mode === "turn" && view.phase === "setup" ? (
            <SetupTurn view={view} pin={pin} seen={roleSeen} onSealed={() => setSealed(true)} />
          ) : mode === "turn" && view.phase === "gather" && view.alive ? (
            <GatherTurn view={view} pin={pin} onSealed={() => setSealed(true)} />
          ) : mode === "turn" && view.phase === "roundtable" && view.alive ? (
            <RoundTableTurn view={view} pin={pin} players={players} history={game?.exists ? game.history : []} onSealed={() => setSealed(true)} />
          ) : mode === "turn" && view.phase === "night" && view.alive ? (
            <NightTurn view={view} pin={pin} players={players} onSealed={() => setSealed(true)} />
          ) : (
            <Button testID="player-hide-button" label="Hide & pass the phone back" icon="eye-off" onPress={leave} />
          )}
        </ScrollView>
      )}
    </View>
  );
}

function RoleCheck({ view, onDone }: { view: PrivateView; onDone: () => void }) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const [shown, setShown] = useState(false); // held at least once
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
      <HoldToReveal testID="role-check-reveal" label="Press and hold to see who you are" minHeight={190} onReveal={() => setShown(true)}>
        <View style={styles.roleCard} testID="role-check-card">
          {view.recruited_now ? (
            <>
              <Eyebrow>You have been recruited</Eyebrow>
              <Text testID="role-check-title" style={styles.roleTitle}>You are now a Traitor</Text>
              <Body>
                The Traitors chose you. From now on you plot with them — and you win with them. Keep it secret.
              </Body>
            </>
          ) : (
            <>
              <Eyebrow>{view.name}, you are still</Eyebrow>
              <Text testID="role-check-title" style={styles.roleTitle}>
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
        </View>
      </HoldToReveal>
      <Button testID="role-check-done" label="Got it — on to my vote" icon="arrow-forward" disabled={!shown} onPress={onDone} />
    </ScrollView>
  );
}

function RoleCard({
  view,
  exit,
  onReveal,
  children,
}: {
  view: PrivateView;
  exit: { how: "murdered" | "banished"; day: number } | null;
  onReveal?: () => void;
  children?: React.ReactNode;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const traitor = view.role === "traitor";
  // The card itself looks the same for everyone; the role (and anything that hints at it)
  // shows only while a finger is held on it.
  return (
    <Animated.View entering={FadeIn.duration(800)} style={styles.roleCard} testID="role-card">
      <Eyebrow>{view.name}, you are</Eyebrow>
      <HoldToReveal testID="role-hold" label="Press and hold to see your role" minHeight={children ? 220 : 150} onReveal={onReveal}>
        <View style={{ gap: spacing.sm }}>
          <Text testID="role-title" style={styles.roleTitle}>
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
          {children}
        </View>
      </HoldToReveal>
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

function ActionChoices({
  options,
  selected,
  onSelect,
  label = "Choose your secret action",
}: {
  options: string[];
  selected: string | null;
  onSelect: (a: string) => void;
  label?: string;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={styles.pickLabel}>{label}</Text>
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
    return <FaithfulNight view={view} pin={pin} players={players} onSealed={onSealed} />;
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
        <Button testID="night-confirm-button" label="Seal the murder" icon="lock-closed" disabled={!chosen} loading={confirm.isPending} onPress={() => chosen && confirm.mutate(chosen)} />
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
          <Body testID="recruit-reason" style={{ fontSize: 15 }}>
            {view.recruit_reason === "alone"
              ? "You may recruit because you are the only Traitor left."
              : "You may recruit because a Traitor has been banished — one recruit replaces each banished Traitor."}
          </Body>
          <VictimPicker label={`New Traitor · Day ${view.day}`} prefix="night-recruit" players={candidates} selected={recruitTarget} onSelect={setRecruitTarget} />
          <ErrorText testID="turn-error" message={recruit.error?.message || pass.error?.message} />
          <Button testID="night-recruit-button" label="Seal the recruitment" icon="lock-closed" disabled={!recruitTarget} loading={recruit.isPending} onPress={() => recruitTarget && recruit.mutate(recruitTarget)} />
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

const SURE = ["Just a hunch", "Fairly sure", "Certain — it's them"];

/**
 * The Faithful's night turn. It has exactly the shape of a Traitor's — pick a name, then one
 * of three options, then seal — so nobody watching can tell the two apart. Nothing chosen
 * here is sent or saved; sealing simply takes the night turn.
 */
function FaithfulNight({ view, pin, players, onSealed }: { view: PrivateView; pin: string; players: PublicPlayer[]; onSealed: () => void }) {
  const styles = useStyles();
  const [suspect, setSuspect] = useState<string | null>(null);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [sure, setSure] = useState<string | null>(null);
  const seal = useMutation({ mutationFn: () => api.takeTurn({ player_id: view.player_id, pin }), onSuccess: () => setStep(3) });
  const skip = useMutation({ mutationFn: () => api.takeTurn({ player_id: view.player_id, pin }), onSuccess: onSealed });
  const name = players.find((p) => p.id === suspect)?.name;
  const error = seal.error?.message || skip.error?.message;
  if (step === 3) {
    return (
      <>
        <View style={styles.brief} testID="suspect-brief">
          <Eyebrow>Your suspicion · Day {view.day}</Eyebrow>
          <Text style={styles.briefTarget}>{name}</Text>
          <Text style={styles.briefLabel}>How sure you are:</Text>
          <Text style={styles.briefAction}>{sure}</Text>
          <Body style={{ fontSize: 15 }}>Only you know this — it isn&apos;t shared or saved. Watch them closely tomorrow.</Body>
        </View>
        <Button testID="night-done-button" label="Hide & pass the phone" icon="eye-off" onPress={onSealed} />
      </>
    );
  }
  if (step === 2) {
    return (
      <>
        <Body>Suspect: {name}. How sure are you? Pick one — it&apos;s only for you:</Body>
        <ActionChoices options={SURE} selected={sure} onSelect={setSure} label="How sure are you?" />
        <ErrorText testID="turn-error" message={error} />
        <Button testID="night-confirm-button" label="Seal my suspicion" icon="lock-closed" disabled={!sure} loading={seal.isPending} onPress={() => seal.mutate()} />
        <Button testID="night-skip-button" label="Skip — pass the phone on" variant="ghost" loading={skip.isPending} onPress={() => skip.mutate()} />
      </>
    );
  }
  return (
    <>
      <Body testID="night-faithful-note">
        The castle sleeps while the Traitors plot. Choose who you suspect most — then how sure you are. It&apos;s only for
        you: nothing here is shared or saved.
      </Body>
      <VictimPicker label={`Your suspect · Day ${view.day}`} prefix="night-suspect" players={players} selected={suspect} onSelect={setSuspect} excludeId={view.player_id} />
      <ErrorText testID="turn-error" message={error} />
      <Button testID="night-pick-button" label="Choose how sure" icon="arrow-forward" disabled={!suspect} onPress={() => setStep(2)} />
      <Button testID="night-skip-button" label="Skip — pass the phone on" variant="ghost" loading={skip.isPending} onPress={() => skip.mutate()} />
    </>
  );
}

/**
 * The Traitors' secret group chat. Everyone has the same button and sees the same screen;
 * only a Traitor still in the game gets messages back, and only they can send.
 */
function SecretChat({ view, pin, onClose }: { view: PrivateView; pin: string; onClose: () => void }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const [text, setText] = useState("");
  const { data } = useQuery({
    queryKey: ["chat", view.player_id],
    queryFn: () => api.readChat(view.player_id, pin),
    refetchInterval: 3000,
  });
  const send = useMutation({
    mutationFn: () => api.sendChat(view.player_id, pin, text.trim()),
    onSuccess: (d) => {
      qc.setQueryData(["chat", view.player_id], d);
      setText("");
    },
  });
  const messages = data?.messages ?? [];
  const time = (t: string) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }} testID="secret-chat">
      <View style={styles.chatHead}>
        <Pressable testID="chat-close-button" onPress={onClose} style={styles.iconBtn} hitSlop={8} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={24} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.chatTitle}>Secret chat</Text>
          <Text style={styles.chatSub}>Only the Traitors can see or send messages here.</Text>
        </View>
      </View>
      <ScrollView
        ref={scroll}
        style={{ flex: 1 }}
        contentContainerStyle={styles.chatList}
        onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}
        keyboardShouldPersistTaps="handled"
      >
        {messages.length === 0 ? (
          <View style={styles.chatEmpty} testID="chat-empty">
            <Ionicons name="chatbubbles-outline" size={34} color={colors.muted} />
            <Text style={styles.chatEmptyText}>No messages.</Text>
          </View>
        ) : (
          messages.map((m) => {
            const mine = m.from_id === view.player_id;
            return (
              <View key={m.id} style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]} testID="chat-message">
                {!mine ? <Text style={styles.bubbleName}>{m.from_name}</Text> : null}
                <Text style={styles.bubbleText}>{m.text}</Text>
                <Text style={styles.bubbleTime}>{time(m.t)}</Text>
              </View>
            );
          })
        )}
      </ScrollView>
      <ErrorText testID="chat-error" message={send.error?.message} />
      <View style={[styles.chatBar, { paddingBottom: insets.bottom + spacing.sm }]}>
        <TextInput
          testID="chat-input"
          value={text}
          onChangeText={setText}
          placeholder="Message…"
          placeholderTextColor={colors.muted}
          style={styles.chatInput}
          maxLength={500}
          multiline
        />
        <Pressable
          testID="chat-send-button"
          onPress={() => text.trim() && send.mutate()}
          disabled={!text.trim() || send.isPending}
          style={[styles.chatSend, (!text.trim() || send.isPending) && { opacity: 0.45 }]}
          accessibilityLabel="Send"
        >
          <Ionicons name="send" size={20} color={colors.onBrandPrimary} />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

function SetupTurn({ view, pin, seen, onSealed }: { view: PrivateView; pin: string; seen: boolean; onSealed: () => void }) {
  const submit = useMutation({
    mutationFn: () => api.takeTurn({ player_id: view.player_id, pin }),
    onSuccess: () => onSealed(),
  });
  return (
    <>
      {!seen ? <Body testID="setup-hold-note">Press and hold the card above to see your role, then confirm.</Body> : null}
      <ErrorText testID="turn-error" message={submit.error?.message} />
      <Button testID="setup-turn-confirm-button" label="I understand — hide it" icon="eye-off" disabled={!seen} loading={submit.isPending} onPress={() => submit.mutate()} />
    </>
  );
}

function RoundTableTurn({
  view,
  pin,
  players,
  history,
  onSealed,
}: {
  view: PrivateView;
  pin: string;
  players: PublicPlayer[];
  history: DayResult[];
  onSealed: () => void;
}) {
  const styles = useStyles();
  const [vote, setVote] = useState<string | null>(view.my_vote_id);
  // A tied Round Table goes to a revote: everyone votes again, only between the tied players.
  const revoteIds = view.revote_ids ?? [];
  const revote = revoteIds.length > 0;
  const choices = revote ? players.filter((p) => revoteIds.includes(p.id)) : players;
  const tiedNames = players.filter((p) => revoteIds.includes(p.id)).map((p) => p.name);
  const last = history.length ? history[history.length - 1] : null;
  const firstVote = revote && last?.day === view.day && last.banish?.tie ? last.banish : null;
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
          <Eyebrow>Tie-break revote</Eyebrow>
          <Text style={styles.revoteNames}>{tiedNames.join(" or ")}</Text>
          <Text style={styles.carriedQ}>The vote was tied. Everyone votes again — this time you can only choose between them.</Text>
        </View>
      ) : null}
      {firstVote ? (
        <VoteBoard vote={firstVote} title="The first vote — tied" highlight={revoteIds} collapsible testID="revote-first-vote" />
      ) : null}
      {view.endgame && !revote ? (
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
  // confirms, privately, whether it was carried out. Everyone else gets a question of the same
  // shape (not recorded), so every check-in looks and taps exactly the same from outside.
  const styles = useStyles();
  const { colors } = useTheme();
  const traitor = view.role === "traitor";
  const needsAnswer = traitor && !!view.planned_murder && !view.murder_done;
  const [answer, setAnswer] = useState<boolean | null>(null);
  const checkIn = useMutation({
    mutationFn: () => api.takeTurn({ player_id: view.player_id, pin, murder_done: needsAnswer ? answer ?? false : undefined }),
    onSuccess: onSealed,
  });
  const note = needsAnswer
    ? null
    : traitor && view.murder_done
      ? { id: "gather-already-confirmed", text: "A fellow Traitor has already confirmed tonight's murder." }
      : traitor
        ? { id: "gather-no-murder", text: "No murder to confirm tonight." }
        : { id: "gather-faithful-note", text: "Think back over the day." };
  const yesId = needsAnswer ? "carried-yes" : "gather-yes";
  const noId = needsAnswer ? "carried-no" : "gather-no";
  return (
    <>
      <View style={styles.carriedCard} testID={needsAnswer ? "carried-card" : "gather-card"}>
        <Eyebrow>{needsAnswer ? "Your murder in plain sight" : "Before the Round Table"}</Eyebrow>
        <Text style={styles.carriedVictim} testID={needsAnswer ? "carried-victim" : undefined}>
          {needsAnswer ? view.target?.name : "Today"}
        </Text>
        <Text style={styles.carriedAction} testID={note?.id}>{needsAnswer ? view.action : note?.text}</Text>
        <Text style={styles.carriedQ}>
          {needsAnswer ? "Was it carried out — in plain sight, without being caught?" : "Did you spot anything suspicious today?"}
        </Text>
        <View style={{ flexDirection: "row", gap: spacing.sm }}>
          <Pressable testID={yesId} onPress={() => setAnswer(true)} style={[styles.pick, { flex: 1, justifyContent: "center" }, answer === true && styles.pickOn]}>
            <Text style={[styles.pickText, answer === true && { color: colors.onBrandPrimary }]}>
              {needsAnswer ? "Yes — it's done" : "Yes — I did"}
            </Text>
          </Pressable>
          <Pressable testID={noId} onPress={() => setAnswer(false)} style={[styles.pick, { flex: 1, justifyContent: "center" }, answer === false && styles.pickOn]}>
            <Text style={[styles.pickText, answer === false && { color: colors.onBrandPrimary }]}>
              {needsAnswer ? "No — it wasn't" : "No — nothing"}
            </Text>
          </Pressable>
        </View>
      </View>
      <Body style={{ fontSize: 15 }}>Everyone answers and checks in, so nobody can tell who the Traitors are.</Body>
      <ErrorText testID="turn-error" message={checkIn.error?.message} />
      <Button testID="gather-checkin-button" label="Check in" icon="checkmark-circle" disabled={answer === null} loading={checkIn.isPending} onPress={() => checkIn.mutate()} />
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
  // One colour for every role: a glimpse of the colour must never tell Traitor from Faithful.
  roleTitle: { fontFamily: fonts.display, fontSize: 56, lineHeight: 60, color: c.brand },
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
  chatHead: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  chatTitle: { fontFamily: fonts.display, fontSize: 28, lineHeight: 32, color: c.onSurface },
  chatSub: { color: c.muted, fontSize: 14, lineHeight: 19 },
  chatList: { padding: spacing.lg, gap: spacing.sm, flexGrow: 1, justifyContent: "flex-end" },
  chatEmpty: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.sm, paddingVertical: spacing.xl },
  chatEmptyText: { color: c.muted, fontSize: 16 },
  bubble: { maxWidth: "82%", borderRadius: radius.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: 2 },
  bubbleMine: { alignSelf: "flex-end", backgroundColor: c.brandTertiary, borderBottomRightRadius: 4 },
  bubbleTheirs: { alignSelf: "flex-start", backgroundColor: c.surfaceSecondary, borderWidth: 1, borderColor: c.border, borderBottomLeftRadius: 4 },
  bubbleName: { color: c.brand, fontSize: 13, fontWeight: "700" },
  bubbleText: { color: c.onSurface, fontSize: 17, lineHeight: 23 },
  bubbleTime: { color: c.muted, fontSize: 11, alignSelf: "flex-end" },
  chatBar: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: c.divider },
  chatInput: {
    flex: 1,
    minHeight: 48,
    maxHeight: 120,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.surfaceSecondary,
    color: c.onSurface,
    fontSize: 17,
    paddingHorizontal: spacing.md,
    paddingTop: 12,
    paddingBottom: 12,
  },
  chatSend: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", backgroundColor: c.brandPrimary },
  remember: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: c.surfaceSecondary, borderWidth: 1, borderColor: c.brandSecondary, borderRadius: radius.md, padding: spacing.md },
  rememberText: { color: c.onSurface, fontSize: 16, fontWeight: "700" },
  rememberSub: { color: c.muted, fontSize: 13, lineHeight: 18, marginTop: 1 },
  rememberOn: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xs },
  rememberOnText: { color: c.onSurfaceTertiary, fontSize: 14, flex: 1 },
  outBox: { marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: c.divider, gap: 4 },
  outTitle: { fontFamily: fonts.display, fontSize: 28, lineHeight: 32 },
  revoteCard: { gap: spacing.xs, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: c.surfaceSecondary, borderWidth: 1, borderColor: c.brand },
  revoteNames: { fontFamily: fonts.display, fontSize: 30, lineHeight: 34, color: c.onSurface },
  carriedCard: { gap: spacing.sm, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: c.surfaceSecondary, borderWidth: 1, borderColor: c.brandSecondary },
  carriedVictim: { fontFamily: fonts.display, fontSize: 34, lineHeight: 38, color: c.onSurface },
  carriedAction: { fontFamily: fonts.displaySemi, fontSize: 22, lineHeight: 26, color: c.brand },
  carriedQ: { color: c.onSurfaceSecondary, fontSize: 16, lineHeight: 22, marginTop: spacing.xs },
}));
