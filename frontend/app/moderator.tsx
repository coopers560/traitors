import Ionicons from "@react-native-vector-icons/ionicons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState, type ComponentProps } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, ApiError, ModAuth, ModeratorView, passphraseProblem, personalise, roundLabel, VoteLogEntry } from "@/src/api";
import { ConfirmSheet } from "@/src/components/confirm-sheet";
import { ScreenHeader } from "@/src/components/screen-header";
import { Body, Button, ErrorText, Eyebrow, Title } from "@/src/components/ui";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

// The moderator ("Claudia") god-view. Reached from the dashboard's ⋯ menu ("ClaudAI (host)"),
// then the game's own ClaudAI passphrase, checked by the server. There is no master key and no
// way to recover the passphrase. It reveals every role, so it must never be opened in front of the players.

export default function Moderator() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const [pass, setPass] = useState("");
  const [auth, setAuth] = useState<ModAuth | null>(null);
  const [code, setCode] = useState<string | null>(null);

  // There is no master key: this game's ClaudAI passphrase opens the game in progress, and only it.
  const unlock = useMutation({
    mutationFn: () => api.moderatorLogin(pass),
    onSuccess: (r) => {
      setCode(r.code);
      setAuth({ passphrase: pass });
    },
  });
  const unlockError = unlock.error ? unlock.error.message : null;

  if (!auth) {
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
            <Body>Like Claudia, but it never forgets. Enter this game&apos;s ClaudAI passphrase — ClaudAI sees every role and every move, so never open it where players can see. No ClaudAI host yet? The game&apos;s host can nominate one from the ⋯ menu.</Body>
          </View>
          <TextInput
            testID="moderator-pass-input"
            value={pass}
            onChangeText={(t) => { unlock.reset(); setPass(t); }}
            placeholder="ClaudAI passphrase"
            placeholderTextColor="#8E989E"
            maxLength={64}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="off"
            textContentType="none"
            spellCheck={false}
            autoFocus
            returnKeyType="go"
            onSubmitEditing={() => pass.length > 0 && unlock.mutate()}
            style={styles.input}
          />
          <ErrorText testID="moderator-pass-error" message={unlockError} />
          <Button testID="moderator-unlock-button" label="Unlock" icon="lock-open" disabled={!pass} loading={unlock.isPending} onPress={() => unlock.mutate()} />
          <Text style={styles.gateNote}>The passphrase can&apos;t be recovered or reset — there is no master key.</Text>
        </KeyboardAwareScrollView>
      </View>
    );
  }

  if (!code) return null;

  return (
    <Breakdown
      key={code}
      code={code}
      auth={auth}
      onAuthChange={setAuth}
      onLock={() => { setAuth(null); setPass(""); setCode(null); }}
    />
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

/** Change this game's ClaudAI passphrase (e.g. to hand ClaudAI to someone else). It can't be recovered. */
function ClaudAIPassphrase({ code, auth, onAuthChange }: { code: string; auth: ModAuth; onAuthChange: (a: ModAuth) => void }) {
  const styles = useStyles();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [pass, setPass] = useState("");
  const [pass2, setPass2] = useState("");
  const ok = !passphraseProblem(pass) && pass === pass2;
  const close = () => {
    setOpen(false);
    setPass("");
    setPass2("");
  };
  const save = useMutation({
    mutationFn: async () => {
      // Don't let a refresh still using the old passphrase land after the change.
      await qc.cancelQueries({ queryKey: ["moderator", code] });
      return api.moderatorSetPassphrase(code, auth, pass);
    },
    onSuccess: (v) => {
      // Carry on signed in with the new passphrase.
      onAuthChange({ passphrase: pass });
      qc.setQueryData(["moderator", code], v);
      close();
    },
  });
  return (
    <View style={styles.card} testID="moderator-pin-card">
      <Text style={styles.cardLabel}>ClaudAI passphrase</Text>
      <Text style={styles.planText}>
        Only the ClaudAI host should know it. It can never be recovered or reset — change it here to hand ClaudAI to someone
        else, and write the new one down somewhere safe.
      </Text>
      {open ? (
        <>
          <PassphraseFields
            testID="moderator-new-pin-input"
            value={pass}
            confirm={pass2}
            onChange={(t) => { save.reset(); setPass(t); }}
            onConfirmChange={(t) => { save.reset(); setPass2(t); }}
          />
          <ErrorText testID="moderator-pin-error" message={save.error?.message} />
          <Button testID="moderator-pin-save" label="Save the new passphrase" icon="key" disabled={!ok} loading={save.isPending} onPress={() => save.mutate()} />
          <Button testID="moderator-pin-cancel" label="Cancel" variant="ghost" onPress={() => { save.reset(); close(); }} />
        </>
      ) : (
        <Button testID="moderator-pin-open" label="Change the ClaudAI passphrase" variant="secondary" icon="key-outline" onPress={() => setOpen(true)} />
      )}
    </View>
  );
}

/** The choices for how long the Traitors get to carry out the murder, in minutes. */
const WINDOW_CHOICES = [0, 15, 30, 45, 60, 90];

/** An ISO time as local "HH:MM". */
function clockOf(t: string): string {
  const d = new Date(t);
  return isNaN(d.getTime()) ? "" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

/**
 * One Round Table a day, or two (lunch and about 8pm), and how long the Traitors get to strike.
 * ClaudAI can change both during the game.
 */
function Schedule({ code, auth, m }: { code: string; auth: ModAuth; m: ModeratorView }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const qc = useQueryClient();
  const [step, setStep] = useState<"idle" | "pick" | "one">("idle");
  const two = m.tables_per_day === 2;
  const calDay = m.cal_day ?? m.day;
  const save = useMutation({
    mutationFn: (v: { tables: 1 | 2; session?: "lunch" | "evening" }) => api.moderatorSchedule(code, auth, v.tables, v.session),
    onSuccess: (v) => {
      qc.setQueryData(["moderator", code], v);
      setStep("idle");
    },
  });
  // How long the Traitors get to carry out the murder after the plot (older games: the default).
  const gap = m.murder_window_minutes ?? 30;
  const plotAt = m.round_table_at && m.phase !== "ended" ? clockOf(m.round_table_at) : "";
  const saveGap = useMutation({
    mutationFn: (minutes: number) => api.moderatorMurderWindow(code, auth, minutes),
    onSuccess: (v) => qc.setQueryData(["moderator", code], v),
  });
  return (
    <View style={styles.card} testID="moderator-schedule-card">
      <Text style={styles.cardLabel}>Schedule</Text>
      <Text style={styles.progressText} testID="moderator-schedule-current">
        {two ? "2 a day (lunch & 8pm)" : "1 Round Table a day"}
      </Text>
      <Text style={styles.planText}>
        {two
          ? "A Round Table at lunch and another at about 8pm, with a murder (or recruit) before each."
          : "One Round Table each evening, with one murder (or recruit) a day."}
        {m.phase !== "ended" ? ` Now: ${roundLabel(m)}.` : ""}
      </Text>
      <ErrorText testID="moderator-schedule-error" message={save.error?.message} />
      {m.phase === "ended" ? null : step === "pick" ? (
        <>
          <Text style={[styles.planText, { color: colors.onSurface, fontWeight: "700" }]} testID="moderator-schedule-question">
            Is the current round Day {calDay}&apos;s Lunch or Evening Round Table?
          </Text>
          <Button testID="moderator-schedule-lunch" label="Lunch" icon="sunny-outline" loading={save.isPending && save.variables?.session === "lunch"} disabled={save.isPending} onPress={() => save.mutate({ tables: 2, session: "lunch" })} />
          <Button testID="moderator-schedule-evening" label="Evening (8pm)" icon="moon-outline" loading={save.isPending && save.variables?.session === "evening"} disabled={save.isPending} onPress={() => save.mutate({ tables: 2, session: "evening" })} />
          <Button testID="moderator-schedule-cancel" label="Cancel" variant="ghost" onPress={() => { save.reset(); setStep("idle"); }} />
        </>
      ) : step === "one" ? (
        <>
          <Text style={[styles.planText, { color: colors.onSurface, fontWeight: "700" }]} testID="moderator-schedule-question">
            Switch to one Round Table a day? The current round becomes Day {calDay}, and every day after has a single evening Round Table.
          </Text>
          <Button testID="moderator-schedule-one-confirm" label="Switch to 1 a day" icon="calendar-outline" loading={save.isPending} onPress={() => save.mutate({ tables: 1 })} />
          <Button testID="moderator-schedule-cancel" label="Cancel" variant="ghost" onPress={() => { save.reset(); setStep("idle"); }} />
        </>
      ) : (
        <Button
          testID="moderator-schedule-switch"
          label={two ? "Switch to 1 Round Table a day" : "Switch to 2 a day (lunch & 8pm)"}
          variant="secondary"
          icon="calendar-outline"
          onPress={() => { save.reset(); setStep(two ? "one" : "pick"); }}
        />
      )}

      <View style={styles.gapSection} testID="moderator-gap">
        <Text style={styles.cardLabel}>Time to carry out the murder</Text>
        <Text style={styles.progressText} testID="moderator-gap-current">
          {gap > 0 ? `${gap} minutes` : "No wait"}
        </Text>
        <Text style={styles.planText}>
          {m.traitors_plot_alone
            ? `Once the Traitors seal their plan, the Round Table stays shut for ${Math.max(gap, 10)}–${Math.max(gap, 10) + 10} minutes (a random moment, so nobody can work out when they sealed it).`
            : gap > 0
              ? `Once everyone has taken their plot turn, the Round Table stays shut for ${gap} minutes.`
              : "The Round Table can open as soon as everyone has taken their plot turn."}
        </Text>
        {plotAt ? (
          <Text style={[styles.planText, { color: colors.onSurface, fontWeight: "700" }]} testID="moderator-gap-next">
            Round Table opens at {plotAt}.
          </Text>
        ) : null}
        <ErrorText testID="moderator-gap-error" message={saveGap.error?.message} />
        {m.phase === "ended" ? null : (
          <View style={styles.gapRow} accessibilityRole="radiogroup">
            {WINDOW_CHOICES.map((h) => {
              const on = gap === h;
              const busy = saveGap.isPending && saveGap.variables === h;
              return (
                <Pressable
                  key={h}
                  testID={`moderator-gap-${h}`}
                  onPress={() => { if (!on) { saveGap.reset(); saveGap.mutate(h); } }}
                  disabled={saveGap.isPending}
                  style={[styles.gapChip, on && styles.gapChipOn]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on, disabled: saveGap.isPending }}
                  accessibilityLabel={h === 0 ? "No wait" : `${h} minutes`}
                >
                  {busy ? (
                    <ActivityIndicator size="small" color={colors.brand} />
                  ) : (
                    <Text style={[styles.gapChipText, on && styles.gapChipTextOn]}>{h === 0 ? "None" : `${h}m`}</Text>
                  )}
                </Pressable>
              );
            })}
          </View>
        )}
      </View>
    </View>
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
      <TextInput testID={testID} value={value} onChangeText={onChange} placeholder="New ClaudAI passphrase" {...field} />
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

function Breakdown({
  code,
  auth,
  onAuthChange,
  onLock,
}: {
  code: string;
  auth: ModAuth;
  onAuthChange: (a: ModAuth) => void;
  onLock: () => void;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  // Roles start hidden so you can follow the game without being spoiled; tap to unmask.
  const [rolesShown, setRolesShown] = useState(false);
  const { data, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: ["moderator", code],
    queryFn: () => api.moderatorView(code, auth),
    // Stop asking once the passphrase is refused (changed elsewhere, or locked out): a phone left
    // open here must not keep sending a stale passphrase.
    refetchInterval: (q) => (q.state.error instanceof ApiError && [403, 429].includes(q.state.error.status) ? false : 4000),
    retry: false,
  });
  // Re-run the last tied Round Table as a revote (also for ties settled before revotes existed).
  const qc = useQueryClient();
  const [confirmRevote, setConfirmRevote] = useState(false);
  const revote = useMutation({
    mutationFn: () => api.moderatorRevote(code, auth),
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
  // Refused (the passphrase was changed on another phone, or too many wrong tries): stop showing
  // what was loaded before and send them back to sign in.
  const refused = error instanceof ApiError && (error.status === 403 || error.status === 429);
  if (!data || refused) {
    return (
      <View style={styles.root} testID="moderator-screen">
        <ScreenHeader title="ClaudAI" testID="moderator" />
        <View style={[styles.scroll, { gap: spacing.md }]}>
          <ErrorText
            testID="moderator-view-error"
            message={
              refused && error.status === 403
                ? "ClaudAI was locked: the passphrase was refused (it may have been changed). Lock and sign in again."
                : error instanceof ApiError && error.status !== 404
                  ? error.message
                  : error
                    ? `No game found with the code ${code}.`
                    : "Could not load the game."
            }
          />
          <Button testID="moderator-lock-button" label="Lock and leave" icon="lock-closed" onPress={onLock} />
        </View>
      </View>
    );
  }

  const m: ModeratorView = data;
  const lastEntry = m.history.length ? m.history[m.history.length - 1] : null;
  const lastTie = lastEntry?.banish?.tie ? lastEntry.banish : null;
  // The players with the most votes in that tie: the only ones who can be chosen in the revote.
  const topVotes = lastTie?.tally[0]?.votes ?? 0;
  const topList = (lastTie?.tally ?? []).filter((t) => t.votes === topVotes).map((t) => t.name);
  const topNames = topList.join(" and ");
  const traitors = m.players.filter((p) => p.role === "traitor");
  const faithful = m.players.filter((p) => p.role === "faithful");
  const voteByDay = new Map<number, VoteLogEntry>(m.vote_log.map((v) => [v.day, v]));
  const eyebrow = m.phase === "ended" ? "Game over" : m.phase === "setup" ? "Before Day 1" : dayOf(m);
  // Each round's label ("Day 3 · Lunch"), for things stored with only the round number (the chat).
  const labels = new Map<number, string>();
  for (const x of [...m.event_log, ...m.vote_log, ...m.history]) if (x.label) labels.set(x.day, x.label);
  if (m.label) labels.set(m.day, m.label);
  const labelOf = (day: number) => labels.get(day) ?? `Day ${day}`;

  return (
    <View style={styles.root} testID="moderator-screen">
      <View style={[styles.topbar, { paddingTop: insets.top + spacing.sm }]}>
        <Ionicons name="shield-half" size={20} color="#D4AF37" />
        <Text style={styles.topbarText}>Claud<Text style={{ color: colors.traitor }}>AI</Text> · game {m.code}</Text>
        <Text style={styles.live}>{isRefetching ? "…" : "● live"}</Text>
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.lg }]}>
        {/* A refresh failed: keep the last good view, but say so */}
        {error ? (
          <ErrorText
            testID="moderator-refresh-error"
            message={`Couldn't refresh: ${error instanceof ApiError && error.status === 404 ? `no game found with the code ${code}.` : error.message}`}
          />
        ) : null}
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
              {lastEntry && m.day > lastEntry.day ? ` This takes the game back to the ${roundLabel(lastEntry)} Round Table.` : ""}
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
            <Text style={[styles.cardLabel, { color: colors.traitor }]}>{m.session ? "The Traitors’ plan" : "Tonight’s plan"}</Text>
            {!rolesShown ? (
              <Text style={[styles.planText, { color: colors.muted }]} testID="moderator-tonight-hidden">
                Hidden. Tap “Reveal roles” to see who the Traitors are after {m.session ? "this plot" : "tonight"}.
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
                  Method: <Text style={styles.planMethod}>{m.tonight.action ? personalise(m.tonight.action, m.tonight.victim_name) : "not chosen yet"}</Text>
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
                    {new Date(c.t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })} · {c.label || labelOf(c.day)} ·{" "}
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
        <EventLog events={m.event_log} currentDay={m.day} currentLabel={roundLabel(m)} rolesShown={rolesShown} />

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
            <Text style={[styles.sectionTitle, { marginTop: spacing.md }]}>{m.tables_per_day === 2 ? "Round by round" : "Day by day"}</Text>
            {m.history.map((h) => <DayCard key={h.day} h={h} votes={voteByDay.get(h.day)} rolesShown={rolesShown} />)}
          </>
        ) : null}

        <Schedule code={code} auth={auth} m={m} />

        <ClaudAIPassphrase code={code} auth={auth} onAuthChange={onAuthChange} />

        <View style={{ gap: spacing.sm, marginTop: spacing.lg }}>
          <Button testID="moderator-refresh-button" label="Refresh now" variant="secondary" icon="refresh" onPress={() => refetch()} />
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

function EventLog({
  events,
  currentDay,
  currentLabel,
  rolesShown,
}: {
  events: ModeratorView["event_log"];
  currentDay: number;
  currentLabel: string;
  rolesShown: boolean;
}) {
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
  // Grouped by round, headed with each round's label ("Day 3 · Lunch"; "Day 3" for older entries).
  const byRound: { key: string; label: string; items: typeof rows }[] = [];
  for (const e of rows) {
    const label = roundLabel(e);
    const key = `${e.day}|${label}`;
    const last = byRound[byRound.length - 1];
    if (last && last.key === key) last.items.push(e);
    else byRound.push({ key, label, items: [e] });
  }
  const tone = (t: "traitor" | "gold" | "muted") => (t === "traitor" ? colors.traitor : t === "gold" ? colors.brand : colors.muted);
  return (
    <View style={styles.card} testID="moderator-log">
      <View style={styles.logHead}>
        <Text style={styles.cardLabel}>Everything that&apos;s happened</Text>
        <Text style={styles.logCount}>{visible.length} events</Text>
      </View>
      {!rolesShown ? <Text style={styles.logHint}>Roles hidden: secret Traitor moves are left out. Tap “Reveal roles” for the full log.</Text> : null}
      {byRound.map((d, gi) => (
        <View key={`${d.key}-${gi}`} style={{ gap: 2 }}>
          <Text style={styles.logDay}>{d.label}</Text>
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
          <Text style={styles.logMore}>{showAll ? `Show ${currentLabel} only` : `Show earlier rounds (${hiddenCount} more)`}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** "Day 3 of 12 · Lunch": the current round's label with the length of the holiday. */
function dayOf(g: { day: number; label?: string; cal_day?: number; total_days: number }): string {
  const label = roundLabel(g);
  const prefix = `Day ${g.cal_day ?? g.day}`;
  return label.startsWith(prefix) ? `${prefix} of ${g.total_days}${label.slice(prefix.length)}` : `${label} of ${g.total_days}`;
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
      <Text style={styles.dayHead}>{roundLabel(h)}</Text>

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
              {mu.victim_name} was murdered{rolesShown && mu.action ? ` — ${personalise(mu.action, mu.victim_name)}` : ""}.
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
  gateNote: { color: c.muted, fontSize: 14, lineHeight: 20, textAlign: "center" },
  checks: { flexDirection: "row", flexWrap: "wrap", columnGap: spacing.md, rowGap: spacing.xs },
  check: { flexDirection: "row", alignItems: "center", gap: 4 },
  checkText: { color: c.muted, fontSize: 14, fontWeight: "600" },
  passStatus: { color: c.muted, fontSize: 14, lineHeight: 20 },
  showRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs, alignSelf: "flex-start", minHeight: 32 },
  showText: { color: c.brand, fontSize: 14, fontWeight: "700" },
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
  gapSection: { gap: spacing.xs, marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: c.divider },
  gapRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.xs },
  gapChip: {
    minWidth: 56,
    height: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.surfaceTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  gapChipOn: { borderColor: c.brand, backgroundColor: c.brandTertiary },
  gapChipText: { color: c.onSurfaceSecondary, fontSize: 16, fontWeight: "700" },
  gapChipTextOn: { color: c.brand },
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
