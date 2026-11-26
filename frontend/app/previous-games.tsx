import Ionicons from "@react-native-vector-icons/ionicons";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { type Href, useRouter } from "expo-router";
import { type ReactElement, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, ArchiveGame } from "@/src/api";
import { ScreenHeader } from "@/src/components/screen-header";
import { Body, Button, Eyebrow, Title } from "@/src/components/ui";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

// Every finished game, newest first. Tapping one opens its whole story (app/story.tsx), which
// the server only publishes once that game is over.

// Cast so this file type-checks before the generated typed-routes list includes the new screen.
const storyHref = (code: string) => `/story?code=${encodeURIComponent(code)}` as Href;

function dateOf(t: string | null | undefined): string {
  if (!t) return "";
  const d = new Date(t);
  return isNaN(d.getTime()) ? "" : format(d, "EEE d MMM yyyy");
}

function timeValue(t: string | null | undefined): number {
  const v = t ? Date.parse(t) : NaN;
  return isNaN(v) ? 0 : v;
}

export default function PreviousGames() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [pulling, setPulling] = useState(false);
  const { data, isLoading, error, refetch, isRefetching } = useQuery({ queryKey: ["archive"], queryFn: api.archive });
  const games = useMemo(
    () => [...(data?.games ?? [])].sort((a, b) => timeValue(b.ended_at) - timeValue(a.ended_at)),
    [data],
  );

  const onRefresh = async () => {
    setPulling(true);
    try {
      await refetch();
    } finally {
      setPulling(false);
    }
  };

  const header = (
    <View style={styles.header}>
      <Eyebrow style={{ fontSize: 15 }}>The castle archive</Eyebrow>
      <Title>Previous games</Title>
      <Body>Every finished game, with the whole story — every role, every murder and every secret revealed.</Body>
    </View>
  );

  let empty: ReactElement | null = null;
  if (isLoading) {
    empty = (
      <View style={styles.center} testID="previous-games-loading">
        <ActivityIndicator color={colors.brand} size="large" />
      </View>
    );
  } else if (error) {
    empty = (
      <View style={styles.stateCard} testID="previous-games-error">
        <Ionicons name="cloud-offline-outline" size={32} color={colors.brand} />
        <Text style={styles.stateTitle}>Couldn&apos;t reach the castle</Text>
        <Text style={styles.stateText}>
          {error instanceof Error ? `${error.message}. ` : ""}Check your internet and try again.
        </Text>
        <Button
          testID="previous-games-retry-button"
          label="Try again"
          icon="refresh"
          variant="secondary"
          loading={isRefetching}
          onPress={() => refetch()}
          style={{ alignSelf: "stretch" }}
        />
      </View>
    );
  } else {
    empty = (
      <View style={styles.stateCard} testID="previous-games-empty">
        <Ionicons name="hourglass-outline" size={32} color={colors.brand} />
        <Text style={styles.stateTitle}>No finished games yet</Text>
        <Text style={styles.stateText}>
          When a game ends, its whole story is published here for everyone to look back on.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.root} testID="previous-games-screen">
      <ScreenHeader title="Previous games" testID="previous-games" />
      <FlatList
        data={error ? [] : games}
        keyExtractor={(g) => g.code}
        renderItem={({ item, index }) => (
          <GameCard game={item} index={index} onPress={() => router.push(storyHref(item.code))} />
        )}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        ItemSeparatorComponent={Separator}
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.xl }]}
        refreshControl={<RefreshControl refreshing={pulling} onRefresh={onRefresh} tintColor={colors.brand} colors={[colors.brand]} />}
        testID="previous-games-list"
      />
    </View>
  );
}

function Separator() {
  return <View style={{ height: spacing.md }} />;
}

function GameCard({ game, index, onPress }: { game: ArchiveGame; index: number; onPress: () => void }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const traitorsWin = game.winner === "traitors";
  const accent = traitorsWin ? colors.traitor : colors.brand;
  const title = traitorsWin ? "The Traitors won" : game.winner === "faithful" ? "The Faithful won" : "Game over";
  const ended = dateOf(game.ended_at);
  return (
    <Animated.View entering={FadeInDown.delay(Math.min(index, 8) * 60).duration(380)}>
      <Pressable
        testID={`previous-game-${game.code}`}
        accessibilityRole="button"
        accessibilityLabel={`${title}${ended ? `, ended ${ended}` : ""}. Open the whole story`}
        onPress={onPress}
        style={({ pressed }) => [styles.card, { borderColor: `${accent}88` }, pressed && { opacity: 0.85, transform: [{ scale: 0.99 }] }]}
      >
        <View style={[styles.stripe, { backgroundColor: accent }]} />
        <View style={[styles.icon, { borderColor: accent, backgroundColor: `${accent}22` }]}>
          <Ionicons name={traitorsWin ? "skull" : "shield-checkmark"} size={28} color={accent} />
        </View>
        <View style={styles.cardBody}>
          <Text style={[styles.winner, { color: accent }]} testID={`previous-game-winner-${game.code}`}>
            {title}
          </Text>
          {ended ? (
            <View style={styles.metaRow}>
              <Ionicons name="calendar-outline" size={17} color={colors.onSurfaceTertiary} />
              <Text style={styles.meta}>Ended {ended}</Text>
            </View>
          ) : null}
          <View style={styles.metaRow}>
            <Ionicons name="people-outline" size={17} color={colors.onSurfaceTertiary} />
            <Text style={styles.meta}>
              {game.players} player{game.players === 1 ? "" : "s"}
              {game.label ? ` · last round ${game.label}` : ""}
            </Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.open}>Read the whole story</Text>
            <Ionicons name="arrow-forward" size={17} color={colors.brand} />
          </View>
        </View>
        <Ionicons name="chevron-forward" size={24} color={colors.muted} />
      </Pressable>
    </Animated.View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  scroll: { padding: spacing.lg, flexGrow: 1 },
  header: { gap: spacing.sm, marginBottom: spacing.lg },
  center: { paddingVertical: spacing.xxl, alignItems: "center" },
  stateCard: {
    backgroundColor: c.surfaceSecondary,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: c.border,
    padding: spacing.lg,
    gap: spacing.sm,
    alignItems: "center",
  },
  stateTitle: { fontFamily: fonts.display, fontSize: 30, lineHeight: 36, color: c.onSurface, textAlign: "center" },
  stateText: { color: c.onSurfaceSecondary, fontSize: 17, lineHeight: 24, textAlign: "center", marginBottom: spacing.sm },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: c.surfaceSecondary,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.md,
    paddingLeft: spacing.md + 4,
    overflow: "hidden",
  },
  stripe: { position: "absolute", top: 0, bottom: 0, left: 0, width: 5 },
  icon: { width: 56, height: 56, borderRadius: radius.pill, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  cardBody: { flex: 1, minWidth: 0, gap: 4 },
  winner: { fontFamily: fonts.display, fontSize: 30, lineHeight: 34 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  meta: { color: c.onSurfaceSecondary, fontSize: 16, lineHeight: 22, flexShrink: 1 },
  open: { color: c.brand, fontSize: 16, fontWeight: "700" },
}));
