import Ionicons from "@react-native-vector-icons/ionicons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type Href, usePathname, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, ApiError, Lobby, LobbySlot, passphraseProblem } from "@/src/api";
import { HelpButton } from "@/src/components/help-button";
import { useGameCode } from "@/src/game-code";
import { claimMyPlayer, rememberSpotPin, useDeviceId } from "@/src/lobby";
import { useMe } from "@/src/me";
import { Body, Button, ErrorText, Eyebrow, Title } from "@/src/components/ui";
import { makeStyles, radius, spacing, useTheme } from "@/src/theme";

// Cast so this file type-checks even before the generated typed-routes list includes it.
const PREVIOUS_GAMES = "/previous-games" as Href;

type OpenLobby = Extract<Lobby, { exists: true }>;

/**
 * New game: a live sign-up sheet. Whoever starts it is the host. Everyone else opens the app on
 * their own phone and taps "Add me" — that makes a spot locked to their phone at once, so nobody
 * can type into someone else's — then enters their name and PIN. Every phone sees the sheet fill
 * up as it happens. A phone can also be passed round to add several people. The host then
 * chooses the Traitors, and every phone goes straight into the game.
 *
 * Also shown by the home screen (app/index.tsx) itself when there is no game in progress — then
 * there is nowhere to go back to, so no back button.
 */
export default function Setup() {
  const styles = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  // `gone`: the game this phone was in was ended on another phone.
  const { setCode, gone } = useGameCode();
  const { setMe } = useMe();
  const device = useDeviceId();
  const canGoBack = router.canGoBack();
  // Back to the dashboard — unless this is the home screen already (it then shows the game).
  const goHome = () => {
    if (pathname === "/") return;
    if (router.canGoBack()) router.dismissTo("/");
    else router.replace("/");
  };

  const lobbyKey = ["lobby", device];
  const { data: lobby, error: loadError, refetch } = useQuery({
    queryKey: lobbyKey,
    queryFn: () => api.lobby(device as string),
    enabled: !!device,
    refetchInterval: 2000, // everyone sees the sheet fill up live
    gcTime: 0,
  });
  const put = (l: Lobby) => qc.setQueryData(lobbyKey, l);

  // The host has chosen the Traitors: into the game (as this phone's player, if it signed up one).
  const entering = useRef(false);
  const startedCode = lobby?.exists ? lobby.started_code : null;
  useEffect(() => {
    if (!lobby?.exists || !startedCode || entering.current) return;
    entering.current = true;
    (async () => {
      const code = await claimMyPlayer(lobby, setMe);
      if (code) await setCode(code);
      qc.invalidateQueries({ queryKey: ["game"] });
      goHome();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startedCode]);

  const open = useMutation({ mutationFn: () => api.lobbyOpen(device as string), onSuccess: put });

  // A game is already in progress (one group, one game): go and join it instead.
  const joinCurrent = async () => {
    const cur = await api.currentGame();
    if (cur.code) await setCode(cur.code);
    goHome();
  };

  return (
    <View style={styles.root} testID="setup-screen">
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        {canGoBack ? (
          <Pressable testID="setup-back-button" onPress={() => router.back()} style={styles.iconBtn} hitSlop={8}>
            <Ionicons name="chevron-back" size={26} color={colors.onSurface} />
          </Pressable>
        ) : null}
        <Text style={[styles.headerText, !canGoBack && { paddingLeft: spacing.sm }]}>New game</Text>
        <HelpButton from="setup" testID="setup-help-button" />
      </View>
      <KeyboardAwareScrollView
        bottomOffset={24}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.lg }]}
      >
        <View style={{ gap: spacing.sm }}>
          <Eyebrow>{lobby?.exists ? "Sign-up is open" : "Summon the players"}</Eyebrow>
          <Title>Who is playing?</Title>
          <Body>
            {!lobby?.exists
              ? "Start the sign-up, then everyone adds themselves on their own phone — or pass this phone round."
              : startedCode
                ? "The Traitors have been chosen. Joining the game…"
                : lobby.you_host
                  ? "Everyone opens the app on their own phone and taps an empty box — or pass this phone round. Each person picks a secret 4-digit PIN they'll remember for 12 days."
                  : `Tap an empty box to add yourself, with a secret 4-digit PIN you'll remember for 12 days. ${lobby.host_name ?? "The host"} chooses the Traitors once everyone's in.`}
          </Body>
          {/* The start screen is this one now, so its two links live here */}
          <View style={styles.links}>
            <Pressable testID="setup-how-to-play-link" accessibilityRole="link" onPress={() => router.push("/how-to-play")} style={styles.link} hitSlop={6}>
              <Ionicons name="book-outline" size={18} color={colors.brand} />
              <Text style={styles.linkText}>How to play</Text>
            </Pressable>
            <Pressable testID="setup-previous-games-link" accessibilityRole="link" onPress={() => router.push(PREVIOUS_GAMES)} style={styles.link} hitSlop={6}>
              <Ionicons name="library-outline" size={18} color={colors.brand} />
              <Text style={styles.linkText}>Previous games</Text>
            </Pressable>
          </View>
        </View>

        {gone ? <ErrorText testID="setup-game-gone" message="Your game was ended on another phone." /> : null}

        {!device || (!lobby && !loadError) || startedCode ? (
          <ActivityIndicator color={colors.brand} size="large" style={{ marginVertical: spacing.lg }} />
        ) : !lobby ? (
          <>
            <ErrorText testID="setup-load-error" message="Could not reach the castle. Check your connection." />
            <Button testID="setup-retry" label="Try again" onPress={() => refetch()} />
          </>
        ) : !lobby.exists ? (
          <>
            <ErrorText testID="setup-error" message={open.error?.message} />
            {open.error instanceof ApiError && open.error.status === 409 ? (
              <Button testID="setup-join-current-button" label="Join the game in progress" icon="enter-outline" onPress={joinCurrent} />
            ) : null}
            <Button testID="setup-open-button" label="Start the sign-up" icon="people" loading={open.isPending} onPress={() => open.mutate()} />
            <Text style={styles.note}>You&apos;ll be the host: you add yourself first, and you choose the Traitors once everyone&apos;s in.</Text>
          </>
        ) : (
          <Sheet lobby={lobby} device={device} put={put} />
        )}
      </KeyboardAwareScrollView>
    </View>
  );
}

