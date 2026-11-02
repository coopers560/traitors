import { Modal, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Body, Button, ErrorText, Title } from "@/src/components/ui";
import { makeStyles, radius, spacing } from "@/src/theme";

type Props = {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  error?: string | null;
};

export function ConfirmSheet({ visible, title, message, confirmLabel, danger, loading, onConfirm, onCancel, error }: Props) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.scrim} onPress={onCancel} testID="confirm-sheet-scrim" />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]} testID="confirm-sheet">
        <Title style={{ fontSize: 32, lineHeight: 38 }}>{title}</Title>
        <Body>{message}</Body>
        <ErrorText testID="confirm-sheet-error" message={error} />
        <Button
          testID="confirm-sheet-confirm-button"
          label={confirmLabel}
          variant={danger ? "danger" : "primary"}
          loading={loading}
          onPress={onConfirm}
        />
        <Button testID="confirm-sheet-cancel-button" label="Cancel" variant="secondary" onPress={onCancel} />
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
}));
