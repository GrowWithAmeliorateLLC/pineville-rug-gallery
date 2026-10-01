// Appointments API for the admin calendar (needs x-admin-key, same password as the Rug Manager).
// GET  /api/appointments  -> { appointments: [...] }  (first call also imports earlier website
//                            requests from GoHighLevel contact notes, once)
// POST /api/appointments  -> {action:"status", id, status} | {action:"note", id, note} | {action:"delete", id}
import { apptStore, listAppts, saveAppt, STATUSES } from "../lib/apptstore.mjs";
import { isAdmin, json } from "../lib/rugstore.mjs";

const GHL_BASE = "https://services.leadconnectorhq.com";
const LOCATION_ID = process.env.PRG_GHL_LOCATION_ID || "SEUOenwNjKokn5Nnb0cU";
const TOKEN = process.env.PRG_GHL_TOKEN;
const ghlHeaders = () => ({ Authorization: `Bearer ${TOKEN}`, Version: "2021-07-28", Accept: "application/json" });

// Copy an admin team note onto the client's GHL contact (one GHL note per appointment, kept in sync).
async function syncNoteToGhl(rec) {
  if (!TOKEN || !rec.contactId) return "skipped";
  const h = { ...ghlHeaders(), "Content-Type": "application/json" };
  const base = `${GHL_BASE}/contacts/${encodeURIComponent(rec.contactId)}/notes`;
  const text = String(rec.teamNote || "").trim();
  try {
    if (!text) {
      if (rec.ghlNoteId) { await fetch(`${base}/${rec.ghlNoteId}`, { method: "DELETE", headers: h }); delete rec.ghlNoteId; }
      return "cleared";
    }
    const kind = rec.type === "Cleaning" ? "Cleaning / repair appointment" : rec.type === "Trade" ? "Trade application" : "Design appointment";
    const when = [rec.date, rec.customTime || rec.time].filter(Boolean).join(" ");
    const body = `TEAM NOTE (from website admin)\n${kind}${when ? " · " + when : ""}\n\n${text}`;
    if (rec.ghlNoteId) {
      const r = await fetch(`${base}/${rec.ghlNoteId}`, { method: "PUT", headers: h, body: JSON.stringify({ body }) });
      if (r.ok) return "updated";
      if (r.status !== 404) return "failed";
    }
    const r = await fetch(base, { method: "POST", headers: h, body: JSON.stringify({ body }) });
    if (!r.ok) return "failed";
    const j = await r.json().catch(() => ({}));
    const id = (j.note && j.note.id) || j.id;
    if (id) rec.ghlNoteId = id;
    return "saved";
  } catch (_) { return "failed"; }
}

async function ghl(path) {
  const r = await fetch(GHL_BASE + path, { headers: ghlHeaders() });
  if (!r.ok) throw new Error(`GHL ${r.status} on ${path.split("?")[0]}`);
  return r.json();
}

// Turn one of our "... APPOINTMENT REQUEST" / "TRADE PROGRAM" notes back into fields.
function parseNote(text) {
  const lines = String(text || "").split("\n");
  const head = (lines.shift() || "").trim();
  const f = {};
  let last = null;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^SMS consent captured/i.test(line)) break;
    const m = line.match(/^([A-Za-z][A-Za-z \-]{1,30}):\s?(.*)$/);
    if (m) { last = m[1].toLowerCase(); f[last] = m[2]; }
    else if (last && line.trim()) f[last] += "\n" + line;
  }
  return { head, f };
}

