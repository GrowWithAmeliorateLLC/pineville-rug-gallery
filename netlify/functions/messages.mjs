// Customer messages for the admin "Messages" tab (needs x-admin-key, same password as the Rug Manager).
// Shows texts to the gallery number (980-577-2764), website chat (the chat widget replies by text),
// and email replies from customers (e.g. replies to the sale emails).
// Shows ONLY customer messages plus replies sent from this tab. Hidden: marketing blasts and campaign emails,
// confirmations, auto-replies we send, anyone who replied STOP/unsubscribe, the team's alert texts,
// our own test messages, and appointment bookings (those stay in the Appointments tab).
//
// GET  /api/messages              -> { conversations: [...], unread }
// GET  /api/messages?id=CONV_ID   -> { conversation, messages: [...] }   (also marks it read)
// POST /api/messages {action:"reply", id, message} -> replies the way the customer last wrote in:
//      by email if their latest message was an email (or they have no phone), otherwise by text.
import { getStore } from "@netlify/blobs";
import { isAdmin, json } from "../lib/rugstore.mjs";

const GHL_BASE = "https://services.leadconnectorhq.com";
const LOCATION_ID = process.env.PRG_GHL_LOCATION_ID || "SEUOenwNjKokn5Nnb0cU";
const TOKEN = process.env.PRG_GHL_TOKEN;
const EMAIL_FROM = process.env.PRG_EMAIL_FROM || "renee@pinevilleruggallery.com";
const TEAM = (process.env.PRG_NOTIFY_NUMBERS || "9802882538,9803783162,7045600318")
  .split(",").map((p) => p.replace(/\D/g, "").slice(-10)).filter((p) => p.length === 10);

const headers = () => ({ Authorization: `Bearer ${TOKEN}`, Version: "2021-07-28", Accept: "application/json", "Content-Type": "application/json" });
const store = () => getStore({ name: "prg-messages", consistency: "strong" });
const last10 = (p) => String(p || "").replace(/\D/g, "").slice(-10);
const ts = (v) => (typeof v === "number" ? v : Date.parse(v || "") || 0);
const TEXTY = /SMS|WEBCHAT|LIVE_CHAT/i;
const EMAILY = /EMAIL/i;
const SHOWN = /SMS|WEBCHAT|LIVE_CHAT|EMAIL/i;
// A "name" that is just the phone number (any formatting) is not a name.
const realName = (n, phone) => { n = String(n || "").trim(); return !n || (last10(n).length === 10 && last10(n) === last10(phone)) ? "" : n; };

function channel(t) {
  t = String(t || "").toUpperCase();
  return t.includes("WEBCHAT") || t.includes("LIVE_CHAT") ? "Website chat" : t.includes("SMS") ? "Text" : t.includes("EMAIL") ? "Email" : "";
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
// Our own test messages ("TEST from Ameliorate: ...") never show.
const TESTMSG = /^\s*TEST from Ameliorate/i;
// Hidden numbers besides the team's alert numbers (Amy's own phone, used for testing).
const HIDDEN = ["3154800680"];
const hiddenPhone = (p) => TEAM.includes(last10(p)) || HIDDEN.includes(last10(p));

async function readJSON(key) { return (await store().get(key, { type: "json" }).catch(() => null)) || {}; }

// Email HTML -> plain text, without the quoted original ("On ... wrote:", "From: ...").
function emailText(s) {
  let t = String(s || "")
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<blockquote[\s\S]*$/i, " ")
    .replace(/<div[^>]*(gmail_quote|divRplyFwdMsg|ms-outlook)[\s\S]*$/i, " ")
    .replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|tr|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
  const cut = t.search(/^\s*(On .{5,200}wrote:|-{2,}\s*Original Message|_{5,}|From:\s.+|Sent from my |Get Outlook for )/im);
  if (cut > 0) t = t.slice(0, cut);
  return t.replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim().slice(0, 2000);
}

