// Appointment records for the admin "Appointments" calendar.
// Store "prg-appointments", one key per request: "a/<id>".
import { getStore } from "@netlify/blobs";

export const apptStore = () => getStore({ name: "prg-appointments", consistency: "strong" });

export const STATUSES = ["New", "Confirmed", "Done", "Canceled"];

export function newApptId(created) {
  return new Date(created || Date.now()).toISOString().replace(/[-:.TZ]/g, "") + Math.random().toString(36).slice(2, 6);
}

export async function saveAppt(rec) {
  const id = rec.id || newApptId(rec.created);
  const full = { status: "New", ...rec, id };
  await apptStore().setJSON(`a/${id}`, full);
  return full;
}

export async function listAppts() {
  const s = apptStore();
  const { blobs } = await s.list({ prefix: "a/" });
  const out = await Promise.all(blobs.map((b) => s.get(b.key, { type: "json" }).catch(() => null)));
  return out.filter(Boolean);
}
