// Shared site behavior, added to every public page by netlify/edge-functions/chat-widget.js.
// Mobile menu: close it after a menu link is tapped, when tapping anywhere outside it,
// or when the page jumps to a new section. (Before, it stayed open and covered the page.)
(function () {
  var menu = document.querySelector("nav ul");
  var burger = document.querySelector(".burger");
  if (!menu || !burger) return;
  function isOpen() { return menu.style.display === "flex" && getComputedStyle(burger).display !== "none"; }
  function close() { if (menu.getAttribute("style")) menu.removeAttribute("style"); }
  menu.addEventListener("click", function (e) { if (e.target.closest("a")) close(); });
  document.addEventListener("click", function (e) {
    if (!isOpen()) return;
    if (menu.contains(e.target) || burger.contains(e.target)) return;
    close();
  });
  window.addEventListener("hashchange", close);
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });
})();
