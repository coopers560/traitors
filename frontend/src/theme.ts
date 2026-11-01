// Design tokens for this app. Dark theme only (The Traitors: candlelit castle).
// Keys match the "color" block of /app/design_guidelines.json.

import { useMemo } from "react";
import { Appearance, StyleSheet, useColorScheme } from "react-native";

export type ColorScheme = "light" | "dark";

const dark = {
  surface: "#0D1113",
  onSurface: "#F3EFE7",
  surfaceSecondary: "#1A2024",
  onSurfaceSecondary: "#E1D9CD",
  surfaceTertiary: "#252D32",
  onSurfaceTertiary: "#C0B4A4",
  surfaceInverse: "#F3EFE7",
  onSurfaceInverse: "#0D1113",
  muted: "#8E989E",

  brand: "#D4AF37",
  onBrand: "#0D1113",
  brandPrimary: "#C5A030",
  onBrandPrimary: "#0D1113",
  brandSecondary: "#8C7123",
  onBrandSecondary: "#F3EFE7",
  brandTertiary: "#3D351B",
  onBrandTertiary: "#D4AF37",

  success: "#3E6950",
  onSuccess: "#DDF3E4",
  warning: "#8C5A20",
  onWarning: "#FDEBD3",
  error: "#7A2828",
  onError: "#FAD7D7",
  info: "#2B4C5E",
  onInfo: "#D4E8F5",

  border: "#32383C",
  borderStrong: "#575E63",
  divider: "#20262A",

  // Extra: scrim tints over imagery, and the blood-red traitor accent
  scrim: "rgba(13,17,19,0.92)",
  scrimLight: "rgba(13,17,19,0.35)",
  traitor: "#B33A3A",
};

export type ThemeColors = typeof dark;

export const defaultScheme = "dark" satisfies ColorScheme;

export const themes: { light: ThemeColors; dark?: ThemeColors } = { light: dark, dark };

export const fonts = {
  display: "CormorantGaramond-Bold",
  displaySemi: "CormorantGaramond-SemiBold",
};

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48, xxxl: 64 };
export const radius = { sm: 4, md: 8, lg: 16, pill: 999 };

export function setColorScheme(scheme: ColorScheme | null) {
  Appearance.setColorScheme?.(scheme ?? "unspecified");
}

setColorScheme?.("dark");

export function useTheme(): { scheme: ColorScheme; colors: ThemeColors } {
  const system = useColorScheme();
  const scheme: ColorScheme = (system === "light" || system === "dark") && themes[system] ? system : defaultScheme;
  return { scheme, colors: themes[scheme] ?? dark };
}

export const colors = dark;

export function makeStyles<T extends StyleSheet.NamedStyles<T> | StyleSheet.NamedStyles<any>>(
  factory: (colors: ThemeColors) => T & StyleSheet.NamedStyles<any>,
): () => T {
  return function useStyles(): T {
    const { colors } = useTheme();
    return useMemo(() => StyleSheet.create(factory(colors)), [colors]);
  };
}
