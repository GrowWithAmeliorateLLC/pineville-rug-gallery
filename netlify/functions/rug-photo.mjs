// Rug photos.
// GET  /api/rug-photo?id=<id>&s=thumb|full  -> serves the uploaded image (cached; ?v= busts the cache)
// POST /api/rug-photo  {id, full, thumb}    -> admin upload (x-admin-key). full/thumb are JPEG data URLs,
//                                             already resized in the browser.
// Extra photos per rug (10/1/2026):
// GET  /api/rug-photo?id=<id>&x=<k>&s=thumb|full
// POST {action:"add-extra", id, full, thumb, name}          -> admin uploads another photo for that rug
// POST {action:"import-extras", id, items:[{k, name, src}]} -> copies photos from Liane's PhotoProofPro gallery
//                                                              (src = "<set>/<hash>"), skipping ones already there
// POST {action:"delete-extra", id, k}                        -> removes one extra photo
import { loadRugs, saveRugs, publicRug, isAdmin, photoStore, json } from "../lib/rugstore.mjs";

const MAX_B64 = 5_500_000; // stays under Netlify's 6 MB request limit

function decode(dataUrl) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(String(dataUrl || ""));
  if (!m || m[2].length > MAX_B64) return null;
  return { type: m[1], bytes: Buffer.from(m[2], "base64") };
}

export default async (req) => {
  if (req.method === "GET") {
    const u = new URL(req.url);
    const id = u.searchParams.get("id") || "";
    const s = u.searchParams.get("s") === "full" ? "full" : "thumb";
    const x = u.searchParams.get("x") || "";
    if (!/^[a-z0-9]+$/i.test(id) || (x && !/^[a-z0-9]+$/i.test(x))) return new Response("Not found", { status: 404 });
    const hit = await photoStore().getWithMetadata(x ? `${id}/x/${x}/${s}` : `${id}/${s}`, { type: "arrayBuffer" });
    if (!hit) return new Response("Not found", { status: 404 });
    return new Response(hit.data, {
      headers: {
        "Content-Type": (hit.metadata && hit.metadata.contentType) || "image/jpeg",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  }

  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!isAdmin(req)) return json({ error: "unauthorized" }, 401);

  let body;
  try { body = await req.json(); } catch { return json({ error: "bad_request" }, 400); }

  const rugs = await loadRugs();
  const rug = rugs.find((r) => r.id === body.id);
  if (!rug) return json({ error: "not_found" }, 404);

  const ps0 = photoStore();
  if (!Array.isArray(rug.extras)) rug.extras = [];

  if (body.action === "add-extra") {
    const full = decode(body.full);
    const thumb = decode(body.thumb);
    if (!full || !thumb) return json({ error: "bad_image", message: "Photo is missing or too large." }, 400);
    const k = "u" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    await ps0.set(`${rug.id}/x/${k}/full`, full.bytes, { metadata: { contentType: full.type } });
    await ps0.set(`${rug.id}/x/${k}/thumb`, thumb.bytes, { metadata: { contentType: thumb.type } });
    return saveExtra(rug.id, (r) => { r.extras.push({ k, v: Date.now(), name: String(body.name || "").slice(0, 120) }); });
  }

  if (body.action === "import-extras") {
    const items = (Array.isArray(body.items) ? body.items : []).slice(0, 20)
      .filter((it) => /^[a-z0-9]{1,12}$/i.test(it.k || "") && /^\d{6}\/[0-9a-f]{32}$/.test(it.src || ""))
      .filter((it) => !rug.extras.some((x) => x.k === it.k));
    const base = "https://cdn.photoproofpro.com/";
    const got = [];
    await Promise.all(items.map(async (it) => {
      try {
        const [full, thumb] = await Promise.all([
          fetch(`${base}uploads/resized/6950/202149/${it.src}.jpg`),
          fetch(`${base}styles/large_thumb/s3/uploads/resized/6950/202149/${it.src}.jpg`),
        ]);
        if (!full.ok || !thumb.ok) return;
        await ps0.set(`${rug.id}/x/${it.k}/full`, await full.arrayBuffer(), { metadata: { contentType: "image/jpeg" } });
        await ps0.set(`${rug.id}/x/${it.k}/thumb`, await thumb.arrayBuffer(), { metadata: { contentType: "image/jpeg" } });
        got.push(it);
      } catch (_) {}
    }));
    got.sort((a, b) => a.k.localeCompare(b.k));
    const res = await saveExtra(rug.id, (r) => {
      for (const it of got) if (!r.extras.some((x) => x.k === it.k)) r.extras.push({ k: it.k, v: Date.now(), name: String(it.name || "").slice(0, 120) });
      r.extras.sort((a, b) => a.k.localeCompare(b.k));
    });
    return res;
  }

  if (body.action === "delete-extra") {
    const k = String(body.k || "");
    if (!/^[a-z0-9]+$/i.test(k)) return json({ error: "bad_request" }, 400);
    await Promise.allSettled([ps0.delete(`${rug.id}/x/${k}/full`), ps0.delete(`${rug.id}/x/${k}/thumb`)]);
    return saveExtra(rug.id, (r) => { r.extras = r.extras.filter((x) => x.k !== k); });
  }

  const full = decode(body.full);
  const thumb = decode(body.thumb);
  if (!full || !thumb) return json({ error: "bad_image", message: "Photo is missing or too large." }, 400);

  const ps = photoStore();
  await ps.set(`${rug.id}/full`, full.bytes, { metadata: { contentType: full.type } });
  await ps.set(`${rug.id}/thumb`, thumb.bytes, { metadata: { contentType: thumb.type } });

  rug.photo = { kind: "blob", v: Date.now() };
  rug.updated = Date.now();
  await saveRugs(rugs);
  return json({ ok: true, rug: publicRug(rug) });
};

// Re-reads the rug list right before saving so edits made meanwhile aren't lost.
async function saveExtra(id, change) {
  const rugs = await loadRugs();
  const r = rugs.find((x) => x.id === id);
  if (!r) return json({ error: "not_found" }, 404);
  if (!Array.isArray(r.extras)) r.extras = [];
  change(r);
  r.updated = Date.now();
  await saveRugs(rugs);
  return json({ ok: true, rug: publicRug(r) });
}

export const config = { path: "/api/rug-photo" };
