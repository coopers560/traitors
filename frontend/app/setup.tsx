import Ionicons from "@react-native-vector-icons/ionicons";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "@/src/api";
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

  const create = useMutation({
    mutationFn: api.createGame,
    onSuccess: async (s) => {
      if (s.exists) await setCode(s.code);
      qc.setQueryData(["game"], s);
      router.dismissTo("/");
    },
  });

  const update = (key: number, patch: Partial<Row>) => setRows((r) => r.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const filled = rows.filter((r) => r.name.trim() || r.pin);
  const traitors = Math.max(1, Math.round(filled.length / 5));

  const submit = () => {
    setLocalError(null);
    if (filled.length < 4) return setLocalError("Add at least 4 players (10–15 is ideal).");
    const bad = filled.find((r) => !r.name.trim() || !/^\d{4}$/.test(r.pin));
    if (bad) return setLocalError(`${bad.name.trim() || "A player"} needs a name and a 4-digit PIN.`);
    create.mutate(filled.map((r) => ({ name: r.name.trim(), pin: r.pin })));
  };

  return (
    <View style={styles.root} testID="setup-screen">
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="setup-back-button" onPress={() => router.back()} style={styles.iconBtn} hitSlop={8}>
          <Ionicons name="chevron-back" size={26} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerText}>New game</Text>
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
            {filled.length} players · {filled.length >= 4 ? traitors : "–"} Traitors · 12 days
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

        <ErrorText testID="setup-error" message={localError || create.error?.message} />
        <Button testID="setup-start-button" label="Choose the Traitors" icon="flame" loading={create.isPending} onPress={submit} />
        <Text style={styles.note}>The app secretly picks the Traitors. Nobody — not even the organiser — will know who they are.</Text>
      </KeyboardAwareScrollView>
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
  headerText: { color: c.onSurface, fontSize: 18, fontWeight: "700" },
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
