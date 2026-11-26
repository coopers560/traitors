import Ionicons from "@react-native-vector-icons/ionicons";
import { useRouter } from "expo-router";
import { Pressable, StyleProp, ViewStyle } from "react-native";

import { makeStyles, radius, useTheme } from "@/src/theme";

/**
 * The "?" on every screen. Opens the help page with the section for the screen
 * it was tapped on shown first. The help text is fixed and the same for every
 * player, so opening it can never give away a role or anything about the game.
 */
export function HelpButton({ from, testID, style }: { from: string; testID: string; style?: StyleProp<ViewStyle> }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel="Help"
      onPress={() => router.push({ pathname: "/help", params: { from } })}
      style={[styles.btn, style]}
      hitSlop={8}
    >
      <Ionicons name="help" size={24} color={colors.brand} />
    </Pressable>
  );
}

const useStyles = makeStyles((c) => ({
  btn: {
    width: 48,
    height: 48,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: c.surfaceSecondary,
    borderWidth: 1,
    borderColor: c.brandSecondary,
  },
}));
