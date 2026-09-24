// Appointment lead + booking handler.
//
// POST: the site's forms (Sales appointment, Cleaning/Repair, Trade). Enforces a
//   per-slot booking cap (default 3), upserts the contact into GoHighLevel,
//   records the requested slot + A2P SMS consent, and (until SMS/A2P is live)
//   sends EMAIL notifications: a confirmation to the customer + an internal alert
//   to the team — both via GHL's email API.
// GET:  ?form=sales|cleaning&date=YYYY-MM-DD -> per-slot booking counts (live availability).
//
// Env vars:
//   PRG_GHL_TOKEN        - GHL Private Integration token
//                          (needs: contacts.write/readonly + conversations/message.write for email)
//   PRG_GHL_LOCATION_ID  - optional; defaults below
//   PRG_NOTIFY_NUMBERS   - optional; cell(s) to text on a booking once SMS is live (placeholder below)
//   PRG_NOTIFY_EMAIL     - optional; internal email that gets the team alert (placeholder below)
//   PRG_EMAIL_FROM       - optional; From address for outgoing email

const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";
const LOCATION_ID = process.env.PRG_GHL_LOCATION_ID || "SEUOenwNjKokn5Nnb0cU";
const TOKEN = process.env.PRG_GHL_TOKEN;
const NOTIFY_NUMBERS = process.env.PRG_NOTIFY_NUMBERS || "3154800680";           // SMS (once A2P live)
const NOTIFY_EMAIL = process.env.PRG_NOTIFY_EMAIL || "hi@growwithameliorate.com"; // internal email (placeholder)
const EMAIL_FROM = process.env.PRG_EMAIL_FROM || "showroom@pinevilleruggallery.com";

const CAPS = { Sales: 3, Cleaning: 3 };
const SLOTS = {
  Sales: ["11:00 AM", "1:00 PM", "3:00 PM", "5:00 PM"],
  Cleaning: ["9:00–11:00 AM", "11:00 AM–1:00 PM", "1:00–3:00 PM", "3:00–5:00 PM"],
};
const typeFromForm = (f) => (String(f).toLowerCase() === "cleaning" ? "Cleaning" : "Sales");
const bkey = (t, d, s) => `${t}|${d}|${s}`;
const esc = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function getBlobStore() {
  try { const mod = await import("@netlify/blobs"); return mod.getStore("prg-bookings"); }
  catch (_) { return null; }
}
async function readCount(store, t, d, s) {
  if (!store) return 0;
  try { const v = await store.get(bkey(t, d, s), { consistency: "strong" }); return v ? parseInt(v, 10) || 0 : 0; }
  catch (_) { return 0; }
}

async function sendGhlEmail(contactId, subject, html) {
  try {
    const r = await fetch(`${GHL_BASE}/conversations/messages`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ type: "Email", contactId, subject, html, emailFrom: EMAIL_FROM }),
    });
    const t = await r.json().catch(() => ({}));
    return { status: r.status, ok: r.ok, detail: r.ok ? undefined : t };
  } catch (e) { return { status: 0, ok: false, detail: String(e && e.message || e) }; }
}
async function upsertContact(payload) {
  const r = await fetch(`${GHL_BASE}/contacts/upsert`, { method: "POST", headers: headers(), body: JSON.stringify(payload) });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, id: j?.contact?.id || j?.id || null, detail: j };
}

