import Ionicons from "@react-native-vector-icons/ionicons";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { type Href, useLocalSearchParams, useRouter } from "expo-router";
import { type ComponentProps, type ReactNode, useCallback, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, ApiError, BanishResult, ChatMessage, DayResult, ModeratorEvent, Role, roundLabel, Story, VoteEdge } from "@/src/api";
import { ScreenHeader } from "@/src/components/screen-header";
import { Body, Button, Eyebrow, IMAGES, Title } from "@/src/components/ui";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

// "The whole story": everything that happened in a FINISHED game, published to everyone once
// it is over. The server only serves a game here after it has ended, so every secret (roles,
// recruits, murder methods, the Traitors' chat) is shown openly on this screen.

// Cast so this file type-checks before the generated typed-routes list includes the new screen.
const PREVIOUS_GAMES = "/previous-games" as Href;

type StoryPlayer = Story["players"][number];
type IconName = ComponentProps<typeof Ionicons>["name"];
type Winner = Story["winner"];

type NightOutcome =
  | { kind: "murder"; victim: string; method: string | null; eliminated: boolean; livesLeft: number | null; role: Role | null }
  | { kind: "recruit"; name: string | null }
  | { kind: "none"; why: string | null; plan: string | null };

type VoteRound = { key: string; title: string | null; round: 1 | 2; vote: BanishResult; ballots: VoteEdge[] };

type RoundModel = {
  key: string;
  index: number;
  label: string;
  h: DayResult;
  night: NightOutcome | null;
  votes: VoteRound[];
  endVotes: string[];
};

type Model = {
  story: Story;
  rounds: RoundModel[];
  cast: StoryPlayer[];
  /** A player's allegiance at the time of a round (a recruit was Faithful before it). */
  roleAt: (id: string | null | undefined, roundIndex: number) => Role | null;
  finalLabel: string;
  endText: string | null;
  stats: { rounds: number; murdered: number; banished: number; recruited: number; survived: number; traitors: number };
  chat: ChatMessage[];
  events: ModeratorEvent[];
};

type Block =
  | { type: "hero"; key: string }
  | { type: "cast"; key: string }
  | { type: "heading"; key: string; eyebrow: string; title: string; icon: IconName; note?: string; testID: string }
  | { type: "round"; key: string; round: RoundModel; first: boolean; last: boolean }
  | { type: "ending"; key: string }
  | { type: "groupLabel"; key: string; label: string; tone: "traitor" | "gold" }
  | { type: "chat"; key: string; m: ChatMessage }
  | { type: "empty"; key: string; text: string; testID: string }
  | { type: "logToggle"; key: string }
  | { type: "log"; key: string; e: ModeratorEvent }
  | { type: "footer"; key: string };

const EVENT_ICON: Record<string, { icon: IconName; tone: "traitor" | "gold" | "muted" }> = {
  setup: { icon: "flag", tone: "gold" },
  role: { icon: "eye-outline", tone: "muted" },
  stage: { icon: "time-outline", tone: "gold" },
  schedule: { icon: "calendar-outline", tone: "gold" },
  victim: { icon: "skull-outline", tone: "traitor" },
  murder: { icon: "skull", tone: "traitor" },
  recruit: { icon: "person-add", tone: "traitor" },
  lielow: { icon: "moon-outline", tone: "traitor" },
  pass: { icon: "moon-outline", tone: "muted" },
  plan: { icon: "document-text-outline", tone: "traitor" },
  checkin: { icon: "checkmark-circle-outline", tone: "muted" },
  confirm: { icon: "checkmark-done", tone: "traitor" },
  reveal: { icon: "mail-open-outline", tone: "gold" },
  vote: { icon: "hand-left-outline", tone: "muted" },
  banish: { icon: "flame", tone: "gold" },
  end: { icon: "trophy", tone: "gold" },
  actions: { icon: "list-outline", tone: "muted" },
};

// ---------------------------------------------------------------- helpers

