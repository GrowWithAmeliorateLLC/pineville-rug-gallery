// Every 5 minutes: text the team about new customer messages in GHL (chat + text replies).
import { runWatch } from "../lib/inboxwatch.mjs";

export default async () => {
  const r = await runWatch().catch((e) => ({ ok: false, error: String(e && e.message || e) }));
  console.log("inbox-watch", JSON.stringify(r));
  return new Response(null, { status: 204 });
};

export const config = { schedule: "*/5 * * * *" };