export default async (req) => {
  if (!TOKEN) return json({ error: "CRM not configured (missing PRG_GHL_TOKEN)" }, 500);

  if (req.method === "GET") {
    const u = new URL(req.url);
    const type = typeFromForm(u.searchParams.get("form"));
    const date = u.searchParams.get("date") || "";
    const slots = SLOTS[type] || [];
    const cap = CAPS[type] || 99;
    const counts = {};
    const store = date ? await getBlobStore() : null;
    if (date) for (const s of slots) counts[s] = await readCount(store, type, date, s);
    return json({ cap, counts });
  }

  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body;
  try { body = await req.json(); } catch { return json({ error: "Invalid request" }, 400); }

  if (body.company) return json({ ok: true }); // honeypot

  const name = (body.name || "").trim();
  const email = (body.email || "").trim();
  const phone = (body.phone || "").trim();
  if (!name || (!email && !phone)) return json({ error: "Missing required fields" }, 400);

  const parts = name.split(/\s+/);
  const firstName = parts.shift() || name;
  const lastName = parts.join(" ");

  const smsT = body.sms_transactional === true || body.sms_transactional === "1" || body.sms_transactional === "on";
  const smsM = body.sms_marketing === true || body.sms_marketing === "1" || body.sms_marketing === "on";

  const services = Array.isArray(body.services) ? body.services.filter(Boolean) : (body.services ? [body.services] : []);

  const apptType = (body.appt_type || "").trim();
  const apptDate = (body.appt_date || "").trim();
  let apptSlot = (body.appt_slot || "").trim();
  const apptCustom = (body.appt_custom_time || "").trim();
  if (apptCustom && /after 5|sunday|other/i.test(apptSlot)) apptSlot = `${apptSlot} — ${apptCustom}`;

  const isFixedSlot = !!(SLOTS[apptType] && SLOTS[apptType].includes(apptSlot));
  const store = (apptType && apptDate && isFixedSlot) ? await getBlobStore() : null;
  if (store) {
    const cap = CAPS[apptType] || 99;
    const cur = await readCount(store, apptType, apptDate, apptSlot);
    if (cur >= cap) return json({ error: "slot_full", message: "That time just filled — please choose another." }, 409);
  }

  const fulfillment = (body.fulfillment || "").trim();
  const isPickup = /pick/i.test(fulfillment);
  const isDropoff = /drop/i.test(fulfillment);

  const address1 = (body.address || "").trim();
  const city = (body.city || "").trim();
  const state = (body.state || "").trim();
  const postalCode = (body.zip || body.postalCode || "").trim();

  const companyName = (body.company_name || "").trim();
  const isTrade = body.form === "trade";

  const tags = ["Website Lead"];
  if (apptType) tags.push(`Appointment: ${apptType}`);
  services.forEach((s) => tags.push(`Interest: ${s}`));
  if (isTrade) tags.push("Trade Program Applicant");
  if (!services.length && !isTrade && !apptType) tags.push("Interest: General Inquiry");
  if (isPickup) tags.push("Fulfillment: Pickup");
  else if (isDropoff) tags.push("Fulfillment: Drop-off");
  if (smsT) tags.push("SMS Consent - Transactional");
  if (smsM) tags.push("SMS Consent - Marketing");

  const source = isTrade ? "Website - Trade Program" : apptType ? `Website - ${apptType} Appointment` : "Website - Inquiry";

  const contact = { locationId: LOCATION_ID, firstName, lastName, name, source, tags };
  if (email) contact.email = email;
  if (phone) contact.phone = phone;
  if (address1) contact.address1 = address1;
  if (city) contact.city = city;
  if (state) contact.state = state;
  if (postalCode) contact.postalCode = postalCode;
  if (companyName) contact.companyName = companyName;

  // 1) Upsert the contact.
  let up;
  try { up = await upsertContact(contact); }
  catch (e) { return json({ error: "CRM unreachable" }, 502); }
  if (!up.ok) return json({ error: "CRM upsert failed", status: up.status, detail: up.detail }, 502);
  const contactId = up.id;

  // 2) Reserve the slot.
  if (store) {
    try { const cur = await readCount(store, apptType, apptDate, apptSlot); await store.set(bkey(apptType, apptDate, apptSlot), String(cur + 1)); }
    catch (_) {}
  }

  // 3) Note.
  const addressLine = [address1, [city, state].filter(Boolean).join(", "), postalCode].filter(Boolean).join(" · ");
  const detailLines = [
    isTrade ? "TRADE PROGRAM APPLICATION" : "",
    apptType ? `Appointment type: ${apptType}` : "",
    apptDate ? `Requested date: ${apptDate}` : "",
    apptSlot ? `Requested time: ${apptSlot}` : "",
    companyName ? `Company: ${companyName}` : "",
    services.length ? `Interested in: ${services.join(", ")}` : "",
    fulfillment ? `Pickup or drop-off: ${isPickup ? "Pickup & delivery" : isDropoff ? "Drop-off at gallery" : fulfillment}` : "",
    addressLine ? `Address: ${addressLine}` : "",
    body.project ? `Details: ${body.project}` : "",
    body.referral ? `Heard about us: ${body.referral}` : "",
    body.message ? `Message: ${body.message}` : "",
    `Contact: ${phone || ""} ${email || ""}`.trim(),
  ].filter(Boolean);
  const detail = detailLines.join("\n");

  const consent =
    `SMS consent captured ${new Date().toISOString()} via ${body.page || "website"}.\n` +
    `- Transactional (appointment texts): ${smsT ? "YES" : "no"}\n` +
    `- Marketing (offers/new arrivals): ${smsM ? "YES" : "no"}\n` +
    `Team notify (SMS pending A2P): ${NOTIFY_NUMBERS}`;

  const heading = isTrade ? "TRADE PROGRAM" : apptType ? `${apptType.toUpperCase()} APPOINTMENT REQUEST` : "WEBSITE INQUIRY";
  if (contactId) {
    try {
      await fetch(`${GHL_BASE}/contacts/${contactId}/notes`, {
        method: "POST", headers: headers(),
        body: JSON.stringify({ body: `${heading}\n${detail || "(no extra detail)"}\n\n${consent}` }),
      });
    } catch (_) {}
  }

  // 4) EMAIL notifications (until SMS/A2P is live). Best-effort.
  let emailLead = null, emailTeam = null;
  if (contactId && (apptType || isTrade)) {
    const what = isTrade ? "trade program application" : `${apptType === "Cleaning" ? "cleaning / repair" : "design"} appointment`;
    const when = [apptDate ? `on <b>${esc(apptDate)}</b>` : "", apptSlot ? `at <b>${esc(apptSlot)}</b>` : ""].filter(Boolean).join(" ");
    const leadHtml =
      `<p>Hi ${esc(firstName) || "there"},</p>` +
      `<p>Thank you for your ${what} request with <b>Pineville Rug Gallery</b>${when ? " " + when : ""}. ` +
      `We've received it and will confirm your time by text or call shortly.</p>` +
      `<p>Questions in the meantime? Call us anytime at <b>(704) 889-2454</b>.</p>` +
      `<p>Warmly,<br>Pineville Rug Gallery<br>310 Main Street · Historic Downtown Pineville, NC</p>`;
    emailLead = await sendGhlEmail(contactId, "We've received your request — Pineville Rug Gallery", leadHtml);

    const notify = await upsertContact({ locationId: LOCATION_ID, name: "PRG Website Notifications", email: NOTIFY_EMAIL, tags: ["Internal Notifications"] });
    if (notify.id) {
      const teamHtml = `<p><b>${esc(heading)}</b></p><p>${esc(detail).replace(/\n/g, "<br>")}</p>`;
      emailTeam = await sendGhlEmail(notify.id, `New ${esc(apptType || (isTrade ? "trade" : "website"))} lead: ${esc(name)}`, teamHtml);
    } else {
      emailTeam = { ok: false, detail: "notify contact not created", status: notify.status };
    }
  }

  if (body.debug) return json({ ok: true, emailLead, emailTeam });
  return json({ ok: true });
};

function headers() {
  return {
    Authorization: `Bearer ${TOKEN}`,
    Version: GHL_VERSION,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}

export const config = { path: "/api/pineville-lead" };
