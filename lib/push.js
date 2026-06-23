import webpush from "web-push";

// Configure web push from VAPID env. If keys are absent, push is simply
// disabled (the in-app feed still works), so the app never crashes for
// want of credentials.
const PUB = process.env.VAPID_PUBLIC_KEY;
const PRIV = process.env.VAPID_PRIVATE_KEY;
const SUBJECT = process.env.VAPID_SUBJECT || "mailto:admin@toto.app";

let configured = false;
if (PUB && PRIV) {
  try { webpush.setVapidDetails(SUBJECT, PUB, PRIV); configured = true; }
  catch (e) { console.error("[push] VAPID config failed:", e.message); }
}

export function pushConfigured() { return configured; }
export function vapidPublicKey() { return PUB || null; }

// Send one push. Returns true | false | "gone" (expired subscription).
export async function sendPush(sub, payload) {
  if (!configured) return false;
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload)
    );
    return true;
  } catch (e) {
    if (e.statusCode === 404 || e.statusCode === 410) return "gone";
    return false;
  }
}
