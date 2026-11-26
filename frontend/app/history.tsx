import Ionicons from "@react-native-vector-icons/ionicons";
import { useQuery } from "@tanstack/react-query";
import { ScrollView, Text, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, DayResult, roundLabel } from "@/src/api";
import { HoldRole } from "@/src/components/hold-reveal";
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
      <ScreenHeader title="Day history" testID="history" help="history" />
      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.lg }]}>
        <View style={{ gap: spacing.sm }}>
          <Eyebrow>The castle records</Eyebrow>
          <Title>What has happened</Title>
        </View>
        {history.length === 0 ? (
          <Body testID="history-empty">Nothing yet. The first entry appears after the first reveal.</Body>
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
  const banishText = (bb: NonNullable<DayResult["banish"]>) =>
    bb.tie && bb.revote_ids?.length && bb.round !== 2
      ? "Tied vote — a revote follows"
      : bb.tie || !bb.target_id
      ? bb.round === 2 ? "Tied again — nobody banished" : "Tied vote — nobody banished"
      : bb.already_dead
        ? `${bb.name} got the most votes (already murdered)`
        : bb.eliminated
          ? `${bb.name} was banished${bb.role_hidden ? " — allegiance kept secret" : ""}`
          : `${bb.name} lost a life`;

  return (
    <Animated.View entering={FadeInDown.delay(Math.min(index, 8) * 60).duration(400)} style={styles.card} testID={`history-day-${h.day}`}>
      <Text style={styles.day}>{roundLabel(h)}</Text>

      {h.ended_by_vote ? (
        <Text style={styles.main} testID={`history-ended-${h.day}`}>The players voted to end the game.</Text>
      ) : null}

      {m ? (
        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <Ionicons name="skull-outline" size={20} color={colors.traitor} />
            <Text style={styles.label}>Murder</Text>
          </View>
          {m.success ? (
            <Text style={styles.main} testID={`history-murder-${h.day}`}>{m.victim_name} was murdered</Text>
          ) : (
            <Text style={styles.main}>No murder — the Traitors failed</Text>
          )}
        </View>
      ) : null}

      {m && b ? <View style={styles.divider} /> : null}

      {b ? (
        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <Ionicons name="flame-outline" size={20} color={colors.brand} />
            <Text style={styles.label}>Round Table</Text>
          </View>
          {h.tie_vote ? (
            <Text style={styles.tallyName} testID={`history-tie-${h.day}`}>
              First vote tied ({h.tie_vote.tally.map((t) => `${t.name} ${t.votes}`).join(" · ")}) — then a revote:
            </Text>
          ) : null}
          <Text style={styles.main} testID={`history-banish-${h.day}`}>{banishText(b)}</Text>
          {b.eliminated && !b.already_dead && !b.tie && b.target_id && !b.role_hidden ? (
            <HoldRole role={b.role} testID={`history-banish-role-${h.day}`} />
          ) : null}
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
          {b.votes && b.votes.length ? (
            <View style={styles.whoVoted}>
              <Text style={styles.whoVotedLabel}>Who voted for whom</Text>
              {b.votes.map((v) => (
                <View key={v.voter_id} style={styles.voteRow}>
                  <Text style={styles.voterName} numberOfLines={1}>{v.voter_name}</Text>
                  <Ionicons name="arrow-forward" size={13} color={colors.muted} />
                  <Text style={styles.voteFor} numberOfLines={1}>{v.target_name}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
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
  whoVoted: { marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: c.divider, gap: 2 },
  whoVotedLabel: { color: c.muted, fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase", fontWeight: "600", marginBottom: 2 },
  voteRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 1 },
  voterName: { color: c.onSurface, fontSize: 15, fontWeight: "600", flex: 1 },
  voteFor: { color: c.onSurfaceSecondary, fontSize: 15, flex: 1, textAlign: "right" },
}));
