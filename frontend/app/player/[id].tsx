import Ionicons from "@react-native-vector-icons/ionicons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState, type ComponentRef } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { KeyboardAvoidingView, KeyboardAwareScrollView } from "react-native-keyboard-controller";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, ApiError, DayResult, exitOf, GameState, personalise, PrivateView, PublicPlayer, roundLabel } from "@/src/api";
import { HelpButton } from "@/src/components/help-button";
import { HoldToReveal } from "@/src/components/hold-reveal";
import { PinPad } from "@/src/components/pin-pad";
import { VoteBoard } from "@/src/components/vote-board";
import { Backdrop, Body, Button, ErrorText, Eyebrow, IMAGES, Title } from "@/src/components/ui";
import { useMe } from "@/src/me";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

/** The current round's name ("Day 3 · Lunch"); "Day N" for games stored before round labels. */
function currentRound(game: GameState | undefined, day: number): string {
  return game?.exists && game.day === day && game.label ? game.label : `Day ${day}`;
}

/** How a player left the game, named by the round it happened in. */
function exitWithLabel(history: DayResult[], playerId: string): { how: "murdered" | "banished"; label: string } | null {
  const e = exitOf(history, playerId);
  if (!e) return null;
  const h = history.find((x) => x.day === e.day);
  return { how: e.how, label: h ? roundLabel(h) : `Day ${e.day}` };
}

// The hold on the role card: the role shows after 2 seconds, the Traitors' menu opens after 8.
// Exactly the same for every player, whatever their role — the hint is shown to everyone.
const REVEAL_MS = 2000; // the role shows after 2 seconds of holding
const MENU_MS = 8000; // …and 6 seconds more opens the Traitors' menu
const MENU_HINT = "Keep holding 6 more seconds for the Traitors' menu";
/** Extra cover height for the hint, so the card doesn't grow when the role shows. */
const HINT_SPACE = 76;

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
  // The Traitors' menu (fellow Traitors, tonight's plan, secret chat), opened by a long hold
  // on the role card. Everyone can open it and it looks the same for everyone.
  const [menuOpen, setMenuOpen] = useState(false);
  const autoTried = useRef(false);

  const players = game?.exists ? game.players : [];
  const history = game?.exists ? game.history : [];
  const me = players.find((p) => p.id === id);
  const round = view ? currentRound(game, view.day) : "";
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
      (view.phase === "setup" || (view.alive && (view.phase === "gather" || view.phase === "roundtable")))
    );

  // Always the same backdrop, whatever the role: a glance from across the room
  // must not reveal who is a Traitor. The role is shown only in text, up close.
  const bg = IMAGES.candle;

  // No secret chat during setup (the server allows none yet), so no menu then — for anyone.
  const openMenu = view && view.phase !== "setup" ? () => setMenuOpen(true) : undefined;
  // When the role is revealed, fetch the private view again so the unread count is up to date.
  const refreshView = () => {
    if (view) api.privateView(id, pin).then(setView).catch(() => {});
  };

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
      ) : (
        <>
          {menuOpen ? <TraitorsMenu view={view} pin={pin} round={round} onClose={() => setMenuOpen(false)} /> : null}
          {/* Only hidden while the menu is open, so a turn half-taken is still there afterwards. */}
          <View style={{ flex: 1, display: menuOpen ? "none" : "flex" }}>
            {mode === "turn" && view.phase === "roundtable" && view.alive && !roleChecked ? (
              <RoleCheck view={view} onDone={() => setRoleChecked(true)} onLongHold={openMenu} onRevealed={refreshView} />
            ) : (
              <KeyboardAwareScrollView bottomOffset={24} keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.lg }]}>
                <RoleCard view={view} exit={exitWithLabel(history, view.player_id)} onReveal={() => { setRoleSeen(true); refreshView(); }} onLongHold={openMenu}>
                  {mode === "turn" && view.phase === "setup" ? (
                    view.role === "traitor" ? (
                      <Body testID="setup-traitor-note">
                        Remember your fellow Traitors. Before every Round Table, keep holding this card for the Traitors&apos; menu and choose a victim there (or lie low) — on your own phone, out of sight. Carry out the murder in plain sight, then confirm it when everyone checks in.
                      </Body>
                    ) : (
                      <FaithfulBrief view={view} />
                    )
                  ) : isPeek ? (
                    view.role === "traitor" ? <TraitorBrief view={view} round={round} /> : <FaithfulBrief view={view} />
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
                <ChangePin
                  playerId={id}
                  pin={pin}
                  onChanged={(newPin) => {
                    setPin(newPin);
                    if (boundHere) void setMe(id, newPin);
                  }}
                />
                {mode === "turn" && view.phase === "setup" ? (
                  <SetupTurn view={view} pin={pin} seen={roleSeen} onSealed={() => setSealed(true)} />
                ) : mode === "turn" && view.phase === "gather" && view.alive ? (
                  <GatherTurn view={view} pin={pin} onSealed={() => setSealed(true)} />
                ) : mode === "turn" && view.phase === "roundtable" && view.alive ? (
                  <RoundTableTurn view={view} pin={pin} players={players} history={history} onSealed={() => setSealed(true)} />
                ) : (
                  <Button testID="player-hide-button" label="Hide & pass the phone back" icon="eye-off" onPress={leave} />
                )}
              </KeyboardAwareScrollView>
            )}
          </View>
        </>
      )}
    </View>
  );
}