function timeOf(t: string): string {
  const d = new Date(t);
  return isNaN(d.getTime()) ? "" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

function dateOf(t: string | null | undefined): string {
  if (!t) return "";
  const d = new Date(t);
  return isNaN(d.getTime()) ? "" : format(d, "EEE d MMM yyyy");
}

function capitalise(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function initialOf(name: string | null | undefined): string {
  return (name ?? "?").trim().charAt(0).toUpperCase() || "?";
}

function winnerText(w: Winner): string {
  return w === "traitors" ? "The Traitors won" : w === "faithful" ? "The Faithful won" : "The game is over";
}

/** Everything the screen shows, worked out once from the story. */
function buildModel(story: Story): Model {
  const players = story.players ?? [];
  const history = story.rounds ?? [];
  const events = story.event_log ?? [];
  const voteLog = story.vote_log ?? [];
  const byId = new Map(players.map((p) => [p.id, p]));
  const byName = new Map(players.map((p) => [p.name.trim().toLowerCase(), p]));
  const eventsByDay = new Map<number, ModeratorEvent[]>();
  for (const e of events) {
    const list = eventsByDay.get(e.day);
    if (list) list.push(e);
    else eventsByDay.set(e.day, [e]);
  }
  const lastEvent = (day: number, kind: string) => {
    const list = (eventsByDay.get(day) ?? []).filter((e) => e.kind === kind);
    return list[list.length - 1] ?? null;
  };

  // Who was recruited in which round: from the murder reveal in the log ("... — Anna was
  // recruited and is now a Traitor"), else from the player's recorded recruit round.
  const recruitName = new Map<number, string | null>();
  const recruitIndex = new Map<string, number>();
  history.forEach((h, i) => {
    if (!h.recruited) return;
    let name: string | null = null;
    for (const e of eventsByDay.get(h.day) ?? []) {
      if (e.kind !== "reveal") continue;
      const m = /(?:^|—\s*)([^—]+?) was recruited/.exec(e.text ?? "");
      if (m) name = m[1].trim();
    }
    let p = name ? byName.get(name.toLowerCase()) : undefined;
    if (!p) {
      p = players.find((x) => x.started_as === "faithful" && x.role === "traitor" && x.recruited_label === roundLabel(h));
      if (p) name = p.name;
    }
    recruitName.set(i, name);
    if (p && !recruitIndex.has(p.id)) recruitIndex.set(p.id, i);
  });
  for (const p of players) {
    if (p.started_as === "faithful" && p.role === "traitor" && !recruitIndex.has(p.id) && p.recruited_label) {
      const i = history.findIndex((h) => roundLabel(h) === p.recruited_label);
      if (i >= 0) recruitIndex.set(p.id, i);
    }
  }

  const roleAt = (id: string | null | undefined, i: number): Role | null => {
    const p = id ? byId.get(id) : undefined;
    if (!p) return null;
    if (p.started_as === "faithful" && p.role === "traitor") {
      const at = recruitIndex.get(p.id);
      return at === undefined || i >= at ? "traitor" : "faithful";
    }
    return p.role;
  };

  // The recorded ballots of one Round Table vote (1 = first vote, 2 = tie-break revote).
  const logFor = (day: number, round: 1 | 2) => {
    const all = voteLog.filter((v) => v.day === day);
    const exact = all.filter((v) => (v.round ?? 0) === round);
    return exact[exact.length - 1] ?? all[round - 1] ?? null;
  };

  const rounds: RoundModel[] = history.map((h, i) => {
    let night: NightOutcome | null = null;
    const m = h.murder;
    if (h.recruited) {
      night = { kind: "recruit", name: recruitName.get(i) ?? null };
    } else if (m?.success) {
      const eliminated = m.eliminated ?? (m.lives_left === undefined || m.lives_left === 0);
      night = {
        kind: "murder",
        victim: m.victim_name ?? (m.victim_id ? byId.get(m.victim_id)?.name : undefined) ?? "Someone",
        method: m.action ?? null,
        eliminated,
        livesLeft: m.lives_left ?? null,
        role: eliminated ? (m.role ?? roleAt(m.victim_id, i)) : null,
      };
    } else if (m) {
      const reveal = lastEvent(h.day, "reveal")?.text ?? "";
      const stripped = reveal.replace(/^Murder reveal:\s*nobody died\s*—\s*/i, "");
      const why = stripped && stripped !== reveal ? capitalise(stripped) : null;
      const planText = (lastEvent(h.day, "plan")?.text ?? "").replace(/^Tonight's plan:\s*/i, "");
      const plan = why && /not carried out/i.test(why) && /^murder /i.test(planText) ? planText : null;
      night = { kind: "none", why, plan };
    }

    const votes: VoteRound[] = [];
    if (h.tie_vote) {
      votes.push({ key: `${h.day}-1`, title: "First vote", round: 1, vote: h.tie_vote, ballots: h.tie_vote.votes ?? logFor(h.day, 1)?.votes ?? [] });
    }
    if (h.banish) {
      const r: 1 | 2 = h.tie_vote || h.banish.round === 2 ? 2 : 1;
      votes.push({
        key: `${h.day}-${r}`,
        title: h.tie_vote ? "The revote" : null,
        round: r,
        vote: h.banish,
        ballots: h.banish.votes ?? logFor(h.day, r)?.votes ?? [],
      });
    }

    const endVotes: string[] = [];
    for (const v of voteLog) {
      if (v.day !== h.day) continue;
      for (const n of v.end_votes ?? []) if (n && !endVotes.includes(n)) endVotes.push(n);
    }

    return { key: `${h.day}-${i}`, index: i, label: roundLabel(h), h, night, votes, endVotes };
  });

  const rank = (p: StoryPlayer) => (p.role === "traitor" ? (p.started_as === "faithful" ? 1 : 0) : 2);
  const cast = [...players].sort(
    (a, b) => rank(a) - rank(b) || Number(!!a.exit) - Number(!!b.exit) || a.name.localeCompare(b.name),
  );

  const last = history[history.length - 1];
  const storedLabel = (story as Story & { label?: string }).label;
  const finalLabel = (last ? roundLabel(last) : storedLabel) ?? "";
  const endEvents = events.filter((e) => e.kind === "end");
  const endRaw = endEvents[endEvents.length - 1]?.text ?? "";
  const endText = endRaw ? capitalise(endRaw.replace(/^Game over\s*—\s*/i, "")) : null;

  return {
    story,
    rounds,
    cast,
    roleAt,
    finalLabel,
    endText,
    stats: {
      rounds: history.length,
      murdered: players.filter((p) => p.exit?.how === "murdered").length,
      banished: players.filter((p) => p.exit?.how === "banished").length,
      recruited: players.filter((p) => p.started_as === "faithful" && p.role === "traitor").length,
      survived: players.filter((p) => !p.exit).length,
      traitors: players.filter((p) => p.role === "traitor").length,
    },
    chat: story.traitor_chat ?? [],
    events,
  };
}

/** The screen as a list of blocks, so long stories scroll smoothly (only what's on screen renders). */
function blocksOf(model: Model, logOpen: boolean): Block[] {
  const blocks: Block[] = [{ type: "hero", key: "hero" }];

  blocks.push({
    type: "heading",
    key: "h-cast",
    eyebrow: "Every role revealed",
    title: "The cast",
    icon: "people-outline",
    testID: "story-cast-heading",
  });
  blocks.push({ type: "cast", key: "cast" });

  blocks.push({
    type: "heading",
    key: "h-rounds",
    eyebrow: "Night by night",
    title: "Round by round",
    icon: "git-commit-outline",
    note: "Names in red were Traitors at that point in the game.",
    testID: "story-rounds-heading",
  });
  if (model.rounds.length === 0) {
    blocks.push({ type: "empty", key: "rounds-empty", text: "No rounds were played.", testID: "story-rounds-empty" });
  }
  model.rounds.forEach((r, i) => {
    blocks.push({ type: "round", key: `round-${r.key}`, round: r, first: i === 0, last: i === model.rounds.length - 1 });
  });
  blocks.push({ type: "ending", key: "ending" });

  blocks.push({
    type: "heading",
    key: "h-chat",
    eyebrow: "Now it can be told",
    title: "The Traitors' secret chat",
    icon: "chatbubbles-outline",
    testID: "story-chat-heading",
  });
  if (model.chat.length === 0) {
    blocks.push({ type: "empty", key: "chat-empty", text: "The Traitors never used their secret chat.", testID: "story-chat-empty" });
  }
  let lastLabel: string | null = null;
  model.chat.forEach((m, i) => {
    const label = roundLabel(m);
    if (label !== lastLabel) {
      blocks.push({ type: "groupLabel", key: `chat-label-${i}`, label, tone: "traitor" });
      lastLabel = label;
    }
    blocks.push({ type: "chat", key: `chat-${m.id ?? i}-${i}`, m });
  });

  blocks.push({
    type: "heading",
    key: "h-log",
    eyebrow: "The castle records",
    title: "Everything that happened",
    icon: "document-text-outline",
    testID: "story-log-heading",
  });
  blocks.push({ type: "logToggle", key: "log-toggle" });
  if (logOpen) {
    lastLabel = null;
    model.events.forEach((e, i) => {
      const label = roundLabel(e);
      if (label !== lastLabel) {
        blocks.push({ type: "groupLabel", key: `log-label-${i}`, label, tone: "gold" });
        lastLabel = label;
      }
      blocks.push({ type: "log", key: `log-${i}`, e });
    });
  }

  blocks.push({ type: "footer", key: "footer" });
  return blocks;
}

// ---------------------------------------------------------------- screen

export default function StoryScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ code?: string | string[] }>();
  const rawCode = Array.isArray(params.code) ? params.code[0] : params.code;
  const code = (rawCode ?? "").trim().toUpperCase();
  const [logOpen, setLogOpen] = useState(false);

  const { data, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: ["story", code],
    queryFn: () => api.story(code),
    enabled: !!code,
    staleTime: 5 * 60 * 1000, // a finished game never changes
    retry: (count, e) => !(e instanceof ApiError && e.status === 404) && count < 2,
  });

  const model = useMemo(() => (data ? buildModel(data) : null), [data]);
  const blocks = useMemo(() => (model ? blocksOf(model, logOpen) : []), [model, logOpen]);

  const renderItem = useCallback(
    ({ item }: { item: Block }) => {
      if (!model) return null;
      switch (item.type) {
        case "hero":
          return <Hero model={model} />;
        case "cast":
          return <Cast model={model} />;
        case "heading":
          return <Heading eyebrow={item.eyebrow} title={item.title} icon={item.icon} note={item.note} testID={item.testID} />;
        case "round":
          return <RoundItem r={item.round} first={item.first} last={item.last} roleAt={model.roleAt} />;
        case "ending":
          return <Ending model={model} />;
        case "groupLabel":
          return <GroupLabel label={item.label} tone={item.tone} />;
        case "chat":
          return <ChatRow m={item.m} />;
        case "empty":
          return (
            <Text style={styles.emptyText} testID={item.testID}>
              {item.text}
            </Text>
          );
        case "logToggle":
          return <LogToggle count={model.events.length} open={logOpen} onToggle={() => setLogOpen((o) => !o)} />;
        case "log":
          return <LogRow e={item.e} />;
        case "footer":
          return (
            <View style={styles.footer}>
              <Button
                testID="story-previous-games-button"
                label="All previous games"
                variant="secondary"
                icon="albums-outline"
                onPress={() => router.push(PREVIOUS_GAMES)}
              />
            </View>
          );
      }
    },
    [model, logOpen, router, styles],
  );

  if (!code) {
    return (
      <Message
        icon="help-circle-outline"
        title="No game chosen"
        text="Open a finished game from Previous games to read its whole story."
        testID="story-missing-code"
        action={{ label: "Previous games", icon: "albums-outline", onPress: () => router.push(PREVIOUS_GAMES), testID: "story-missing-previous-button" }}
      />
    );
  }

  if (isLoading) {
    return (
      <View style={styles.root} testID="story-screen">
        <ScreenHeader title="The whole story" testID="story" />
        <View style={styles.center} testID="story-loading">
          <ActivityIndicator color={colors.brand} size="large" />
          <Text style={styles.centerText}>Opening the castle records…</Text>
        </View>
      </View>
    );
  }

  if (error || !model) {
    const notFinished = error instanceof ApiError && error.status === 404;
    return notFinished ? (
      <Message
        icon="hourglass-outline"
        title="This game hasn't finished yet"
        text="The whole story is published to everyone the moment the game ends. Come back once a winner has been crowned."
        testID="story-error"
        action={{ label: "Previous games", icon: "albums-outline", onPress: () => router.push(PREVIOUS_GAMES), testID: "story-error-previous-button" }}
      />
    ) : (
      <Message
        icon="cloud-offline-outline"
        title="Couldn't open the story"
        text={error instanceof Error ? `${error.message}. Check your internet and try again.` : "Check your internet and try again."}
        testID="story-error"
        action={{ label: "Try again", icon: "refresh", onPress: () => refetch(), testID: "story-retry-button", loading: isRefetching }}
      />
    );
  }

  return (
    <View style={styles.root} testID="story-screen">
      <ScreenHeader title="The whole story" testID="story" />
      <FlatList
        data={blocks}
        keyExtractor={(b) => b.key}
        renderItem={renderItem}
        initialNumToRender={6}
        maxToRenderPerBatch={12}
        windowSize={9}
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.xl }]}
        testID="story-list"
      />
    </View>
  );
}

