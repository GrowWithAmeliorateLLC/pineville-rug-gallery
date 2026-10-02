// Shared storage + helpers for the Pineville Rug Gallery rug manager.
// Rug list lives in Netlify Blobs store "prg-rugs" (key "rugs").
// Uploaded photos live in store "prg-rug-photos" (keys "<id>/full", "<id>/thumb").
import { getStore } from "@netlify/blobs";
import { createHash, timingSafeEqual } from "node:crypto";

export const rugStore = () => getStore({ name: "prg-rugs", consistency: "strong" });
export const photoStore = () => getStore({ name: "prg-rug-photos", consistency: "strong" });

// The 36 rugs that were on the gallery page before the CMS existed (photos hosted on PhotoProofPro).
const PP = "https://cdn.photoproofpro.com/styles/large_thumb/s3/uploads/resized/6950/202149/";
const SEED = [
  "203753/15a661c7353250e366c3c3b141720438.jpg", "203753/14fd4f59ce35250135d457c7ee148980.jpg",
  "203753/f0187d26321d18466f2a696c78129000.jpg", "203753/683f63d0b4a2d011d03fec8230881a54.jpg",
  "203753/be79132117ccfee1efc6fa5e28ed19ab.jpg", "203753/727fb09869aeeecb1afc1c0089d1fdfc.jpg",
  "203753/4e0dee9442f0e58283a6e07d44de87b6.jpg", "203753/e34a82d740d8a1807b278cb899eef3e6.jpg",
  "203753/2f24786921c7c418b309e657d716293b.jpg", "203753/8485543087e79b2ac7b34227959b1477.jpg",
  "203753/cc20d3e23ca1555b212b6128fdf71c64.jpg", "203753/e96084e56c3c22486f1960fc596a80eb.jpg",
  "203753/30177aa026382e56921d746401183ab0.jpg", "203753/36dec943f8a253bcab31f089de14013f.jpg",
  "203753/9127ce505854df5ef80d81e869ecea1f.jpg", "203753/f7485c78a7c506094b86ae7ef8648dcf.jpg",
  "203852/cc9221b0943221a83ea69e9573a3a653.jpg", "203852/4b59a5fa1387284ae56e62ac2e81dbad.jpg",
  "203852/b2b590e724758725292e6361f3c89d5b.jpg", "203852/b278045030e127ee30af3f804493170d.jpg",
  "203852/8c68b103c4b4e521f3cc4f1cf76bd21e.jpg", "203852/eb86a319eade7878fb97eb1d86e14cf8.jpg",
  "203852/ea3df1f57932ea9ad03ef687dd8a8aef.jpg", "203852/4ae718a5cc577f9324f0808fd93818ff.jpg",
  "203852/7ced98bef5f81664be9ebc820c7ff251.jpg", "203852/783f0b35d56ea058be6559d2175dc84b.jpg",
  "203852/5b84c6ee21f8e765813f47e6e1aaac93.jpg", "203852/1e3cb2118a6bb6ff24b49cf71c70825b.jpg",
  "203852/97cec0018b55b23763be7b26aa4308ca.jpg", "203852/42301c518eebb6e2bf1b5e3ad17b65a7.jpg",
  "203852/9c4909e7b21afcc2fe0b66a3d2f5a8d7.jpg", "203852/e8a171bbbe5e5118fbfa3d8e7ca06898.jpg",
  "203852/f4eb578bf12a082a08932475ffe6a934.jpg", "203852/cb2baf993478c18a8d4939edce17f460.jpg",
  "203852/a2030801bee0c91b054a8a97860b201a.jpg", "203852/eda51438fc8cebef68f993b7ed56060e.jpg",
];

export const FIELDS = { stock: 40, name: 120, origin: 80, size: 60, age: 60, material: 80, price: 40, description: 4000,
  // Collection filters: blank = sorted automatically from the details above. turn = photo rotation ("" = auto).
  sizeCat: 20, ageCat: 20, styleCat: 20, turn: 10 };