async function importFromGhl(existing) {
  if (!TOKEN) return 0;
  const contacts = [];
  let after = "", afterId = "";
  for (let page = 0; page < 10; page++) {
    const q = `/contacts/?locationId=${LOCATION_ID}&limit=100` + (afterId ? `&startAfter=${after}&startAfterId=${afterId}` : "");
    const j = await ghl(q);
    const list = j.contacts || [];
    contacts.push(...list);
    if (list.length < 100 || !j.meta || !j.meta.startAfterId) break;
    after = j.meta.startAfter; afterId = j.meta.startAfterId;
  }
  const leads = contacts.filter((c) => (c.tags || []).some((t) => /website lead/i.test(t)));
  const seen = new Set(existing.map((a) => `${a.contactId}|${a.date}|${a.time}`));
  let n = 0;
  for (const c of leads) {
    let notes = [];
    try { notes = (await ghl(`/contacts/${c.id}/notes`)).notes || []; } catch (_) { continue; }
    for (const note of notes) {
      const { head, f } = parseNote(note.body);
      const kind = /^SALES APPOINTMENT/i.test(head) ? "Design" : /^CLEANING APPOINTMENT/i.test(head) ? "Cleaning" : /^TRADE PROGRAM/i.test(head) ? "Trade" : null;
      if (!kind) continue;
      const time = f["requested time"] || "";
      const [slot, custom] = time.split(" — ");
      const date = f["requested date"] || "";
      if (seen.has(`${c.id}|${date}|${slot || ""}`)) continue;
      const confirm = (f["confirm by"] || "").toLowerCase();
      await saveAppt({
        id: "g" + note.id,
        created: note.dateAdded || c.dateAdded || new Date().toISOString(),
        source: "website (imported)",
        type: kind,
        date, time: slot || "", customTime: custom || "",
        confirmVia: confirm ? confirm[0].toUpperCase() + confirm.slice(1) : "",
        name: [c.firstName, c.lastName].filter(Boolean).join(" ") || c.contactName || "",
        firstName: c.firstName || "", lastName: c.lastName || "",
        phone: c.phone || "", email: c.email || "",
        company: f["company"] || c.companyName || "",
        services: f["interested in"] ? f["interested in"].split(/,\s*/) : [],
        fulfillment: f["pickup or drop-off"] || "",
        address1: f["address"] || [c.address1, c.city, c.state, c.postalCode].filter(Boolean).join(", "),
        city: "", state: "", postalCode: "",
        details: f["details"] || "", referral: f["heard about us"] || "", message: f["message"] || "",
        smsTransactional: /Transactional[^\n]*YES/i.test(note.body), smsMarketing: /Marketing[^\n]*YES/i.test(note.body),
        contactId: c.id,
      });
      seen.add(`${c.id}|${date}|${slot || ""}`);
      n++;
    }
  }
  return n;
}

export default async (req) => {
  if (!isAdmin(req)) return json({ error: "unauthorized" }, 401);
  const s = apptStore();

  if (req.method === "GET") {
    let appts = await listAppts();
    const meta = (await s.get("meta/ghl-import", { type: "json" }).catch(() => null)) || null;
    let importNote = meta ? "" : undefined;
    if (!meta) {
      try {
        const n = await importFromGhl(appts);
        await s.setJSON("meta/ghl-import", { at: new Date().toISOString(), imported: n });
        if (n) appts = await listAppts();
      } catch (e) { importNote = String(e.message || e); }
    }
    return json({ appointments: appts, locationId: LOCATION_ID, ...(importNote ? { importNote } : {}) });
  }

  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  let body;
  try { body = await req.json(); } catch { return json({ error: "bad_request" }, 400); }
  const key = `a/${String(body.id || "")}`;
  const rec = await s.get(key, { type: "json" }).catch(() => null);
  if (!rec) return json({ error: "not_found" }, 404);

  if (body.action === "status") {
    if (!STATUSES.includes(body.status)) return json({ error: "bad_status" }, 400);
    rec.status = body.status;
    rec.statusAt = new Date().toISOString();
  } else if (body.action === "note") {
    rec.teamNote = String(body.note || "").slice(0, 2000);
    rec.ghlSync = await syncNoteToGhl(rec);
  } else if (body.action === "delete") {
    await s.delete(key);
    return json({ ok: true });
  } else return json({ error: "unknown_action" }, 400);

  await s.setJSON(key, rec);
  return json({ ok: true, appointment: rec });
};

export const config = { path: "/api/appointments" };
