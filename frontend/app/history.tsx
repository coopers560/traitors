import Ionicons from "@react-native-vector-icons/ionicons";
import { useQuery } from "@tanstack/react-query";
import { ScrollView, Text, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, DayResult } from "@/src/api";
import { ScreenHeader } from "@/src/components/screen-header";
import { Body, Eyebrow, Title } from "@/src/components/ui";
import { makeStyles, radius, spacing, useTheme } from "@/src/theme";

export default function History() {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const { data } = useQuery({ queryKey: ["game"], queryFn: api.getGame });
  const history = data?.exists ? data.history : [];

  return (
    <View style={styles.root} testID="history-screen">
      <ScreenHeader title="Day history" testID="history" />
      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.lg }]}>
        <View style={{ gap: spacing.sm }}>
          <Eyebrow>The castle records</Eyebrow>
          <Title>What has happened</Title>
        </View>
        {history.length === 0 ? (
          <Body testID="history-empty">Nothing yet. The first entry appears after the Day 1 reveal.</Body>
        ) : (
          history.map((h, i) => <DayCard key={h.day} h={h} index={i} />)
        )}
      </ScrollView>
    </View>
  );
}

function DayCard({ h, index }: { h: DayResult; index: number }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const m = h.murder;
  const b = h.banish;
  const roleText = (role?: string | null) => (role === "traitor" ? "a Traitor" : "Faithful");
  return (
    <Animated.View entering={FadeInDown.delay(Math.min(index, 8) * 60).duration(400)} style={styles.card} testID={`history-day-${h.day}`}>
      <Text style={styles.day}>Day {h.day}</Text>

      <View style={styles.section}>
        <View style={styles.sectionHead}>
          <Ionicons name="skull-outline" size={20} color={colors.traitor} />
          <Text style={styles.label}>Murder</Text>
        </View>
        {m.success ? (
          <Text style={styles.main} testID={`history-murder-${h.day}`}>
            {m.victim_name} {m.eliminated ? `was killed — ${roleText(m.role)}` : "lost a life"}
          </Text>
        ) : (
          <Text style={styles.main} testID={`history-murder-${h.day}`}>No murder — the Traitors failed</Text>
        )}
      </View>

      <View style={styles.divider} />

      <View style={styles.section}>
        <View style={styles.sectionHead}>
          <Ionicons name="flame-outline" size={20} color={colors.brand} />
          <Text style={styles.label}>Round Table</Text>
        </View>
        <Text style={styles.main} testID={`history-banish-${h.day}`}>
          {b.tally.length === 0
            ? "Nobody voted — nobody banished"
            : b.tie || !b.target_id
            ? "Tied vote — nobody banished"
            : b.already_dead
              ? `${b.name} got the most votes (already murdered)`
              : `${b.name} ${b.eliminated ? `was banished — ${roleText(b.role)}` : "lost a life"}`}
        </Text>
        <View style={styles.tally}>
          {b.tally.map((t) => (
            <View key={t.player_id} style={styles.tallyRow}>
              <Text style={styles.tallyName}>{t.name}</Text>
              <Text style={styles.tallyVotes}>
                {t.votes} vote{t.votes === 1 ? "" : "s"}
              </Text>
            </View>
          ))}
        </View>
        {h.skipped?.length ? (
          <Text style={styles.tallyName} testID={`history-skipped-${h.day}`}>
            Didn&apos;t vote:{" "}
            {h.skipped
              .map((n) => (h.skipped_by?.[n] ? `${n} (skipped by ${h.skipped_by[n]})` : n))
              .join(", ")}
          </Text>
        ) : null}
      </View>
    </Animated.View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  scroll: { padding: spacing.lg, gap: spacing.md },
  card: { backgroundColor: c.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md, borderWidth: 1, borderColor: c.border },
  day: { fontSize: 22, fontWeight: "700", color: c.brand, letterSpacing: 0.5 },
  section: { gap: spacing.xs },
  sectionHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  label: { color: c.muted, fontSize: 13, letterSpacing: 2, textTransform: "uppercase", fontWeight: "600" },
  main: { color: c.onSurface, fontSize: 18, lineHeight: 25, fontWeight: "600" },
  divider: { height: 1, backgroundColor: c.divider },
  tally: { gap: 2, marginTop: spacing.xs },
  tallyRow: { flexDirection: "row", justifyContent: "space-between" },
  tallyName: { color: c.onSurfaceSecondary, fontSize: 16 },
  tallyVotes: { color: c.onSurfaceTertiary, fontSize: 16 },
}));