/** A full-screen message (missing code, not finished, offline). */
function Message({
  icon,
  title,
  text,
  testID,
  action,
}: {
  icon: IconName;
  title: string;
  text: string;
  testID: string;
  action: { label: string; icon: IconName; onPress: () => void; testID: string; loading?: boolean };
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <View style={styles.root} testID="story-screen">
      <ScreenHeader title="The whole story" testID="story" />
      <View style={styles.message} testID={testID}>
        <View style={styles.messageIcon}>
          <Ionicons name={icon} size={40} color={colors.brand} />
        </View>
        <Title style={{ textAlign: "center", fontSize: 34, lineHeight: 40 }}>{title}</Title>
        <Body style={{ textAlign: "center" }}>{text}</Body>
        <Button testID={action.testID} label={action.label} icon={action.icon} variant="secondary" onPress={action.onPress} loading={action.loading} style={{ alignSelf: "stretch" }} />
      </View>
    </View>
  );
}

// ---------------------------------------------------------------- hero

function Hero({ model }: { model: Model }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const { story, stats } = model;
  const traitorsWin = story.winner === "traitors";
  const accent = traitorsWin ? colors.traitor : colors.brand;
  const started = dateOf(story.created_at);
  const ended = dateOf(story.ended_at);
  const when = started && ended && started !== ended ? `${started} – ${ended}` : ended || started;
  return (
    <Animated.View entering={FadeInDown.duration(500)} style={[styles.hero, { borderColor: accent }]} testID="story-hero">
      <Image source={{ uri: traitorsWin ? IMAGES.hood : IMAGES.castle }} style={styles.fill} contentFit="cover" transition={400} />
      <LinearGradient
        colors={["rgba(13,17,19,0.35)", "rgba(13,17,19,0.82)", colors.surface]}
        locations={[0, 0.5, 1]}
        style={styles.fill}
      />
      <LinearGradient colors={[`${accent}55`, "transparent"]} locations={[0, 0.6]} style={styles.fill} />
      <View style={styles.heroBody}>
        <Eyebrow style={styles.eyebrow15}>The whole story</Eyebrow>
        <View style={[styles.heroIcon, { borderColor: accent, backgroundColor: `${accent}26` }]}>
          <Ionicons name={traitorsWin ? "skull" : "shield-checkmark"} size={44} color={accent} />
        </View>
        <Text style={[styles.heroTitle, { color: accent }]} testID="story-winner">
          {winnerText(story.winner)}
        </Text>
        {model.endText ? <Text style={styles.heroSub}>{model.endText}</Text> : null}
        <Text style={styles.heroMeta}>
          {[when, model.finalLabel ? `Ended ${model.finalLabel}` : ""].filter(Boolean).join(" · ")}
        </Text>
        <View style={styles.stats}>
          <Stat value={model.cast.length} label="players" icon="people" color={colors.onSurface} />
          <Stat value={stats.traitors} label={stats.traitors === 1 ? "Traitor" : "Traitors"} icon="skull-outline" color={colors.traitor} />
          <Stat value={stats.rounds} label={stats.rounds === 1 ? "round" : "rounds"} icon="flame-outline" color={colors.brand} />
          <Stat value={stats.murdered} label="murdered" icon="skull" color={colors.traitor} />
          <Stat value={stats.banished} label="banished" icon="flame" color={colors.brand} />
          {stats.recruited ? <Stat value={stats.recruited} label="recruited" icon="person-add" color={colors.traitor} /> : null}
          <Stat value={stats.survived} label="survived" icon="heart" color={colors.onSuccess} />
        </View>
      </View>
    </Animated.View>
  );
}

