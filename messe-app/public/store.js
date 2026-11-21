/* Lokale Datenhaltung (IndexedDB) + optionaler Abgleich mit dem Sync-Server.
 *
 * Datenmodell: je POS eine Menge von Feldern  key -> {v, t, by}
 *   status              "vorbereitet" | "bearbeitung" | "pruefen" | "erledigt"
 *   note                Freitext
 *   sn:<gerät>:<n>      Seriennummer (gerät = Artikel#lfdNr innerhalb der POS)
 *   photo:<id>          {w, h, size} oder null (= gelöscht)
 * Zusammenführen: pro Feld gewinnt der jüngste Zeitstempel (t), bei Gleichstand der Name.
 * Fotos selbst liegen als Blob in IndexedDB und werden separat hochgeladen.
 */
(function () {
  const DB_NAME = "messe-technik";
  const LS = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } };
  const LSset = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

  let db;
  const fields = new Map();   // pos -> Map(key -> {v,t,by})
  const listeners = new Set();
  let outbox = [];            // [{pos,key,v,t,by}]
  const project = { id: "default" };

  function openDB() {
    return new Promise((res, rej) => {
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        d.createObjectStore("fields");   // key: project|pos|field
        d.createObjectStore("blobs");    // key: photo id
        d.createObjectStore("meta");     // outbox, lastSeq, uploaded
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  const tx = (store, mode, fn) => new Promise((res, rej) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    const out = fn(s);
    t.oncomplete = () => res(out && "result" in out ? out.result : out);
    t.onerror = () => rej(t.error);
  });
  const getMeta = (k) => tx("meta", "readonly", (s) => s.get(project.id + "|" + k));
  const setMeta = (k, v) => tx("meta", "readwrite", (s) => s.put(v, project.id + "|" + k));

  const newer = (a, b) => !b || a.t > b.t || (a.t === b.t && String(a.by || "") > String(b.by || ""));

  function applyLocal(pos, key, rec) {
    let m = fields.get(pos);
    if (!m) fields.set(pos, (m = new Map()));
    const cur = m.get(key);
    if (cur && !newer(rec, cur)) return false;
    m.set(key, rec);
    return true;
  }

  async function persist(changes) {
    await tx("fields", "readwrite", (s) => {
      for (const c of changes) s.put({ v: c.v, t: c.t, by: c.by }, `${project.id}|${c.pos}|${c.key}`);
    });
  }

  function emit(posSet) { for (const fn of listeners) try { fn(posSet); } catch (e) { console.error(e); } }

  const Store = {
    user: LS("mt.user", ""),
    settings: Object.assign({ server: "", token: "", auto: true }, LS("mt.settings", {})),
    syncInfo: { state: "local", text: "nur lokal", last: null },

    async init(projectId) {
      project.id = projectId || "default";
      db = await openDB();
      const all = await tx("fields", "readonly", (s) => {
        const out = [];
        s.openCursor().onsuccess = (e) => {
          const c = e.target.result;
          if (!c) return;
          const [p, pos, ...rest] = String(c.key).split("|");
          if (p === project.id) out.push([pos, rest.join("|"), c.value]);
          c.continue();
        };
        return out;
      });
      for (const [pos, key, rec] of all) applyLocal(pos, key, rec);
      outbox = (await getMeta("outbox")) || [];
    },

    setUser(name) { this.user = name; LSset("mt.user", name); },
    saveSettings() { LSset("mt.settings", this.settings); },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    get(pos, key) { const m = fields.get(pos); return m ? m.get(key) : undefined; },
    val(pos, key) { const r = this.get(pos, key); return r ? r.v : undefined; },
    entries(pos) { return fields.get(pos) || new Map(); },
    allPositions() { return [...fields.keys()]; },
    pending() { return outbox.length; },

    async set(pos, key, v) {
      const rec = { v: v === "" ? null : v, t: Date.now(), by: this.user || "?" };
      applyLocal(pos, key, rec);
      const ch = { pos, key, ...rec };
      outbox.push(ch);
      await persist([ch]);
      await setMeta("outbox", outbox);
      emit(new Set([pos]));
      Sync.soon();
    },

    /* Merge von außen (Server oder Import). Gibt Menge geänderter POS zurück. */
    async merge(changes, { fromServer = false } = {}) {
      const changed = new Set();
      const keep = [];
      for (const c of changes) {
        if (applyLocal(c.pos, c.key, { v: c.v, t: c.t, by: c.by })) { changed.add(c.pos); keep.push(c); }
      }
      if (keep.length) await persist(keep);
      if (!fromServer && keep.length) { outbox.push(...keep); await setMeta("outbox", outbox); Sync.soon(); }
      if (changed.size) emit(changed);
      return changed;
    },

    /* ---------- Fotos ---------- */
    async addPhoto(pos, file) {
      const { blob, w, h } = await resizeImage(file, 1920, 0.82);
      const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      await tx("blobs", "readwrite", (s) => s.put(blob, id));
      await this.set(pos, "photo:" + id, { w, h, size: blob.size, pos });
      return id;
    },
    async deletePhoto(pos, id) { await this.set(pos, "photo:" + id, null); },
    photos(pos) {
      const out = [];
      for (const [k, r] of this.entries(pos)) if (k.startsWith("photo:") && r.v) out.push({ id: k.slice(6), ...r });
      return out.sort((a, b) => a.t - b.t);
    },
    async photoBlob(id) { return tx("blobs", "readonly", (s) => s.get(id)); },
    async photoURL(id) {
      const b = await this.photoBlob(id);
      if (b) return URL.createObjectURL(b);
      if (Sync.base()) return `${Sync.base()}/api/photos/${encodeURIComponent(id)}${Sync.tokenQuery()}`;
      return null;
    },
    async isUploaded(id) { const u = (await getMeta("uploaded")) || {}; return !!u[id]; },

    /* ---------- Export / Import ---------- */
    async exportJSON(withPhotos = true) {
      const out = { format: "messe-technik-export", version: 1, project: project.id, exported: new Date().toISOString(), by: this.user, fields: [], photos: {} };
      for (const [pos, m] of fields) for (const [key, r] of m) out.fields.push({ pos, key, ...r });
      if (withPhotos) {
        for (const f of out.fields) {
          if (!f.key.startsWith("photo:") || !f.v) continue;
          const id = f.key.slice(6);
          let b = await this.photoBlob(id);
          if (!b && Sync.base()) { try { b = await (await fetch(await this.photoURL(id))).blob(); } catch {} }
          if (b) out.photos[id] = await blobToDataURL(b);
        }
      }
      return out;
    },
    async importJSON(data) {
      if (!data || data.format !== "messe-technik-export") throw new Error("Keine gültige Exportdatei");
      if (data.project && data.project !== project.id) throw new Error(`Export gehört zu Projekt „${data.project}“`);
      for (const [id, url] of Object.entries(data.photos || {})) {
        const exists = await this.photoBlob(id);
        if (!exists) { const b = await (await fetch(url)).blob(); await tx("blobs", "readwrite", (s) => s.put(b, id)); }
      }
      return this.merge(data.fields || []);
    },
    _db: () => db,
    _meta: { get: getMeta, set: setMeta },
    _outbox: () => outbox,
    _setOutbox: async (o) => { outbox = o; await setMeta("outbox", outbox); },
    _blobPut: (id, b) => tx("blobs", "readwrite", (s) => s.put(b, id)),
  };

  /* ---------- Sync ---------- */
  let timer = null, running = false, again = false, poll = null;
  const Sync = {
    base() {
      const s = Store.settings.server.trim().replace(/\/+$/, "");
      if (s) return s;
      return Sync.sameOrigin ? location.origin + location.pathname.replace(/\/[^/]*$/, "") : "";
    },
    sameOrigin: false,
    tokenQuery() { return Store.settings.token ? `?token=${encodeURIComponent(Store.settings.token)}` : ""; },
    headers(extra) { return Object.assign({ "X-Token": Store.settings.token || "" }, extra || {}); },

    async detect() {
      // Läuft die App auf dem Sync-Server selbst, wird er automatisch verwendet.
      try {
        const r = await fetch("api/ping", { cache: "no-store" });
        if (r.ok && (await r.json()).app === "messe-technik") Sync.sameOrigin = true;
      } catch {}
    },
    setState(state, text) {
      Store.syncInfo = { state, text, last: state === "ok" ? new Date() : Store.syncInfo.last };
      emit(new Set());
    },
    soon(ms = 800) {
      if (!Sync.base() || !Store.settings.auto) { if (!Sync.base()) Sync.setState("local", "nur lokal"); return; }
      clearTimeout(timer);
      timer = setTimeout(() => Sync.run(), ms);
    },
    start() {
      clearInterval(poll);
      if (Sync.base() && Store.settings.auto) { poll = setInterval(() => Sync.run(), 15000); Sync.run(); }
      else Sync.setState("local", Sync.base() ? "Sync pausiert" : "nur lokal");
    },
    async run() {
      const base = Sync.base();
      if (!base) return;
      if (running) { again = true; return; }
      running = true;
      Sync.setState("busy", "synchronisiere …");
      try {
        const since = (await getMeta("lastSeq")) || 0;
        const sending = outbox.slice();
        const r = await fetch(`${base}/api/sync`, {
          method: "POST", headers: Sync.headers({ "Content-Type": "application/json" }),
          body: JSON.stringify({ project: project.id, since, changes: sending }),
        });
        if (r.status === 401) throw new Error("Zugangscode falsch");
        if (!r.ok) throw new Error(`Server ${r.status}`);
        const res = await r.json();
        outbox = outbox.slice(sending.length);
        await setMeta("outbox", outbox);
        await Store.merge(res.changes || [], { fromServer: true });
        await setMeta("lastSeq", res.seq);
        await Sync.uploadPhotos(base);
        Sync.setState("ok", outbox.length ? `${outbox.length} ausstehend` : "synchron");
      } catch (e) {
        Sync.setState("err", navigator.onLine === false ? "offline" : `Fehler: ${e.message}`);
      } finally {
        running = false;
        if (again) { again = false; Sync.soon(300); }
      }
    },
    async uploadPhotos(base) {
      const up = (await getMeta("uploaded")) || {};
      const ids = await tx("blobs", "readonly", (s) => s.getAllKeys());
      for (const id of ids) {
        if (up[id]) continue;
        const blob = await Store.photoBlob(id);
        const r = await fetch(`${base}/api/photos/${encodeURIComponent(id)}?project=${encodeURIComponent(project.id)}`, {
          method: "PUT", headers: Sync.headers({ "Content-Type": blob.type || "image/jpeg" }), body: blob,
        });
        if (!r.ok) throw new Error(`Foto-Upload ${r.status}`);
        up[id] = Date.now();
        await setMeta("uploaded", up);
        emit(new Set(["__photos"]));
      }
    },
    async resetCursor() { await setMeta("lastSeq", 0); },
  };

  /* ---------- Helfer ---------- */
  function resizeImage(file, max, quality) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.round(img.naturalWidth * s), h = Math.round(img.naturalHeight * s);
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        c.getContext("2d").drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        c.toBlob((b) => (b ? res({ blob: b, w, h }) : rej(new Error("Bild konnte nicht verarbeitet werden"))), "image/jpeg", quality);
      };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("Bildformat nicht lesbar")); };
      img.src = url;
    });
  }
  function blobToDataURL(b) {
    return new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(b); });
  }

  window.addEventListener("online", () => Sync.soon(100));
  window.Store = Store;
  window.Sync = Sync;
})();
