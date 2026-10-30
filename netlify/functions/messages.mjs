// Customer text messages for the admin "Messages" tab (needs x-admin-key, same password as the Rug Manager).
// Texts only for now: texts to the gallery number (980-577-2764) and website chat (the chat widget replies by text).
// Shows ONLY customer messages plus replies sent from this tab. Hidden: marketing blasts, confirmations, auto-replies,
// anyone who replied STOP, the team's alert texts, and appointment bookings (those stay in the Appointments tab).
//
// GET  /api/messages              -> { conversations: [...], unread }
// GET  /api/messages?id=CONV_ID   -> { conversation, messages: [...] }   (also marks it read)
// POST /api/messages {action:"reply", id, message} -> sends a text from the gallery number
import { getStore } from "@netlify/blobs";
import { isAdmin, json } from "../lib/rugstore.mjs";

const GHL_BASE = "https://services.leadconnectorhq.com";
const LOCATION_ID = process.env.PRG_GHL_LOCATION_ID || "SEUOenwNjKokn5Nnb0cU";
const TOKEN = process.env.PRG_GHL_TOKEN;
const TEAM = (process.env.PRG_NOTIFY_NUMBERS || "9802882538,9803783162,7045600318")
  .split(",").map((p) => p.replace(/\D/g, "").slice(-10)).filter((p) => p.length === 10);

const headers = () => ({ Authorization: `Bearer ${TOKEN}`, Version: "2021-07-28", Accept: "application/json", "Content-Type": "application/json" });
const store = () => getStore({ name: "prg-messages", consistency: "strong" });
const last10 = (p) => String(p || "").replace(/\D/g, "").slice(-10);
const ts = (v) => (typeof v === "number" ? v : Date.parse(v || "") || 0);
const TEXTY = /SMS|WEBCHAT|LIVE_CHAT/i;
// A "name" that is just the phone number (any formatting) is not a name.
const realName = (n, phone) => { n = String(n || "").trim(); return !n || (last10(n).length === 10 && last10(n) === last10(phone)) ? "" : n; };

function channel(t) {
  t = String(t || "").toUpperCase();
  return t.includes("WEBCHAT") || t.includes("LIVE_CHAT") ? "Website chat" : t.includes("SMS") ? "Text" : "";
}

async function ghl(path, opts = {}) {
  const r = await fetch(GHL_BASE + path, { ...opts, headers: headers() });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, j };
}

// Opt-out / carrier keywords: never count as a customer message.
const KEYWORD = /^\s*(stop|stopall|unsubscribe|cancel|end|quit|help|info|start|unstop|yes)\s*[.!]*\s*$/i;
const STOPWORD = /^\s*(stop|stopall|unsubscribe|cancel|end|quit)\s*[.!]*\s*$/i;
const RESTART = /^\s*(start|unstop|yes)\s*[.!]*\s*$/i;
// Hidden numbers besides the team's alert numbers (Amy's own phone, used for testing).
const HIDDEN = ["3154800680"];
const hiddenPhone = (p) => TEAM.includes(last10(p)) || HIDDEN.includes(last10(p));

async function readJSON(key) { return (await store().get(key, { type: "json" }).catch(() => null)) || {}; }

// One conversation's texts, cleaned up:
//  - customer messages (inbound), minus STOP/HELP-type keywords
//  - outgoing texts ONLY if they were sent from this Messages tab (no blasts, confirmations or auto-replies)
async function textsFor(id, sentIds) {
  const m = await ghl(`/conversations/${encodeURIComponent(id)}/messages?limit=100`);
  const raw = (m.j.messages && m.j.messages.messages) || m.j.messages || [];
  const all = (Array.isArray(raw) ? raw : [])
    .filter((x) => TEXTY.test(x.messageType || "") && String(x.body || "").trim())
    .map((x) => ({
      id: x.id,
      from: String(x.direction || "").toLowerCase() === "inbound" ? "customer" : "gallery",
      body: String(x.body),
      at: ts(x.dateAdded),
      channel: channel(x.messageType),
      status: x.status || "",
    }))
    .sort((a, b) => a.at - b.at);
  // Opted out = their latest STOP/START-type keyword is a STOP.
  let optedOut = false;
  for (const x of all) if (x.from === "customer") { if (STOPWORD.test(x.body)) optedOut = true; else if (RESTART.test(x.body)) optedOut = false; }
  const sent = new Set(sentIds || []);
  const messages = all.filter((x) => (x.from === "customer" ? !KEYWORD.test(x.body) : sent.has(x.id)));
  return { ok: m.ok, optedOut, messages };
}