function Stat({ value, label, icon, color }: { value: number; label: string; icon: IconName; color: string }) {
  const styles = useStyles();
  return (
    <View style={styles.stat}>
      <Ionicons name={icon} size={16} color={color} />
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function Heading({ eyebrow, title, icon, note, testID }: { eyebrow: string; title: string; icon: IconName; note?: string; testID: string }) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <View style={styles.heading} testID={testID}>
      <View style={styles.headingRow}>
        <Ionicons name={icon} size={20} color={colors.brand} />
        <Eyebrow style={styles.eyebrow15}>{eyebrow}</Eyebrow>
      </View>
      <Title style={styles.headingTitle}>{title}</Title>
      {note ? <Text style={styles.headingNote}>{note}</Text> : null}
    </View>
  );
}

// ---------------------------------------------------------------- the cast

function Cast({ model }: { model: Model }) {
  const styles = useStyles();
  return (
    <Animated.View entering={FadeInDown.delay(120).duration(450)} style={styles.castGrid} testID="story-cast">
      {model.cast.map((p) => (
        <CastCard key={p.id} p={p} />
      ))}
    </Animated.View>
  );
}

function CastCard({ p }: { p: StoryPlayer }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const traitor = p.role === "traitor";
  const accent = traitor ? colors.traitor : colors.brand;
  const recruited = traitor && p.started_as === "faithful";
  return (
    <View style={[styles.castCard, { borderColor: `${accent}77` }]} testID={`story-player-${p.id}`}>
      <View style={[styles.castStripe, { backgroundColor: accent }]} />
      <View style={styles.castTop}>
        <View style={[styles.avatar, { borderColor: accent, backgroundColor: `${accent}1F` }]}>
          <Text style={[styles.avatarText, { color: accent, opacity: p.exit ? 0.6 : 1 }]}>{initialOf(p.name)}</Text>
          {p.exit ? (
            <View style={[styles.avatarBadge, { borderColor: accent }]}>
              <Ionicons name={p.exit.how === "murdered" ? "skull" : "flame"} size={13} color={accent} />
            </View>
          ) : null}
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text style={styles.castName} numberOfLines={2}>
            {p.name}
          </Text>
          <View style={styles.roleRow}>
            <Ionicons name={traitor ? "skull-outline" : "shield-checkmark-outline"} size={16} color={accent} />
            <Text style={[styles.castRole, { color: accent }]} testID={`story-player-role-${p.id}`}>
              {traitor ? "Traitor" : "Faithful"}
            </Text>
          </View>
        </View>
      </View>
      <View style={styles.badges}>
        {p.is_host ? <Badge icon="star" text="Host" color={colors.brand} /> : null}
        {recruited ? <Badge icon="person-add" text={p.recruited_label ? `Recruited · ${p.recruited_label}` : "Recruited"} color={colors.traitor} /> : null}
        {p.exit ? (
          <Badge
            icon={p.exit.how === "murdered" ? "skull-outline" : "flame-outline"}
            text={`${p.exit.how === "murdered" ? "Murdered" : "Banished"} · ${p.exit.label}`}
            color={colors.onSurfaceTertiary}
          />
        ) : (
          <Badge icon="heart" text="Survived" color={colors.onSuccess} bg={colors.success} />
        )}
      </View>
    </View>
  );
}

