/* Lokale Datenhaltung im Browser (IndexedDB) – kein Server nötig.
 *
 * Datenmodell: je POS eine Menge von Feldern  key -> {v, t, by}
 *   status              "vorbereitet" | "bearbeitung" | "pruefen" | "erledigt"
 *   note                Freitext
 *   sn:<gerät>:<n>      Seriennummer (gerät = Artikel#lfdNr innerhalb der POS)
 *   photo:<id>          {w, h, size} oder null (= gelöscht)
 * Abgleich zwischen Geräten per Export/Import: pro Feld gewinnt der jüngste
 * Zeitstempel (t), bei Gleichstand der Name. Fotos liegen als Blob in IndexedDB.
 */
(function () {
  const DB_NAME = "messe-technik";
  const LS = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } };
  const LSset = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

  let db;
  const fields = new Map();   // pos -> Map(key -> {v,t,by})
  const listeners = new Set();
  const project = { id: "default" };

  function openDB() {
    return new Promise((res, rej) => {
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        d.createObjectStore("fields");   // key: project|pos|field
        d.createObjectStore("blobs");    // key: photo id
        d.createObjectStore("meta");
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  const tx = (store, mode, fn) => new Promise((res, rej) => {
    const t = db.transaction(store, mode);
    const out = fn(t.objectStore(store));
    t.oncomplete = () => res(out && "result" in out ? out.result : out);
    t.onerror = () => rej(t.error);
  });

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
    },

    setUser(name) { this.user = name; LSset("mt.user", name); },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    get(pos, key) { const m = fields.get(pos); return m ? m.get(key) : undefined; },
    val(pos, key) { const r = this.get(pos, key); return r ? r.v : undefined; },
    entries(pos) { return fields.get(pos) || new Map(); },

    async set(pos, key, v) {
      const rec = { v: v === "" ? null : v, t: Date.now(), by: this.user || "?" };
      applyLocal(pos, key, rec);
      await persist([{ pos, key, ...rec }]);
      emit(new Set([pos]));
    },

    /* Merge von außen (Import). Gibt Menge geänderter POS zurück. */
    async merge(changes) {
      const changed = new Set();
      const keep = [];
      for (const c of changes) {
        if (applyLocal(c.pos, c.key, { v: c.v, t: c.t, by: c.by })) { changed.add(c.pos); keep.push(c); }
      }
      if (keep.length) await persist(keep);
      if (changed.size) emit(changed);
      return changed;
    },

    /* ---------- Fotos ---------- */
    async addPhoto(pos, file) {
      const { blob, w, h } = await resizeImage(file, 1920, 0.82);
      const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      await tx("blobs", "readwrite", (s) => s.put(blob, id));
      await this.set(pos, "photo:" + id, { w, h, size: blob.size });
      return id;
    },
    async deletePhoto(pos, id) { await this.set(pos, "photo:" + id, null); },
    photos(pos) {
      const out = [];
      for (const [k, r] of this.entries(pos)) if (k.startsWith("photo:") && r.v) out.push({ id: k.slice(6), ...r });
      return out.sort((a, b) => a.t - b.t);
    },
    async photoBlob(id) { return tx("blobs", "readonly", (s) => s.get(id)); },
    async photoURL(id) { const b = await this.photoBlob(id); return b ? URL.createObjectURL(b) : null; },

    /* ---------- Export / Import ---------- */
    async exportJSON(withPhotos = true) {
      const out = { format: "messe-technik-export", version: 1, project: project.id, exported: new Date().toISOString(), by: this.user, fields: [], photos: {} };
      for (const [pos, m] of fields) for (const [key, r] of m) out.fields.push({ pos, key, ...r });
      if (withPhotos) {
        for (const f of out.fields) {
          if (!f.key.startsWith("photo:") || !f.v) continue;
          const id = f.key.slice(6);
          const b = await this.photoBlob(id);
          if (b) out.photos[id] = await blobToDataURL(b);
        }
      }
      return out;
    },
    async importJSON(data) {
      if (!data || data.format !== "messe-technik-export") throw new Error("Keine gültige Exportdatei");
      if (data.project && data.project !== project.id) throw new Error(`Export gehört zu Projekt „${data.project}“`);
      for (const [id, url] of Object.entries(data.photos || {})) {
        if (!(await this.photoBlob(id))) await tx("blobs", "readwrite", (s) => s.put(dataURLToBlob(url), id));
      }
      return this.merge(data.fields || []);
    },
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
  function dataURLToBlob(url) {
    // ohne fetch(), damit es auch bei geöffneter Datei (file://) funktioniert
    const [head, b64] = url.split(",");
    const type = (head.match(/data:([^;]+)/) || [])[1] || "image/jpeg";
    const bin = atob(b64), arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type });
  }

  window.Store = Store;
})();
