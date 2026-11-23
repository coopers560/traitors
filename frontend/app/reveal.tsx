import Ionicons from "@react-native-vector-icons/ionicons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import Animated, { FadeIn, FadeInDown, ZoomIn } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, DayResult, Phase } from "@/src/api";
import { ConfirmSheet } from "@/src/components/confirm-sheet";
import { HelpButton } from "@/src/components/help-button";
import { Backdrop, Body, Button, ErrorText, Eyebrow, IMAGES, Title } from "@/src/components/ui";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

export default function Reveal() {
  const styles = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["game"], queryFn: api.getGame });
  const [step, setStep] = useState(0);
  // A 5-4-3-2-1 beat plays before the name is shown; we remember which step it finished on.
  const [revealedStep, setRevealedStep] = useState<number | null>(null);
  const [confirmFinish, setConfirmFinish] = useState(false);
  // Freeze the reveal the moment it opens: the game keeps polling and another phone may
  // move it on, but this screen must stay put so everyone can read it in their own time.
  // Captured once, on the first render where the game data is available.
  const [snap, setSnap] = useState<{ phase: Phase; day: number; result: DayResult } | null>(null);
  if (!snap && data?.exists && data.history.length) {
    setSnap({ phase: data.phase, day: data.day, result: data.history[data.history.length - 1] });
  }

  const advance = useMutation({
    mutationFn: () => api.advance(snap?.phase ?? "banished", snap?.day ?? 0),
    onSuccess: (s) => {
      qc.setQueryData(["game"], s);
      router.dismissTo("/");
    },
  });

  if (!snap) {
    return (
      <View style={[styles.root, { alignItems: "center", justifyContent: "center" }]}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }
  const result: DayResult = snap.result;

  // The reveal is frozen on open: the Round Table shows the murder then the banishment.
  const isBanish = snap.phase === "banished";
  const isMurder = snap.phase === "reveal";
  const inFlow = isBanish || isMurder;
  // Two reveals a day: the murder ("reveal", before anyone votes), then the banishment
  // ("banished", after the vote). Each is frozen on open so everyone can take their time.
  const steps = isBanish
    ? ["intro", "banish", ...(result.winner ? ["winner"] : [])]
    : isMurder
      ? ["intro", "murder", ...(result.winner ? ["winner"] : [])]
      : ["banish", ...(result.murder ? ["murder"] : []), ...(result.winner ? ["winner"] : [])];
  const last = step >= steps.length - 1;

  const finishLabel = isBanish
    ? result.winner
      ? "See all the roles"
      : `Begin Day ${result.day + 1}`
    : result.winner
      ? "See all the roles"
      : "On to the vote";

  // A dramatic countdown gates the actual name on the banishment/murder step.
  const current = steps[step];
  const countdownStep = current === "murder" || current === "banish";
  const counting = countdownStep && revealedStep !== step;

  const finish = () => {
    // A continuing step (next day / night falls) is a big progression — reconfirm it.
    if (!result.winner) setConfirmFinish(true);
    else advance.mutate();
  };

  return (
    <View style={styles.root} testID="reveal-screen">
      <Backdrop image={IMAGES.seal} strong={step > 0} />
      <HelpButton from="reveal" testID="reveal-help-button" style={{ position: "absolute", top: insets.top + spacing.sm, right: spacing.md, zIndex: 1 }} />
      <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.lg }]}>
        <View style={{ flex: 1, justifyContent: "center", gap: spacing.lg }}>
          {current === "intro" ? <Intro day={result.day} kind={isBanish ? "banish" : "murder"} /> : null}
          {counting ? (
            <Countdown kind={current === "banish" ? "banish" : "murder"} onDone={() => setRevealedStep(step)} />
          ) : (
            <>
              {current === "murder" ? <Murder r={result} /> : null}
              {current === "banish" ? <Banish r={result} /> : null}
            </>
          )}
          {current === "winner" ? <Winner winner={result.winner!} /> : null}
        </View>
        {!counting ? (
          <View style={{ gap: spacing.sm }}>
            <ErrorText testID="reveal-error" message={advance.error?.message} />
            {!last ? (
              <Button testID="reveal-next-button" label="Continue" icon="arrow-forward" onPress={() => setStep((s) => s + 1)} />
            ) : inFlow ? (
              <Button
                testID="reveal-finish-button"
                label={finishLabel}
                icon={result.winner ? "trophy" : isBanish ? "sunny" : "flame"}
                loading={advance.isPending}
                onPress={finish}
              />
            ) : (
              <Button testID="reveal-back-button" label="Back" onPress={() => router.dismissTo("/")} />
            )}
          </View>
        ) : null}
      </ScrollView>

      <ConfirmSheet
        visible={confirmFinish}
        title={isBanish ? `Begin Day ${result.day + 1}?` : "Start the vote?"}
        message="This moves the game on for everyone. Make sure the whole group has seen the reveal — you can't come back to this screen."
        confirmLabel={finishLabel}
        loading={advance.isPending}
        onConfirm={() => advance.mutate()}
        onCancel={() => setConfirmFinish(false)}
      />
    </View>
  );
}