// Conversations where a customer has texted us (and hasn't opted out).
async function listConversations() {
  const s = store();
  const known = await readJSON("has-inbound");
  const sentMap = await readJSON("sent");
  const watch = (await getStore({ name: "prg-inbox-watch", consistency: "strong" }).get("state-v2", { type: "json" }).catch(() => null)) || {};
  const watched = { ...(watch.seen || {}), ...(watch.acked || {}) };

  const q = `/conversations/search?locationId=${LOCATION_ID}&sortBy=last_message_date&sort=desc&limit=100`;
  const { ok, status, j } = await ghl(q);
  if (!ok) throw new Error(`Could not reach the inbox (${status}).`);

  const candidates = (j.conversations || []).filter((c) => {
    if (!c.phone || hiddenPhone(c.phone)) return false;
    if ((c.tags || []).some((t) => /internal notifications/i.test(t))) return false;
    const inbound = String(c.lastMessageDirection || "").toLowerCase() === "inbound";
    return known[c.id] || watched[c.id] || (inbound && TEXTY.test(c.lastMessageType || ""));
  }).slice(0, 40);

  const checked = await Promise.all(candidates.map(async (c) => {
    try { return { c, t: await textsFor(c.id, sentMap[c.id]) }; } catch (_) { return null; }
  }));

  let changed = false;
  const out = [];
  for (const row of checked) {
    if (!row || !row.t.ok) continue;
    const { c, t } = row;
    const fromCustomer = t.messages.filter((x) => x.from === "customer");
    if (!fromCustomer.length || t.optedOut) continue;
    if (!known[c.id]) { known[c.id] = Date.now(); changed = true; }
    const lastIn = fromCustomer[fromCustomer.length - 1];
    const lastAny = t.messages[t.messages.length - 1];
    out.push({
      id: c.id,
      contactId: c.contactId,
      name: realName(c.fullName || c.contactName, c.phone),
      phone: c.phone,
      last: lastIn.body.slice(0, 200),
      lastAt: lastIn.at,
      replied: lastAny.from === "gallery",
      channel: lastIn.channel || "Text",
      unread: Number(c.unreadCount) || 0,
    });
  }
  out.sort((a, b) => b.lastAt - a.lastAt);
  if (changed) await s.setJSON("has-inbound", known).catch(() => {});
  return out;
}

async function thread(id) {
  const conv = await ghl(`/conversations/${encodeURIComponent(id)}`);
  if (!conv.ok) return null;
  const c = conv.j.conversation || conv.j;
  if (hiddenPhone(c.phone)) return null;
  const sentMap = await readJSON("sent");
  const t = await textsFor(id, sentMap[id]);
  if (t.optedOut) return null;
  // Mark read in the CRM so the unread dot clears.
  if (Number(c.unreadCount) > 0) await ghl(`/conversations/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify({ locationId: LOCATION_ID, unreadCount: 0 }) }).catch(() => {});
  let name = (c.fullName || c.contactName || "").trim();
  let phone = c.phone || "";
  if ((!name || !phone) && c.contactId) {
    const ct = await ghl(`/contacts/${encodeURIComponent(c.contactId)}`);
    const k = ct.j.contact || {};
    name = name || [k.firstName, k.lastName].filter(Boolean).join(" ");
    phone = phone || k.phone || "";
  }
  return { conversation: { id, contactId: c.contactId, name: realName(name, phone), phone }, messages: t.messages };
}

export default async (req) => {
  if (!isAdmin(req)) return json({ error: "unauthorized" }, 401);
  if (!TOKEN) return json({ error: "Messages are not set up yet." }, 500);

  if (req.method === "GET") {
    const id = new URL(req.url).searchParams.get("id");
    try {
      if (id) {
        const t = await thread(id);
        return t ? json(t) : json({ error: "That conversation was not found." }, 404);
      }
      const conversations = await listConversations();
      return json({ conversations, unread: conversations.filter((c) => c.unread > 0).length });
    } catch (e) {
      return json({ error: String(e.message || e) }, 502);
    }
  }

  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  let body;
  try { body = await req.json(); } catch { return json({ error: "bad_request" }, 400); }
  if (body.action !== "reply") return json({ error: "unknown_action" }, 400);
  const message = String(body.message || "").trim();
  if (!message) return json({ error: "Type a message first." }, 400);
  if (message.length > 640) return json({ error: "That's a bit long for a text. Please keep it under 640 characters." }, 400);

  const conv = await ghl(`/conversations/${encodeURIComponent(String(body.id || ""))}`);
  const c = conv.ok ? (conv.j.conversation || conv.j) : null;
  if (!c || !c.contactId) return json({ error: "That conversation was not found." }, 404);
  if (hiddenPhone(c.phone)) return json({ error: "That conversation was not found." }, 404);

  const sent = await ghl(`/conversations/messages`, { method: "POST", body: JSON.stringify({ type: "SMS", contactId: c.contactId, message }) });
  if (!sent.ok) {
    const why = JSON.stringify(sent.j || {});
    const dnd = /dnd|do not disturb|opted out|unsubscribed/i.test(why);
    return json({ error: dnd ? "This customer has opted out of texts (they replied STOP), so we can't text them. Please call or email instead." : "The text didn't send. Please try again in a minute." }, 502);
  }
  // Remember this reply so it shows in the thread (other outgoing texts stay hidden).
  const msgId = sent.j.messageId || sent.j.id || "";
  const convId = String(body.id);
  if (msgId) {
    const sentMap = await readJSON("sent");
    sentMap[convId] = [...(sentMap[convId] || []), msgId].slice(-200);
    await store().setJSON("sent", sentMap).catch(() => {});
  }
  return json({ ok: true, message: { id: msgId, from: "gallery", body: message, at: Date.now(), channel: "Text", status: "sent" } });
};

export const config = { path: "/api/messages" };