// ---------- Collection filter groups (10/1/2026, per Renée's list) ----------
export const SIZE_GROUPS = ["3x5", "4x6", "5x7", "6x9", "8x10", "9x12", "10x14", "Large Gallery", "Runner"];
export const AGE_GROUPS = ["Antique", "New"];
export const STYLE_GROUPS = ["Persian", "Turkish", "Oriental"];
export const TURNS = ["", "left", "right", "none"];

// "9'7\"x12'6\"", "5'x7'", "3'x16'x7\"" (= 3' x 16'7"), "5'3\"x7\"" -> [shortFt, longFt]
export function parseSize(text) {
  let parts = String(text || "").toLowerCase().replace(/[×*]/g, "x").split("x").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 3) parts = [parts[0], parts[1] + parts[2]];
  if (parts.length !== 2) return null;
  const ft = (p) => {
    const n = (p.match(/\d+(?:\.\d+)?/g) || []).map(Number);
    if (!n.length) return NaN;
    return n[0] + (n.length > 1 && n[1] < 12 ? n[1] / 12 : 0);
  };
  const a = ft(parts[0]), b = ft(parts[1]);
  if (!(a > 0 && b > 0)) return null;
  return [Math.min(a, b), Math.max(a, b)];
}

const STD = [[3, 5], [4, 6], [5, 7], [6, 9], [8, 10], [9, 12], [10, 14]];
export function autoSize(text) {
  const d = parseSize(text);
  if (!d) return "";
  const [w, l] = d;
  if (w <= 4.2 && l / w >= 2.2) return "Runner";
  if (w > 10.6 || l > 14.6) return "Large Gallery";
  let best = 0, bd = Infinity;
  STD.forEach(([W, L], i) => { const dd = Math.hypot(w - W, l - L); if (dd < bd) { bd = dd; best = i; } });
  return `${STD[best][0]}x${STD[best][1]}`;
}
export function autoAge(rug) {
  const t = `${rug.name || ""} ${rug.age || ""}`;
  if (/\bnew\b|contemporary|modern/i.test(t)) return "New";
  const y = (String(rug.age || "").match(/\b(1[5-9]\d\d|20\d\d)\b/) || [])[1];
  if (y && +y >= 2000) return "New";
  return "Antique";
}
const PERSIAN_NAMES = /heriz|tabriz|kerman|kirman|mahal|malayer|kashan|isfahan|nain|qum|qom|bijar|bidjar|sarouk|saruk|hamadan|hamedan|bakht|baktiary|ardabil|ardebil|lilihan|liliyan|farahan|mishan|sarab|joshegan|ghochan|quchan|kurdish|senneh|sultanabad|mashad|mashhad|kazvin|qashqai|gabbeh|afshar/i;
export function autoStyle(rug) {
  const o = String(rug.origin || "");
  if (/pers|iran|azerbaijan|malayer/i.test(o)) return "Persian";
  if (/turk/i.test(o)) return "Turkish";
  if (o.trim()) return "Oriental";
  if (/oushak|ushak|kars|konya/i.test(rug.name || "")) return "Turkish";
  if (PERSIAN_NAMES.test(rug.name || "")) return "Persian";
  return "Oriental";
}
export function rugGroups(rug) {
  return {
    sizeGroup: SIZE_GROUPS.includes(rug.sizeCat) ? rug.sizeCat : autoSize(rug.size),
    ageGroup: AGE_GROUPS.includes(rug.ageCat) ? rug.ageCat : autoAge(rug),
    styleGroup: STYLE_GROUPS.includes(rug.styleCat) ? rug.styleCat : autoStyle(rug),
  };
}

const blankRug = () => Object.fromEntries(Object.keys(FIELDS).map((k) => [k, ""]));

function seedRugs() {
  const t = Date.now();
  return SEED.map((p, i) => ({
    id: "s" + String(i + 1).padStart(2, "0"),
    ...blankRug(),
    photo: { kind: "url", src: PP + p },
    created: t - i,
  }));
}

export async function loadRugs() {
  const s = rugStore();
  let data = await s.get("rugs", { type: "json" });
  if (!data || !Array.isArray(data.rugs)) {
    data = { rugs: seedRugs(), updated: new Date().toISOString() };
    await s.setJSON("rugs", data);
  }
  await runMigrations(s, data);
  return data.rugs;
}