/** Change your own PIN: the same small link on everyone's screen, opening a form when tapped. */
function ChangePin({ playerId, pin, onChanged }: { playerId: string; pin: string; onChanged: (newPin: string) => void }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [done, setDone] = useState(false);
  const save = useMutation({
    mutationFn: () => api.changePin(playerId, pin, next),
    onSuccess: () => {
      onChanged(next);
      setOpen(false);
      setNext("");
      setAgain("");
      setDone(true);
    },
  });
  const digits = (t: string) => t.replace(/\D/g, "").slice(0, 4);
  const ok = /^\d{4}$/.test(next) && next === again;
  if (!open) {
    return (
      <Pressable testID="change-pin-link" onPress={() => { setOpen(true); setDone(false); save.reset(); }} style={styles.rememberOn} hitSlop={6}>
        <Ionicons name={done ? "checkmark-circle" : "key-outline"} size={18} color={colors.brand} />
        <Text style={styles.rememberOnText}>{done ? "PIN changed — use your new one from now on." : "Change my PIN"}</Text>
      </Pressable>
    );
  }
  return (
    <View style={styles.pinForm} testID="change-pin-form">
      <Text style={styles.rememberText}>Change my PIN</Text>
      <TextInput
        testID="change-pin-new"
        value={next}
        onChangeText={(t) => setNext(digits(t))}
        placeholder="New 4-digit PIN"
        placeholderTextColor={colors.muted}
        style={[styles.pinInput, { letterSpacing: next ? 6 : 0 }]}
        keyboardType="number-pad"
        secureTextEntry
        maxLength={4}
        autoFocus
      />
      <TextInput
        testID="change-pin-again"
        value={again}
        onChangeText={(t) => setAgain(digits(t))}
        placeholder="Type it again"
        placeholderTextColor={colors.muted}
        style={[styles.pinInput, { letterSpacing: again ? 6 : 0 }]}
        keyboardType="number-pad"
        secureTextEntry
        maxLength={4}
      />
      {again.length === 4 && next !== again ? <Text style={styles.rememberSub}>The two don&apos;t match yet.</Text> : null}
      <ErrorText testID="change-pin-error" message={save.error?.message} />
      <Button testID="change-pin-save" label="Save my new PIN" icon="key" disabled={!ok} loading={save.isPending} onPress={() => save.mutate()} />
      <Button testID="change-pin-cancel" label="Keep my PIN" variant="secondary" onPress={() => { setOpen(false); setNext(""); setAgain(""); }} />
    </View>
  );
}

function RoleCheck({
  view,
  onDone,
  onLongHold,
  onRevealed,
}: {
  view: PrivateView;
  onDone: () => void;
  onLongHold?: () => void;
  onRevealed?: () => void;
}) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const [shown, setShown] = useState(false); // the role has been shown at least once
  const traitor = view.role === "traitor";
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
      <HoldToReveal
        testID="role-check-reveal"
        label="Press and hold to see who you are"
        minHeight={200 + (onLongHold ? HINT_SPACE : 0)}
        revealAfterMs={REVEAL_MS}
        longHold={onLongHold ? { afterMs: MENU_MS, hint: MENU_HINT, onLongHold } : undefined}
        onReveal={() => { setShown(true); onRevealed?.(); }}
      >
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
              {fellowsText(view)}
            </Body>
          ) : (
            <Body>Nothing has changed for you. Find the Traitors.</Body>
          )}
          {onLongHold ? <UnreadLine view={view} testID="role-check-unread" /> : null}
        </View>
      </HoldToReveal>
      <Button testID="role-check-done" label="Got it — on to my vote" icon="arrow-forward" disabled={!shown} onPress={onDone} />
    </ScrollView>
  );
}

