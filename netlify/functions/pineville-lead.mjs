// Appointment lead handler.
// Receives the site's custom form (no native GHL form) and upserts the contact
// into GoHighLevel via the LeadConnector v2 API, records A2P SMS consent as tags
// + a timestamped note, then GHL workflows fire on "contact created / tag added".
//
// Mirrors the ATX K9 pattern (custom form -> contacts/upsert) but keeps the GHL
// token SERVER-SIDE in a Netlify env var instead of exposing it in page source.
//
// Required Netlify environment variables:
//   PRG_GHL_TOKEN        - GHL Private Integration token for the Pineville sub-account
//                          (scopes: contacts.write, contacts.readonly)
//   PRG_GHL_LOCATION_ID  - optional; defaults to the Pineville location id below.

const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";
const LOCATION_ID = process.env.PRG_GHL_LOCATION_ID || "SEUOenwNjKokn5Nnb0cU";
const TOKEN = process.env.PRG_GHL_TOKEN;

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!TOKEN) return json({ error: "CRM not configured (missing PRG_GHL_TOKEN)" }, 500);

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

  // Services the visitor selected (multi-select checkboxes).
  const services = Array.isArray(body.services)
    ? body.services.filter(Boolean)
    : (body.services ? [body.services] : []);

  const tags = ["Website Lead"];
  services.forEach((s) => tags.push(`Interest: ${s}`));
  if (!services.length) tags.push("Interest: General Inquiry");
  if (smsT) tags.push("SMS Consent - Transactional");
  if (smsM) tags.push("SMS Consent - Marketing");

  const contact = {
    locationId: LOCATION_ID,
    firstName,
    lastName,
    name,
    source: "Website - Appointment Request",
    tags,
  };
  if (email) contact.email = email;
  if (phone) contact.phone = phone;

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

  // 2) Attach a note: what they want + the free-text detail + an A2P consent record.
  const detail = [
    services.length ? `Interested in: ${services.join(", ")}` : "",
    body.project ? `Space / project: ${body.project}` : "",
    body.preferred ? `Preferred time: ${body.preferred}` : "",
    body.referral ? `Heard about us: ${body.referral}` : "",
    body.message ? `Message: ${body.message}` : "",
  ].filter(Boolean).join("\n");

  const consent =
    `SMS consent captured ${new Date().toISOString()} via ${body.page || "website"}.\n` +
    `- Transactional (appointment texts): ${smsT ? "YES" : "no"}\n` +
    `- Marketing (offers/new arrivals): ${smsM ? "YES" : "no"}`;

  if (contactId) {
    try {
      await fetch(`${GHL_BASE}/contacts/${contactId}/notes`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ body: `APPOINTMENT REQUEST\n${detail || "(no extra detail)"}\n\n${consent}` }),
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
