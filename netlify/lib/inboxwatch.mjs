// Inbox watcher: texts the team when a customer sends a NEW message into GHL
// (website chat or a text reply to 980-577-2764), since nobody at Pineville has a GHL login yet.
// Used by inbox-watch.mjs (runs every 5 min) and inbox-watch-check.mjs (read-only health check).
import { getStore } from "@netlify/blobs";

const GHL_BASE = "https://services.leadconnectorhq.com";
const LOCATION_ID = process.env.PRG_GHL_LOCATION_ID || "SEUOenwNjKokn5Nnb0cU";
const TOKEN = process.env.PRG_GHL_TOKEN;
const NOTIFY_NUMBERS = (process.env.PRG_NOTIFY_NUMBERS || "9802882538,9803783162,7045600318")
  .split(",").map((p) => p.replace(/\D/g, "").slice(-10)).filter((p) => p.length === 10);

const headers = () => ({ Authorization: `Bearer ${TOKEN}`, Version: "2021-07-28", Accept: "application/json", "Content-Type": "application/json" });
const store = () => getStore({ name: "prg-inbox-watch", consistency: "strong" });
const last10 = (p) => String(p || "").replace(/\D/g, "").slice(-10);
const ts = (v) => (typeof v === "number" ? v : Date.parse(v || "") || 0);

export async function searchConversations() {
  const u = new URL(`${GHL_BASE}/conversations/search`);
  u.searchParams.set("locationId", LOCATION_ID);
  u.searchParams.set("sortBy", "last_message_date");
  u.searchParams.set("sort", "desc");
  u.searchParams.set("limit", "30");
  const r = await fetch(u, { headers: headers() });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, conversations: j.conversations || [], error: r.ok ? null : j };
}

// Messages from customers (not the team) that came in after `since`.
export function newInbound(conversations, seen, since) {
  return conversations.filter((c) => {
    const t = ts(c.lastMessageDate);
    if (String(c.lastMessageDirection || "").toLowerCase() !== "inbound") return false;
    if (t <= since || t <= (seen[c.id] || 0)) return false;
    if (NOTIFY_NUMBERS.includes(last10(c.phone))) return false; // team member replying to an alert
    return true;
  });
}

function channel(c) {
  const t = String(c.lastMessageType || "").toUpperCase();
  return t.includes("LIVE_CHAT") || t.includes("WEBCHAT") ? "website chat" : t.includes("SMS") ? "text" : t.includes("EMAIL") ? "email" : "message";
}

function etHour() {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hourCycle: "h23" }).format(new Date()));
}

async function sendSms(contactId, message) {
  const r = await fetch(`${GHL_BASE}/conversations/messages`, { method: "POST", headers: headers(), body: JSON.stringify({ type: "SMS", contactId, message }) });
  return r.ok;
}
async function teamContactId(phone10) {
  const r = await fetch(`${GHL_BASE}/contacts/upsert`, { method: "POST", headers: headers(), body: JSON.stringify({ locationId: LOCATION_ID, phone: `+1${phone10}`, tags: ["Internal Notifications"] }) });
  const j = await r.json().catch(() => ({}));
  return j?.contact?.id || j?.id || null;
}

export async function runWatch() {
  if (!TOKEN) return { ok: false, reason: "no token" };
  const s = store();
  const state = (await s.get("state", { type: "json" }).catch(() => null)) || {};
  const now = Date.now();
  // First run: start watching from now, so old conversations never trigger alerts.
  if (!state.since) { await s.setJSON("state", { since: now, seen: {} }); return { ok: true, initialized: true }; }
  // Quiet hours 9 PM - 8 AM Eastern: hold alerts until morning.
  const h = etHour();
  if (h >= 21 || h < 8) return { ok: true, quietHours: true };

  const res = await searchConversations();
  if (!res.ok) return { ok: false, status: res.status };
  const fresh = newInbound(res.conversations, state.seen || {}, state.since);
  const seen = { ...(state.seen || {}) };
  let sent = 0;
  if (fresh.length) {
    const ids = [];
    for (const p of NOTIFY_NUMBERS) { const id = await teamContactId(p); if (id) ids.push(id); }
    for (const c of fresh.slice(0, 5)) {
      const who = c.fullName || c.contactName || c.phone || "A customer";
      const body = String(c.lastMessageBody || "").replace(/\s+/g, " ").slice(0, 160);
      const msg = `New ${channel(c)} from ${who}${c.phone ? " (" + c.phone + ")" : ""}: "${body}" - Reply from the gallery inbox (LeadConnector app).`;
      for (const id of ids) if (await sendSms(id, msg)) sent++;
      seen[c.id] = ts(c.lastMessageDate);
    }
  }
  // Keep the seen map small.
  const keep = Object.entries(seen).sort((a, b) => b[1] - a[1]).slice(0, 200);
  await s.setJSON("state", { since: state.since, seen: Object.fromEntries(keep), lastRun: now });
  return { ok: true, newMessages: fresh.length, textsSent: sent };
}