function Countdown({ kind, onDone }: { kind: "banish" | "murder"; onDone: () => void }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [n, setN] = useState(5);
  const done = useRef(false);
  useEffect(() => {
    const id = setInterval(() => {
      setN((v) => {
        if (v <= 1) {
          clearInterval(id);
          if (!done.current) { done.current = true; setTimeout(onDone, 500); }
          return 1;
        }
        return v - 1;
      });
    }, 850);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <View style={{ alignItems: "center", gap: spacing.md }} testID="reveal-countdown">
      <Eyebrow>{kind === "banish" ? "The banished is…" : "Tonight the Traitors took…"}</Eyebrow>
      <Animated.Text key={n} entering={ZoomIn.duration(300)} style={[styles.countdown, { color: colors.brand }]} testID="reveal-countdown-number">
        {n}
      </Animated.Text>
    </View>
  );
}

function Intro({ day, kind }: { day: number; kind: "banish" | "murder" }) {
  return (
    <Animated.View entering={FadeIn.duration(1200)} style={{ gap: spacing.md }} testID="reveal-intro">
      {kind === "banish" ? (
        <>
          <Eyebrow>The end of Day {day}</Eyebrow>
          <Title style={{ fontSize: 52, lineHeight: 56 }}>The Round Table has spoken…</Title>
          <Body>Take your time. Here is who the table has banished — and how everyone voted.</Body>
        </>
      ) : (
        <>
          <Eyebrow>Day {day}</Eyebrow>
          <Title style={{ fontSize: 52, lineHeight: 56 }}>The candles flicker…</Title>
          <Body>Before anyone votes: did the Traitors strike today, in plain sight?</Body>
        </>
      )}
    </Animated.View>
  );
}

function Murder({ r }: { r: DayResult }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const m = r.murder;
  if (!m) return null;
  if (!m.success) {
    return (
      <Animated.View entering={FadeInDown.duration(900)} style={{ gap: spacing.md }} testID="reveal-murder-failed">
        <Eyebrow>The night</Eyebrow>
        {r.recruited ? (
          <>
            <Title testID="reveal-recruited">A new Traitor walks among you.</Title>
            <Body>There was no murder. Instead the Traitors turned one of the Faithful to their side — but who?</Body>
          </>
        ) : (
          <>
            <Title>Nobody was murdered today.</Title>
            <Body>The Traitors failed to strike. No one was taken tonight… for now.</Body>
          </>
        )}
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
      <Consequence eliminated={!!m.eliminated} role={m.role} />
    </Animated.View>
  );
}

function Banish({ r }: { r: DayResult }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const b = r.banish;
  if (!b) return null;
  return (
    <Animated.View entering={FadeInDown.duration(900)} style={{ gap: spacing.md }} testID="reveal-banish">
      <Eyebrow>The Round Table</Eyebrow>
      {b.tie || !b.target_id ? (
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
            <Consequence eliminated={!!b.eliminated} role={b.role} roleHidden={!!b.role_hidden} />
          )}
        </>
      )}
      <View style={styles.card} testID="reveal-tally">
        <Text style={styles.cardLabel}>The votes</Text>
        {b.tally.map((t) => (
          <View key={t.player_id} style={styles.tallyRow}>
            <Text style={styles.tallyName}>{t.name}</Text>
            <Text style={styles.tallyVotes}>{t.votes}</Text>
          </View>
        ))}
        {b.votes && b.votes.length ? (
          <View style={styles.whoVoted} testID="reveal-who-voted">
            <Text style={styles.whoVotedLabel}>Who voted for whom</Text>
            {b.votes.map((v) => (
              <View key={v.voter_id} style={styles.voteRow}>
                <Text style={styles.voterName} numberOfLines={1}>{v.voter_name}</Text>
                <Ionicons name="arrow-forward" size={14} color={colors.muted} />
                <Text style={styles.voteFor} numberOfLines={1}>{v.target_name}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </Animated.View>
  );
}

function Consequence({ eliminated, role, roleHidden }: { eliminated: boolean; role?: string | null; roleHidden?: boolean }) {
  const styles = useStyles();
  const { colors } = useTheme();
  if (!eliminated) return null; // a single hit is always out — nothing else to show
  if (roleHidden) {
    return (
      <Animated.View entering={FadeIn.delay(600).duration(1000)} style={{ gap: spacing.xs }} testID="reveal-role-hidden">
        <Body>Is out of the game — but with so few left, their allegiance stays a secret until the very end.</Body>
      </Animated.View>
    );
  }
  const traitor = role === "traitor";
  return (
    <Animated.View entering={FadeIn.delay(800).duration(1200)} style={{ gap: spacing.xs }} testID="reveal-eliminated">
      <Body>Is out of the game. They were…</Body>
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
  countdown: { fontFamily: fonts.display, fontSize: 140, lineHeight: 150, fontWeight: "700" },
  card: { backgroundColor: c.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm, borderWidth: 1, borderColor: c.border },
  cardLabel: { color: c.muted, fontSize: 13, letterSpacing: 2, textTransform: "uppercase", fontWeight: "600" },
  lifeRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  role: { fontFamily: fonts.display, fontSize: 48, lineHeight: 52 },
  tallyRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 },
  tallyName: { color: c.onSurface, fontSize: 18 },
  tallyVotes: { color: c.brand, fontSize: 18, fontWeight: "700" },
  whoVoted: { marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: c.divider, gap: 4 },
  whoVotedLabel: { color: c.muted, fontSize: 12, letterSpacing: 1.5, textTransform: "uppercase", fontWeight: "600", marginBottom: 2 },
  voteRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 2 },
  voterName: { color: c.onSurface, fontSize: 16, fontWeight: "600", flex: 1 },
  voteFor: { color: c.onSurfaceSecondary, fontSize: 16, flex: 1, textAlign: "right" },
}));
