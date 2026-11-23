import Ionicons from "@react-native-vector-icons/ionicons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ScreenHeader } from "@/src/components/screen-header";
import { Body, Button, Eyebrow, Title } from "@/src/components/ui";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

// Everything on this page is fixed text, identical for every player and every
// game. It reads nothing from the game, so it cannot give anything away. Keep it
// that way: no roles, no examples of secret actions, no late-game twists, and
// nothing that describes what only one side sees on their private screen.

type Icon = React.ComponentProps<typeof Ionicons>["name"];
type Tip = [lead: string, text: string];
type Section = { id: string; icon: Icon; title: string; tips: Tip[] };

const QUICK: string[] = [
  "Tap your own name.",
  "Enter your PIN where nobody can see.",
  "Do what the screen says, then hide it and hand the phone back.",
];

const SECTIONS: Section[] = [
  {
    id: "welcome",
    icon: "home-outline",
    title: "Start screen",
    tips: [
      ["Begin a new game", "you are setting it up for the group."],
      ["Join with a code", "someone else already started it. Ask them for the 5-character code."],
      ["How to play", "the rules, in a minute."],
    ],
  },
  {
    id: "setup",
    icon: "person-add-outline",
    title: "New game",
    tips: [
      ["Each player", "types their own name and a 4-digit PIN. Keep the PIN to yourself, you need it every turn."],
      ["4 to 15 players.", "Empty rows are ignored. Use the cross to remove a row, or Add a player for more."],
      ["First name on the list", "is the host. Only the host's PIN can end the game for everyone."],
      ["Choose the Traitors", "starts the game. Roles are dealt in secret, even from the organiser."],
    ],
  },
  {
    id: "join",
    icon: "enter-outline",
    title: "Join a game",
    tips: [
      ["Type the code", "shown top right on a phone that is already in the game, then Join the game."],
      ["Scanned a QR or tapped a link?", "You join automatically."],
      ["No game found?", "Check the letters. Codes never use 0, O, 1, I or L."],
    ],
  },
  {
    id: "main",
    icon: "flame-outline",
    title: "Main screen",
    tips: [
      ["The card at the top", "tells you what is happening now and holds the one big button."],
      ["The big button", "moves the game on for every phone. Press it once, when everyone is together."],
      ["Button greyed out?", "It is waiting for players. A circle by a name means not yet, a tick means done."],
      ["Your turn", "tap your own name in the list."],
      ["Check my secret", "tap it, then your name, to look at your own role again at any time."],
      ["Code (top right)", "tap for a QR code and a link to bring in more phones."],
      ["⋯ (top right)", "opens the menu. See The menu below."],
      ["Looks out of date?", "Pull down to refresh. Phones catch up by themselves every few seconds."],
    ],
  },
  {
    id: "day",
    icon: "sunny-outline",
    title: "What to tap, through the day",
    tips: [
      ["Before Day 1", "everyone taps their name to see their role. Then Begin Day 1."],
      ["Night (first)", "tap your name once — the Traitors secretly pick their victim before the Round Table. Then Reveal the murder."],
      ["The reveal", "open the envelope together to see who was murdered."],
      ["Round Table (evening)", "talk it over, then everyone taps their name and votes. Then Reveal the banishment."],
      ["Someone missing for the vote?", "Skip & reveal counts the votes cast so far."],
      ["Next day", "after the banishment, begin the next day."],
    ],
  },
  {
    id: "player",
    icon: "lock-closed-outline",
    title: "Your private screen",
    tips: [
      ["Private.", "Check nobody is looking before you enter your PIN."],
      ["Wrong PIN?", "The dots clear. Just try again."],
      ["Follow the screen.", "Sometimes there is a choice to make, sometimes only a button to pass the phone on."],
      ["Everyone takes a turn", "and every turn looks the same from across the room. Don't skip yours."],
      ["Always finish", "with the button at the bottom so the screen is hidden before the phone leaves your hand."],
      ["✕ (top right)", "closes the screen without doing anything."],
    ],
  },
  {
    id: "reveal",
    icon: "mail-open-outline",
    title: "The envelope",
    tips: [
      ["Gather everyone", "before you open it, and read it out loud."],
      ["Continue", "steps through one page at a time."],
      ["The last button", "moves the whole game on. One tap, on one phone, is enough."],
    ],
  },
  {
    id: "menu",
    icon: "ellipsis-horizontal",
    title: "The menu (⋯)",
    tips: [
      ["Day history", "what has been announced so far, day by day. Nothing secret is in there."],
      ["Secret actions", "locked. It asks who you are and only opens for the right people."],
      ["Invite players", "a QR code and a link for other phones."],
      ["Leave game on this phone", "the game carries on for everyone else. Come back with the code."],
      ["End this game for everyone", "needs the host's PIN and cannot be undone."],
    ],
  },
  {
    id: "finale",
    icon: "trophy-outline",
    title: "Game over",
    tips: [
      ["All roles", "are now shown next to the names on the main screen."],
      ["Share the finale", "makes a picture of the result to send to the family."],
      ["Start a new game", "clears this one for every phone. Share the picture first."],
    ],
  },
  {
    id: "stuck",
    icon: "help-buoy-outline",
    title: "Stuck?",
    tips: [
      ["Forgot your role?", "Check my secret, then your name."],
      ["Forgot your PIN?", "There is no reset, so choose one you will remember."],
      ["Could not reach the castle?", "Check your internet, then Try again. The game is safe."],
      ["Game ended on another phone?", "It was ended for everyone. Start a new one or join another."],
      ["Opened the wrong name?", "Tap ✕. Nothing happens without that player's PIN."],
      ["Phone ran out of battery?", "Use any other phone. Join with the code and carry on."],
    ],
  },
];

