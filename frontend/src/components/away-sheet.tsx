import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, GameState, PublicPlayer } from "@/src/api";
import { PinPad } from "@/src/components/pin-pad";
import { Body, Button, ErrorText, Title } from "@/src/components/ui";
import { makeStyles, radius, spacing } from "@/src/theme";

export type AwayRequest = { player: PublicPlayer; undo: boolean };
type Step = "choose" | "vote" | "pin";

type Props = {
  request: AwayRequest | null;
  /** Player 1, the only one allowed to manage absent players. */
  host: PublicPlayer | undefined;
  players: PublicPlayer[];
  onDone: (s: GameState) => void;
  onError: () => void;
  onCancel: () => void;
};

/**
 * For a player who is away at the Round Table, player 1 can either enter their vote
 * for them or skip it; both (and undo) need player 1's PIN.
 */
export function AwaySheet({ request, host, players, onDone, onError, onCancel }: Props) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const target = request?.player;
  const isHost = target?.id === host?.id;
  const [step, setStep] = useState<Step>("choose");
  const [mode, setMode] = useState<"skip" | "proxy">("skip");
  const [vote, setVote] = useState<PublicPlayer | null>(null);
  const [pin, setPin] = useState("");

  const submit = useMutation({
    mutationFn: () => {
      const auth = { byId: host!.id, pin };
      if (request!.undo) return api.skipVote(target!.id, { undo: true, ...auth });
      if (mode === "proxy") return api.proxyVote(target!.id, vote!.id, auth);
      return api.skipVote(target!.id, auth);
    },
    onSuccess: onDone,
    onError: () => {
      setPin("");
      onError();
    },
  });

  // Fresh start every time the sheet opens
  useEffect(() => {
    setStep(request?.undo || isHost ? "pin" : "choose");
    setMode("skip");
    setVote(null);
    setPin("");
    submit.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.id, request?.undo]);

  useEffect(() => {
    if (pin.length === 4 && host && !submit.isPending) submit.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin]);

  const close = () => {
    submit.reset();
    onCancel();
  };

  const title = request?.undo
    ? target?.proxy_by
      ? `Remove ${target?.name}'s vote?`
      : `Let ${target?.name} vote again?`
    : step === "vote"
      ? `${target?.name}'s vote`
      : `${target?.name} is away`;

  return (
    <Modal visible={!!request} transparent animationType="fade" onRequestClose={close}>
      <Pressable style={styles.scrim} onPress={close} testID="away-sheet-scrim" />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]} testID="away-sheet">
        <Title style={styles.title}>{title}</Title>

        {step === "choose" ? (
          <>
            <Body>Only {host?.name} (player 1) can do this. What would you like to do?</Body>
            <Button testID="away-enter-vote-button" label="Enter their vote" icon="create-outline" onPress={() => { setMode("proxy"); setStep("vote"); }} />
            <Button testID="away-skip-vote-button" label="Skip their vote today" variant="secondary" icon="remove-circle-outline" onPress={() => { setMode("skip"); setStep("pin"); }} />
          </>
        ) : step === "vote" ? (
          <>
            <Body>Who does {target?.name} want to banish? Ask them by phone or message.</Body>
            <ScrollView style={{ maxHeight: 300 }} contentContainerStyle={{ gap: spacing.sm }}>
              {players
                .filter((p) => p.alive && p.id !== target?.id)
                .map((p) => (
                  <Pressable
                    key={p.id}
                    testID={`away-vote-option-${p.id}`}
                    onPress={() => { setVote(p); setStep("pin"); }}
                    style={({ pressed }) => [styles.pick, pressed && styles.pickPressed]}
                  >
                    <Text style={styles.pickText}>{p.name}</Text>
                  </Pressable>
                ))}
            </ScrollView>
          </>
        ) : (
          <>
            <Body testID="away-sheet-host">
              {request?.undo
                ? `Only ${host?.name} (player 1) can undo this.`
                : mode === "proxy"
                  ? `${target?.name} votes to banish ${vote?.name}.`
                  : `${target?.name} won't vote tonight, but can still vote if they turn up.`}{" "}
              {host?.name}, enter your PIN.
            </Body>
            <ErrorText testID="away-sheet-error" message={submit.error?.message} />
            <View style={{ alignItems: "center" }}>
              <PinPad value={pin} onChange={setPin} disabled={submit.isPending} />
            </View>
            {!request?.undo && !isHost ? (
              <Button
                testID="away-sheet-back-button"
                label={mode === "proxy" ? "Change their vote" : "Back"}
                variant="secondary"
                icon="arrow-back"
                onPress={() => {
                  setPin("");
                  submit.reset();
                  setStep(mode === "proxy" ? "vote" : "choose");
                }}
              />
            ) : null}
          </>
        )}
        <Button testID="away-sheet-cancel-button" label="Cancel" variant="ghost" onPress={close} />
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