/**
 * Unread messages in the Traitors' menu, shown with the role once it's revealed. Everyone gets the
 * same line (a Faithful's count is always 0), so it looks the same on every card.
 */
function UnreadLine({ view, testID }: { view: PrivateView; testID: string }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const n = view.chat_unread ?? 0;
  return (
    <View style={styles.unreadRow} testID={testID}>
      <Ionicons name={n ? "chatbubbles" : "chatbubbles-outline"} size={18} color={colors.brand} />
      <Text style={styles.unreadText}>{n ? `${n} unread message${n === 1 ? "" : "s"}` : "No unread messages"}</Text>
    </View>
  );
}

/** "Your fellow Traitor: Bob8", or "You are the only Traitor left — Bob8 was banished." */
function fellowsText(view: PrivateView): string {
  const inGame = view.fellow_traitors ?? [];
  const out = view.fellow_traitors_out ?? [];
  const outText = out.length ? ` (${out.join(", ")} ${out.length > 1 ? "were" : "was"} banished.)` : "";
  if (inGame.length) return `Your fellow Traitor${inGame.length > 1 ? "s" : ""}: ${inGame.join(", ")}.${outText}`;
  return out.length ? `You are the only Traitor left — ${out.join(", ")} ${out.length > 1 ? "were" : "was"} banished.` : "You are the only Traitor.";
}

function RoleCard({
  view,
  exit,
  onReveal,
  onLongHold,
  children,
}: {
  view: PrivateView;
  exit: { how: "murdered" | "banished"; label: string } | null;
  /** The role has been shown (after the 3-second hold). */
  onReveal?: () => void;
  /** Held on for 8 seconds: open the Traitors' menu. */
  onLongHold?: () => void;
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
      <HoldToReveal
        testID="role-hold"
        label="Press and hold to see your role"
        minHeight={(children ? 220 : 150) + (onLongHold ? HINT_SPACE : 0)}
        revealAfterMs={REVEAL_MS}
        longHold={onLongHold ? { afterMs: MENU_MS, hint: MENU_HINT, onLongHold } : undefined}
        onReveal={onReveal}
      >
        <View style={{ gap: spacing.sm }}>
          <Text testID="role-title" style={styles.roleTitle}>
            {traitor ? "A Traitor" : "Faithful"}
          </Text>
          {view.recruited_now ? (
            <Body testID="role-recruited">You&apos;ve just been recruited — you plot with the Traitors now. Keep it secret.</Body>
          ) : null}
          {traitor && view.fellow_traitors ? (
            <Body testID="fellow-traitors">{fellowsText(view)}</Body>
          ) : !traitor ? (
            <Body>Find the Traitors and banish them at the Round Table.</Body>
          ) : null}
          {children}
          {onLongHold ? <UnreadLine view={view} testID="role-unread" /> : null}
        </View>
      </HoldToReveal>
      {!view.alive ? (
        <View style={styles.outBox} testID="eliminated-how">
          <Text style={[styles.outTitle, { color: exit?.how === "murdered" ? colors.traitor : colors.brand }]}>
            {exit?.how === "murdered" ? "You were murdered" : exit?.how === "banished" ? "You were banished" : "You are out of the game"}
          </Text>
          <Body style={{ fontSize: 15, lineHeight: 21 }}>
            {exit?.how === "murdered"
              ? `The Traitors murdered you in plain sight on ${exit.label}.`
              : exit?.how === "banished"
                ? `The Round Table voted you out on ${exit.label}.`
                : "You have been eliminated."}{" "}
            Please keep the secrets — no hints to anyone still playing.
          </Body>
        </View>
      ) : null}
    </Animated.View>
  );
}

