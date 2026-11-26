import Ionicons from "@react-native-vector-icons/ionicons";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, ApiError, passphraseProblem } from "@/src/api";
import { HelpButton } from "@/src/components/help-button";
import { useGameCode } from "@/src/game-code";
import { Body, Button, ErrorText, Eyebrow, Title } from "@/src/components/ui";
import { makeStyles, radius, spacing, useTheme } from "@/src/theme";

type Row = { key: number; name: string; pin: string };
let nextKey = 0;
const blank = (): Row => ({ key: nextKey++, name: "", pin: "" });

export default function Setup() {
  const styles = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { setCode } = useGameCode();
  const [rows, setRows] = useState<Row[]>(() => Array.from({ length: 10 }, blank));
  const [localError, setLocalError] = useState<string | null>(null);

  // Optional ClaudAI: a host who sees everything, opened with its own passphrase (typed twice —
  // it can never be recovered, there is no master key).
  const [claudai, setClaudai] = useState(false);
  const [modPass, setModPass] = useState("");
  const [modPass2, setModPass2] = useState("");
  const passOk = !passphraseProblem(modPass) && modPass === modPass2;
  // Round Tables per day: 2 (lunch and about 8pm) or 1 (the evening only).
  const [tables, setTables] = useState<1 | 2>(2);

  const create = useMutation({
    mutationFn: (v: { players: { name: string; pin: string }[]; claudaiPassphrase?: string; tablesPerDay: 1 | 2 }) =>
      api.createGame(v.players, { claudaiPassphrase: v.claudaiPassphrase, tablesPerDay: v.tablesPerDay }),
    onSuccess: async (s) => {
      if (s.exists) await setCode(s.code);
      qc.setQueryData(["game"], s);
      router.dismissTo("/");
    },
  });

  // A game is already in progress (one group, one game): go and join it instead.
  const joinCurrent = async () => {
    const cur = await api.currentGame();
    if (cur.code) await setCode(cur.code);
    router.dismissTo("/");
  };

  const update = (key: number, patch: Partial<Row>) => setRows((r) => r.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const filled = rows.filter((r) => r.name.trim() || r.pin);

  const submit = () => {
    setLocalError(null);
    if (filled.length < 4) return setLocalError("Add at least 4 players (10–15 is ideal).");
    const bad = filled.find((r) => !r.name.trim() || !/^\d{4}$/.test(r.pin));
    if (bad) return setLocalError(`${bad.name.trim() || "A player"} needs a name and a 4-digit PIN.`);
    if (claudai) {
      const problem = passphraseProblem(modPass);
      if (problem) return setLocalError(`ClaudAI passphrase: ${problem} (or untick ClaudAI).`);
      if (modPass !== modPass2) return setLocalError("The two ClaudAI passphrases don't match — type it again to confirm.");
    }
    create.mutate({
      players: filled.map((r) => ({ name: r.name.trim(), pin: r.pin })),
      claudaiPassphrase: claudai ? modPass : undefined,
      tablesPerDay: tables,
    });
  };

  return (
    <View style={styles.root} testID="setup-screen">
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="setup-back-button" onPress={() => router.back()} style={styles.iconBtn} hitSlop={8}>
          <Ionicons name="chevron-back" size={26} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerText}>New game</Text>
        <HelpButton from="setup" testID="setup-help-button" />
      </View>
      <KeyboardAwareScrollView
        bottomOffset={24}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.lg }]}
      >
        <View style={{ gap: spacing.sm }}>
          <Eyebrow>Summon the players</Eyebrow>
          <Title>Who is playing?</Title>
          <Body>
            Pass the phone round: each person types their own name and a secret 4-digit PIN they will remember for 12
            days.
          </Body>
        </View>

        <View style={styles.summary} testID="setup-summary">
          <Ionicons name="skull-outline" size={20} color={colors.brand} />
          <Text style={styles.summaryText}>
            {filled.length} players · Traitors chosen at random · 12 days · {tables === 2 ? "2 Round Tables a day" : "1 Round Table a day"}
          </Text>
        </View>

        {rows.map((r, i) => (
          <View key={r.key} style={styles.row}>
            <Text style={styles.num}>{i + 1}</Text>
            <TextInput
              testID={`setup-name-input-${i}`}
              value={r.name}
              onChangeText={(t) => update(r.key, { name: t })}
              placeholder="Name"
              placeholderTextColor={colors.muted}
              style={[styles.input, { flex: 1, minWidth: 0 }]}
              autoCapitalize="words"
              returnKeyType="next"
              maxLength={20}
            />
            <TextInput
              testID={`setup-pin-input-${i}`}
              value={r.pin}
              onChangeText={(t) => update(r.key, { pin: t.replace(/\D/g, "").slice(0, 4) })}
              placeholder="PIN"
              placeholderTextColor={colors.muted}
              style={[styles.input, styles.pin]}
              keyboardType="number-pad"
              secureTextEntry
              maxLength={4}
            />
            {rows.length > 4 ? (
              <Pressable testID={`setup-remove-player-${i}`} onPress={() => setRows((x) => x.filter((y) => y.key !== r.key))} style={styles.remove} hitSlop={6}>
                <Ionicons name="close" size={22} color={colors.muted} />
              </Pressable>
            ) : null}
          </View>
        ))}

        {rows.length < 15 ? (
          <Button testID="setup-add-player-button" label="Add a player" variant="ghost" icon="person-add-outline" onPress={() => setRows((r) => [...r, blank()])} />
        ) : null}

        <View style={styles.claudai} testID="setup-tables">
          <Text style={styles.claudaiTitle}>Round Tables per day</Text>
          {([2, 1] as const).map((n) => {
            const on = tables === n;
            return (
              <Pressable
                key={n}
                testID={`setup-tables-${n}`}
                onPress={() => setTables(n)}
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

        <ErrorText testID="setup-error" message={localError || create.error?.message} />
        {create.error instanceof ApiError && create.error.status === 409 ? (
          <Button testID="setup-join-current-button" label="Join the game in progress" icon="enter-outline" onPress={joinCurrent} />
        ) : null}
        <Button testID="setup-start-button" label="Choose the Traitors" icon="flame" disabled={claudai && !passOk} loading={create.isPending} onPress={submit} />
        {claudai && !passOk ? (
          <Text style={styles.note} testID="setup-claudai-blocked">Finish the ClaudAI passphrase (strong, and typed the same twice) — or untick ClaudAI.</Text>
        ) : null}
        <Text style={styles.note}>The app secretly picks the Traitors. Nobody — not even the organiser — will know who they are.</Text>
      </KeyboardAwareScrollView>
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
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
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
  showText: { color: c.brand, fontSize: 14, fontWeight: "700" },
  warnRow: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" },
  warnText: { color: c.onSurfaceSecondary, fontSize: 14, lineHeight: 20, flex: 1 },
  num: { width: 20, color: c.muted, fontSize: 16, fontWeight: "600", textAlign: "right" },
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
  pin: { width: 76, textAlign: "center", letterSpacing: 4, paddingHorizontal: spacing.sm },
  remove: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  note: { color: c.muted, fontSize: 14, lineHeight: 20, textAlign: "center" },
}));
