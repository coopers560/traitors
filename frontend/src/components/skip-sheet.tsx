import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, GameState, PublicPlayer } from "@/src/api";
import { PinPad } from "@/src/components/pin-pad";
import { Body, Button, ErrorText, Title } from "@/src/components/ui";
import { makeStyles, radius, spacing } from "@/src/theme";

type Props = {
  target: PublicPlayer | null;
  players: PublicPlayer[];
  onDone: (s: GameState) => void;
  onError: () => void;
  onCancel: () => void;
};

/** Skip a player's vote: the person skipping picks their own name and enters their PIN. */
export function SkipSheet({ target, players, onDone, onError, onCancel }: Props) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const [by, setBy] = useState<PublicPlayer | null>(null);
  const [pin, setPin] = useState("");

  const skip = useMutation({
    mutationFn: () => api.skipVote(target!.id, { byId: by!.id, pin }),
    onSuccess: onDone,
    onError: () => {
      setPin("");
      onError();
    },
  });

  // Fresh start every time the sheet opens for someone
  useEffect(() => {
    setBy(null);
    setPin("");
    skip.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.id]);

  useEffect(() => {
    if (pin.length === 4 && by && !skip.isPending) skip.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin]);

  const close = () => {
    skip.reset();
    onCancel();
  };

  return (
    <Modal visible={!!target} transparent animationType="fade" onRequestClose={close}>
      <Pressable style={styles.scrim} onPress={close} testID="skip-sheet-scrim" />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]} testID="skip-sheet">
        <Title style={styles.title}>Skip {target?.name}&apos;s vote?</Title>
        {!by ? (
          <>
            <Body>Who is skipping it? Tap your own name — you&apos;ll need your PIN.</Body>
            <ScrollView style={{ maxHeight: 320 }} contentContainerStyle={{ gap: spacing.sm }}>
              {players
                .filter((p) => p.alive)
                .map((p) => (
                  <Pressable key={p.id} testID={`skip-by-${p.id}`} onPress={() => setBy(p)} style={({ pressed }) => [styles.pick, pressed && styles.pickPressed]}>
                    <Text style={styles.pickText}>{p.name}</Text>
                  </Pressable>
                ))}
            </ScrollView>
          </>
        ) : (
          <>
            <Body testID="skip-sheet-by">
              {by.name}, enter your PIN to skip {target?.name}&apos;s vote tonight. They can still vote if they turn up.
            </Body>
            <ErrorText testID="skip-sheet-error" message={skip.error?.message} />
            <View style={{ alignItems: "center" }}>
              <PinPad value={pin} onChange={setPin} disabled={skip.isPending} />
            </View>
            <Button testID="skip-sheet-change-name-button" label="Not you? Choose another name" variant="ghost" onPress={() => { setBy(null); setPin(""); skip.reset(); }} />
          </>
        )}
        <Button testID="skip-sheet-cancel-button" label="Cancel" variant="secondary" onPress={close} />
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((c) => ({
  scrim: { flex: 1, backgroundColor: c.scrim },
  sheet: {
    backgroundColor: c.surfaceSecondary,
    borderTopLeftRadius: radius.lg * 1.5,
    borderTopRightRadius: radius.lg * 1.5,
    padding: spacing.lg,
    gap: spacing.md,
    borderTopWidth: 1,
    borderColor: c.brandSecondary,
  },
  title: { fontSize: 32, lineHeight: 38 },
  pick: {
    minHeight: 56,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: c.surfaceTertiary,
    borderWidth: 1,
    borderColor: c.border,
  },
  pickPressed: { backgroundColor: c.brandTertiary },
  pickText: { color: c.onSurface, fontSize: 19, fontWeight: "600" },
}));
