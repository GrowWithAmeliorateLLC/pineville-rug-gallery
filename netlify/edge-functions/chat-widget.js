// Adds the GoHighLevel (LeadConnector) chat widget to every public HTML page,
// including the per-rug pages, without editing each page by hand.
// Widget is configured in GHL: Sites > Chat Widget ("A2P Compliance Chat Widget Mixed").
// Not added to the Rug Manager (/admin). If anything fails, the page is served unchanged.

const WIDGET = '<script src="https://widgets.leadconnectorhq.com/loader.js" data-resources-url="https://widgets.leadconnectorhq.com/chat-widget/loader.js" data-widget-id="6aca88a2acaaba2812095d64"></script>';

export default async (req, context) => {
  const res = await context.next();
  const type = res.headers.get("content-type") || "";
  if (!res.ok || !type.includes("text/html")) return res;
  const html = await res.text();
  if (html.includes("data-widget-id=") || !html.includes("</body>")) {
    return new Response(html, { status: res.status, headers: res.headers });
  }
  const out = html.replace(/<\/body>(?![\s\S]*<\/body>)/i, WIDGET + "\n</body>");
  const headers = new Headers(res.headers);
  headers.delete("content-length");
  return new Response(out, { status: res.status, headers });
};

export const config = {
  path: "/*",
  excludedPath: ["/admin", "/admin/*", "/api/*", "/.netlify/*", "/assets/*", "/old-media/*", "/sitemap.xml", "/robots.txt"],
  onError: "bypass",
};