// Email messages in a conversation list often come without the body; fetch it when needed.
async function emailBody(x) {
  if (String(x.body || "").trim()) return emailText(x.body);
  const ids = (x.meta && x.meta.email && x.meta.email.messageIds) || [];
  const mid = ids[ids.length - 1] || x.id;
  const r = await ghl(`/conversations/messages/email/${encodeURIComponent(mid)}`).catch(() => null);
  const e = (r && r.ok && (r.j.emailMessage || r.j)) || {};
  return emailText(e.body || e.html || e.text || "");
}

// One conversation's messages, cleaned up:
//  - customer messages (inbound texts, chats and emails), minus STOP/unsubscribe-type keywords and our tests
//  - outgoing messages ONLY if they were sent from this Messages tab (no blasts, campaign emails or auto-replies)
async function textsFor(id, sentIds) {
  const m = await ghl(`/conversations/${encodeURIComponent(id)}/messages?limit=100`);
  const raw = (m.j.messages && m.j.messages.messages) || m.j.messages || [];
  const sent = new Set(sentIds || []);
  const rows = (Array.isArray(raw) ? raw : []).filter((x) => SHOWN.test(x.messageType || ""));
  const all = (await Promise.all(rows.map(async (x) => {
    const inbound = String(x.direction || "").toLowerCase() === "inbound";
    const isEmail = EMAILY.test(x.messageType || "");
    // Only fetch email bodies we will actually show (customer emails, or our replies from this tab).
    if (isEmail && !inbound && !sent.has(x.id)) return null;
    const body = isEmail ? await emailBody(x) : String(x.body || "");
    const photos = (Array.isArray(x.attachments) ? x.attachments : []).map((a) => (typeof a === "string" ? a : a && a.url) || "").filter((u) => /^https:\/\//.test(u));
    if (!body.trim() && !photos.length) return null;
    return {
      id: x.id,
      from: inbound ? "customer" : "gallery",
      body,
      photos,
      at: ts(x.dateAdded),
      channel: channel(x.messageType),
      subject: isEmail ? String((x.meta && x.meta.email && x.meta.email.subject) || x.subject || "") : "",
      status: x.status || "",
    };
  }))).filter(Boolean).sort((a, b) => a.at - b.at);
  // Opted out = their latest STOP/START-type keyword is a STOP.
  let optedOut = false;
  for (const x of all) if (x.from === "customer") { if (STOPWORD.test(x.body)) optedOut = true; else if (RESTART.test(x.body)) optedOut = false; }
  const messages = all.filter((x) => (x.from === "customer" ? !KEYWORD.test(x.body) && !TESTMSG.test(x.body) : sent.has(x.id)));
  return { ok: m.ok, optedOut, messages };
}

// How a reply should go out: the way the customer last wrote in. No phone = email.
function replyWay(messages, phone) {
  const lastIn = [...messages].reverse().find((x) => x.from === "customer");
  if (!last10(phone) || last10(phone).length !== 10) return "email";
  return lastIn && lastIn.channel === "Email" ? "email" : "text";
}

// Conversations where a customer has written to us (and hasn't opted out).
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
    if (!c.phone && !c.email) return false;
    if (c.phone && hiddenPhone(c.phone)) return false;
    if ((c.tags || []).some((t) => /internal notifications/i.test(t))) return false;
    const inbound = String(c.lastMessageDirection || "").toLowerCase() === "inbound";
    return known[c.id] || watched[c.id] || (inbound && SHOWN.test(c.lastMessageType || ""));
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
      phone: c.phone || "",
      email: c.email || "",
      last: (lastIn.body || (lastIn.photos && lastIn.photos.length ? "📷 Sent a photo" : "")).replace(/\s+/g, " ").slice(0, 200),
      lastAt: lastIn.at,
      replied: lastAny.from === "gallery",
      channel: lastIn.channel || "Text",
      replyBy: replyWay(t.messages, c.phone),
      unread: Number(c.unreadCount) || 0,
    });
  }
  out.sort((a, b) => b.lastAt - a.lastAt);
  if (changed) await s.setJSON("has-inbound", known).catch(() => {});
  return out;
}

