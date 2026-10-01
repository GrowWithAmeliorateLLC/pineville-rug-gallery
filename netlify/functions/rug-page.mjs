// Individual rug page: /rug/<id>  (server-rendered from the rug manager data)
import { loadRugs, publicRug, isPublic, esc } from "../lib/rugstore.mjs";

const CSS = `
:root{--paper:#fdfaf4;--cream:#f5efe4;--sand:#ece3d3;--pine:#12312b;--pine-deep:#0c221d;--clay:#b0663f;--clay-soft:#c98b64;--ink:#221e18;--stone:#6d645a;--line:rgba(34,30,24,.14)}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Jost',sans-serif;color:var(--ink);background:var(--paper);line-height:1.65;font-weight:300;-webkit-font-smoothing:antialiased}
h1,h2{font-family:'Cormorant Garamond',serif;font-weight:500;line-height:1.08}
a{color:inherit;text-decoration:none} img{display:block;max-width:100%}
.btn{display:inline-block;font-size:.7rem;text-transform:uppercase;letter-spacing:.18em;font-weight:500;padding:15px 24px;border:1px solid var(--pine);color:var(--pine);transition:.3s;text-align:center}
.btn:hover{background:var(--pine);color:var(--paper)} .btn.solid{background:var(--pine);color:var(--paper)}
header{position:sticky;top:0;z-index:50;background:rgba(253,250,244,.94);backdrop-filter:blur(10px);border-bottom:1px solid var(--line)}
.nav{display:flex;align-items:center;justify-content:space-between;padding:14px 40px;max-width:1400px;margin:0 auto;gap:16px}
.brand{flex:none} .brand img{height:132px;width:auto;margin:-28px 0 -29px -8px}
.nav-cta{display:flex;gap:12px;align-items:center} .nav-cta a.back{font-size:.72rem;text-transform:uppercase;letter-spacing:.16em;color:var(--pine)}
.nav-cta .btn{padding:13px 18px;font-size:.66rem;letter-spacing:.16em;white-space:nowrap}
.wrap{max-width:1240px;margin:0 auto;padding:60px 40px 100px}
.crumb{font-size:.72rem;text-transform:uppercase;letter-spacing:.2em;color:var(--clay);margin-bottom:28px;display:inline-block}
.grid{display:grid;grid-template-columns:1.15fr .85fr;gap:60px;align-items:start}
.photo{position:relative;display:block;cursor:zoom-in}
.photo img{width:100%;max-height:82vh;object-fit:contain;margin:0 auto;box-shadow:0 14px 34px rgba(12,34,29,.16);opacity:0;transition:opacity .4s ease}
.photo img.ready{opacity:1}
.photo .zoomhint{position:absolute;right:12px;bottom:12px;background:rgba(12,34,29,.78);color:#fff;font-size:.68rem;text-transform:uppercase;letter-spacing:.16em;padding:8px 12px}
h1{font-size:clamp(2.2rem,4vw,3.2rem);color:var(--pine);margin-bottom:10px}
.price{font-family:'Cormorant Garamond',serif;font-size:1.7rem;color:var(--clay);margin-bottom:24px}
dl{border-top:1px solid var(--line);margin-bottom:26px}
dl div{display:flex;gap:16px;padding:12px 0;border-bottom:1px solid var(--line)}
dt{width:110px;flex:none;font-size:.68rem;text-transform:uppercase;letter-spacing:.18em;color:var(--stone);padding-top:3px}
dd{font-size:1rem}
.desc{color:var(--stone);margin-bottom:30px;white-space:pre-line}
.actions{display:grid;gap:12px}
.note{font-size:.85rem;color:var(--stone);margin-top:18px}
footer{background:var(--pine-deep);color:rgba(245,239,228,.7);padding:40px 20px;text-align:center;font-size:.8rem}
@media(max-width:900px){.grid{grid-template-columns:1fr;gap:34px}}
@media(max-width:620px){.nav{padding:12px 22px}.brand img{height:92px;margin:-19px 0 -20px -6px}.nav-cta a.back,.nav-cta .hdr-btn{display:none}.wrap{padding:36px 22px 70px}}
.nav-cta .hdr-mobile{display:none} @media(max-width:620px){.nav-cta .hdr-mobile{display:inline-block}}
`;