// One-time data fixes. Each runs once; the "migrations" key records what has run.
// A migration may do slow work first (prepare), then apply() makes quick edits to a FRESH
// read of the rug list right before saving, so edits made meanwhile in the admin aren't lost.
const fillMaterial = (rugs) => {
  let n = 0;
  for (const r of rugs) if (!String(r.material || "").trim()) { r.material = "Cotton foundation, wool pile"; n++; }
  return n;
};

// 9/30/2026 — Renée: the main photo should show the whole rug. Full-rug angle from Liane's
// PhotoProofPro sets, copied into our own photo store like the original import.
const WHOLE_RUG = {
  "HER-26-111": "203753/5fba02639271c416659749a4ba5aca3e", // d
  "HER-26-115": "203753/c22df501ac6981cc3699d05e1da3596d", // d
  "HER-26-134": "203753/a024f7ee66f9cdbcc1631e3a6546c3b6", // g
  "HER-26-137": "203753/863f7900725100344e625abc130c48bd", // f
  "HER-26-139": "203753/37512ad2d3a912a6abc2938f56c4c9e7", // e
  "HER-26-145": "203753/15a223cba012c8c37cd7982cdd137e0d", // f
  "HER-26-160": "203753/39d10896339eb4c265dac900403e83f8", // d
  "HER-86-124": "203753/12dae23a063666130766a02781d73edb", // e
  "26766": "203852/2397a5a018f043d34965d20a96f229b8", // f
  "Ousha2": "203852/e5af41bd16f16a50b89314a634633280", // b
};

// 10/1/2026 — Liane's color-corrected full-rug photos (PhotoProofPro "Final Rugs", folder 206037). Approved by Amy.
const COLOR_CORRECTED = {
  "HER-86-124": "206037/e344bda31a153adca8e0026f620509ed",
  "HOR-26-156": "206037/a742c39a8ec9d0d0d01ed1efe940da31",
  "HER-26-111": "206037/5c0509c5723417146105da8b734b8923",
  "HER-26-115": "206037/18c47a1e85f2e6ae51ac791f10c56ec5",
  "HER-26-131": "206037/5a5980b84cb4c2b4fd07e07ad913bd97",
  "HER-19-1063": "206037/a5311ef909a25787798a73f027b5288f",
  "HER-26-139": "206037/2e637b3a13d8064809c10ac9c551c053",
  "HER-22": "206037/45e32a35ffc4508228416b388892a8dd",
  "HER-26-133": "206037/1ec83e9ae64534b1777e4fbbe59ea3d5",
  "HER-26-134": "206037/410f63400814e28b43e150dc7ada57b8",
  "HER-26-137": "206037/28dce0f6d76f4b579feebff9d304ac83",
};

// Copies PhotoProofPro photos (stock # -> "set/hash") into our photo store; returns the rug ids updated.
const copyPhotos = (map) => async (rugs) => {
  const base = "https://cdn.photoproofpro.com/";
  const ps = photoStore();
  const done = [];
  for (const r of rugs) {
    const key = map[String(r.stock || "").trim()];
    if (!key) continue;
    try {
      const [full, thumb] = await Promise.all([
        fetch(`${base}uploads/resized/6950/202149/${key}.jpg`),
        fetch(`${base}styles/large_thumb/s3/uploads/resized/6950/202149/${key}.jpg`),
      ]);
      if (!full.ok || !thumb.ok) continue;
      await ps.set(`${r.id}/full`, await full.arrayBuffer(), { metadata: { contentType: "image/jpeg" } });
      await ps.set(`${r.id}/thumb`, await thumb.arrayBuffer(), { metadata: { contentType: "image/jpeg" } });
      done.push(r.id);
    } catch (_) {}
  }
  return done;
};
const markBlob = (rugs, ids) => {
  const v = Date.now();
  let n = 0;
  for (const r of rugs) if (ids.includes(r.id)) { r.photo = { kind: "blob", v }; n++; }
  return n;
};

