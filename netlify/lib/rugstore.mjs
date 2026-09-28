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

export const FIELDS = { name: 120, origin: 80, size: 60, age: 60, material: 80, price: 40, description: 4000 };

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
  return data.rugs;
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
  return rug.name || [rug.size, rug.origin].filter(Boolean).join(" ") || "Hand-knotted rug";
}

export function publicRug(rug) {
  return {
    id: rug.id,
    ...cleanFields(rug),
    label: label(rug),
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
