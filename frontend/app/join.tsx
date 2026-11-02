import { useMutation } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/screen-header";
import { Body, Button, ErrorText, Eyebrow, Title } from "@/src/components/ui";
import { useGameCode } from "@/src/game-code";
import { makeStyles, radius, spacing, useTheme } from "@/src/theme";

export default function Join() {
  const styles = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { setCode } = useGameCode();
  const [value, setValue] = useState("");

  const join = useMutation({
    mutationFn: () => api.findGame(value),
    onSuccess: async (s) => {
      if (!s.exists) return;
      await setCode(s.code);
      router.dismissTo("/");
    },
  });
  const ready = value.trim().length === 5;

  return (
    <View style={styles.root} testID="join-screen">
      <ScreenHeader title="Join a game" testID="join" />
      <KeyboardAwareScrollView bottomOffset={24} keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.lg }]}>
        <View style={{ gap: spacing.sm }}>
          <Eyebrow>Already started on another phone?</Eyebrow>
          <Title>Enter the code</Title>
          <Body>The 5-character code is shown at the top of the main screen on the phone that started the game.</Body>
        </View>
        <TextInput
          testID="join-code-input"
          value={value}
          onChangeText={(t) => {
            join.reset();
            setValue(t.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 5));
          }}
          placeholder="ABCDE"
          placeholderTextColor={colors.muted}
          autoCapitalize="characters"
          autoCorrect={false}
          autoFocus
          returnKeyType="go"
          onSubmitEditing={() => ready && join.mutate()}
          style={styles.input}
        />
        <ErrorText testID="join-error" message={join.error ? (join.error.message.includes("No game") ? "No game found with that code. Check the letters and try again." : join.error.message) : null} />
        <Button testID="join-submit-button" label="Join the game" icon="enter-outline" disabled={!ready} loading={join.isPending} onPress={() => join.mutate()} />
      </KeyboardAwareScrollView>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  scroll: { padding: spacing.lg, gap: spacing.lg },
  input: {
    height: 80,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: c.brandSecondary,
    backgroundColor: c.surfaceSecondary,
    color: c.brand,
    fontSize: 40,
    fontWeight: "700",
    letterSpacing: 12,
    textAlign: "center",
  },
}));
