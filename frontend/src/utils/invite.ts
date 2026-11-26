import * as Linking from "expo-linking";
import { Share } from "react-native";

/**
 * The link that opens the app. There are no join codes — one group plays one game at a
 * time, so the app simply offers to join the game in progress. On the web build this is
 * the site itself; on a native build it falls back to the app's deep-link scheme.
 */
export function inviteLink(): string {
  if (typeof window !== "undefined" && window.location?.origin) {
    return `${window.location.origin}/`;
  }
  return Linking.createURL("/");
}

export function inviteMessage(): string {
  return `Join our Traitors game! Tap to open it — it goes straight into the game: ${inviteLink()}`;
}

/** Open WhatsApp (app or web) with the invite pre-written. */
export async function shareToWhatsApp(): Promise<void> {
  const url = `https://wa.me/?text=${encodeURIComponent(inviteMessage())}`;
  await Linking.openURL(url);
}

/** The OS share sheet (AirDrop, Messages, etc.); a no-op that resolves if cancelled. */
export async function shareInvite(): Promise<void> {
  try {
    await Share.share({ message: inviteMessage() });
  } catch {
    // cancelled or unsupported (e.g. some web browsers) — the QR code is on screen anyway
  }
}