function shell(title, desc, body) {
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500&family=Jost:wght@300;400;500&display=swap" rel="stylesheet">
<style>${CSS}</style></head><body>
<header><div class="nav">
  <a class="brand" href="/index.html" aria-label="Pineville Rug Gallery"><img src="https://storage.googleapis.com/pineville-rug/Trans_PRG.png" alt="Pineville Rug Gallery — Est. 1986"></a>
  <div class="nav-cta">
    <a class="back" href="/gallery.html">← The Collection</a>
    <a href="/index.html#book-design" class="btn solid hdr-btn">Book a Design Appointment</a>
    <a href="/index.html#book-cleaning" class="btn hdr-btn">Book a Cleaning</a>
    <a href="/index.html#book" class="btn solid hdr-mobile">Book</a>
  </div>
</div></header>
${body}
<footer>© ${new Date().getFullYear()} Pineville Rug Gallery · 310 Main Street, Pineville, NC · (980) 288-2538 · Store (704) 889-2454 · <a href="/index.html">Home</a></footer>
<script src="/assets/rugview.js"></script>
</body></html>`;
}

export default async (req, context) => {
  const id = (context.params && context.params.id) || "";
  const rugs = await loadRugs();
  const raw = rugs.find((r) => r.id === id && isPublic(r));

  if (!raw) {
    const html = shell("Rug not found — Pineville Rug Gallery", "", `
<div class="wrap" style="text-align:center">
  <h1>This rug has found its home.</h1>
  <p class="desc" style="margin:14px auto 30px;max-width:520px">It may have sold or moved off the floor. Browse the rest of the collection, or call us — we have over 1,000 rugs in the gallery.</p>
  <a class="btn solid" href="/gallery.html">View the Collection</a>
</div>`);
    return new Response(html, { status: 404, headers: { "Content-Type": "text/html; charset=utf-8" } });
  }

  const r = publicRug(raw);
  const rows = [["Stock #", r.stock], ["Origin", r.origin], ["Size", r.size], ["Age", r.age], ["Material", r.material]]
    .filter(([, v]) => v)
    .map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`)
    .join("");
  const book = `/index.html?rug=${encodeURIComponent(r.label)}#book-design`;
  const metaDesc = [r.label, r.origin, r.size, r.material].filter(Boolean).join(" · ") + " — hand-knotted rug at Pineville Rug Gallery, Pineville NC.";

  const html = shell(`${r.label} — Pineville Rug Gallery`, metaDesc, `
<div class="wrap">
  <a class="crumb" href="/gallery.html">← Back to the collection</a>
  <div class="grid">
    <a class="photo" href="${esc(r.full)}" data-zoom="${esc(r.full)}" data-turn="${esc(r.turn || "")}" aria-label="Zoom in on this rug"><img data-upright="${esc(r.full)}" data-turn="${esc(r.turn || "")}" alt="${esc(r.label)}"><span class="zoomhint">Tap to zoom</span></a>
    <div>
      <h1>${esc(r.label)}</h1>
      ${r.price ? `<div class="price">${esc(r.price)}</div>` : ""}
      ${rows ? `<dl>${rows}</dl>` : ""}
      ${r.description ? `<p class="desc">${esc(r.description)}</p>` : ""}
      <div class="actions">
        <a class="btn solid" href="${esc(book)}">Book a Viewing of This Rug</a>
        <a class="btn" href="tel:9802882538">Call the Gallery · (980) 288-2538</a>
        <a class="btn" href="tel:7048892454">Store · (704) 889-2454</a>
      </div>
      <p class="note">This one is ready to meet your room. Complimentary local pickup &amp; delivery: we can bring it home so you can see it in your space.</p>
    </div>
  </div>
</div>`);
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
};

export const config = { path: "/rug/:id" };