function TraitorBrief({ view, round }: { view: PrivateView; round: string }) {
  const styles = useStyles();
  if (view.phase === "night" && !view.plan_sealed) {
    return <Body testID="traitor-brief-unsealed">Tonight&apos;s plan isn&apos;t sealed yet — make it in the Traitors&apos; menu.</Body>;
  }
  if (view.recruit) return <Body testID="traitor-brief-recruit">Recruiting {view.recruit.name} — no murder this time.</Body>;
  if (!view.target || !view.murder_confirmed) {
    return <Body>{view.phase === "night" || view.phase === "gather" ? "Lying low — no murder this time." : "No murder is planned right now."}</Body>;
  }
  return (
    <View style={styles.brief} testID="traitor-brief">
      <Eyebrow>Today&apos;s murder · {round}</Eyebrow>
      <Text style={styles.briefTarget} testID="traitor-target-name">{view.target.name}</Text>
      <Text style={styles.briefLabel}>Your secret action — do it in plain sight:</Text>
      <Text style={styles.briefAction} testID="traitor-action">{personalise(view.action, view.target.name)}</Text>
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
  display = (a) => a,
}: {
  options: string[];
  selected: string | null;
  onSelect: (a: string) => void;
  label?: string;
  /** How to show an option (e.g. a method with the victim's name in it); `onSelect` still gets the original. */
  display?: (a: string) => string;
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
            <Text style={[styles.pickText, { flex: 1 }, on && { color: colors.onBrandPrimary }]}>{display(a)}</Text>
            <Ionicons name={on ? "radio-button-on" : "radio-button-off"} size={24} color={on ? colors.onBrandPrimary : colors.borderStrong} />
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * Tonight's plan, in the Traitors' menu: name the victim, then seal one of five secret methods —
 * or recruit (only when allowed), or lie low. Whoever seals first decides for all the Traitors, and
 * the Round Table then opens 30 minutes later. Nobody else takes a turn during the plot.
 */
function PlotActions({
  view,
  pin,
  players,
  round,
  onChanged,
}: {
  view: PrivateView;
  pin: string;
  players: PublicPlayer[];
  round: string;
  onChanged: (v: PrivateView) => void;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [target, setTarget] = useState<string | null>(view.target?.id ?? null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [repick, setRepick] = useState(false);
  const [mode, setMode] = useState<"murder" | "recruit">("murder");
  const [recruitTarget, setRecruitTarget] = useState<string | null>(null);
  const [lowAsk, setLowAsk] = useState(false);
  // Kept fresh by the menu's refresh, so a victim a fellow Traitor has just picked shows up here.
  const choices = repick ? [] : view.action_choices ?? [];
  const hasFellows = (view.fellow_traitors ?? []).length > 0;

  const traitorIds = new Set<string>();
  // Traitors cannot murder/recruit each other; we only know fellow names, so filter by name.
  players.forEach((p) => (view.fellow_traitors?.includes(p.name) || p.id === view.player_id) && traitorIds.add(p.id));
  const candidates = players.filter((p) => !traitorIds.has(p.id));

  const pickVictim = useMutation({
    mutationFn: (tid: string) => api.takeTurn({ player_id: view.player_id, pin, target_id: tid }),
    onSuccess: (v) => { setChosen(null); setRepick(false); onChanged(v); },
  });
  const seal = useMutation({
    mutationFn: (action: string) => api.takeTurn({ player_id: view.player_id, pin, action }),
    onSuccess: onChanged,
  });
  const recruit = useMutation({
    mutationFn: (rid: string) => api.takeTurn({ player_id: view.player_id, pin, recruit_id: rid }),
    onSuccess: onChanged,
  });
  const lieLow = useMutation({
    mutationFn: () => api.takeTurn({ player_id: view.player_id, pin }),
    onSuccess: onChanged,
  });
  const error = pickVictim.error?.message || seal.error?.message || recruit.error?.message || lieLow.error?.message;

  // Lying low seals the plan too, so it takes a second tap.
  const lowButton = (
    <Button
      testID="plot-lie-low-button"
      label={lowAsk ? "Tap again to seal: no murder this time" : "Lie low — no murder this time"}
      variant="secondary"
      icon="moon-outline"
      loading={lieLow.isPending}
      onPress={() => (lowAsk ? lieLow.mutate() : setLowAsk(true))}
    />
  );
  const sealNote = (
    <Text style={styles.menuNote} testID="plot-seal-note">
      {hasFellows ? "Whoever seals first decides — for all the Traitors. " : ""}Once sealed, you get at least 30 minutes to strike before the Round Table opens.
    </Text>
  );

  // Step 2: a victim is picked — choose one of the five secret methods and seal it.
  if (choices.length > 0) {
    const victimName = view.target?.name ?? players.find((p) => p.id === target)?.name;
    return (
      <View style={{ gap: spacing.sm }} testID="plot-method">
        <Text style={styles.menuWho}>{victimName}</Text>
        <ActionChoices options={choices} selected={chosen} onSelect={setChosen} label="Choose how — do it in plain sight" display={(a) => personalise(a, victimName)} />
        {sealNote}
        <ErrorText testID="plot-error" message={error} />
        <Button testID="plot-seal-button" label="Seal the murder" icon="lock-closed" disabled={!chosen} loading={seal.isPending} onPress={() => chosen && seal.mutate(chosen)} />
        <Button testID="plot-repick-button" label="Pick someone else" variant="secondary" icon="arrow-back" onPress={() => { setRepick(true); setChosen(null); }} />
        {lowButton}
      </View>
    );
  }
  // Step 1: choose the victim — or, if the Traitors are short, recruit instead.
  return (
    <View style={{ gap: spacing.sm }} testID="plot-pick">
      {view.can_recruit ? (
        <View style={{ flexDirection: "row", gap: spacing.sm }} testID="plot-mode">
          <Pressable testID="plot-mode-murder" onPress={() => setMode("murder")} style={[styles.pick, { flex: 1, justifyContent: "center" }, mode === "murder" && styles.pickOn]}>
            <Text style={[styles.pickText, mode === "murder" && { color: colors.onBrandPrimary }]}>Murder</Text>
          </Pressable>
          <Pressable testID="plot-mode-recruit" onPress={() => setMode("recruit")} style={[styles.pick, { flex: 1, justifyContent: "center" }, mode === "recruit" && styles.pickOn]}>
            <Text style={[styles.pickText, mode === "recruit" && { color: colors.onBrandPrimary }]}>Recruit</Text>
          </Pressable>
        </View>
      ) : null}
      {view.can_recruit && mode === "recruit" ? (
        <>
          <Text style={styles.menuText} testID="recruit-reason">
            {view.recruit_reason === "alone"
              ? "You may recruit because you are the only Traitor left"
              : "You may recruit because a Traitor has been banished"}{" "}
            — instead of a murder this time. They turn within 10 minutes. Never more than two Traitors.
          </Text>
          <VictimPicker label={`New Traitor · ${round}`} prefix="plot-recruit" players={candidates} selected={recruitTarget} onSelect={setRecruitTarget} />
          {sealNote}
          <ErrorText testID="plot-error" message={error} />
          <Button testID="plot-recruit-button" label="Seal the recruitment" icon="lock-closed" disabled={!recruitTarget} loading={recruit.isPending} onPress={() => recruitTarget && recruit.mutate(recruitTarget)} />
        </>
      ) : (
        <>
          <VictimPicker label={`The victim · ${round}`} prefix="plot-victim" players={candidates} selected={target} onSelect={setTarget} />
          <ErrorText testID="plot-error" message={error} />
          <Button testID="plot-pick-button" label="Choose the method" icon="arrow-forward" disabled={!target} loading={pickVictim.isPending} onPress={() => target && pickVictim.mutate(target)} />
        </>
      )}
      {lowButton}
    </View>
  );
}

/**
 * The Traitors' menu, opened by holding the role card for eight seconds. Anyone can open it and it
 * looks the same for everyone: the same title, the same frames, the same message box. Only a
 * Traitor still in the game sees what is in it — fellow Traitors, tonight's plan and the secret
 * chat. Anyone else's frames just say so, and their messages go nowhere, with no error shown.
 */
function TraitorsMenu({ view: initial, pin, round, onClose }: { view: PrivateView; pin: string; round: string; onClose: () => void }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const [text, setText] = useState("");
  const id = initial.player_id;
  // Kept fresh while open, so a plan a fellow Traitor has just changed shows up. Every player's
  // menu asks the server in exactly the same way. Nothing is kept once the menu closes (gcTime 0),
  // so a shared phone never holds on to one player's secrets for the next.
  const { data: fresh } = useQuery({
    queryKey: ["menu-view", id],
    queryFn: () => api.privateView(id, pin),
    refetchInterval: 3000,
    gcTime: 0,
  });
  const view = fresh ?? initial;
  const traitor = view.role === "traitor" && view.alive;
  const { data: game } = useQuery({ queryKey: ["game"], queryFn: api.getGame });
  const players = game?.exists ? game.players : [];
  const { data: chat } = useQuery({
    queryKey: ["chat", id],
    queryFn: () => api.readChat(id, pin),
    refetchInterval: 3000,
    gcTime: 0,
  });
  const send = useMutation({
    mutationFn: (message: string) => api.sendChat(id, pin, message),
    onSuccess: (d) => {
      if (d.allowed) qc.setQueryData(["chat", id], d);
    },
    // Never an error on screen: a message that isn't allowed must look just like one that is
    // sent. Only a message that never reached the server (no signal) is put back to try again.
    onError: (e, message) => {
      if (e instanceof ApiError && e.status < 500) return;
      setText((t) => t || message);
    },
  });
  const submit = () => {
    const message = text.trim();
    if (!message || send.isPending) return;
    setText(""); // the box clears straight away for everyone, whatever the server makes of it
    send.mutate(message);
  };

  const messages = traitor ? chat?.messages ?? [] : [];
  const plotting = view.phase === "night" || view.phase === "gather";
  // During the plot, until a Traitor seals it, the plan card holds the choices.
  const choosing = traitor && view.phase === "night" && !view.plan_sealed;
  const plan =
    !traitor || !plotting || choosing
      ? null
      : view.recruit
        ? { who: view.recruit.name, what: "Recruit them to join the Traitors — no murder this time." }
        : view.target && view.murder_confirmed && view.action
          ? { who: view.target.name, what: personalise(view.action, view.target.name) }
          : { who: "Lying low", what: "No murder this time." };
  // When the Round Table can open: the sealed time plus the time to strike (only the Traitors see this).
  const opensAt =
    view.phase === "night" && view.plan_ready_at
      ? new Date(view.plan_ready_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })
      : null;
  // Scroll to the newest message when one arrives — but not on opening while there's a plan to make.
  const lastCount = useRef<number | null>(null);
  const onContentSize = () => {
    if (!chat) return;
    const first = lastCount.current === null;
    if (!first && lastCount.current === messages.length) return;
    lastCount.current = messages.length;
    if (first && choosing) return;
    scroll.current?.scrollToEnd({ animated: !first });
  };
  const hidden = "Only the Traitors can see this.";
  // No plan to show: say where the game is instead of a misleading "no murder planned".
  const planStageText = (v: PrivateView): string => {
    const next = v.can_recruit ? " You can recruit a Faithful at the next plot." : "";
    if (plotting) return "Lying low — no murder this time." + next;
    if (v.phase === "reveal") return "The murder has been revealed. The next plot starts after the Round Table." + next;
    if (v.phase === "roundtable" || v.phase === "banished") return "The next plot starts after the Round Table." + next;
    if (v.phase === "day") return "The next plot starts soon." + next;
    return "Nothing to plan right now.";
  };
  const time = (t: string) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  const seenBy = (names: string[]) => names.map((n) => (n === view.name ? "you" : n)).join(", ");

  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }} testID="traitors-menu">
      <View style={styles.chatHead}>
        <Pressable testID="chat-close-button" onPress={onClose} style={styles.iconBtn} hitSlop={8} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={24} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.chatTitle}>The Traitors&apos; menu</Text>
          <Text style={styles.chatSub}>Only the Traitors can use this menu.</Text>
        </View>
      </View>
      <ScrollView
        ref={scroll}
        style={{ flex: 1 }}
        contentContainerStyle={styles.menuList}
        onContentSizeChange={onContentSize}
        keyboardShouldPersistTaps="handled"
      >
        <View style={[styles.menuCard, styles.menuFellows]} testID="menu-fellows">
          <Eyebrow>Fellow Traitors</Eyebrow>
          <Text style={styles.menuText} testID="menu-fellows-text">
            {!traitor ? hidden : fellowsText(view)}
          </Text>
        </View>
        <View style={[styles.menuCard, styles.menuPlan]} testID="menu-plan">
          <Eyebrow>The plan · {round}</Eyebrow>
          {choosing ? (
            <PlotActions view={view} pin={pin} players={players} round={round} onChanged={(v) => qc.setQueryData(["menu-view", id], v)} />
          ) : plan ? (
            <>
              <Text style={styles.menuWho} testID="menu-plan-victim">{plan.who}</Text>
              <Text style={styles.menuText} testID="menu-plan-action">{plan.what}</Text>
              {opensAt ? (
                <Text style={styles.menuNote} testID="menu-plan-sealed">
                  Sealed. The Round Table can open from {opensAt}.
                </Text>
              ) : null}
            </>
          ) : (
            <Text style={styles.menuText} testID="menu-plan-stage">{traitor ? planStageText(view) : hidden}</Text>
          )}
        </View>
        <View style={styles.menuChat} testID="secret-chat">
          <Eyebrow>Secret chat</Eyebrow>
          {messages.length === 0 ? (
            <View style={styles.chatEmpty} testID="chat-empty">
              <Ionicons name="chatbubbles-outline" size={34} color={colors.muted} />
              <Text style={styles.chatEmptyText}>No messages.</Text>
            </View>
          ) : (
            messages.map((m) => {
              const mine = m.from_id === view.player_id;
              const seen = (m.seen_by ?? []).filter(Boolean);
              return (
                <View key={m.id} style={[styles.msg, { alignSelf: mine ? "flex-end" : "flex-start" }]}>
                  <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]} testID="chat-message">
                    {!mine ? <Text style={styles.bubbleName}>{m.from_name}</Text> : null}
                    <Text style={styles.bubbleText}>{m.text}</Text>
                    <Text style={styles.bubbleTime}>{time(m.t)}</Text>
                  </View>
                  {seen.length ? (
                    <Text style={[styles.bubbleSeen, { alignSelf: mine ? "flex-end" : "flex-start" }]} testID="chat-seen-by">
                      Seen by {seenBy(seen)}
                    </Text>
                  ) : null}
                </View>
              );
            })
          )}
        </View>
      </ScrollView>
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
          onPress={submit}
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
      {!seen ? <Body testID="setup-hold-note">Press and hold the card above for 2 seconds to see your role, then confirm.</Body> : null}
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
      ? { id: "gather-already-confirmed", text: "A fellow Traitor has already confirmed today's murder." }
      : traitor
        ? { id: "gather-no-murder", text: "No murder to confirm this time." }
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
        <Text style={styles.carriedAction} testID={note?.id}>{needsAnswer ? personalise(view.action, view.target?.name) : note?.text}</Text>
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
  unreadRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.xs },
  unreadText: { color: c.onSurfaceSecondary, fontSize: 16, fontWeight: "600" },
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
  menuList: { padding: spacing.lg, paddingTop: spacing.sm, gap: spacing.md, flexGrow: 1 },
  // Fixed minimum sizes: the frames look the same whatever is (or isn't) in them.
  menuCard: { gap: spacing.xs, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: c.brandSecondary, backgroundColor: c.surfaceSecondary },
  menuFellows: { minHeight: 84 },
  menuPlan: { minHeight: 136 },
  menuNote: { color: c.muted, fontSize: 14, lineHeight: 20 },
  menuText: { color: c.onSurface, fontSize: 17, lineHeight: 24 },
  menuWho: { color: c.onSurface, fontSize: 17, lineHeight: 24, fontWeight: "700" },
  menuChat: { gap: spacing.sm, flexGrow: 1 },
  chatEmpty: { alignItems: "center", justifyContent: "center", gap: spacing.sm, paddingVertical: spacing.xl },
  chatEmptyText: { color: c.muted, fontSize: 16 },
  chatBar: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: c.divider },
  msg: { maxWidth: "82%", gap: 2 },
  bubble: { borderRadius: radius.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: 2 },
  bubbleMine: { backgroundColor: c.brandTertiary, borderBottomRightRadius: 4 },
  bubbleTheirs: { backgroundColor: c.surfaceSecondary, borderWidth: 1, borderColor: c.border, borderBottomLeftRadius: 4 },
  bubbleName: { color: c.brand, fontSize: 13, fontWeight: "700" },
  bubbleText: { color: c.onSurface, fontSize: 17, lineHeight: 23 },
  bubbleTime: { color: c.muted, fontSize: 11, alignSelf: "flex-end" },
  bubbleSeen: { color: c.muted, fontSize: 11, paddingHorizontal: spacing.xs },
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
  pinForm: { gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: c.brandSecondary, backgroundColor: c.surfaceSecondary },
  pinInput: {
    height: 52,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.surface,
    color: c.onSurface,
    fontSize: 18,
    paddingHorizontal: spacing.md,
  },
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