/** The live sheet: every spot, this phone's own spots editable, and the host's controls. */
function Sheet({ lobby, device, put }: { lobby: OpenLobby; device: string; put: (l: Lobby) => void }) {
  const styles = useStyles();
  const { colors } = useTheme();
  // Spots this phone has opened again to change.
  const [editing, setEditing] = useState<string[]>([]);
  const [asked, setAsked] = useState<string | null>(null); // a remove waiting for its second tap
  useEffect(() => {
    if (!asked) return;
    const t = setTimeout(() => setAsked(null), 4000); // not tapped again in time: never mind
    return () => clearTimeout(t);
  }, [asked]);
  const [takeOver, setTakeOver] = useState(false);
  const [hostPin, setHostPin] = useState("");
  const claim = useMutation({
    mutationFn: (pin?: string) => api.lobbyTakeOver(device, pin),
    onSuccess: (l) => { setTakeOver(false); setHostPin(""); put(l); },
    onError: () => setHostPin(""),
  });
  const join = useMutation({ mutationFn: (pos: number) => api.lobbyJoin(device, pos), onSuccess: put });
  const remove = useMutation({
    mutationFn: (id: string) => api.lobbyRemove(device, id),
    onSuccess: (l) => { setAsked(null); put(l); },
  });
  const mineCount = lobby.slots.filter((s) => s.mine).length;
  const full = lobby.slots.length >= lobby.max_players;
  const waiting = lobby.slots.filter((s) => !s.ready).length;
  // The boxes: every taken one, plus empty ones to tap — at least 10, and always one spare (up to the maximum).
  const lastTaken = lobby.slots.reduce((m, s) => Math.max(m, s.pos), -1);
  const boxCount = Math.min(lobby.max_players, Math.max(10, lastTaken + 2, lobby.slots.length + 1));
  const boxes = Array.from({ length: boxCount }, (_, pos) => ({ pos, slot: lobby.slots.find((s) => s.pos === pos) }));
  const hasSaved = lobby.slots.some((s) => s.mine && s.ready);

  return (
    <>
      <View style={styles.summary} testID="setup-summary">
        <Ionicons name="skull-outline" size={20} color={colors.brand} />
        <Text style={styles.summaryText}>
          {lobby.ready_count} ready{waiting ? ` · ${waiting} adding details` : ""} · Traitors chosen at random · 12 days ·{" "}
          {lobby.tables_per_day === 2 ? "2 Round Tables a day" : "1 Round Table a day"}
        </Text>
      </View>

      <View style={{ gap: spacing.sm }} testID="lobby-slots">
        {boxes.map(({ pos: i, slot: s }) =>
          !s && i === 0 && !lobby.you_host ? (
            <View key="empty-0" style={[styles.spot, styles.spotEmpty]} testID="lobby-box-0">
              <Text style={styles.num}>1</Text>
              <Ionicons name="key-outline" size={20} color={colors.muted} />
              <Text style={[styles.spotName, styles.spotWaiting]}>Kept for the host</Text>
            </View>
          ) : !s ? (
            // An empty box: tap it and it's held for this phone straight away.
            <Pressable
              key={`empty-${i}`}
              testID={`lobby-box-${i}`}
              onPress={() => join.mutate(i)}
              disabled={join.isPending}
              style={[styles.spot, styles.spotEmpty]}
              accessibilityRole="button"
              accessibilityLabel={`Box ${i + 1}: tap to add ${hasSaved ? "another player" : "yourself"}`}
            >
              <Text style={styles.num}>{i + 1}</Text>
              {join.isPending && join.variables === i ? (
                <ActivityIndicator color={colors.brand} />
              ) : (
                <Ionicons name="add-circle-outline" size={22} color={colors.brand} />
              )}
              <Text style={styles.spotEmptyText}>{hasSaved ? "Tap to add another player" : "Tap to add yourself"}</Text>
            </Pressable>
          ) : s.mine && (!s.ready || editing.includes(s.id)) ? (
            <SpotForm
              key={s.id}
              index={i}
              slot={s}
              device={device}
              onlyBox={lobby.slots.filter((x) => x.mine && x.id !== s.id).length === 0}
              onSaved={(l) => { setEditing((e) => e.filter((x) => x !== s.id)); put(l); }}
              onCancelEdit={s.ready ? () => setEditing((e) => e.filter((x) => x !== s.id)) : undefined}
              onRemove={() => remove.mutate(s.id)}
              removing={remove.isPending && remove.variables === s.id}
            />
          ) : (
            <View key={s.id} style={[styles.spot, s.mine && styles.spotMine]} testID={`lobby-slot-${i}`}>
              <Text style={styles.num}>{i + 1}</Text>
              {s.ready ? (
                <Ionicons name="checkmark-circle" size={22} color={colors.brand} />
              ) : (
                <Ionicons name="lock-closed-outline" size={20} color={colors.muted} />
              )}
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[styles.spotName, !s.ready && styles.spotWaiting]} numberOfLines={1} testID={`lobby-slot-name-${i}`}>
                  {s.ready ? s.name : "Adding their details…"}
                </Text>
                {s.host || s.mine ? (
                  <Text style={styles.spotTag}>{[s.host ? "Host" : null, s.mine ? (mineCount > 1 ? "Added on this phone" : "You") : null].filter(Boolean).join(" · ")}</Text>
                ) : null}
              </View>
              {s.mine ? (
                <Pressable testID={`lobby-edit-${i}`} onPress={() => setEditing((e) => [...e, s.id])} style={styles.remove} hitSlop={6} accessibilityLabel="Change">
                  <Ionicons name="create-outline" size={22} color={colors.brand} />
                </Pressable>
              ) : null}
              {s.mine || lobby.you_host ? (
                <Pressable
                  testID={`lobby-remove-${i}`}
                  onPress={() => (asked === s.id ? remove.mutate(s.id) : setAsked(s.id))}
                  style={[styles.remove, asked === s.id && styles.removeAsk]}
                  hitSlop={6}
                  accessibilityLabel={asked === s.id ? "Tap again to remove" : "Remove"}
                >
                  {asked === s.id ? (
                    <Text style={styles.removeAskText}>Remove?</Text>
                  ) : (
                    <Ionicons name="close" size={22} color={colors.muted} />
                  )}
                </Pressable>
              ) : null}
            </View>
          ),
        )}
      </View>

      <ErrorText testID="lobby-error" message={join.error?.message || remove.error?.message} />
      {full ? <Text style={styles.note}>The game is full — {lobby.max_players} players at most.</Text> : null}

      {lobby.you_host ? (
        <HostControls lobby={lobby} device={device} put={put} />
      ) : (
        <>
          <Text style={styles.note} testID="lobby-waiting-note">
            Waiting for {lobby.host_name ?? "the host"} to choose the Traitors.
          </Text>
          <ErrorText testID="lobby-takeover-error" message={claim.error?.message} />
          {lobby.host_away ? (
            // The host's phone has gone and they never added themselves: someone has to take over.
            <Button testID="lobby-takeover-button" label="The host has gone — take over as host" variant="ghost" icon="key-outline" loading={claim.isPending} onPress={() => claim.mutate(undefined)} />
          ) : lobby.host_name ? (
            takeOver ? (
              <View style={styles.form} testID="lobby-takeover-form">
                <Text style={styles.formTitle}>{lobby.host_name}, on a different phone?</Text>
                <Text style={styles.formNote}>Enter your PIN to carry on as host on this phone. Your box moves here too.</Text>
                <TextInput
                  testID="lobby-takeover-pin"
                  value={hostPin}
                  onChangeText={(t) => setHostPin(t.replace(/\D/g, "").slice(0, 4))}
                  placeholder={`${lobby.host_name}'s PIN`}
                  placeholderTextColor={colors.muted}
                  style={[styles.input, { letterSpacing: hostPin ? 6 : 0 }]}
                  keyboardType="number-pad"
                  secureTextEntry
                  maxLength={4}
                />
                <Button testID="lobby-takeover-confirm" label="Take over as host" icon="key-outline" disabled={hostPin.length !== 4} loading={claim.isPending} onPress={() => claim.mutate(hostPin)} />
                <Button testID="lobby-takeover-cancel" label="Never mind" variant="secondary" onPress={() => { setTakeOver(false); setHostPin(""); claim.reset(); }} />
              </View>
            ) : (
              <Pressable testID="lobby-takeover-link" onPress={() => setTakeOver(true)} style={styles.link} hitSlop={6}>
                <Ionicons name="key-outline" size={16} color={colors.brand} />
                <Text style={styles.linkText}>Are you {lobby.host_name} on a different phone?</Text>
              </Pressable>
            )
          ) : null}
        </>
      )}
    </>
  );
}