function Badge({ icon, text, color, bg }: { icon: IconName; text: string; color: string; bg?: string }) {
  const styles = useStyles();
  return (
    <View style={[styles.badge, { borderColor: bg ?? color, backgroundColor: bg ?? "transparent" }]}>
      <Ionicons name={icon} size={14} color={color} />
      <Text style={[styles.badgeText, { color }]}>{text}</Text>
    </View>
  );
}

function RoleChip({ role, testID }: { role: Role; testID?: string }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const traitor = role === "traitor";
  const accent = traitor ? colors.traitor : colors.brand;
  return (
    <View style={[styles.roleChip, { borderColor: accent, backgroundColor: `${accent}22` }]} testID={testID}>
      <Ionicons name={traitor ? "skull" : "shield-checkmark"} size={15} color={accent} />
      <Text style={[styles.roleChipText, { color: accent }]}>{traitor ? "Traitor" : "Faithful"}</Text>
    </View>
  );
}

// ---------------------------------------------------------------- the timeline

function RoundItem({
  r,
  first,
  last,
  roleAt,
}: {
  r: RoundModel;
  first: boolean;
  last: boolean;
  roleAt: Model["roleAt"];
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const winner = r.h.winner;
  return (
    <View style={styles.roundRow} testID={`story-round-${r.h.day}`}>
      <View style={styles.rail}>
        {first && last ? null : <View style={[styles.railLine, first && { top: 18 }, last && { bottom: undefined, height: 18 }]} />}
        <View style={[styles.railDot, winner && { borderColor: winner === "traitors" ? colors.traitor : colors.brand }]}>
          <Text style={styles.railNum}>{r.index + 1}</Text>
        </View>
      </View>
      <View style={styles.roundCard}>
        <View style={styles.roundHead}>
          <View style={styles.labelPill}>
            <Text style={styles.labelPillText}>{r.label}</Text>
          </View>
          {winner ? (
            <View style={styles.roundWin}>
              <Ionicons name="trophy" size={16} color={winner === "traitors" ? colors.traitor : colors.brand} />
              <Text style={[styles.roundWinText, { color: winner === "traitors" ? colors.traitor : colors.brand }]}>
                {winner === "traitors" ? "Traitors win" : "Faithful win"}
              </Text>
            </View>
          ) : null}
        </View>

        {r.night ? <Night n={r.night} day={r.h.day} /> : null}

        {r.h.ended_by_vote ? (
          <View style={styles.panel} testID={`story-ended-by-vote-${r.h.day}`}>
            <View style={styles.panelHead}>
              <Ionicons name="hand-right-outline" size={18} color={colors.brand} />
              <Text style={styles.panelLabel}>The endgame</Text>
            </View>
            <Text style={styles.main}>Everyone voted to end the game.</Text>
          </View>
        ) : null}

        {r.votes.length ? (
          <View style={styles.panel} testID={`story-table-${r.h.day}`}>
            <View style={styles.panelHead}>
              <Ionicons name="flame" size={18} color={colors.brand} />
              <Text style={styles.panelLabel}>The Round Table</Text>
            </View>
            {r.votes.map((v, i) => (
              <View key={v.key} style={i > 0 ? styles.voteDivider : undefined}>
                <VoteBlock v={v} roundIndex={r.index} roleAt={roleAt} />
              </View>
            ))}
          </View>
        ) : null}

        {r.endVotes.length ? (
          <Text style={styles.sub} testID={`story-end-votes-${r.h.day}`}>
            Voted to end the game: {r.endVotes.join(", ")}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function Night({ n, day }: { n: NightOutcome; day: number }) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <View style={[styles.panel, styles.nightPanel]} testID={`story-night-${day}`}>
      <View style={styles.panelHead}>
        <Ionicons name="moon" size={18} color={colors.traitor} />
        <Text style={styles.panelLabel}>The night</Text>
      </View>
      {n.kind === "murder" ? (
        <>
          <Text style={styles.main}>
            <Text style={styles.strong}>{n.victim}</Text>
            {n.eliminated
              ? " was murdered"
              : ` was attacked and lost a life${n.livesLeft !== null ? ` (${n.livesLeft} left)` : ""}`}
          </Text>
          {n.role ? <RoleChip role={n.role} testID={`story-murder-role-${day}`} /> : null}
          {n.method ? (
            <View style={styles.method} testID={`story-method-${day}`}>
              <Text style={styles.methodLabel}>The secret method</Text>
              <Text style={styles.methodText}>“{n.method}”</Text>
            </View>
          ) : null}
        </>
      ) : n.kind === "recruit" ? (
        <>
          <Text style={styles.main}>
            A Faithful was recruited{n.name ? ": " : ""}
            {n.name ? <Text style={[styles.strong, { color: colors.traitor }]}>{n.name}</Text> : null}
          </Text>
          <Text style={styles.sub}>No murder — {n.name ?? "they"} secretly joined the Traitors.</Text>
        </>
      ) : (
        <>
          <Text style={styles.main}>No murder</Text>
          {n.why ? <Text style={styles.sub}>{n.why}</Text> : null}
          {n.plan ? <Text style={styles.sub}>The plan was to {n.plan}</Text> : null}
        </>
      )}
    </View>
  );
}

function VoteBlock({ v, roundIndex, roleAt }: { v: VoteRound; roundIndex: number; roleAt: Model["roleAt"] }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const b = v.vote;
  let icon: IconName = "remove-circle-outline";
  let line: ReactNode;
  let role: Role | null = null;
  if (b.tie && b.revote_ids?.length && b.round !== 2 && v.round !== 2) {
    icon = "git-compare-outline";
    const names = (b.revote_names ?? []).filter(Boolean).join(" and ");
    line = names ? `Tied — a revote between ${names}` : "Tied — a revote followed";
  } else if (b.tie || !b.target_id) {
    line = v.round === 2 ? "Tied again — nobody banished" : "Tied — nobody banished";
  } else if (b.already_dead) {
    line = `${b.name} got the most votes (already out)`;
  } else if (b.eliminated) {
    icon = "exit-outline";
    line = (
      <>
        <Text style={styles.strong}>{b.name}</Text> was banished
      </>
    );
    role = b.role ?? roleAt(b.target_id, roundIndex);
  } else {
    line = (
      <>
        <Text style={styles.strong}>{b.name}</Text> lost a life
      </>
    );
  }
  const tally = b.tally ?? [];
  const max = Math.max(1, ...tally.map((t) => t.votes));
  const ballots = [...v.ballots].sort((x, y) => (x.voter_name ?? "").localeCompare(y.voter_name ?? ""));
  return (
    <View style={styles.voteBlock} testID={`story-vote-${v.key}`}>
      {v.title ? (
        <View style={styles.voteTitleRow}>
          <Ionicons name={v.round === 2 ? "refresh" : "git-compare-outline"} size={16} color={colors.onBrandTertiary} />
          <Text style={styles.voteTitle}>{v.title}</Text>
        </View>
      ) : null}
      <View style={styles.outcome}>
        <Ionicons name={icon} size={22} color={colors.brand} style={{ marginTop: 2 }} />
        <View style={{ flex: 1, gap: spacing.xs }}>
          <Text style={styles.main}>{line}</Text>
          {role ? <RoleChip role={role} testID={`story-banish-role-${v.key}`} /> : null}
          {role && b.role_hidden ? <Text style={styles.sub}>Their allegiance was kept secret at the time.</Text> : null}
        </View>
      </View>

      {tally.length ? (
        <View style={styles.bars}>
          {tally.map((t) => {
            const traitor = roleAt(t.player_id, roundIndex) === "traitor";
            const top = t.player_id === b.target_id || (b.tie && t.votes === max);
            return (
              <View key={t.player_id} style={styles.barRow}>
                <View style={styles.barHead}>
                  <Text style={[styles.barName, traitor && { color: colors.traitor }]} numberOfLines={1}>
                    {t.name}
                  </Text>
                  <Text style={styles.barCount}>
                    {t.votes} vote{t.votes === 1 ? "" : "s"}
                  </Text>
                </View>
                <View style={styles.barTrack}>
                  <View style={{ flex: t.votes, backgroundColor: top ? colors.brand : colors.brandSecondary, borderRadius: radius.pill }} />
                  <View style={{ flex: Math.max(0, max - t.votes) }} />
                </View>
              </View>
            );
          })}
        </View>
      ) : null}

      {ballots.length ? (
        <View style={styles.ballots}>
          <Text style={styles.smallLabel}>Who voted for whom</Text>
          {ballots.map((e) => {
            const voterTraitor = roleAt(e.voter_id, roundIndex) === "traitor";
            const targetTraitor = roleAt(e.target_id, roundIndex) === "traitor";
            return (
              <View key={`${e.voter_id}-${e.target_id}`} style={styles.ballot}>
                <Text style={[styles.voter, voterTraitor && { color: colors.traitor }]} numberOfLines={1}>
                  {e.voter_name ?? "?"}
                </Text>
                <Ionicons name="arrow-forward" size={15} color={colors.muted} />
                <Text style={[styles.target, targetTraitor && { color: colors.traitor }]} numberOfLines={1}>
                  {e.target_name ?? "?"}
                </Text>
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

function Ending({ model }: { model: Model }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const w = model.story.winner;
  const accent = w === "traitors" ? colors.traitor : colors.brand;
  const traitors = model.cast.filter((p) => p.role === "traitor").map((p) => p.name);
  return (
    <View style={[styles.ending, { borderColor: accent }]} testID="story-ending">
      <LinearGradient colors={[`${accent}40`, colors.surfaceSecondary]} style={styles.fill} />
      <Ionicons name="trophy" size={34} color={accent} />
      <Text style={[styles.endingTitle, { color: accent }]}>{winnerText(w)}</Text>
      {model.endText ? <Text style={styles.endingText}>{model.endText}</Text> : null}
      {traitors.length ? (
        <Text style={styles.endingText}>
          The Traitors: <Text style={{ color: colors.traitor, fontWeight: "800" }}>{traitors.join(", ")}</Text>
        </Text>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------- chat and log

function GroupLabel({ label, tone }: { label: string; tone: "traitor" | "gold" }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const c = tone === "traitor" ? colors.traitor : colors.brand;
  return (
    <View style={styles.groupLabel}>
      <View style={[styles.groupLine, { backgroundColor: `${c}55` }]} />
      <Text style={[styles.groupLabelText, { color: c }]}>{label}</Text>
      <View style={[styles.groupLine, { backgroundColor: `${c}55` }]} />
    </View>
  );
}

function ChatRow({ m }: { m: ChatMessage }) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <View style={styles.msg} testID="story-chat-message">
      <View style={styles.msgAvatar}>
        <Text style={styles.msgAvatarText}>{initialOf(m.from_name)}</Text>
      </View>
      <View style={styles.msgBubble}>
        <View style={styles.msgMeta}>
          <Text style={[styles.msgFrom, { color: colors.traitor }]} numberOfLines={1}>
            {m.from_name}
          </Text>
          <Text style={styles.msgTime}>{timeOf(m.t)}</Text>
        </View>
        <Text style={styles.msgText}>{m.text}</Text>
      </View>
    </View>
  );
}

function LogToggle({ count, open, onToggle }: { count: number; open: boolean; onToggle: () => void }) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <Pressable
      testID="story-log-toggle"
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      onPress={onToggle}
      style={({ pressed }) => [styles.logToggle, pressed && { opacity: 0.8 }]}
    >
      <Ionicons name="document-text-outline" size={22} color={colors.brand} />
      <View style={{ flex: 1 }}>
        <Text style={styles.logToggleTitle}>{open ? "Hide the full record" : "Show the full record"}</Text>
        <Text style={styles.logToggleSub}>
          {count} event{count === 1 ? "" : "s"}, every move in order
        </Text>
      </View>
      <Ionicons name={open ? "chevron-up" : "chevron-down"} size={22} color={colors.brand} />
    </Pressable>
  );
}

function LogRow({ e }: { e: ModeratorEvent }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const ic = EVENT_ICON[e.kind] ?? { icon: "ellipse-outline" as IconName, tone: "muted" as const };
  const tone = ic.tone === "traitor" ? colors.traitor : ic.tone === "gold" ? colors.brand : colors.muted;
  return (
    <View style={styles.logRow} testID={`story-log-${e.kind}`}>
      <Text style={styles.logTime}>{timeOf(e.t)}</Text>
      <Ionicons name={ic.icon} size={16} color={tone} style={{ marginTop: 3 }} />
      <Text style={[styles.logText, (e.kind === "stage" || e.kind === "end") && { color: colors.brand, fontWeight: "700" }]}>{e.text}</Text>
    </View>
  );
}

// ---------------------------------------------------------------- styles

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  scroll: { padding: spacing.lg },
  fill: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, padding: spacing.lg },
  centerText: { color: c.onSurfaceSecondary, fontSize: 17 },
  message: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, padding: spacing.lg },
  messageIcon: {
    width: 84,
    height: 84,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: c.brandTertiary,
    borderWidth: 1,
    borderColor: c.brandSecondary,
  },
  eyebrow15: { fontSize: 15 },
  emptyText: { color: c.onSurfaceTertiary, fontSize: 17, lineHeight: 24, marginBottom: spacing.lg },

  // hero
  hero: { borderRadius: radius.lg, overflow: "hidden", borderWidth: 1, minHeight: 320, backgroundColor: c.surfaceSecondary },
  heroBody: { padding: spacing.lg, paddingTop: spacing.xl, gap: spacing.sm, alignItems: "center" },
  heroIcon: { width: 84, height: 84, borderRadius: radius.pill, borderWidth: 2, alignItems: "center", justifyContent: "center", marginTop: spacing.sm },
  heroTitle: { fontFamily: fonts.display, fontSize: 46, lineHeight: 52, textAlign: "center" },
  heroSub: { color: c.onSurface, fontSize: 18, lineHeight: 25, textAlign: "center" },
  heroMeta: { color: c.onSurfaceTertiary, fontSize: 16, lineHeight: 22, textAlign: "center" },
  stats: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: spacing.sm, marginTop: spacing.sm },
  stat: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: "rgba(13,17,19,0.7)",
    borderWidth: 1,
    borderColor: c.border,
  },
  statValue: { fontSize: 17, fontWeight: "800" },
  statLabel: { color: c.onSurfaceSecondary, fontSize: 15 },

  // headings
  heading: { gap: spacing.xs, marginTop: spacing.xl, marginBottom: spacing.md },
  headingRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  headingTitle: { fontSize: 34, lineHeight: 40 },
  headingNote: { color: c.onSurfaceTertiary, fontSize: 15, lineHeight: 21 },

  // cast
  castGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  castCard: {
    flexGrow: 1,
    flexBasis: "46%",
    minWidth: 150,
    backgroundColor: c.surfaceSecondary,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.md,
    paddingTop: spacing.md + 4,
    gap: spacing.sm,
    overflow: "hidden",
  },
  castStripe: { position: "absolute", top: 0, left: 0, right: 0, height: 4 },
  castTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  avatar: { width: 52, height: 52, borderRadius: radius.pill, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  avatarText: { fontFamily: fonts.display, fontSize: 30, lineHeight: 34 },
  avatarBadge: {
    position: "absolute",
    right: -4,
    bottom: -4,
    width: 24,
    height: 24,
    borderRadius: radius.pill,
    borderWidth: 1,
    backgroundColor: c.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  castName: { color: c.onSurface, fontSize: 18, lineHeight: 23, fontWeight: "700" },
  roleRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  castRole: { fontSize: 16, fontWeight: "800", letterSpacing: 0.3 },
  badges: { gap: 6, alignItems: "flex-start" },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: 1,
    maxWidth: "100%",
  },
  badgeText: { fontSize: 15, fontWeight: "600", flexShrink: 1 },
  roleChip: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  roleChipText: { fontSize: 15, fontWeight: "800" },

  // timeline
  roundRow: { flexDirection: "row", gap: spacing.sm, paddingBottom: spacing.lg },
  rail: { width: 36, alignItems: "center" },
  railLine: { position: "absolute", top: 0, bottom: 0, width: 2, backgroundColor: c.brandSecondary },
  railDot: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: c.brandTertiary,
    borderWidth: 2,
    borderColor: c.brandSecondary,
    alignItems: "center",
    justifyContent: "center",
  },
  railNum: { color: c.brand, fontSize: 15, fontWeight: "800" },
  roundCard: {
    flex: 1,
    minWidth: 0,
    backgroundColor: c.surfaceSecondary,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: c.border,
    padding: spacing.md,
    gap: spacing.md,
  },
  roundHead: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.sm },
  labelPill: { backgroundColor: c.brandPrimary, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 5 },
  labelPillText: { color: c.onBrandPrimary, fontSize: 16, fontWeight: "800", letterSpacing: 0.3 },
  roundWin: { flexDirection: "row", alignItems: "center", gap: 4 },
  roundWinText: { fontSize: 16, fontWeight: "800" },
  panel: { backgroundColor: c.surfaceTertiary, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  nightPanel: { borderLeftWidth: 3, borderLeftColor: c.traitor },
  panelHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  panelLabel: { color: c.onSurfaceTertiary, fontSize: 15, letterSpacing: 1.5, textTransform: "uppercase", fontWeight: "700" },
  main: { color: c.onSurface, fontSize: 18, lineHeight: 25 },
  strong: { fontWeight: "800" },
  sub: { color: c.onSurfaceSecondary, fontSize: 16, lineHeight: 22 },
  method: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: c.traitor,
    backgroundColor: c.surfaceSecondary,
    padding: spacing.md,
    gap: 2,
  },
  methodLabel: { color: c.traitor, fontSize: 15, letterSpacing: 1.5, textTransform: "uppercase", fontWeight: "700" },
  methodText: { fontFamily: fonts.displaySemi, fontSize: 26, lineHeight: 31, color: c.onSurface },
  voteDivider: { borderTopWidth: 1, borderTopColor: c.border, paddingTop: spacing.md },
  voteBlock: { gap: spacing.sm },
  voteTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 5,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 3,
    backgroundColor: c.brandTertiary,
    borderWidth: 1,
    borderColor: c.brandSecondary,
  },
  voteTitle: { color: c.onBrandTertiary, fontSize: 15, fontWeight: "700" },
  outcome: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" },
  bars: { gap: spacing.sm },
  barRow: { gap: 4 },
  barHead: { flexDirection: "row", alignItems: "baseline", gap: spacing.sm },
  barName: { color: c.onSurface, fontSize: 16, fontWeight: "600", flex: 1 },
  barCount: { color: c.onSurfaceTertiary, fontSize: 15, fontWeight: "600" },
  barTrack: { flexDirection: "row", height: 10, borderRadius: radius.pill, backgroundColor: c.surfaceSecondary, overflow: "hidden" },
  ballots: { gap: 4, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: c.border },
  smallLabel: { color: c.onSurfaceTertiary, fontSize: 15, letterSpacing: 1.2, textTransform: "uppercase", fontWeight: "700", marginBottom: 2 },
  ballot: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 2 },
  voter: { color: c.onSurface, fontSize: 16, fontWeight: "600", flex: 1 },
  target: { color: c.onSurfaceSecondary, fontSize: 16, flex: 1, textAlign: "right" },
  ending: {
    borderRadius: radius.lg,
    borderWidth: 2,
    padding: spacing.lg,
    alignItems: "center",
    gap: spacing.sm,
    overflow: "hidden",
    backgroundColor: c.surfaceSecondary,
  },
  endingTitle: { fontFamily: fonts.display, fontSize: 38, lineHeight: 44, textAlign: "center" },
  endingText: { color: c.onSurfaceSecondary, fontSize: 17, lineHeight: 24, textAlign: "center" },

  // chat and log
  groupLabel: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.sm, marginBottom: spacing.sm },
  groupLine: { flex: 1, height: 1 },
  groupLabelText: { fontSize: 15, fontWeight: "800", letterSpacing: 0.5 },
  msg: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start", marginBottom: spacing.sm },
  msgAvatar: {
    width: 38,
    height: 38,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: c.traitor,
    backgroundColor: c.surfaceSecondary,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  msgAvatarText: { fontFamily: fonts.display, fontSize: 22, lineHeight: 26, color: c.traitor },
  msgBubble: {
    flex: 1,
    minWidth: 0,
    backgroundColor: c.surfaceSecondary,
    borderRadius: radius.lg,
    borderTopLeftRadius: radius.sm,
    borderWidth: 1,
    borderColor: c.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: 2,
  },
  msgMeta: { flexDirection: "row", alignItems: "baseline", gap: spacing.sm },
  msgFrom: { fontSize: 15, fontWeight: "800", flexShrink: 1 },
  msgTime: { color: c.muted, fontSize: 15 },
  msgText: { color: c.onSurface, fontSize: 17, lineHeight: 24 },
  logToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: 64,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: c.brandSecondary,
    backgroundColor: c.surfaceSecondary,
    marginBottom: spacing.sm,
  },
  logToggleTitle: { color: c.onSurface, fontSize: 17, fontWeight: "700" },
  logToggleSub: { color: c.onSurfaceTertiary, fontSize: 15 },
  logRow: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start", paddingVertical: 3 },
  logTime: { color: c.muted, fontSize: 15, width: 48, fontVariant: ["tabular-nums"] },
  logText: { color: c.onSurfaceSecondary, fontSize: 15, lineHeight: 21, flex: 1 },
  footer: { marginTop: spacing.xl },
}));
