// Rug photos.
// GET  /api/rug-photo?id=<id>&s=thumb|full  -> serves the uploaded image (cached; ?v= busts the cache)
// POST /api/rug-photo  {id, full, thumb}    -> admin upload (x-admin-key). full/thumb are JPEG data URLs,
//                                             already resized in the browser.
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
    if (!/^[a-z0-9]+$/i.test(id)) return new Response("Not found", { status: 404 });
    const hit = await photoStore().getWithMetadata(`${id}/${s}`, { type: "arrayBuffer" });
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

export const config = { path: "/api/rug-photo" };