/** This phone's own spot, open for its name and PIN. Locked to this phone on the server. */
function SpotForm({
  index,
  slot,
  device,
  onlyBox,
  onSaved,
  onCancelEdit,
  onRemove,
  removing,
}: {
  index: number;
  slot: LobbySlot;
  device: string;
  /** This phone has no other box (only then is the PIN kept, to skip it once the game starts). */
  onlyBox: boolean;
  onSaved: (l: Lobby) => void;
  onCancelEdit?: () => void;
  onRemove: () => void;
  removing: boolean;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [name, setName] = useState(slot.name ?? "");
  const [pin, setPin] = useState("");
  const save = useMutation({
    mutationFn: async () => {
      const l = await api.lobbySave(device, slot.id, name.trim(), pin);
      await rememberSpotPin(slot.id, pin, onlyBox);
      return l;
    },
    onSuccess: onSaved,
  });
  const ok = !!name.trim() && /^\d{4}$/.test(pin);
  return (
    <View style={styles.form} testID={`lobby-form-${index}`}>
      <Text style={styles.formTitle}>
        {index + 1}. {slot.ready ? "Change your details" : "Your details"}
      </Text>
      <Text style={styles.formNote}>Held for you while you&apos;re here. Save to keep it — leave without saving and it frees up again.</Text>
      <TextInput
        testID={`lobby-name-input-${index}`}
        value={name}
        onChangeText={setName}
        placeholder="Your name"
        placeholderTextColor={colors.muted}
        style={styles.input}
        autoCapitalize="words"
        autoFocus
        returnKeyType="next"
        maxLength={20}
      />
      <TextInput
        testID={`lobby-pin-input-${index}`}
        value={pin}
        onChangeText={(t) => setPin(t.replace(/\D/g, "").slice(0, 4))}
        placeholder="Secret 4-digit PIN"
        placeholderTextColor={colors.muted}
        style={[styles.input, { letterSpacing: pin ? 6 : 0 }]}
        keyboardType="number-pad"
        secureTextEntry
        maxLength={4}
        onSubmitEditing={() => ok && save.mutate()}
      />
      <Text style={styles.formNote}>Keep the PIN to yourself — you&apos;ll need it to see your secret.</Text>
      <ErrorText testID={`lobby-save-error-${index}`} message={save.error?.message} />
      <Button testID={`lobby-save-button-${index}`} label="Save" icon="checkmark" disabled={!ok} loading={save.isPending} onPress={() => save.mutate()} />
      {onCancelEdit ? (
        <Button testID={`lobby-cancel-edit-${index}`} label="Keep it as it was" variant="secondary" onPress={onCancelEdit} />
      ) : (
        <Button testID={`lobby-cancel-${index}`} label="Never mind — free this box" variant="secondary" icon="close" loading={removing} onPress={onRemove} />
      )}
    </View>
  );
}

/** The host's settings and the big button. */
function HostControls({ lobby, device, put }: { lobby: OpenLobby; device: string; put: (l: Lobby) => void }) {
  const styles = useStyles();
  const { colors } = useTheme();
  // Optional ClaudAI: a host who sees everything, opened with its own passphrase (typed twice —
  // it can never be recovered, there is no master key). Only ever on the host's phone.
  const [claudai, setClaudai] = useState(false);
  const [modPass, setModPass] = useState("");
  const [modPass2, setModPass2] = useState("");
  const passOk = !passphraseProblem(modPass) && modPass === modPass2;
  const [cancelAsk, setCancelAsk] = useState(false);
  useEffect(() => {
    if (!cancelAsk) return;
    const t = setTimeout(() => setCancelAsk(false), 4000); // not tapped again in time: never mind
    return () => clearTimeout(t);
  }, [cancelAsk]);
  const settings = useMutation({ mutationFn: (n: 1 | 2) => api.lobbySettings(device, n), onSuccess: put });
  const start = useMutation({ mutationFn: () => api.lobbyStart(device, claudai ? modPass : undefined), onSuccess: put });
  const cancel = useMutation({ mutationFn: () => api.lobbyCancel(device), onSuccess: put });
  const waiting = lobby.slots.filter((s) => !s.ready).length;
  const enough = lobby.ready_count >= 4;
  const hostHasBox = lobby.slots.some((s) => s.mine && s.host);
  const blocked = !enough || waiting > 0 || !hostHasBox || (claudai && !passOk);
  const why = !hostHasBox
    ? "Add yourself first — the host needs a box too (your PIN is the one that can end the game)."
    : !enough
    ? `${4 - lobby.ready_count} more player${4 - lobby.ready_count === 1 ? "" : "s"} needed (10–15 is ideal).`
    : waiting
      ? `Waiting for ${waiting} to finish adding their details.`
      : claudai && !passOk
        ? "Finish the ClaudAI passphrase (strong, and typed the same twice) — or untick ClaudAI."
        : null;

  return (
    <>
      <View style={styles.claudai} testID="setup-tables">
        <Text style={styles.claudaiTitle}>Round Tables per day</Text>
        {([2, 1] as const).map((n) => {
          const on = lobby.tables_per_day === n;
          return (
            <Pressable
              key={n}
              testID={`setup-tables-${n}`}
              onPress={() => !on && settings.mutate(n)}
              style={[styles.choice, on && styles.choiceOn]}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
            >
              <Ionicons name={on ? "radio-button-on" : "radio-button-off"} size={24} color={colors.brand} />
              <View style={{ flex: 1 }}>
                <Text style={styles.choiceTitle}>{n === 2 ? "Two a day — lunch & 8pm" : "One a day — the evening"}</Text>
                <Text style={[styles.note, { textAlign: "left" }]}>
                  {n === 2
                    ? "A Round Table at lunch and another at about 8pm, with a murder (or a recruit) before each. A faster game."
                    : "One Round Table each evening, with one murder (or recruit) a day. The slower, classic pace."}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.claudai} testID="setup-claudai">
        <Pressable
          testID="setup-claudai-toggle"
          onPress={() => setClaudai((v) => !v)}
          style={styles.claudaiRow}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: claudai }}
        >
          <Ionicons name={claudai ? "checkbox" : "square-outline"} size={26} color={colors.brand} />
          <View style={{ flex: 1 }}>
            <Text style={styles.claudaiTitle}>
              Add Claud<Text style={{ color: colors.traitor }}>AI</Text>
            </Text>
            <Text style={[styles.note, { textAlign: "left" }]}>
              A host who sees every role and move, so nobody else has to. Opened from the ⋯ menu (“ClaudAI (host)”) with its own passphrase.
            </Text>
          </View>
        </Pressable>
        {claudai ? (
          <>
            <PassphraseFields testID="setup-claudai-pin" value={modPass} confirm={modPass2} onChange={setModPass} onConfirmChange={setModPass2} />
            <View style={styles.warnRow} testID="setup-claudai-warning">
              <Ionicons name="warning-outline" size={18} color={colors.traitor} style={{ marginTop: 1 }} />
              <Text style={styles.warnText}>
                Give it only to the ClaudAI host and write it down somewhere safe. It can never be recovered or reset —
                there is no master key, not even for the app&apos;s makers. Lose it and nobody can open ClaudAI for this game.
              </Text>
            </View>
          </>
        ) : null}
      </View>

      <Button
        testID="lobby-cancel-signup"
        label={cancelAsk ? "Tap again to cancel the sign-up" : "Cancel the sign-up"}
        variant="secondary"
        icon="trash-outline"
        loading={cancel.isPending}
        onPress={() => (cancelAsk ? cancel.mutate() : setCancelAsk(true))}
      />
      {/* The host's big button, last on the page. */}
      <Text style={styles.note}>The app secretly picks the Traitors. Nobody — not even the host — will know who they are.</Text>
      {why ? <Text style={styles.note} testID="setup-start-why">{why}</Text> : null}
      <ErrorText testID="setup-start-error" message={start.error?.message || settings.error?.message || cancel.error?.message} />
      <Button testID="setup-start-button" label="Choose the Traitors" icon="flame" disabled={blocked} loading={start.isPending} onPress={() => start.mutate()} />
    </>
  );
}

const PASS_RULES: { label: string; ok: (s: string) => boolean }[] = [
  { label: "8+ characters", ok: (s) => s.length >= 8 },
  { label: "Upper case", ok: (s) => /[A-Z]/.test(s) },
  { label: "Lower case", ok: (s) => /[a-z]/.test(s) },
  { label: "A number", ok: (s) => /[0-9]/.test(s) },
  { label: "A symbol", ok: (s) => /[^A-Za-z0-9]/.test(s) },
];

/** The ClaudAI passphrase typed twice, with a live checklist of what it still needs. */
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
    ? "Choose a passphrase: at least 8 characters with upper and lower case letters, a number and a symbol."
    : !strong
      ? `Still needs: ${missing.join(", ")}.`
      : !confirm
        ? "Strong. Now type it again to confirm."
        : match
          ? "Strong, and both match ✓"
          : "The two don't match yet.";
  const field = {
    placeholderTextColor: colors.muted,
    style: styles.input,
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
      <TextInput testID={testID} value={value} onChangeText={onChange} placeholder="ClaudAI passphrase" {...field} />
      <TextInput testID={`${testID}-confirm`} value={confirm} onChangeText={onConfirmChange} placeholder="Type it again to confirm" {...field} />
      <View style={styles.checks} testID={`${testID}-checks`}>
        {[...PASS_RULES.map((r) => ({ label: r.label, ok: r.ok(value) })), { label: "Both match", ok: match }].map((r) => (
          <View key={r.label} style={styles.check}>
            <Ionicons name={r.ok ? "checkmark-circle" : "ellipse-outline"} size={16} color={r.ok ? colors.brand : colors.muted} />
            <Text style={[styles.checkText, r.ok && { color: colors.onSurface }]}>{r.label}</Text>
          </View>
        ))}
      </View>
      <Text style={[styles.note, { textAlign: "left" }, strong && match && { color: colors.brand }]} testID={`${testID}-status`}>
        {status}
      </Text>
      <Pressable testID={`${testID}-show`} onPress={() => setShow((v) => !v)} style={styles.showRow} hitSlop={6}>
        <Ionicons name={show ? "eye-off-outline" : "eye-outline"} size={18} color={colors.brand} />
        <Text style={styles.showText}>{show ? "Hide what I typed" : "Show what I typed"}</Text>
      </Pressable>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: c.divider,
  },
  headerText: { color: c.onSurface, fontSize: 18, fontWeight: "700", flex: 1 },
  iconBtn: { width: 48, height: 48, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", backgroundColor: c.surfaceSecondary },
  scroll: { padding: spacing.lg, gap: spacing.md },
  summary: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: c.brandTertiary,
    padding: spacing.md,
    borderRadius: radius.md,
  },
  summaryText: { color: c.onBrandTertiary, fontSize: 15, fontWeight: "600", flex: 1 },
  claudai: { gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, backgroundColor: c.surfaceSecondary },
  claudaiRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 48 },
  claudaiTitle: { color: c.onSurface, fontSize: 17, fontWeight: "700" },
  choice: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 56, padding: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: c.border },
  choiceOn: { borderColor: c.brandSecondary, backgroundColor: c.brandTertiary },
  choiceTitle: { color: c.onSurface, fontSize: 16, fontWeight: "700" },
  checks: { flexDirection: "row", flexWrap: "wrap", columnGap: spacing.md, rowGap: spacing.xs },
  check: { flexDirection: "row", alignItems: "center", gap: 4 },
  checkText: { color: c.muted, fontSize: 14, fontWeight: "600" },
  showRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs, alignSelf: "flex-start", minHeight: 32 },
  links: { flexDirection: "row", flexWrap: "wrap", columnGap: spacing.lg, rowGap: spacing.xs },
  link: { flexDirection: "row", alignItems: "center", gap: spacing.xs, minHeight: 44 },
  linkText: { color: c.brand, fontSize: 15, fontWeight: "700" },
  showText: { color: c.brand, fontSize: 14, fontWeight: "700" },
  warnRow: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" },
  warnText: { color: c.onSurfaceSecondary, fontSize: 14, lineHeight: 20, flex: 1 },
  num: { width: 20, color: c.muted, fontSize: 16, fontWeight: "600", textAlign: "right" },
  spot: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: 60,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.surfaceSecondary,
  },
  spotMine: { borderColor: c.brandSecondary },
  spotEmpty: { borderStyle: "dashed", backgroundColor: "transparent" },
  spotEmptyText: { color: c.brand, fontSize: 16, fontWeight: "700", flex: 1 },
  spotName: { color: c.onSurface, fontSize: 18, fontWeight: "700" },
  spotWaiting: { color: c.muted, fontWeight: "600", fontStyle: "italic" },
  spotTag: { color: c.brand, fontSize: 13, fontWeight: "700" },
  removeAsk: { width: "auto", paddingHorizontal: spacing.sm, borderRadius: radius.pill, backgroundColor: c.surfaceTertiary },
  removeAskText: { color: c.traitor, fontSize: 14, fontWeight: "800" },
  form: { gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: c.brandSecondary, backgroundColor: c.surfaceSecondary },
  formTitle: { color: c.onSurface, fontSize: 17, fontWeight: "700" },
  formNote: { color: c.muted, fontSize: 14, lineHeight: 20 },
  input: {
    height: 56,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.surfaceSecondary,
    color: c.onSurface,
    fontSize: 18,
    paddingHorizontal: spacing.md,
  },
  remove: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  note: { color: c.muted, fontSize: 14, lineHeight: 20, textAlign: "center" },
}));
