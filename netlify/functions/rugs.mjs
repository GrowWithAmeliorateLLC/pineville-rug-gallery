// Rug list API.
// GET  /api/rugs            -> public list (rugs with a photo AND a name, in display order)
// GET  /api/rugs?all=1      -> admin list (needs x-admin-key)
// POST /api/rugs            -> admin actions (needs x-admin-key):
//   {action:"login"} | {action:"save", rug} | {action:"delete", id} | {action:"move", id, to:"up"|"down"|"top"}
import { loadRugs, saveRugs, newId, cleanFields, publicRug, isPublic, isAdmin, photoStore, json } from "../lib/rugstore.mjs";

export default async (req) => {
  if (req.method === "GET") {
    const all = new URL(req.url).searchParams.get("all") === "1";
    if (all && !isAdmin(req)) return json({ error: "unauthorized" }, 401);
    const rugs = await loadRugs();
    const list = (all ? rugs : rugs.filter(isPublic)).map(publicRug);
    return json({ rugs: list });
  }

  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!isAdmin(req)) return json({ error: "unauthorized" }, 401);

  let body;
  try { body = await req.json(); } catch { return json({ error: "bad_request" }, 400); }

  if (body.action === "login") return json({ ok: true });

  const rugs = await loadRugs();

  if (body.action === "save") {
    const fields = cleanFields(body.rug);
    const id = body.rug && body.rug.id;
    if (id) {
      const r = rugs.find((x) => x.id === id);
      if (!r) return json({ error: "not_found" }, 404);
      // Only change fields the editor actually sent (an older open admin tab won't blank newer fields).
      for (const k of Object.keys(fields)) if (body.rug && body.rug[k] !== undefined) r[k] = fields[k];
      r.updated = Date.now();
      await saveRugs(rugs);
      return json({ ok: true, rug: publicRug(r) });
    }
    const r = { id: newId(), ...fields, photo: null, created: Date.now() };
    rugs.unshift(r); // newest first
    await saveRugs(rugs);
    return json({ ok: true, rug: publicRug(r) });
  }

  if (body.action === "delete") {
    const i = rugs.findIndex((x) => x.id === body.id);
    if (i < 0) return json({ error: "not_found" }, 404);
    const [gone] = rugs.splice(i, 1);
    await saveRugs(rugs);
    if (gone.photo && gone.photo.kind === "blob") {
      const ps = photoStore();
      await Promise.allSettled([ps.delete(`${gone.id}/full`), ps.delete(`${gone.id}/thumb`)]);
    }
    return json({ ok: true });
  }

  if (body.action === "move") {
    const i = rugs.findIndex((x) => x.id === body.id);
    if (i < 0) return json({ error: "not_found" }, 404);
    const [r] = rugs.splice(i, 1);
    const j = body.to === "top" ? 0 : body.to === "up" ? Math.max(0, i - 1) : Math.min(rugs.length, i + 1);
    rugs.splice(j, 0, r);
    await saveRugs(rugs);
    return json({ ok: true });
  }

  return json({ error: "unknown_action" }, 400);
};

export const config = { path: "/api/rugs" };
