import * as Linking from "expo-linking";
import { Share } from "react-native";

/**
 * A link that opens the app on the Join screen with the code pre-filled, so a
 * recipient can tap (or scan the QR) and join straight away. On the web build
 * this is the site's own URL; on a native build it falls back to the app's
 * deep-link scheme.
 */
export function inviteLink(code: string): string {
  if (typeof window !== "undefined" && window.location?.origin) {
    return `${window.location.origin}/join?code=${encodeURIComponent(code)}`;
  }
  return Linking.createURL("join", { queryParams: { code } });
}

export function inviteMessage(code: string): string {
  return `Join our Traitors game! Tap to join: ${inviteLink(code)}  (or enter code ${code} in the app)`;
}

/** Open WhatsApp (app or web) with the invite pre-written. */
export async function shareToWhatsApp(code: string): Promise<void> {
  const url = `https://wa.me/?text=${encodeURIComponent(inviteMessage(code))}`;
  await Linking.openURL(url);
}

/** The OS share sheet (AirDrop, Messages, etc.); a no-op that resolves if cancelled. */
export async function shareInvite(code: string): Promise<void> {
  try {
    await Share.share({ message: inviteMessage(code) });
  } catch {
    // cancelled or unsupported (e.g. some web browsers) — the code is on screen anyway
  }
}
