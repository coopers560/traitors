import Ionicons from "@react-native-vector-icons/ionicons";
import { useRouter } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { makeStyles, radius, spacing, useTheme } from "@/src/theme";

/** Sticky screen header with a back button. */
export function ScreenHeader({ title, testID }: { title: string; testID: string }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
      <Pressable testID={`${testID}-back-button`} onPress={() => router.back()} style={styles.iconBtn} hitSlop={8}>
        <Ionicons name="chevron-back" size={26} color={colors.onSurface} />
      </Pressable>
      <Text style={styles.headerText}>{title}</Text>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: c.divider,
    backgroundColor: c.surface,
  },
  headerText: { color: c.onSurface, fontSize: 18, fontWeight: "700" },
  iconBtn: { width: 48, height: 48, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", backgroundColor: c.surfaceSecondary },
}));
