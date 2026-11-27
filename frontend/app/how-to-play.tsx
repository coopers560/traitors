import Ionicons from "@react-native-vector-icons/ionicons";
import { useRouter } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Body, Button, Eyebrow, Title } from "@/src/components/ui";
import { SHOW_CLAUDAI } from "@/src/features";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

// Rules only, and nothing that would spoil a game: no examples of the secret
// actions, and none of the late-game twists (the app announces those itself).
const STEPS: { icon: React.ComponentProps<typeof Ionicons>["name"]; title: string; body: string }[] = [
  {
    icon: "people",
    title: "1. The Gathering",
    body: "Everyone adds their name and a secret 4-digit PIN. The app secretly picks two Traitors (just one with 5 or fewer players). Each person then taps their name and sees their role in private.",
  },
  {
    icon: "moon",
    title: "2. The Traitors plot",
    body: "Before every Round Table the Traitors secretly pick a victim and one of five methods in the Traitors' menu, on their own phone — or they lie low and spare everyone. Anyone can check their secret at any time. Once a Traitor seals the plan, they get at least 30 minutes to carry it out before the Round Table opens. Instead of murdering, the Traitors may recruit a Faithful (they turn at a random moment within 10 minutes of the plot, so they can join the Traitors before the Round Table) — only to replace a banished Traitor, or when just one Traitor is left. There are never more than two Traitors. Hold your role card 2 seconds to see your role, and 6 more for the Traitors' menu — secret chat any time.",
  },
  {
    icon: "sunny",
    title: "3. Murder in plain sight",
    body: "Before the Round Table the chosen Traitor carries out the murder: a small, ordinary-looking action done to their victim in front of everyone. Could you spot it?",
  },
  {
    icon: "flame",
    title: "4. The Round Table",
    body: "Everyone checks in on their phone — the Traitors also confirm, in secret, whether they pulled it off. Then the app reveals who was murdered (the method stays secret). Only then do you discuss, accuse, and vote in private to banish someone — everyone first checks who they are now, in case the Traitors recruited. Most votes is out; on a tie everyone votes again, and only the top-voted players can be chosen (tied again, nobody goes). One hit, a banishment or a murder, and you are out.",
  },
  {
    icon: "time-outline",
    title: "Two Round Tables a day",
    body: "At lunch and at about 8pm, with steps 2–4 before each: plot and murder in the morning → lunch Round Table → plot and murder in the afternoon → 8pm Round Table → the next day. (Or one Round Table each evening, if you choose that at setup.)",
  },
  {
    icon: "trophy",
    title: "Winning",
    body: "The Faithful win if every Traitor is out. The Traitors win if they are no longer outnumbered by the Faithful, or if any Traitor survives the last Round Table of Day 12. The castle keeps a few surprises for late in the game; the app explains each one when it arrives.",
  },
  {
    icon: "phone-portrait-outline",
    title: "Playing on several phones",
    body: "Open the app on as many phones as you like, for example one per couple. There are no codes: once a game has started, every other phone just opens the app and goes straight in. Every phone then shows the same game and updates by itself. Anyone can take their turn on any phone: tap your own name and enter your PIN, then hide the screen before handing it back. There is only ever one game at a time, until it's ended. You need an internet connection.",
  },
  {
    icon: "shield-half-outline",
    title: "ClaudAI host (optional)",
    body: "A host who sees every role and move, so nobody else has to. Set the game's ClaudAI passphrase when you create it (typed twice). The ClaudAI host opens it from the ⋯ menu → \"ClaudAI (host)\". It can't be recovered and there is no master key.",
  },
  {
    icon: "book-outline",
    title: "After the game",
    body: "Everyone can open \"The whole story\": every role, murder, vote and secret message, round by round. Finished games stay in \"Previous games\".",
  },
  {
    icon: "eye-off",
    title: "Forgot your secret?",
    body: "Tap \"Check my secret\" on the main screen, then your name, to see your role again in private.",
  },
];

export default function HowToPlay() {
  const styles = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  return (
    <View style={styles.root} testID="how-to-play-screen">
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="how-to-play-back-button" onPress={() => router.back()} style={styles.iconBtn} hitSlop={8}>
          <Ionicons name="chevron-back" size={26} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerText}>How to play</Text>
      </View>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.lg }]}>
        <View style={{ gap: spacing.sm }}>
          <Eyebrow>12 days · one hit and you&apos;re out</Eyebrow>
          <Title>The rules</Title>
        </View>
        {STEPS.filter((s) => SHOW_CLAUDAI || !/ClaudAI/.test(s.title)).map((s) => (
          <View key={s.title} style={styles.card}>
            <View style={styles.cardHead}>
              <Ionicons name={s.icon} size={24} color={colors.brand} />
              <Text style={styles.cardTitle}>{s.title}</Text>
            </View>
            <Body>{s.body}</Body>
          </View>
        ))}
        <Button
          testID="how-to-play-help-button"
          label="Help · what do I tap?"
          variant="ghost"
          icon="help-circle-outline"
          onPress={() => router.push("/help")}
        />
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: c.divider,
  },
  headerText: { color: c.onSurface, fontSize: 18, fontWeight: "700" },
  iconBtn: { width: 48, height: 48, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", backgroundColor: c.surfaceSecondary },
  scroll: { padding: spacing.lg, gap: spacing.md },
  card: { backgroundColor: c.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm, borderWidth: 1, borderColor: c.border },
  cardHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  cardTitle: { fontFamily: fonts.display, fontSize: 26, color: c.onSurface, flex: 1 },
}));
