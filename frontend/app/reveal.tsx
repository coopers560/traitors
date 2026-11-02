import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, DayResult } from "@/src/api";
import { Backdrop, Body, Button, ErrorText, Eyebrow, Hearts, IMAGES, Title } from "@/src/components/ui";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

export default function Reveal() {
  const styles = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["game"], queryFn: api.getGame });
  const [step, setStep] = useState(0);

  const advance = useMutation({
    mutationFn: () => api.advance("reveal", data?.exists ? data.day : 0),
    onSuccess: (s) => {
      qc.setQueryData(["game"], s);
      router.dismissTo("/");
    },
  });

  if (!data?.exists) {
    return (
      <View style={[styles.root, { alignItems: "center", justifyContent: "center" }]}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }
  const result: DayResult | undefined = data.history[data.history.length - 1];
  const inReveal = data.phase === "reveal";
  if (!result) return null;

  const steps = ["intro", "murder", "banish", ...(result.winner ? ["winner"] : [])];
  const last = step >= steps.length - 1;

  return (
    <View style={styles.root} testID="reveal-screen">
      <Backdrop image={IMAGES.seal} strong={step > 0} />
      <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.lg }]}>
        <View style={{ flex: 1, justifyContent: "center", gap: spacing.lg }}>
          {steps[step] === "intro" ? <Intro day={result.day} /> : null}
          {steps[step] === "murder" ? <Murder r={result} /> : null}
          {steps[step] === "banish" ? <Banish r={result} /> : null}
          {steps[step] === "winner" ? <Winner winner={result.winner!} /> : null}
        </View>
        <View style={{ gap: spacing.sm }}>
          <ErrorText testID="reveal-error" message={advance.error?.message} />
          {!last ? (
            <Button testID="reveal-next-button" label="Continue" icon="arrow-forward" onPress={() => setStep((s) => s + 1)} />
          ) : inReveal ? (
            <Button
              testID="reveal-finish-button"
              label={result.winner ? "See all the roles" : `Begin Day ${result.day + 1}`}
              icon={result.winner ? "trophy" : "sunny"}
              loading={advance.isPending}
              onPress={() => advance.mutate()}
            />
          ) : (
            <Button testID="reveal-back-button" label="Back" onPress={() => router.dismissTo("/")} />
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function Intro({ day }: { day: number }) {
  return (
    <Animated.View entering={FadeIn.duration(1200)} style={{ gap: spacing.md }} testID="reveal-intro">
      <Eyebrow>The end of Day {day}</Eyebrow>
      <Title style={{ fontSize: 52, lineHeight: 56 }}>The candles flicker…</Title>
      <Body>Gather everyone round. First, we learn whether the Traitors struck today.</Body>
    </Animated.View>
  );
}

function Murder({ r }: { r: DayResult }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const m = r.murder;
  if (!m.success) {
    return (
      <Animated.View entering={FadeInDown.duration(900)} style={{ gap: spacing.md }} testID="reveal-murder-failed">
        <Eyebrow>The murder</Eyebrow>
        <Title>Nobody was murdered today.</Title>
        <Body>The Traitors failed to strike. Everyone keeps their lives… for now.</Body>
      </Animated.View>
    );
  }
  return (
    <Animated.View entering={FadeInDown.duration(900)} style={{ gap: spacing.md }} testID="reveal-murder">
      <Eyebrow style={{ color: colors.traitor }}>Murdered in plain sight</Eyebrow>
      <Text style={styles.bigName} testID="reveal-murder-victim">{m.victim_name}</Text>
      <View style={styles.card}>
        <Text style={styles.cardLabel}>The secret action stays secret</Text>
        <Body style={{ fontSize: 15 }}>Somebody did something to {m.victim_name} today. Who was it? Think hard…</Body>
      </View>
      <Consequence eliminated={!!m.eliminated} lives={m.lives_left ?? 0} role={m.role} />
    </Animated.View>
  );
}

function Banish({ r }: { r: DayResult }) {
  const styles = useStyles();
  const b = r.banish;
  return (
    <Animated.View entering={FadeInDown.duration(900)} style={{ gap: spacing.md }} testID="reveal-banish">
      <Eyebrow>The Round Table</Eyebrow>
      {b.tally.length === 0 ? (
        <>
          <Title testID="reveal-banish-none">Nobody voted tonight.</Title>
          <Body>With no votes cast, nobody is banished.</Body>
        </>
      ) : b.tie || !b.target_id ? (
        <>
          <Title testID="reveal-banish-tie">The table is divided.</Title>
          <Body>The votes were tied, so nobody is banished tonight.</Body>
        </>
      ) : (
        <>
          <Text style={styles.bigName} testID="reveal-banish-name">{b.name}</Text>
          <Body>has received the most votes.</Body>
          {b.already_dead ? (
            <Body>…but was already murdered today.</Body>
          ) : (
            <Consequence eliminated={!!b.eliminated} lives={b.lives_left ?? 0} role={b.role} />
          )}
        </>
      )}
      {b.tally.length > 0 ? (
        <View style={styles.card} testID="reveal-tally">
          <Text style={styles.cardLabel}>The votes</Text>
          {b.tally.map((t) => (
            <View key={t.player_id} style={styles.tallyRow}>
              <Text style={styles.tallyName}>{t.name}</Text>
              <Text style={styles.tallyVotes}>{t.votes}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </Animated.View>
  );
}

function Consequence({ eliminated, lives, role }: { eliminated: boolean; lives: number; role?: string | null }) {
  const styles = useStyles();
  const { colors } = useTheme();
  if (!eliminated) {
    return (
      <View style={styles.lifeRow}>
        <Hearts lives={lives} size={26} />
        <Body>Loses a life — one left.</Body>
      </View>
    );
  }
  const traitor = role === "traitor";
  return (
    <Animated.View entering={FadeIn.delay(800).duration(1200)} style={{ gap: spacing.xs }} testID="reveal-eliminated">
      <Body>Has lost their last life and leaves the game. They were…</Body>
      <Text style={[styles.role, { color: traitor ? colors.traitor : colors.brand }]} testID="reveal-eliminated-role">
        {traitor ? "A Traitor" : "Faithful"}
      </Text>
    </Animated.View>
  );
}

function Winner({ winner }: { winner: "faithful" | "traitors" }) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <Animated.View entering={FadeIn.duration(1500)} style={{ gap: spacing.md }} testID="reveal-winner">
      <Eyebrow>The game is over</Eyebrow>
      <Text style={[styles.role, { fontSize: 60, lineHeight: 64, color: winner === "traitors" ? colors.traitor : colors.brand }]}>
        {winner === "traitors" ? "The Traitors win" : "The Faithful win"}
      </Text>
      <Body>{winner === "traitors" ? "They hid in plain sight all along." : "Every Traitor has been found."}</Body>
    </Animated.View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  scroll: { flexGrow: 1, paddingHorizontal: spacing.lg, gap: spacing.lg },
  bigName: { fontFamily: fonts.display, fontSize: 56, lineHeight: 60, color: c.onSurface },
  card: { backgroundColor: c.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm, borderWidth: 1, borderColor: c.border },
  cardLabel: { color: c.muted, fontSize: 13, letterSpacing: 2, textTransform: "uppercase", fontWeight: "600" },
  lifeRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  role: { fontFamily: fonts.display, fontSize: 48, lineHeight: 52 },
  tallyRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 },
  tallyName: { color: c.onSurface, fontSize: 18 },
  tallyVotes: { color: c.brand, fontSize: 18, fontWeight: "700" },
}));
