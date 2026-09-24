// Appointment lead + booking handler.
//
// POST: the site's forms (Sales appointment, Cleaning/Repair, Trade). Enforces a
//   per-slot booking cap (default 3), upserts the contact into GoHighLevel, and
//   records the requested slot + A2P SMS consent as tags + a note.
// GET:  ?form=sales|cleaning&date=YYYY-MM-DD -> returns how many bookings each
//   fixed slot already has, so the form can grey out full slots in real time.
//
// Token kept SERVER-SIDE in a Netlify env var. Capacity uses Netlify Blobs with
// strong-consistency reads (guarded dynamic import — if unavailable, booking
// still works, just uncapped).
//
// Env vars:
//   PRG_GHL_TOKEN        - GHL Private Integration token
//   PRG_GHL_LOCATION_ID  - optional; defaults below
//   PRG_NOTIFY_NUMBERS   - optional; cell(s) to text on a new booking (placeholder below)

const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";
const LOCATION_ID = process.env.PRG_GHL_LOCATION_ID || "SEUOenwNjKokn5Nnb0cU";
const TOKEN = process.env.PRG_GHL_TOKEN;
// Placeholder until Reza's & Sardar's numbers are provided (Amy's cell for testing).
const NOTIFY_NUMBERS = process.env.PRG_NOTIFY_NUMBERS || "3154800680";

// Per-appointment-type slot capacity. Renée: cleaning = 3 bookings per window.
const CAPS = { Sales: 3, Cleaning: 3 };
const SLOTS = {
  Sales: ["11:00 AM", "1:00 PM", "3:00 PM", "5:00 PM"],
  Cleaning: ["9:00–11:00 AM", "11:00 AM–1:00 PM", "1:00–3:00 PM", "3:00–5:00 PM"],
};
const typeFromForm = (f) => (String(f).toLowerCase() === "cleaning" ? "Cleaning" : "Sales");
const bkey = (t, d, s) => `${t}|${d}|${s}`;

async function getBlobStore() {
  try {
    const mod = await import("@netlify/blobs");
    return mod.getStore("prg-bookings");
  } catch (_) {
    return null;
  }
}
async function readCount(store, t, d, s) {
  if (!store) return 0;
  try {
    const v = await store.get(bkey(t, d, s), { consistency: "strong" });
    return v ? parseInt(v, 10) || 0 : 0;
  } catch (_) {
    return 0;
  }
}

export default async (req) => {
  if (!TOKEN) return json({ error: "CRM not configured (missing PRG_GHL_TOKEN)" }, 500);

  // --- GET: live availability for a date ---
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

  // Honeypot: bots fill the hidden "company" field. Pretend success, do nothing.
  if (body.company) return json({ ok: true });

  const name = (body.name || "").trim();
  const email = (body.email || "").trim();
  const phone = (body.phone || "").trim();
  if (!name || (!email && !phone)) return json({ error: "Missing required fields" }, 400);

  const parts = name.split(/\s+/);
  const firstName = parts.shift() || name;
  const lastName = parts.join(" ");

  const smsT = body.sms_transactional === true || body.sms_transactional === "1" || body.sms_transactional === "on";
  const smsM = body.sms_marketing === true || body.sms_marketing === "1" || body.sms_marketing === "on";

  const services = Array.isArray(body.services)
    ? body.services.filter(Boolean)
    : (body.services ? [body.services] : []);

  const apptType = (body.appt_type || "").trim();       // "Sales" or "Cleaning"
  const apptDate = (body.appt_date || "").trim();
  let apptSlot = (body.appt_slot || "").trim();
  const apptCustom = (body.appt_custom_time || "").trim();
  if (apptCustom && /after 5|sunday|other/i.test(apptSlot)) apptSlot = `${apptSlot} — ${apptCustom}`;

  // --- Capacity check (fixed slots only; by-request slots are uncapped) ---
  const isFixedSlot = !!(SLOTS[apptType] && SLOTS[apptType].includes(apptSlot));
  const store = (apptType && apptDate && isFixedSlot) ? await getBlobStore() : null;
  if (store) {
    const cap = CAPS[apptType] || 99;
    const cur = await readCount(store, apptType, apptDate, apptSlot);
    if (cur >= cap) {
      return json({ error: "slot_full", message: "That time just filled — please choose another." }, 409);
    }
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

  const source = isTrade
    ? "Website - Trade Program"
    : apptType ? `Website - ${apptType} Appointment` : "Website - Inquiry";

  const contact = { locationId: LOCATION_ID, firstName, lastName, name, source, tags };
  if (email) contact.email = email;
  if (phone) contact.phone = phone;
  if (address1) contact.address1 = address1;
  if (city) contact.city = city;
  if (state) contact.state = state;
  if (postalCode) contact.postalCode = postalCode;
  if (companyName) contact.companyName = companyName;

  // 1) Upsert the contact.
  let upData = {};
  try {
    const up = await fetch(`${GHL_BASE}/contacts/upsert`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(contact),
    });
    upData = await up.json().catch(() => ({}));
    if (!up.ok) return json({ error: "CRM upsert failed", status: up.status, detail: upData }, 502);
  } catch (e) {
    return json({ error: "CRM unreachable" }, 502);
  }

  const contactId = upData?.contact?.id || upData?.id;

  // 2) Reserve the slot (increment count) now the booking is captured.
  if (store) {
    try {
      const cur = await readCount(store, apptType, apptDate, apptSlot);
      await store.set(bkey(apptType, apptDate, apptSlot), String(cur + 1));
    } catch (_) { /* best-effort */ }
  }

  // 3) Attach a note.
  const addressLine = [address1, [city, state].filter(Boolean).join(", "), postalCode].filter(Boolean).join(" · ");
  const detail = [
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
    (apptType && !isTrade) ? `Team notify (SMS pending A2P): ${NOTIFY_NUMBERS}` : "",
  ].filter(Boolean).join("\n");

  const consent =
    `SMS consent captured ${new Date().toISOString()} via ${body.page || "website"}.\n` +
    `- Transactional (appointment texts): ${smsT ? "YES" : "no"}\n` +
    `- Marketing (offers/new arrivals): ${smsM ? "YES" : "no"}`;

  const heading = isTrade ? "TRADE PROGRAM" : apptType ? `${apptType.toUpperCase()} APPOINTMENT REQUEST` : "WEBSITE INQUIRY";

  if (contactId) {
    try {
      await fetch(`${GHL_BASE}/contacts/${contactId}/notes`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ body: `${heading}\n${detail || "(no extra detail)"}\n\n${consent}` }),
      });
    } catch (_) { /* note is best-effort */ }
  }

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
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const config = { path: "/api/pineville-lead" };