async function contactInfo(c) {
  let name = (c.fullName || c.contactName || "").trim();
  let phone = c.phone || "";
  let email = c.email || "";
  if ((!name || !phone || !email) && c.contactId) {
    const ct = await ghl(`/contacts/${encodeURIComponent(c.contactId)}`);
    const k = ct.j.contact || {};
    name = name || [k.firstName, k.lastName].filter(Boolean).join(" ");
    phone = phone || k.phone || "";
    email = email || k.email || "";
  }
  return { name, phone, email };
}

async function thread(id) {
  const conv = await ghl(`/conversations/${encodeURIComponent(id)}`);
  if (!conv.ok) return null;
  const c = conv.j.conversation || conv.j;
  if (c.phone && hiddenPhone(c.phone)) return null;
  const sentMap = await readJSON("sent");
  const t = await textsFor(id, sentMap[id]);
  if (t.optedOut) return null;
  // Mark read in the CRM so the unread dot clears.
  if (Number(c.unreadCount) > 0) await ghl(`/conversations/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify({ locationId: LOCATION_ID, unreadCount: 0 }) }).catch(() => {});
  const { name, phone, email } = await contactInfo(c);
  return { conversation: { id, contactId: c.contactId, name: realName(name, phone), phone, email, replyBy: replyWay(t.messages, phone) }, messages: t.messages };
}

const escHtml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

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

  const convId = String(body.id || "");
  const conv = await ghl(`/conversations/${encodeURIComponent(convId)}`);
  const c = conv.ok ? (conv.j.conversation || conv.j) : null;
  if (!c || !c.contactId) return json({ error: "That conversation was not found." }, 404);
  if (c.phone && hiddenPhone(c.phone)) return json({ error: "That conversation was not found." }, 404);

  const sentMap = await readJSON("sent");
  const t = await textsFor(convId, sentMap[convId]);
  const { phone, email } = await contactInfo(c);
  const way = replyWay(t.messages, phone);

  let sent;
  if (way === "email") {
    if (!email) return json({ error: "We don't have an email address for this customer. Please call them instead." }, 400);
    if (message.length > 5000) return json({ error: "That's a bit long. Please keep it under 5,000 characters." }, 400);
    const lastEmail = [...t.messages].reverse().find((x) => x.from === "customer" && x.channel === "Email");
    const subj = (lastEmail && lastEmail.subject) || "Pineville Rug Gallery";
    const payload = {
      type: "Email",
      contactId: c.contactId,
      emailFrom: EMAIL_FROM,
      emailTo: email,
      subject: /^re:/i.test(subj) ? subj : `Re: ${subj}`,
      html: `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5">${escHtml(message).replace(/\n/g, "<br>")}</div>`,
      message,
    };
    if (lastEmail) payload.replyMessageId = lastEmail.id;
    sent = await ghl(`/conversations/messages`, { method: "POST", body: JSON.stringify(payload) });
    if (!sent.ok) {
      const why = JSON.stringify(sent.j || {});
      const unsub = /dnd|unsubscribed|opted out/i.test(why);
      return json({ error: unsub ? "This customer has unsubscribed from email. Please call them instead." : "The email didn't send. Please try again in a minute." }, 502);
    }
  } else {
    if (message.length > 640) return json({ error: "That's a bit long for a text. Please keep it under 640 characters." }, 400);
    sent = await ghl(`/conversations/messages`, { method: "POST", body: JSON.stringify({ type: "SMS", contactId: c.contactId, message }) });
    if (!sent.ok) {
      const why = JSON.stringify(sent.j || {});
      const dnd = /dnd|do not disturb|opted out|unsubscribed/i.test(why);
      return json({ error: dnd ? "This customer has opted out of texts (they replied STOP), so we can't text them. Please call or email instead." : "The text didn't send. Please try again in a minute." }, 502);
    }
  }
  // Remember this reply so it shows in the thread (other outgoing messages stay hidden).
  const msgId = sent.j.messageId || sent.j.id || "";
  if (msgId) {
    const fresh = await readJSON("sent");
    fresh[convId] = [...(fresh[convId] || []), msgId].slice(-200);
    await store().setJSON("sent", fresh).catch(() => {});
  }
  return json({ ok: true, message: { id: msgId, from: "gallery", body: message, at: Date.now(), channel: way === "email" ? "Email" : "Text", status: "sent" } });
};

export const config = { path: "/api/messages" };
