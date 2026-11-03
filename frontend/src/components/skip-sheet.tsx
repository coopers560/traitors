import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Modal, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, GameState, PublicPlayer } from "@/src/api";
import { PinPad } from "@/src/components/pin-pad";
import { Body, Button, ErrorText, Title } from "@/src/components/ui";
import { makeStyles, radius, spacing } from "@/src/theme";

export type SkipRequest = { player: PublicPlayer; undo: boolean };

type Props = {
  request: SkipRequest | null;
  /** Player 1, the only one allowed to skip votes. */
  host: PublicPlayer | undefined;
  onDone: (s: GameState) => void;
  onError: () => void;
  onCancel: () => void;
};

/** Skip (or un-skip) a player's vote. Only player 1 can do it, with their PIN. */
export function SkipSheet({ request, host, onDone, onError, onCancel }: Props) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const [pin, setPin] = useState("");
  const target = request?.player;

  const skip = useMutation({
    mutationFn: () => api.skipVote(target!.id, { undo: request!.undo, byId: host!.id, pin }),
    onSuccess: onDone,
    onError: () => {
      setPin("");
      onError();
    },
  });

  // Fresh start every time the sheet opens
  useEffect(() => {
    setPin("");
    skip.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.id, request?.undo]);

  useEffect(() => {
    if (pin.length === 4 && host && !skip.isPending) skip.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin]);

  const close = () => {
    skip.reset();
    onCancel();
  };

  return (
    <Modal visible={!!request} transparent animationType="fade" onRequestClose={close}>
      <Pressable style={styles.scrim} onPress={close} testID="skip-sheet-scrim" />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]} testID="skip-sheet">
        <Title style={styles.title}>
          {request?.undo ? `Let ${target?.name} vote again?` : `Skip ${target?.name}'s vote?`}
        </Title>
        <Body testID="skip-sheet-host">
          Only {host?.name} (player 1) can {request?.undo ? "undo a skip" : "skip votes"}. {host?.name}, enter your PIN.
          {request?.undo ? "" : ` ${target?.name} can still vote if they turn up.`}
        </Body>
        <ErrorText testID="skip-sheet-error" message={skip.error?.message} />
        <View style={{ alignItems: "center" }}>
          <PinPad value={pin} onChange={setPin} disabled={skip.isPending} />
        </View>
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
}));
