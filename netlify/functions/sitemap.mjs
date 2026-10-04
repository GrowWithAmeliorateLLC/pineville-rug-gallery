// /sitemap.xml for Google: the main pages plus every public rug page (built live from the Rug Manager).
import { loadRugs, isPublic } from "../lib/rugstore.mjs";

const BASE = "https://pinevilleruggallery.com";
const PAGES = ["/", "/gallery.html", "/trade.html", "/photos.html", "/privacy.html", "/terms.html"];

export default async () => {
  let rugs = [];
  try { rugs = (await loadRugs()).filter(isPublic); } catch (_) {}
  const day = (t) => new Date(t || Date.now()).toISOString().slice(0, 10);
  const urls = [
    ...PAGES.map((p) => `<url><loc>${BASE}${p}</loc></url>`),
    ...rugs.map((r) => `<url><loc>${BASE}/rug/${encodeURIComponent(r.id)}</loc><lastmod>${day(r.updated || r.created)}</lastmod></url>`),
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
  return new Response(xml, { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
};

export const config = { path: "/sitemap.xml" };
