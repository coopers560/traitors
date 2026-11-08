import Ionicons from "@react-native-vector-icons/ionicons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, ActionList, PrivateView } from "@/src/api";
import { ConfirmSheet } from "@/src/components/confirm-sheet";
import { PinPad } from "@/src/components/pin-pad";
import { ScreenHeader } from "@/src/components/screen-header";
import { Body, Button, ErrorText, Eyebrow, Title } from "@/src/components/ui";
import { makeStyles, radius, spacing, useTheme } from "@/src/theme";

type Item = { key: number; text: string };
let k = 0;
const toItems = (a: string[]): Item[] => a.map((text) => ({ key: k++, text }));

export default function Actions() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();

  // The list of murders is for the Traitors only. Prove who you are first; the
  // role check is verified on the server (privateView), so a Faithful cannot see it.
  const { data: game } = useQuery({ queryKey: ["game"], queryFn: api.getGame });
  const players = game?.exists ? game.players : [];
  const [pid, setPid] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [me, setMe] = useState<PrivateView | null>(null);
  const unlocked = me?.role === "traitor";

  const verify = useMutation({
    mutationFn: () => api.privateView(pid as string, pin),
    onSuccess: setMe,
    onError: () => setPin(""),
  });
  useEffect(() => {
    if (pid && pin.length === 4 && !verify.isPending && !me) verify.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin, pid]);

  const { data, isLoading } = useQuery({ queryKey: ["actions"], queryFn: api.getActions, enabled: unlocked });
  const [items, setItems] = useState<Item[]>([]);
  const [draft, setDraft] = useState("");
  const [saved, setSaved] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    if (data) setItems(toItems(data.actions));
  }, [data]);

  const onSaved = (d: ActionList) => {
    qc.setQueryData(["actions"], d);
    setSaved(true);
    setConfirmReset(false);
  };
  const save = useMutation({ mutationFn: () => api.saveActions(items.map((i) => i.text)), onSuccess: onSaved });
  const reset = useMutation({ mutationFn: api.resetActions, onSuccess: onSaved });

  const change = (fn: (i: Item[]) => Item[]) => {
    setSaved(false);
    setItems(fn);
  };
  const add = () => {
    if (!draft.trim()) return;
    change((i) => [{ key: k++, text: draft.trim() }, ...i]);
    setDraft("");
  };

  // ---- Gate: identify the viewer, then confirm they are a Traitor ----
  if (!unlocked) {
    return (
      <View style={styles.root} testID="actions-screen">
        <ScreenHeader title="Secret actions" testID="actions" />
        <View style={[styles.gate, { paddingBottom: insets.bottom + spacing.lg }]}>
          {me && me.role !== "traitor" ? (
            <View style={styles.deny} testID="actions-denied">
              <Ionicons name="lock-closed" size={40} color={colors.brand} />
              <Title style={{ textAlign: "center" }}>Traitors only</Title>
              <Body style={{ textAlign: "center" }}>
                The list of secret actions is for the Traitors. Keep watching — your job is to spot them.
              </Body>
            </View>
          ) : !pid ? (
            <View style={{ gap: spacing.md }}>
              <Eyebrow>Secret actions</Eyebrow>
              <Title>Who is checking?</Title>
              <Body>Only the Traitors can see the list. Tap your name, then enter your PIN in private.</Body>
              <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
                {players.map((p) => (
                  <Pressable key={p.id} testID={`actions-who-${p.id}`} onPress={() => setPid(p.id)} style={styles.pick}>
                    <Text style={styles.pickText}>{p.name}</Text>
                    <Ionicons name="chevron-forward" size={22} color={colors.borderStrong} />
                  </Pressable>
                ))}
              </View>
            </View>
          ) : (
            <View style={{ alignItems: "center", gap: spacing.md }}>
              <Eyebrow>Make sure nobody is looking</Eyebrow>
              <Title style={{ textAlign: "center" }}>{players.find((p) => p.id === pid)?.name ?? "…"}</Title>
              <ErrorText testID="actions-pin-error" message={verify.error?.message} />
              <PinPad value={pin} onChange={setPin} disabled={verify.isPending} />
              <Button testID="actions-who-cancel" label="Not me" variant="ghost" onPress={() => { setPid(null); setPin(""); verify.reset(); }} />
            </View>
          )}
        </View>
      </View>
    );
  }

  // ---- Unlocked (Traitor): the editable list ----
  return (
    <View style={styles.root} testID="actions-screen">
      <ScreenHeader title="Secret actions" testID="actions" />
      {isLoading ? (
        <ActivityIndicator color={colors.brand} style={{ marginTop: spacing.xl }} />
      ) : (
        <KeyboardAwareScrollView bottomOffset={24} keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.lg }]}>
          <View style={{ gap: spacing.sm }}>
            <Eyebrow>Murders in plain sight</Eyebrow>
            <Title>Your actions</Title>
            <Body>
              Each day the app gives the Traitors one of these at random. Make them fit your hotel and your family
              jokes. Today&apos;s action won&apos;t change, new ones are used from the next pick.
            </Body>
          </View>

          <View style={styles.addRow}>
            <TextInput
              testID="actions-new-input"
              value={draft}
              onChangeText={setDraft}
              placeholder="e.g. Ask them about the camel ride"
              placeholderTextColor={colors.muted}
              style={[styles.input, { flex: 1, minWidth: 0 }]}
              onSubmitEditing={add}
              returnKeyType="done"
              maxLength={120}
            />
            <Pressable testID="actions-add-button" onPress={add} style={[styles.addBtn, !draft.trim() && { opacity: 0.45 }]} disabled={!draft.trim()}>
              <Ionicons name="add" size={28} color={colors.onBrandPrimary} />
            </Pressable>
          </View>

          <Text style={styles.count} testID="actions-count">{items.length} actions</Text>

          {items.map((it, idx) => (
            <View key={it.key} style={styles.row}>
              <TextInput
                testID={`actions-item-input-${idx}`}
                value={it.text}
                onChangeText={(t) => change((list) => list.map((x) => (x.key === it.key ? { ...x, text: t } : x)))}
                style={[styles.input, styles.itemInput]}
                multiline
                maxLength={120}
              />
              <Pressable testID={`actions-item-delete-${idx}`} onPress={() => change((list) => list.filter((x) => x.key !== it.key))} style={styles.del} hitSlop={6}>
                <Ionicons name="trash-outline" size={22} color={colors.muted} />
              </Pressable>
            </View>
          ))}

          <ErrorText testID="actions-error" message={save.error?.message || reset.error?.message} />
          {saved ? (
            <View style={styles.saved} testID="actions-saved">
              <Ionicons name="checkmark-circle" size={20} color={colors.onSuccess} />
              <Text style={styles.savedText}>Saved. The Traitors will get these from now on.</Text>
            </View>
          ) : null}
          <Button testID="actions-save-button" label="Save actions" icon="save-outline" loading={save.isPending} onPress={() => save.mutate()} />
          {data && !data.is_default ? (
            <Button testID="actions-reset-button" label="Reset to the original list" variant="ghost" icon="refresh" onPress={() => setConfirmReset(true)} />
          ) : null}
        </KeyboardAwareScrollView>
      )}
      <ConfirmSheet
        visible={confirmReset}
        title="Reset the actions?"
        message="Your own actions will be replaced with the original family-friendly list."
        confirmLabel="Yes, reset"
        danger
        loading={reset.isPending}
        onConfirm={() => reset.mutate()}
        onCancel={() => setConfirmReset(false)}
      />
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  gate: { flex: 1, padding: spacing.lg, justifyContent: "center", gap: spacing.md },
  deny: { alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.md },
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
  pickText: { color: c.onSurface, fontSize: 19, fontWeight: "600" },
  scroll: { padding: spacing.lg, gap: spacing.md },
  addRow: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
  addBtn: { width: 56, height: 56, borderRadius: radius.md, backgroundColor: c.brandPrimary, alignItems: "center", justifyContent: "center" },
  input: {
    minHeight: 56,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.surfaceSecondary,
    color: c.onSurface,
    fontSize: 17,
    paddingHorizontal: spacing.md,
  },
  itemInput: { flex: 1, minWidth: 0, paddingVertical: spacing.md, textAlignVertical: "top" },
  count: { color: c.muted, fontSize: 14, fontWeight: "600" },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  del: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  saved: { flexDirection: "row", gap: spacing.sm, alignItems: "center", backgroundColor: c.success, padding: spacing.md, borderRadius: radius.md },
  savedText: { color: c.onSuccess, fontSize: 15, flex: 1 },
}));
