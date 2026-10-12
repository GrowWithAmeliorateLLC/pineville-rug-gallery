// Read-only health check for the inbox watcher: can our GHL key read conversations?
// Returns counts only (no names, numbers or message text). Sends nothing.
import { searchConversations } from "../lib/inboxwatch.mjs";

export default async () => {
  const r = await searchConversations().catch((e) => ({ ok: false, status: 0, conversations: [], error: String(e) }));
  const types = {};
  for (const c of r.conversations) { const k = `${c.lastMessageType || "?"}/${c.lastMessageDirection || "?"}`; types[k] = (types[k] || 0) + 1; }
  return Response.json({ canRead: r.ok, status: r.status, conversations: r.conversations.length, lastMessageTypes: types, error: r.ok ? undefined : r.error?.message || r.error });
};

export const config = { path: "/api/inbox-watch-check" };
