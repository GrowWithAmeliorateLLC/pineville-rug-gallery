// One-time archive of the OLD WordPress site (pinevilleruggallery.com) before the domain moves to this site.
// Background function (runs up to 15 minutes). Start it with:
//   POST /.netlify/functions/old-site-archive-background   (header x-admin-key: <admin password>)
//   add ?images=1 to re-run only the image step from pages already saved
// It saves every page in the old sitemap, plus every image those pages use, to the Netlify Blobs
// store "prg-old-site":
//   page/<path>        the page HTML, exactly as served
//   img/<path>         each image file (wp-content/uploads)
//   meta/status        progress + counts (read it with GET /api/old-site-archive)
//   meta/urls          the full list of old page addresses
import { getStore } from "@netlify/blobs";
import { isAdmin } from "../lib/rugstore.mjs";

const ORIGIN = "https://pinevilleruggallery.com";
const UA = "Mozilla/5.0 (compatible; AmeliorateArchive/1.0; +https://growwithameliorate.com)";

async function get(url, type = "text") {
  const r = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow" });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return type === "text" ? r.text() : { buf: await r.arrayBuffer(), ct: r.headers.get("content-type") || "" };
}

const locs = (xml) => [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1].replace(/&amp;/g, "&"));

export default async (req) => {
  if (!isAdmin(req)) return new Response("unauthorized", { status: 401 });
  const s = getStore({ name: "prg-old-site", consistency: "strong" });
  const status = { started: new Date().toISOString(), pages: 0, pageErrors: [], images: 0, imageErrors: [], done: false };
  const save = () => s.setJSON("meta/status", { ...status, updated: new Date().toISOString() });
  await save();

  const onlyImages = new URL(req.url).searchParams.get("images") === "1";
  const images = new Set();
  const toOriginal = (u) => u.replace(/^http:/, "https:").replace(/-\d+x\d+(\.[a-z]+)$/i, "$1");
  const collect = (html) => {
    for (const m of html.matchAll(/https?:\/\/(?:www\.)?pinevilleruggallery\.com\/wp-content\/uploads\/[^"'\s)<>,]+?\.(?:jpe?g|png|gif|webp|svg)/gi)) images.add(toOriginal(m[0]));
  };

  if (onlyImages) {
    // Pages already saved: rebuild the image list from them.
    const { blobs } = await s.list({ prefix: "page/" });
    for (const b of blobs) { const html = await s.get(b.key); if (html) collect(html); }
    status.pages = blobs.length;
  } else {
    // 1. Every page address from the old sitemaps
    const index = await get(`${ORIGIN}/sitemap_index.xml`);
    const pages = new Set([`${ORIGIN}/`]);
    for (const map of locs(index)) {
      try { for (const u of locs(await get(map))) if (!/\.(jpe?g|png|gif|webp|svg)$/i.test(u)) pages.add(u); }
      catch (e) { status.pageErrors.push(String(e.message || e)); }
    }
    await s.setJSON("meta/urls", [...pages]);
    status.totalPages = pages.size;
    await save();

    // 2. Each page's HTML, collecting the images it uses
    for (const u of pages) {
      try {
        const html = await get(u);
        const path = new URL(u).pathname.replace(/^\/+|\/+$/g, "") || "home";
        await s.set(`page/${path}`, html, { metadata: { url: u, savedAt: new Date().toISOString() } });
        status.pages++;
        collect(html);
      } catch (e) { status.pageErrors.push(String(e.message || e)); }
      if (status.pages % 10 === 0) await save();
    }
  }
  status.totalImages = images.size;
  await save();

  // 3. Each original image file (size variants skipped), 8 at a time
  const list = [...images];
  let next = 0;
  const worker = async () => {
    while (next < list.length) {
      const u = list[next++];
      try {
        const key = "img/" + new URL(u).pathname.replace(/^\/+/, "");
        if (!(await s.getMetadata(key))) {
          const { buf, ct } = await get(u, "bin");
          await s.set(key, buf, { metadata: { url: u, contentType: ct } });
        }
        status.images++;
      } catch (e) { status.imageErrors.push(String(e.message || e)); }
      if (status.images % 25 === 0) await save();
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  status.done = true;
  status.finished = new Date().toISOString();
  await save();
  return new Response("ok");
};
