/* Pineville Rug Gallery - rug photo helpers.
   - Upright photos: sideways (landscape) rug photos are turned to portrait, in the browser.
     Per-rug override from the admin: turn = "" (auto), "left", "right", "none".
   - Tap to zoom: any element with data-zoom="<full image url>" opens a full-screen viewer.
*/
(function () {
  var cache = {};

  function angleFor(img, turn) {
    if (turn === "none") return 0;
    if (turn === "left") return -90;
    if (turn === "right") return 90;
    return img.naturalWidth > img.naturalHeight * 1.05 ? 90 : 0; // auto
  }

  // Finds the rug inside a plain white/light studio background so the border can be trimmed.
  // Returns null when there's nothing worth trimming (under 2% on every side).
  function trimBox(ctx, W, H) {
    var d = ctx.getImageData(0, 0, W, H).data;
    var light = function (i) { return d[i] > 228 && d[i + 1] > 228 && d[i + 2] > 228; };
    var step = Math.max(1, Math.round(Math.min(W, H) / 300));
    var rowBusy = function (y) { var n = 0, t = 0; for (var x = 0; x < W; x += step) { t++; if (!light((y * W + x) * 4)) n++; } return n / t > 0.12; };
    var colBusy = function (x) { var n = 0, t = 0; for (var y = 0; y < H; y += step) { t++; if (!light((y * W + x) * 4)) n++; } return n / t > 0.12; };
    var top = 0, bot = H - 1, left = 0, right = W - 1;
    while (top < H / 3 && !rowBusy(top)) top += step;
    while (bot > H * 2 / 3 && !rowBusy(bot)) bot -= step;
    while (left < W / 3 && !colBusy(left)) left += step;
    while (right > W * 2 / 3 && !colBusy(right)) right -= step;
    var minW = W * 0.02, minH = H * 0.02;
    if (top < minH && left < minW && H - 1 - bot < minH && W - 1 - right < minW) return null;
    return { x: left, y: top, w: right - left + 1, h: bot - top + 1 };
  }

  // Resolves to a URL for an upright copy of the image (or the original when no turn is needed).
  function upright(src, turn) {
    var key = src + "|" + (turn || "");
    if (cache[key]) return cache[key];
    cache[key] = new Promise(function (resolve) {
      var img = new Image();
      img.decoding = "async";
      img.onload = function () {
        try {
          var a = angleFor(img, turn || "");
          var w = img.naturalWidth, h = img.naturalHeight;
          var c = document.createElement("canvas");
          c.width = a ? h : w; c.height = a ? w : h;
          var ctx = c.getContext("2d");
          ctx.translate(c.width / 2, c.height / 2);
          ctx.rotate(a * Math.PI / 180);
          ctx.drawImage(img, -w / 2, -h / 2);
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          var box = trimBox(ctx, c.width, c.height);
          if (!a && !box) return resolve(src);
          var out = c;
          if (box) {
            out = document.createElement("canvas");
            out.width = box.w; out.height = box.h;
            out.getContext("2d").drawImage(c, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
          }
          out.toBlob(function (b) { resolve(b ? URL.createObjectURL(b) : src); }, "image/jpeg", 0.9);
        } catch (e) { resolve(src); }
      };
      img.onerror = function () { resolve(src); };
      img.src = src;
    });
    return cache[key];
  }

  // <img data-upright="<src>" data-turn="..."> - loads lazily, then swaps in the upright copy.
  function wire(root) {
    var els = (root || document).querySelectorAll("img[data-upright]:not([data-wired])");
    var go = function (el) {
      upright(el.getAttribute("data-upright"), el.getAttribute("data-turn") || "").then(function (u) {
        el.src = u; el.classList.add("ready");
      });
    };
    var io = "IntersectionObserver" in window ? new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) { io.unobserve(en.target); go(en.target); } });
    }, { rootMargin: "400px" }) : null;
    els.forEach(function (el) { el.setAttribute("data-wired", "1"); io ? io.observe(el) : go(el); });
  }

  // ---------- zoom viewer ----------
  var box, pic, scale = 1;
  function ensureBox() {
    if (box) return;
    var st = document.createElement("style");
    st.textContent =
      ".rz-box{position:fixed;inset:0;z-index:999;background:rgba(10,14,12,.94);display:none;align-items:center;justify-content:center;overflow:hidden;touch-action:none}" +
      ".rz-box.on{display:flex}" +
      ".rz-box img{max-width:96vw;max-height:94vh;object-fit:contain;transition:transform .25s ease;cursor:zoom-in;user-select:none;-webkit-user-drag:none}" +
      ".rz-box.zoomed img{cursor:zoom-out;transition:none}" +
      ".rz-x{position:absolute;top:14px;right:16px;width:46px;height:46px;border-radius:50%;border:1px solid rgba(255,255,255,.4);background:rgba(0,0,0,.35);color:#fff;font-size:26px;line-height:42px;text-align:center;cursor:pointer}" +
      ".rz-tip{position:absolute;bottom:16px;left:0;right:0;text-align:center;color:rgba(255,255,255,.75);font:400 13px/1.4 Jost,sans-serif;letter-spacing:.06em}";
    document.head.appendChild(st);
    box = document.createElement("div");
    box.className = "rz-box";
    box.innerHTML = '<img alt=""><button class="rz-x" aria-label="Close">\\u00d7</button><div class="rz-tip">Tap the rug to zoom in \\u00b7 drag to look around</div>';
    document.body.appendChild(box);
    pic = box.querySelector("img");
    box.querySelector(".rz-x").addEventListener("click", close);
    box.addEventListener("click", function (e) { if (e.target === box) close(); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });

    var pan = function (x, y) {
      var r = pic.getBoundingClientRect();
      // transform-origin is relative to the unscaled layout box
      var w = pic.offsetWidth, h = pic.offsetHeight;
      var left = (window.innerWidth - w) / 2, top = (window.innerHeight - h) / 2;
      var ox = Math.max(0, Math.min(1, (x - left) / w)) * 100, oy = Math.max(0, Math.min(1, (y - top) / h)) * 100;
      pic.style.transformOrigin = ox + "% " + oy + "%";
    };
    pic.addEventListener("click", function (e) {
      e.stopPropagation();
      scale = scale > 1 ? 1 : 2.6;
      box.classList.toggle("zoomed", scale > 1);
      pan(e.clientX, e.clientY);
      pic.style.transform = "scale(" + scale + ")";
    });
    box.addEventListener("pointermove", function (e) { if (scale > 1) pan(e.clientX, e.clientY); });
  }
  function open(src, turn) {
    ensureBox();
    scale = 1; pic.style.transform = ""; box.classList.remove("zoomed");
    pic.removeAttribute("src");
    box.classList.add("on");
    document.documentElement.style.overflow = "hidden";
    upright(src, turn).then(function (u) { pic.src = u; });
  }
  function close() {
    if (!box) return;
    box.classList.remove("on");
    document.documentElement.style.overflow = "";
  }
  document.addEventListener("click", function (e) {
    var t = e.target.closest && e.target.closest("[data-zoom]");
    if (!t) return;
    e.preventDefault();
    open(t.getAttribute("data-zoom"), t.getAttribute("data-turn") || "");
  });

  window.PRGRugs = { upright: upright, wire: wire, zoom: open };
  if (document.readyState !== "loading") wire(); else document.addEventListener("DOMContentLoaded", function () { wire(); });
})();
