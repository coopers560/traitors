import { useQuery } from "@tanstack/react-query";
import * as Sharing from "expo-sharing";
import { useRef, useState } from "react";
import { Platform, ScrollView, Text, View } from "react-native";
import { captureRef } from "react-native-view-shot";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, exitOf } from "@/src/api";
import { ScreenHeader } from "@/src/components/screen-header";
import { Button, Hearts } from "@/src/components/ui";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

export default function Finale() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const cardRef = useRef<View>(null);
  const [sharing, setSharing] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const { data } = useQuery({ queryKey: ["game"], queryFn: api.getGame });
  if (!data?.exists) return <View style={styles.root} />;
  if (data.phase !== "ended") {
    return (
      <View style={styles.root} testID="finale-screen">
        <ScreenHeader title="Share the finale" testID="finale" />
        <Text style={[styles.info, { margin: spacing.lg }]} testID="finale-not-ended">The finale picture is ready once the game is over.</Text>
      </View>
    );
  }

  const traitorsWin = data.winner === "traitors";
  const daysPlayed = data.history.length;
  const sorted = [...data.players].sort((a, b) => (a.role === b.role ? 0 : a.role === "traitor" ? -1 : 1));

  const share = async () => {
    setMsg(null);
    if (Platform.OS === "web") {
      setMsg("Open the app on your phone to share the picture to WhatsApp.");
      return;
    }
    setSharing(true);
    try {
      const uri = await captureRef(cardRef, { format: "png", quality: 1, result: "tmpfile" });
      if (!(await Sharing.isAvailableAsync())) throw new Error("Sharing isn't available on this phone.");
      await Sharing.shareAsync(uri, { mimeType: "image/png", dialogTitle: "Share the final verdict", UTI: "public.png" });
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not create the picture.");
    } finally {
      setSharing(false);
    }
  };

  return (
    <View style={styles.root} testID="finale-screen">
      <ScreenHeader title="Share the finale" testID="finale" />
      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.lg }]}>
        <View ref={cardRef} collapsable={false} style={styles.card} testID="finale-card">
          <Text style={styles.kicker}>The Traitors · Holiday in Egypt</Text>
          <Text style={[styles.winner, { color: traitorsWin ? colors.traitor : colors.brand }]} testID="finale-winner">
            {traitorsWin ? "The Traitors win" : "The Faithful win"}
          </Text>
          <Text style={styles.sub}>
            {daysPlayed} day{daysPlayed === 1 ? "" : "s"} · {data.players.length} players ·{" "}
            {data.players.filter((p) => p.role === "traitor").length === 1 ? "1 Traitor" : `${data.players.filter((p) => p.role === "traitor").length} Traitors`}
          </Text>
          <View style={styles.divider} />
          {sorted.map((p) => {
            const exit = exitOf(data.history, p.id);
            const traitor = p.role === "traitor";
            return (
              <View key={p.id} style={styles.row} testID={`finale-player-${p.id}`}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.name} numberOfLines={1}>{p.name}</Text>
                  <Text style={styles.status}>
                    {exit ? `${exit.how === "murdered" ? "Murdered" : "Banished"} on Day ${exit.day}` : "Survived to the end"}
                  </Text>
                </View>
                <View style={{ alignItems: "flex-end", gap: 4 }}>
                  <Text style={[styles.role, { color: traitor ? colors.traitor : colors.brand }]}>{traitor ? "Traitor" : "Faithful"}</Text>
                  <Hearts lives={p.lives} size={14} />
                </View>
              </View>
            );
          })}
          <Text style={styles.footer}>Murders in plain sight</Text>
        </View>

        {msg ? <Text style={styles.info} testID="finale-message">{msg}</Text> : null}
        <Button testID="finale-share-button" label="Share picture" icon="share-social" loading={sharing} onPress={share} />
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  scroll: { padding: spacing.lg, gap: spacing.md },
  card: {
    backgroundColor: c.surfaceSecondary,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
    borderWidth: 2,
    borderColor: c.brandSecondary,
  },
  kicker: { color: c.brand, fontSize: 12, letterSpacing: 2.5, textTransform: "uppercase", fontWeight: "700" },
  winner: { fontFamily: fonts.display, fontSize: 46, lineHeight: 50 },
  sub: { color: c.onSurfaceTertiary, fontSize: 15 },
  divider: { height: 1, backgroundColor: c.brandTertiary, marginVertical: spacing.sm },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: 6 },
  name: { color: c.onSurface, fontSize: 18, fontWeight: "600" },
  status: { color: c.muted, fontSize: 13 },
  role: { fontSize: 12, fontWeight: "700", letterSpacing: 1.5, textTransform: "uppercase" },
  footer: { fontFamily: fonts.displaySemi, color: c.muted, fontSize: 16, textAlign: "center", marginTop: spacing.sm },
  info: { backgroundColor: c.info, color: c.onInfo, fontSize: 16, lineHeight: 22, padding: spacing.md, borderRadius: radius.md, overflow: "hidden" },
}));
