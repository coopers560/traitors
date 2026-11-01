import Ionicons from "@react-native-vector-icons/ionicons";
import * as Haptics from "expo-haptics";
import { Platform, Pressable, Text, View } from "react-native";

import { makeStyles, spacing, useTheme } from "@/src/theme";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"];

export function PinPad({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const styles = useStyles();
  const { colors } = useTheme();

  const press = (k: string) => {
    if (disabled) return;
    if (Platform.OS !== "web") Haptics.selectionAsync();
    if (k === "del") onChange(value.slice(0, -1));
    else if (value.length < 4) onChange(value + k);
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.dots} testID="pin-dots">
        {[0, 1, 2, 3].map((i) => (
          <View key={i} style={[styles.dot, i < value.length && styles.dotFilled]} />
        ))}
      </View>
      <View style={styles.grid}>
        {KEYS.map((k, i) =>
          k === "" ? (
            <View key={i} style={styles.key} />
          ) : (
            <Pressable
              key={i}
              testID={k === "del" ? "pin-key-delete" : `pin-key-${k}`}
              onPress={() => press(k)}
              style={({ pressed }) => [styles.key, styles.keyBtn, pressed && styles.keyPressed]}
            >
              {k === "del" ? (
                <Ionicons name="backspace-outline" size={28} color={colors.onSurface} />
              ) : (
                <Text style={styles.keyText}>{k}</Text>
              )}
            </Pressable>
          ),
        )}
      </View>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  wrap: { alignItems: "center", gap: spacing.lg },
  dots: { flexDirection: "row", gap: spacing.md },
  dot: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: c.brand },
  dotFilled: { backgroundColor: c.brand },
  grid: { flexDirection: "row", flexWrap: "wrap", width: 288, justifyContent: "space-between", rowGap: spacing.md },
  key: { width: 84, height: 72, alignItems: "center", justifyContent: "center" },
  keyBtn: { borderRadius: 16, backgroundColor: c.surfaceSecondary, borderWidth: 1, borderColor: c.border },
  keyPressed: { backgroundColor: c.brandTertiary },
  keyText: { fontSize: 30, color: c.onSurface, fontWeight: "500" },
}));