const MIGRATIONS = {
  "liane-color-corrected-2026-10-01": { prepare: copyPhotos(COLOR_CORRECTED), apply: markBlob },
  // 9/30/2026 — Renée: every rug's Material is "Cotton foundation, wool pile" (only blanks are filled).
  "material-cotton-wool": { apply: fillMaterial },
  // 9/30/2026 — refill any Material blanked by an admin tab opened before the first fill.
  "material-cotton-wool-2": { apply: fillMaterial },
  "whole-rug-main-photos": {
    prepare: async (rugs) => {
      const base = "https://cdn.photoproofpro.com/";
      const ps = photoStore();
      const done = [];
      for (const r of rugs) {
        const key = WHOLE_RUG[r.stock];
        if (!key || !r.photo) continue;
        try {
          const [full, thumb] = await Promise.all([
            fetch(`${base}uploads/resized/6950/202149/${key}.jpg`),
            fetch(`${base}styles/large_thumb/s3/uploads/resized/6950/202149/${key}.jpg`),
          ]);
          if (!full.ok || !thumb.ok) continue;
          await ps.set(`${r.id}/full`, await full.arrayBuffer(), { metadata: { contentType: "image/jpeg" } });
          await ps.set(`${r.id}/thumb`, await thumb.arrayBuffer(), { metadata: { contentType: "image/jpeg" } });
          done.push(r.id);
        } catch (_) {}
      }
      return done;
    },
    apply: (rugs, ids) => {
      const v = Date.now();
      let n = 0;
      for (const r of rugs) if (ids.includes(r.id)) { r.photo = { kind: "blob", v }; n++; }
      return n;
    },
  },
};

async function runMigrations(s, data) {
  const done = (await s.get("migrations", { type: "json" })) || {};
  const todo = Object.keys(MIGRATIONS).filter((k) => !done[k]);
  if (!todo.length) return;
  const prepared = {};
  for (const k of todo) prepared[k] = MIGRATIONS[k].prepare ? await MIGRATIONS[k].prepare(data.rugs) : null;
  const fresh = await s.get("rugs", { type: "json" });
  const rugs = (fresh && Array.isArray(fresh.rugs)) ? fresh.rugs : data.rugs;
  for (const k of todo) done[k] = { at: new Date().toISOString(), changed: MIGRATIONS[k].apply(rugs, prepared[k]) };
  await s.setJSON("rugs", { rugs, updated: new Date().toISOString() });
  await s.setJSON("migrations", done);
  data.rugs = rugs;
}

export async function saveRugs(rugs) {
  await rugStore().setJSON("rugs", { rugs, updated: new Date().toISOString() });
}

export function newId() {
  return "r" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export function cleanFields(input) {
  const out = {};
  for (const [k, max] of Object.entries(FIELDS)) {
    out[k] = String((input && input[k]) ?? "").replace(/\r\n/g, "\n").trim().slice(0, max);
  }
  return out;
}

export function imgUrl(rug, size) {
  const p = rug.photo;
  if (!p) return "";
  if (p.kind === "url") {
    const w = size === "thumb" ? 560 : 1400;
    return `/.netlify/images?url=${encodeURIComponent(p.src)}&w=${w}&q=76`;
  }
  return `/api/rug-photo?id=${encodeURIComponent(rug.id)}&s=${size}&v=${p.v || 0}`;
}

export function label(rug) {
  return rug.name || [rug.size, rug.origin].filter(Boolean).join(" ") || (rug.stock ? `Rug No. ${rug.stock}` : "Hand-knotted rug");
}

// Shown on the public site only once it has a photo and a name (unfinished rugs stay hidden until filled in).
export const isPublic = (rug) => !!(rug && rug.photo && String(rug.name || "").trim());

export function publicRug(rug) {
  return {
    id: rug.id,
    ...cleanFields(rug),
    label: label(rug),
    ...rugGroups(rug),
    thumb: imgUrl(rug, "thumb"),
    full: imgUrl(rug, "full"),
    url: `/rug/${rug.id}`,
  };
}

export function isAdmin(req) {
  const pw = process.env.PRG_ADMIN_PASSWORD || "";
  const given = req.headers.get("x-admin-key") || "";
  if (!pw || !given) return false;
  const a = createHash("sha256").update(pw).digest();
  const b = createHash("sha256").update(given).digest();
  return timingSafeEqual(a, b);
}

export const esc = (s) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function json(obj, status = 200, extra = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...extra },
  });
}
