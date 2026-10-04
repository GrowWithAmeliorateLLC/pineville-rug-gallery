// Public, read-only: serves images saved from the old WordPress site (prg-old-site store, img/ keys)
// so pages that used old /wp-content/uploads/ photos keep working after the domain moved to Netlify.
// GET /old-media/2023/12/photo.webp  -> img/wp-content/uploads/2023/12/photo.webp
// Size variants (photo-700x854.jpg) fall back to the saved original (photo.jpg).
import { getStore } from "@netlify/blobs";

const TYPES = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml" };

export default async (req) => {
  const path = decodeURIComponent(new URL(req.url).pathname.replace(/^\/old-media\//, ""));
  if (!/^[\w\-./]+\.(jpe?g|png|gif|webp|svg)$/i.test(path) || path.includes("..")) return new Response("not found", { status: 404 });
  const s = getStore({ name: "prg-old-site" });
  const keys = [`img/wp-content/uploads/${path}`, `img/wp-content/uploads/${path.replace(/-\d+x\d+(\.[a-z]+)$/i, "$1")}`];
  for (const key of keys) {
    const r = await s.getWithMetadata(key, { type: "arrayBuffer" });
    if (r) {
      const ext = key.split(".").pop().toLowerCase();
      const ct = (r.metadata && r.metadata.contentType) || TYPES[ext] || "application/octet-stream";
      return new Response(r.data, { headers: { "Content-Type": ct, "Cache-Control": "public, max-age=31536000, immutable" } });
    }
  }
  return new Response("not found", { status: 404 });
};

export const config = { path: "/old-media/*" };
