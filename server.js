// ── Proxy Service: N1, Nova S ──────────────────────────────────────
const http = require("http");
const https = require("https");
const url = require("url");

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS, HEAD",
  "Access-Control-Allow-Headers": "*",
};
const NOVAS_URL = "https://best-str.umn.cdn.united.cloud/stream?stream=hp7000&sp=novas&channel=novashd&u=novas&p=n0v43!23t001&player=m3u8";
const N1_URL = "https://best-str.umn.cdn.united.cloud/stream?stream=sp1400&sp=n1info&channel=n1srp&u=n1info&p=n1Sh4redSecre7iNf0&player=m3u8"

function fetch(targetUrl, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const client = targetUrl.startsWith("https") ? https : http;
    const opts = {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120",
        ...extraHeaders,
      }
    };
    client.get(targetUrl, opts, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetch(res.headers.location, extraHeaders).then(resolve).catch(reject);
      }
      let data = Buffer.alloc(0);
      res.on("data", (chunk) => data = Buffer.concat([data, chunk]));
      res.on("end", () => resolve({ body: data.toString(), headers: res.headers, status: res.statusCode }));
    }).on("error", reject);
  });
}

function proxyStream(targetUrl, res, extraHeaders = {}) {
  const client = targetUrl.startsWith("https") ? https : http;
  client.get(targetUrl, {
    headers: { "User-Agent": "Mozilla/5.0", ...extraHeaders }
  }, (proxyRes) => {
    const headers = {};
    for (const [k, v] of Object.entries(proxyRes.headers)) {
      if (!k.toLowerCase().startsWith("access-control")) headers[k] = v;
    }
    Object.assign(headers, CORS_HEADERS);
    res.writeHead(proxyRes.statusCode, headers);
    proxyRes.pipe(res);
  }).on("error", (e) => {
    res.writeHead(502, CORS_HEADERS);
    res.end("Proxy error: " + e.message);
  });
}

function rewriteM3u8(content, baseUrl, proxyBase) {
  const base = new URL(baseUrl);
  const makeAbsolute = (u) => {
    try { return new URL(u).href; }
    catch { return new URL(u, base).href; }
  };
  return content.split("\n").map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return line;
    if (trimmed.startsWith("#")) {
      return line.replace(/URI="([^"]+)"/g, (_, uri) =>
        `URI="${proxyBase}/segment?url=${encodeURIComponent(makeAbsolute(uri))}"`
      );
    }
    return `${proxyBase}/segment?url=${encodeURIComponent(makeAbsolute(trimmed))}`;
  }).join("\n");
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") { res.writeHead(204, CORS_HEADERS); res.end(); return; }

  const parsed = url.parse(req.url, true);
  const path = parsed.pathname;
  const query = parsed.query;

  if (path === "/health") { res.writeHead(200, CORS_HEADERS); res.end("ok"); return; }

  // /novas — Nova S HLS (geo-blocked outside EU)
  if (path === "/novas") {
    try {
      const { body, headers } = await fetch(NOVAS_URL, {
        "Referer": "https://nova.rs/",
        "Origin": "https://nova.rs",
      });
      const proto = req.headers["x-forwarded-proto"] || "https";
      const proxyBase = `${proto}://${req.headers.host}`;
      const rewritten = rewriteM3u8(body, NOVAS_URL, proxyBase);
      res.writeHead(200, { ...CORS_HEADERS, "Content-Type": headers["content-type"] || "application/vnd.apple.mpegurl", "Cache-Control": "no-cache" });
      res.end(rewritten);
    } catch (e) {
      console.error("NovaS error:", e.message);
      res.writeHead(502, CORS_HEADERS);
      res.end("NovaS error: " + e.message);
    }
    return;
  }
  // /novasdebug — raw NovaS m3u8 for debugging
  if (path === "/novasdebug") {
    try {
      const { body, status } = await fetch(NOVAS_URL, { "Referer": "https://nova.rs/" });
      res.writeHead(200, { ...CORS_HEADERS, "Content-Type": "text/plain" });
      res.end(`HTTP ${status}\n\n${body}`);
    } catch (e) { res.writeHead(502, CORS_HEADERS); res.end(e.message); }
    return;
  }
  // /n1 — N1 HLS (geo-blocked outside EU)
  if (path === "/n1") {
    try {
      const { body, headers } = await fetch(N1_URL, {
        "Referer": "https://n1info.rs/",
        "Origin": "https://n1info.rs",
      });
      const proto = req.headers["x-forwarded-proto"] || "https";
      const proxyBase = `${proto}://${req.headers.host}`;
      const rewritten = rewriteM3u8(body, N1_URL, proxyBase);
      res.writeHead(200, { ...CORS_HEADERS, "Content-Type": headers["content-type"] || "application/vnd.apple.mpegurl", "Cache-Control": "no-cache" });
      res.end(rewritten);
    } catch (e) {
      console.error("N1 error:", e.message);
      res.writeHead(502, CORS_HEADERS);
      res.end("N1 error: " + e.message);
    }
    return;
  }
  // /n1debug — raw N1 m3u8 for debugging
  if (path === "/n1debug") {
    try {
      const { body, status } = await fetch(N1_URL, { "Referer": "https://n1info.rs/" });
      res.writeHead(200, { ...CORS_HEADERS, "Content-Type": "text/plain" });
      res.end(`HTTP ${status}\n\n${body}`);
    } catch (e) { res.writeHead(502, CORS_HEADERS); res.end(e.message); }
    return;
  }
  // /proxy?url= — generic m3u8 proxy
  if (path === "/proxy") {
    const targetUrl = query.url;
    if (!targetUrl) { res.writeHead(400, CORS_HEADERS); res.end("Missing url"); return; }
    try {
      const { body, headers } = await fetch(targetUrl);
      const proto = req.headers["x-forwarded-proto"] || "https";
      const proxyBase = `${proto}://${req.headers.host}`;
      const rewritten = rewriteM3u8(body, targetUrl, proxyBase);
      res.writeHead(200, { ...CORS_HEADERS, "Content-Type": headers["content-type"] || "application/vnd.apple.mpegurl", "Cache-Control": "no-cache" });
      res.end(rewritten);
    } catch (e) { res.writeHead(502, CORS_HEADERS); res.end("Failed: " + e.message); }
    return;
  }

  // /segment?url= — proxy individual segments or nested m3u8
  if (path === "/segment") {
    const targetUrl = query.url;
    if (!targetUrl) { res.writeHead(400, CORS_HEADERS); res.end("Missing url"); return; }
    if (targetUrl.includes(".m3u8") || targetUrl.includes("m3u8")) {
      try {
        const { body, headers } = await fetch(targetUrl);
        const proto = req.headers["x-forwarded-proto"] || "https";
        const proxyBase = `${proto}://${req.headers.host}`;
        const rewritten = rewriteM3u8(body, targetUrl, proxyBase);
        res.writeHead(200, { ...CORS_HEADERS, "Content-Type": headers["content-type"] || "application/vnd.apple.mpegurl", "Cache-Control": "no-cache" });
        res.end(rewritten);
      } catch (e) { res.writeHead(502, CORS_HEADERS); res.end("Failed: " + e.message); }
      return;
    }
    proxyStream(targetUrl, res);
    return;
  }

  res.writeHead(404, CORS_HEADERS);
  res.end("Not found");
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`Proxy service (N1, Nova S) on port ${PORT}`));
