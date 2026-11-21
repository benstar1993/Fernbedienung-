#!/usr/bin/env node
/* Messe-Technik Sync-Server – ohne externe Abhängigkeiten (Node ≥ 18).
 *
 *   node server/server.js
 *
 * Umgebungsvariablen:
 *   PORT=8080              Port
 *   TOKEN=geheim           optionaler Zugangscode (Header X-Token oder ?token=)
 *   DATA_DIR=./server/data Ablage für Stände und Fotos
 *   TLS_CERT / TLS_KEY     Pfade zu Zertifikat/Schlüssel → HTTPS (für Kamera auf Handys nötig)
 */
const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

const PORT = +process.env.PORT || 8080;
const TOKEN = process.env.TOKEN || "";
const PUBLIC = path.join(__dirname, "..", "public");
const DATA = path.resolve(process.env.DATA_DIR || path.join(__dirname, "data"));
const PHOTOS = path.join(DATA, "photos");
fs.mkdirSync(PHOTOS, { recursive: true });

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".png": "image/png", ".ico": "image/x-icon" };
const SAFE = /^[A-Za-z0-9_.-]{1,80}$/;

/* ---------- Stände je Projekt ---------- */
const projects = new Map();
function load(id) {
  if (!SAFE.test(id)) throw Object.assign(new Error("ungültiges Projekt"), { code: 400 });
  if (!projects.has(id)) {
    const f = path.join(DATA, `${id}.json`);
    let st = { seq: 0, fields: {} };
    try { st = JSON.parse(fs.readFileSync(f, "utf8")); } catch {}
    projects.set(id, { st, file: f, timer: null });
  }
  return projects.get(id);
}
function save(p) {
  clearTimeout(p.timer);
  p.timer = setTimeout(() => {
    const tmp = p.file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(p.st));
    fs.renameSync(tmp, p.file);
  }, 300);
}
const newer = (a, b) => !b || a.t > b.t || (a.t === b.t && String(a.by || "") > String(b.by || ""));

function sync(body) {
  const p = load(String(body.project || "default"));
  const st = p.st;
  let dirty = false;
  for (const c of Array.isArray(body.changes) ? body.changes : []) {
    if (typeof c.pos !== "string" || typeof c.key !== "string" || typeof c.t !== "number") continue;
    if (c.key.length > 300 || c.pos.length > 60) continue;
    const k = `${c.pos}|${c.key}`;
    const rec = { v: c.v ?? null, t: c.t, by: String(c.by || "").slice(0, 60) };
    if (newer(rec, st.fields[k])) { rec.seq = ++st.seq; st.fields[k] = rec; dirty = true; }
  }
  if (dirty) save(p);
  const since = +body.since || 0;
  const changes = [];
  for (const [k, r] of Object.entries(st.fields)) {
    if (r.seq > since) { const i = k.indexOf("|"); changes.push({ pos: k.slice(0, i), key: k.slice(i + 1), v: r.v, t: r.t, by: r.by }); }
  }
  return { seq: st.seq, changes };
}

/* ---------- HTTP ---------- */
function send(res, code, body, type = "application/json; charset=utf-8") {
  res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on("data", (c) => { n += c.length; if (n > limit) { reject(Object.assign(new Error("zu groß"), { code: 413 })); req.destroy(); } else chunks.push(c); });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function handler(req, res) {
  const url = new URL(req.url, "http://x");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Token");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
  if (req.method === "OPTIONS") return send(res, 204, "");

  try {
    if (url.pathname.startsWith("/api/")) {
      if (url.pathname === "/api/ping") return send(res, 200, { app: "messe-technik", auth: !!TOKEN });
      const tok = req.headers["x-token"] || url.searchParams.get("token") || "";
      if (TOKEN && tok !== TOKEN) return send(res, 401, { error: "Zugangscode falsch" });

      if (url.pathname === "/api/sync" && req.method === "POST") {
        const body = JSON.parse((await readBody(req, 20e6)).toString("utf8") || "{}");
        return send(res, 200, sync(body));
      }
      const m = url.pathname.match(/^\/api\/photos\/([^/]+)$/);
      if (m) {
        const id = decodeURIComponent(m[1]);
        if (!SAFE.test(id)) return send(res, 400, { error: "ungültige ID" });
        const f = path.join(PHOTOS, id + ".jpg");
        if (req.method === "PUT") {
          const buf = await readBody(req, 25e6);
          fs.writeFileSync(f, buf);
          return send(res, 200, { ok: true });
        }
        if (req.method === "GET") {
          if (!fs.existsSync(f)) return send(res, 404, { error: "nicht gefunden" });
          res.writeHead(200, { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=31536000, immutable" });
          return fs.createReadStream(f).pipe(res);
        }
      }
      return send(res, 404, { error: "unbekannt" });
    }

    // statische Dateien
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith("/")) rel += "index.html";
    const f = path.join(PUBLIC, path.normalize(rel));
    if (!f.startsWith(PUBLIC)) return send(res, 403, "verboten", "text/plain");
    fs.stat(f, (err, s) => {
      if (err || !s.isFile()) return send(res, 404, "nicht gefunden", "text/plain");
      const ext = path.extname(f);
      const cache = rel.startsWith("/data/tiles/") || rel.startsWith("/data/booklet/") ? "public, max-age=86400" : "no-cache";
      res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream", "Content-Length": s.size, "Cache-Control": cache });
      fs.createReadStream(f).pipe(res);
    });
  } catch (e) {
    send(res, e.code && e.code < 600 ? e.code : 500, { error: e.message });
  }
}

const tls = process.env.TLS_CERT && process.env.TLS_KEY;
const server = tls
  ? https.createServer({ cert: fs.readFileSync(process.env.TLS_CERT), key: fs.readFileSync(process.env.TLS_KEY) }, handler)
  : http.createServer(handler);
server.listen(PORT, () => {
  console.log(`Messe-Technik läuft auf ${tls ? "https" : "http"}://localhost:${PORT}  (Daten: ${DATA}${TOKEN ? ", Zugangscode aktiv" : ""})`);
  const nets = require("os").networkInterfaces();
  for (const list of Object.values(nets)) for (const n of list || []) if (n.family === "IPv4" && !n.internal) console.log(`  im Netzwerk: ${tls ? "https" : "http"}://${n.address}:${PORT}`);
});
function flush() { for (const p of projects.values()) { clearTimeout(p.timer); fs.writeFileSync(p.file, JSON.stringify(p.st)); } process.exit(0); }
process.on("SIGINT", flush);
process.on("SIGTERM", flush);
