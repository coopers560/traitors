import Ionicons from "@react-native-vector-icons/ionicons";
import { useRouter } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Body, Eyebrow, Title } from "@/src/components/ui";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

const STEPS: { icon: React.ComponentProps<typeof Ionicons>["name"]; title: string; body: string }[] = [
  {
    icon: "people",
    title: "1. The Gathering",
    body: "Everyone adds their name and a secret 4-digit PIN. The app secretly picks the Traitors (about 1 in 5 players). Pass the phone round so each person sees their role in private. The Traitors also choose who to murder on Day 1.",
  },
  {
    icon: "sunny",
    title: "2. During the day",
    body: "Each victim comes with a simple secret action, like \"Hand them a bottle of water\" or \"Ask them what time it is\". Any Traitor does it to the victim, naturally, in front of everyone. That is the murder!",
  },
  {
    icon: "flame",
    title: "3. The Round Table (evening)",
    body: "Gather together, discuss and accuse. Then pass the phone round: everyone votes in private for who to banish. Traitors also confirm whether the murder was done and choose tomorrow's victim — so their turn looks just like everyone else's.",
  },
  {
    icon: "mail-open",
    title: "4. The Reveal",
    body: "The app reveals who was murdered (but never the secret action, so keep guessing who did it), then who the table banished. Each costs one life. Lose both lives and you are out — and your role is revealed.",
  },
  {
    icon: "trophy",
    title: "Winning",
    body: "The Faithful win if every Traitor is out. The Traitors win if they equal the number of Faithful, or if any Traitor survives until the end of Day 12.",
  },
  {
    icon: "phone-portrait-outline",
    title: "Playing on several phones",
    body: "Open the app on as many phones as you like, for example one per couple. The phone that starts the game shows a 5-character join code at the top. On the other phones tap \"Join with a code\" and enter it. Every phone then shows the same game and updates by itself. Anyone can take their turn on any phone: tap your own name and enter your PIN, then tap \"Hide\" before handing it back. Other families can run their own game with their own code. You need an internet connection.",
  },
  {
    icon: "remove-circle-outline",
    title: "Someone can't vote?",
    body: "At the Round Table, tap \"Skip\" next to anyone who is away. Whoever skips them picks their own name and enters their PIN, and everyone can see who skipped whom. Their vote is skipped for that evening only, and if they turn up later they can still vote. If a Traitor is skipped and no other Traitor confirms the murder, that day's murder doesn't count.",
  },
  {
    icon: "eye-off",
    title: "Forgot your secret?",
    body: "Tap \"Check my secret\" on the main screen, then your name, to see your role (and, for Traitors, today's victim and action).",
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
          <Eyebrow>12 days · 2 lives each</Eyebrow>
          <Title>The rules</Title>
        </View>
        {STEPS.map((s) => (
          <View key={s.title} style={styles.card}>
            <View style={styles.cardHead}>
              <Ionicons name={s.icon} size={24} color={colors.brand} />
              <Text style={styles.cardTitle}>{s.title}</Text>
            </View>
            <Body>{s.body}</Body>
          </View>
        ))}
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
