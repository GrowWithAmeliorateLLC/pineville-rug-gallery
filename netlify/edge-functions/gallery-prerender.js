// Pre-renders the rug cards into /gallery.html so Google (and anyone without JavaScript)
// sees the actual collection instead of "Loading the rug collection…".
// Fixes Search Console's "Soft 404" on /gallery.html. The page's own script still
// re-renders the grid (filters, photos) exactly as before.
// If anything fails, the normal static page is served unchanged (onError: bypass).

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function card(r) {
  const meta = [r.size, r.origin].filter(Boolean).join(" · ") || (r.stock ? "No. " + r.stock : "");
  return '<figure><a href="' + esc(r.url) + '"><div class="ph"><img data-upright="' + esc(r.full || r.thumb) + '" data-turn="' + esc(r.turn || "") + '" alt="' + esc(r.label) + '"></div>' +
    "<figcaption>" + (r.name ? "<b>" + esc(r.name) + "</b>" : "") + (meta ? "<span>" + esc(meta) + "</span>" : "") + (r.price ? "<em>" + esc(r.price) + "</em>" : "") + "</figcaption>" +
    "</a></figure>";
}

const PLACEHOLDER = '<p class="loading">Loading the rug collection…</p>';
const DESCRIPTION = '<meta name="description" content="Browse hand-knotted Persian, Turkish and Oriental rugs from Pineville Rug Gallery in Pineville, NC (Charlotte area) — antique and new, every size. Book a viewing and we\'ll have your favorites waiting.">';

export default async (req, context) => {
  const res = await context.next();
  if (!res.ok || !(res.headers.get("content-type") || "").includes("text/html")) return res;
  const html = await res.text();
  let out = html;
  try {
    const api = await fetch(new URL("/api/rugs", req.url), { headers: { accept: "application/json" } });
    const rugs = (await api.json())?.rugs || [];
    if (rugs.length && out.includes(PLACEHOLDER)) out = out.replace(PLACEHOLDER, rugs.map(card).join(""));
  } catch (_) { /* serve the page as-is */ }
  if (!/<meta name="description"/i.test(out)) out = out.replace("</title>", "</title>\n" + DESCRIPTION);
  const headers = new Headers(res.headers);
  headers.delete("content-length");
  return new Response(out, { status: res.status, headers });
};

export const config = { path: ["/gallery.html", "/gallery"], onError: "bypass" };