// Where each screen's "?" lands. Several screens share a section.
const FROM: Record<string, string> = {
  welcome: "welcome",
  setup: "setup",
  join: "join",
  main: "main",
  player: "player",
  reveal: "reveal",
  history: "menu",
  actions: "menu",
  finale: "finale",
};

export default function Help() {
  const styles = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { from } = useLocalSearchParams<{ from?: string }>();
  const hereId = from ? FROM[from] : undefined;
  const here = SECTIONS.find((s) => s.id === hereId);
  const rest = SECTIONS.filter((s) => s !== here);

  return (
    <View style={styles.root} testID="help-screen">
      <ScreenHeader title="Help" testID="help" />
      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.lg }]}>
        <View style={{ gap: spacing.sm }}>
          <Eyebrow>The short version · no spoilers</Eyebrow>
          <Title>What do I tap?</Title>
        </View>

        {here ? <SectionCard s={here} here /> : null}

        <View style={styles.quick} testID="help-quick">
          <Text style={styles.quickTitle}>Every turn, in three taps</Text>
          {QUICK.map((q, i) => (
            <View key={q} style={styles.quickRow}>
              <Text style={styles.quickNum}>{i + 1}</Text>
              <Text style={styles.quickText}>{q}</Text>
            </View>
          ))}
        </View>

        <Button testID="help-how-to-play-button" label="How to play" variant="secondary" icon="book-outline" onPress={() => router.push("/how-to-play")} />

        {here ? <Text style={styles.divider}>Every other screen</Text> : null}
        {rest.map((s) => (
          <SectionCard key={s.id} s={s} />
        ))}

        <View style={styles.promise}>
          <Ionicons name="eye-off-outline" size={20} color={colors.muted} />
          <Body style={{ fontSize: 15, lineHeight: 22, flex: 1, color: colors.muted }}>
            This page is the same for every player and never shows anything about your game, so it is safe to open
            with people watching.
          </Body>
        </View>
      </ScrollView>
    </View>
  );
}

function SectionCard({ s, here }: { s: Section; here?: boolean }) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <View style={[styles.card, here && styles.cardHere]} testID={`help-section-${s.id}`}>
      {here ? <Eyebrow>You are here</Eyebrow> : null}
      <View style={styles.cardHead}>
        <Ionicons name={s.icon} size={22} color={colors.brand} />
        <Text style={styles.cardTitle}>{s.title}</Text>
      </View>
      {s.tips.map(([lead, text]) => (
        <View key={lead} style={styles.tip}>
          <View style={styles.dot} />
          <Text style={styles.tipText}>
            <Text style={styles.tipLead}>{/[.?!]$/.test(lead) ? lead : `${lead}:`}</Text> {text}
          </Text>
        </View>
      ))}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  scroll: { padding: spacing.lg, gap: spacing.md },
  quick: { backgroundColor: c.brandTertiary, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm },
  quickTitle: { color: c.brand, fontSize: 13, letterSpacing: 2, textTransform: "uppercase", fontWeight: "700" },
  quickRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  quickNum: { fontFamily: fonts.display, fontSize: 28, lineHeight: 30, color: c.brand, width: 20, textAlign: "center" },
  quickText: { color: c.onSurface, fontSize: 18, lineHeight: 26, fontWeight: "600", flex: 1 },
  divider: { color: c.muted, fontSize: 13, letterSpacing: 2, textTransform: "uppercase", fontWeight: "600", marginTop: spacing.sm },
  card: { backgroundColor: c.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm, borderWidth: 1, borderColor: c.border },
  cardHere: { borderColor: c.brandSecondary },
  cardHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.xs },
  cardTitle: { fontFamily: fonts.display, fontSize: 26, lineHeight: 30, color: c.onSurface, flex: 1 },
  tip: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: c.brandSecondary, marginTop: 10 },
  tipText: { color: c.onSurfaceSecondary, fontSize: 17, lineHeight: 25, flex: 1 },
  tipLead: { color: c.onSurface, fontWeight: "700" },
  promise: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, marginTop: spacing.sm },
}));
