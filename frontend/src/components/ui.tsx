import Ionicons from "@react-native-vector-icons/ionicons";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import React from "react";
import { ActivityIndicator, Platform, Pressable, StyleProp, Text, TextStyle, View, ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";

import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

export const IMAGES = {
  castle:
    "https://images.unsplash.com/photo-1665516870021-4de1bb8e02aa?crop=entropy&cs=srgb&fm=jpg&ixlib=rb-4.1.0&q=85&w=1200",
  candle:
    "https://images.unsplash.com/photo-1640085461451-e3dc47415dd1?crop=entropy&cs=srgb&fm=jpg&ixlib=rb-4.1.0&q=85&w=1200",
  hood: "https://images.unsplash.com/photo-1646633632840-1c95d61c909e?crop=entropy&cs=srgb&fm=jpg&ixlib=rb-4.1.0&q=85&w=1200",
  seal: "https://images.unsplash.com/photo-1641477176034-1a3e10c343a8?crop=entropy&cs=srgb&fm=jpg&ixlib=rb-4.1.0&q=85&w=1200",
};

/** Full-bleed background image with a dark gradient scrim. */
export function Backdrop({ image, strong }: { image: string; strong?: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} pointerEvents="none">
      <Image source={{ uri: image }} style={{ flex: 1 }} contentFit="cover" transition={400} />
      <LinearGradient
        colors={strong ? [colors.scrim, colors.scrim, colors.surface] : [colors.scrimLight, colors.scrim, colors.surface]}
        locations={[0, 0.45, 1]}
        style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
      />
    </View>
  );
}

export function Title({ children, style, testID }: { children: React.ReactNode; style?: StyleProp<TextStyle>; testID?: string }) {
  const styles = useStyles();
  return (
    <Text testID={testID} style={[styles.title, style]}>
      {children}
    </Text>
  );
}

export function Eyebrow({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  const styles = useStyles();
  return <Text style={[styles.eyebrow, style]}>{children}</Text>;
}

export function Body({ children, style, testID }: { children: React.ReactNode; style?: StyleProp<TextStyle>; testID?: string }) {
  const styles = useStyles();
  return (
    <Text testID={testID} style={[styles.body, style]}>
      {children}
    </Text>
  );
}

type ButtonProps = {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  icon?: React.ComponentProps<typeof Ionicons>["name"];
  disabled?: boolean;
  loading?: boolean;
  testID: string;
  style?: StyleProp<ViewStyle>;
};

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function Button({ label, onPress, variant = "primary", icon, disabled, loading, testID, style }: ButtonProps) {
  const styles = useStyles();
  const { colors } = useTheme();
  const scale = useSharedValue(1);
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const bg = {
    primary: colors.brandPrimary,
    secondary: colors.surfaceTertiary,
    ghost: "transparent",
    danger: colors.error,
  }[variant];
  const fg = {
    primary: colors.onBrandPrimary,
    secondary: colors.onSurface,
    ghost: colors.brand,
    danger: colors.onError,
  }[variant];
  const off = disabled || loading;
  return (
    <AnimatedPressable
      testID={testID}
      accessibilityRole="button"
      disabled={off}
      onPressIn={() => (scale.value = withSpring(0.97))}
      onPressOut={() => (scale.value = withSpring(1))}
      onPress={() => {
        if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress();
      }}
      style={[
        styles.button,
        { backgroundColor: bg, opacity: off ? 0.45 : 1 },
        variant === "ghost" && { borderWidth: 1, borderColor: colors.brandSecondary },
        anim,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={22} color={fg} /> : null}
          <Text style={[styles.buttonText, { color: fg }]}>{label}</Text>
        </>
      )}
    </AnimatedPressable>
  );
}

export function Hearts({ lives, max = 2, size = 18 }: { lives: number; max?: number; size?: number }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: "row", gap: 4 }} accessibilityLabel={`${lives} lives left`}>
      {Array.from({ length: max }).map((_, i) => (
        <Ionicons
          key={i}
          name={i < lives ? "heart" : "heart-outline"}
          size={size}
          color={i < lives ? colors.traitor : colors.muted}
        />
      ))}
    </View>
  );
}

export function ErrorText({ message, testID }: { message?: string | null; testID: string }) {
  const styles = useStyles();
  if (!message) return null;
  return (
    <View style={styles.error} testID={testID}>
      <Text style={styles.errorText}>{message}</Text>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  title: { fontFamily: fonts.display, fontSize: 40, lineHeight: 46, color: c.onSurface },
  eyebrow: {
    fontSize: 13,
    letterSpacing: 2.5,
    textTransform: "uppercase",
    color: c.brand,
    fontWeight: "600",
  },
  body: { fontSize: 18, lineHeight: 27, color: c.onSurfaceSecondary },
  button: {
    minHeight: 64,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  buttonText: { fontSize: 19, fontWeight: "700", letterSpacing: 0.3 },
  error: {
    backgroundColor: c.error,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  errorText: { color: c.onError, fontSize: 16, lineHeight: 22 },
}));
