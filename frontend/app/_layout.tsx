import { QueryClientProvider } from "@tanstack/react-query";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { ActivityIndicator, LogBox, StyleSheet, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";

import { ErrorBoundary } from "@/src/components/error-boundary";
import { queryClient } from "@/src/query-client";
import { colors } from "@/src/theme";

// Disable logbox errors etc so that users can see the app
// and agent works as expected.
LogBox.ignoreAllLogs(true);

export default function RootLayout() {
  const [loaded, error] = useFonts({
    "CormorantGaramond-Bold": require("../assets/fonts/CormorantGaramond-Bold.ttf"),
    "CormorantGaramond-SemiBold": require("../assets/fonts/CormorantGaramond-SemiBold.ttf"),
  });

  return (
    <GestureHandlerRootView style={styles.root}>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <KeyboardProvider>
            <StatusBar style="light" />
            {loaded || error ? (
              <Stack
                screenOptions={{
                  headerShown: false,
                  contentStyle: { backgroundColor: colors.surface },
                  animation: "fade",
                }}
              />
            ) : (
              <View style={styles.loading}>
                <ActivityIndicator color={colors.brand} size="large" />
              </View>
            )}
          </KeyboardProvider>
        </QueryClientProvider>
      </ErrorBoundary>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  loading: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
});
