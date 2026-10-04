// Admin-only view of the old WordPress site archive (see old-site-archive-background.mjs).
// GET /api/old-site-archive                -> progress + counts
// GET /api/old-site-archive?list=pages     -> saved page keys
// GET /api/old-site-archive?list=img       -> saved image keys
// GET /api/old-site-archive?key=page/about-us  -> one saved page (HTML) or image
import { getStore } from "@netlify/blobs";
import { isAdmin, json } from "../lib/rugstore.mjs";

export default async (req) => {
  if (!isAdmin(req)) return json({ error: "unauthorized" }, 401);
  const s = getStore({ name: "prg-old-site", consistency: "strong" });
  const q = new URL(req.url).searchParams;
  if (q.get("key")) {
    const key = q.get("key");
    const r = await s.getWithMetadata(key, { type: "arrayBuffer" });
    if (!r) return json({ error: "not_found" }, 404);
    const ct = key.startsWith("page/") ? "text/html; charset=utf-8" : (r.metadata && r.metadata.contentType) || "application/octet-stream";
    return new Response(r.data, { headers: { "Content-Type": ct, "Cache-Control": "no-store" } });
  }
  if (q.get("list")) {
    const prefix = q.get("list") === "img" ? "img/" : "page/";
    const res = await s.list({ prefix });
    const keys = res.blobs.map((b) => b.key);
    return json({ count: keys.length, keys });
  }
  const status = await s.get("meta/status", { type: "json" }).catch(() => null);
  return json({ status });
};

export const config = { path: "/api/old-site-archive" };
