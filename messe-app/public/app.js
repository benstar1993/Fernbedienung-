/* Messe-Technik – Hallenplan, POS-Details, Seriennummern, Status, Fotos */
(function () {
  const STATUS = [
    { id: "vorbereitet", label: "Vorbereitet", color: "#64748b" },
    { id: "bearbeitung", label: "In Bearbeitung", color: "#e08a00" },
    { id: "pruefen", label: "Zum Prüfen", color: "#7a3fd1" },
    { id: "erledigt", label: "Erledigt", color: "#1f9d55" },
  ];
  const ST = Object.fromEntries(STATUS.map((s) => [s.id, s]));
  const CAUSE = {
    vorschaden: { label: "Vorschaden", cls: "c-vor" },
    aufbau: { label: "Beim Aufbau passiert", cls: "c-aufbau" },
    unbekannt: { label: "Unbekannt", cls: "c-unb" },
  };
  const openDamages = (pid) => Store.damages(pid).filter((d) => !d.behoben);
  const ICON = {
    scan: '<svg viewBox="0 0 24 24"><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 8v8M10 8v8M13 8v8M17 8v8"/></svg>',
    cam: '<svg viewBox="0 0 24 24"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>',
    img: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>',
    pin: '<svg viewBox="0 0 24 24"><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>',
    left: '<svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>',
    right: '<svg viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg>',
    x: '<svg viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>',
    warn: '<svg viewBox="0 0 24 24"><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>',
  };

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }) : "");
  const fmtTime = (t) => (t ? new Date(t).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "");
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  let D;                 // project.json
  let POS = new Map();   // id -> pos
  let map, markers = new Map(), dmgMarkers = new Map(), markerR = 10, current = null, pendingRender = false;

  /* ---------------- Status / Seriennummern ---------------- */
  const statusOf = (pid) => Store.val(pid, "status") || "vorbereitet";
  const serialDevices = (p) => p.geraete.filter((g) => g.serial && g.menge > 0);
  function serialProgress(p) {
    let total = 0, done = 0;
    for (const g of serialDevices(p)) for (let n = 1; n <= g.menge; n++) { total++; if (Store.val(p.id, `sn:${g.key}:${n}`)) done++; }
    return { total, done };
  }
  const hasMT = (p) => p.relevant || p.geraete.length > 0 || p.kabel.length > 0;

  /* ---------------- Start ---------------- */
  async function boot() {
    // Daten kommen aus data/project.js (Script-Tag) – funktioniert auch per Doppelklick (file://)
    D = window.PROJECT_DATA;
    if (!D) throw new Error("data/project.js fehlt");
    D.pos.forEach((p) => POS.set(p.id, p));
    const e = D.event;
    const projectId = [e.Kunde, e.Messe, e.Jahr].filter(Boolean).join("-").replace(/\s+/g, "_") || "projekt";
    await Store.init(projectId);

    document.title = `${e.Messe || "Messe"} ${e.Jahr || ""} · Messe-Technik`;
    $("#eventTitle").textContent = `${e.Messe || ""} ${e.Jahr || ""}`.trim() || "Messe-Technik";
    $("#eventSub").textContent = `${e.Kunde || ""} · ${fmtDate(e["Messe von"])}–${fmtDate(e["Messe bis"])}`;
    $("#planSub").textContent = e.Ort || "";

    initNav();
    initMap();
    initList();
    renderDocs();
    renderSettings();
    initModals();
    updateUser();
    renderStats();

    Store.onChange((changed) => {
      if (!changed || !changed.size) return;
      for (const pid of changed) updateMarker(pid);
      renderStats();
      if ($("#view-list").classList.contains("active")) renderList();
      if (current && (changed.has(current))) {
        const a = document.activeElement;
        if (a && $("#drawer").contains(a) && a.matches("input,textarea")) pendingRender = true;
        else renderDetail(current);
      }
    });
    if (!Store.user) openNameModal();
    handleHash();
    window.addEventListener("hashchange", handleHash);
  }

  /* ---------------- Navigation ---------------- */
  function initNav() {
    $$(".nav-item").forEach((b) => b.addEventListener("click", () => showView(b.dataset.view)));
  }
  function showView(v) {
    $$(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.view === v));
    $$(".view").forEach((s) => s.classList.toggle("active", s.id === "view-" + v));
    if (v === "plan" && map) setTimeout(() => map.invalidateSize(), 0);
    if (v === "list") renderList();
    if (v === "settings") renderSettings();
  }
  function handleHash() {
    const m = location.hash.match(/^#pos\/(.+)$/);
    if (m && POS.has(decodeURIComponent(m[1]))) openDetail(decodeURIComponent(m[1]), { fromHash: true });
    else if (current) closeDetail({ fromHash: true });
  }

  /* ---------------- Hallenplan ---------------- */
  function initMap() {
    const P = D.plan, Z = P.maxZoom;
    map = L.map("map", { crs: L.CRS.Simple, minZoom: -1, maxZoom: Z + 1, zoomSnap: 0.25, zoomDelta: 0.5, attributionControl: false, wheelPxPerZoomLevel: 90 });
    const toLL = (x, y) => map.unproject([x, y], Z);
    const bounds = L.latLngBounds(toLL(0, P.height), toLL(P.width, 0));
    L.tileLayer("data/tiles/{z}/{x}_{y}.jpg", { tileSize: P.tile, minNativeZoom: 0, maxNativeZoom: Z, minZoom: -1, maxZoom: Z + 1, bounds, noWrap: true, keepBuffer: 3 }).addTo(map);
    map.fitBounds(bounds);
    if (window.innerWidth <= 860) map.setView(bounds.getCenter(), map.getZoom() + 1, { animate: false });
    map.setMaxBounds(bounds.pad(0.3));
    map._toLL = toLL;

    for (const p of D.pos) {
      if (!p.plan) continue;
      const m = L.circleMarker(toLL(p.plan[0], p.plan[1]), { radius: 10, weight: 3, bubblingMouseEvents: false });
      m.bindTooltip(`<b>${esc(p.id)}</b> · ${esc(p.name || "")}`, { direction: "top", offset: [0, -8] });
      m.on("click", () => openDetail(p.id));
      m.addTo(map);
      markers.set(p.id, m);
      updateMarker(p.id);
    }
    const resize = () => {
      const z = map.getZoom();
      const r = Math.max(5, 56 * Math.pow(2, z - Z));
      const w = r < 10 ? 2 : 3;
      markers.forEach((m) => { m.setRadius(r); m.setStyle({ weight: w }); });
      markerR = r;
      dmgMarkers.forEach((dm) => dm.setIcon(dmgIcon(dm.options.count)));
    };
    map.on("zoomend", resize);
    resize();

    $("#statusLegend").innerHTML = STATUS.map((s) => `<span class="lg"><i style="border-color:${s.color}"></i>${s.label}</span>`).join("")
      + `<span class="lg"><i style="border-color:#b8c0cc;border-style:dashed"></i>ohne Medientechnik</span>`
      + `<span class="lg"><b class="lg-dmg">!</b>offener Schaden</span>`;
    $("#legendBtn").addEventListener("click", () => openViewer({ src: "data/plan_legend.jpg", caption: "Legende Hallenplan", zoomable: true }));

    // Suche
    const inp = $("#planSearch"), box = $("#planSearchResults");
    let sel = 0, hits = [];
    const draw = () => {
      box.innerHTML = hits.map((p, i) => `<button data-id="${esc(p.id)}" class="${i === sel ? "sel" : ""}"><span class="pid">${esc(p.id)}</span><span>${esc(p.name || "")}<br><span class="muted small">${esc(p.bereich || "")}${p.plan ? "" : " · nicht im Plan"}</span></span></button>`).join("") || `<div class="empty small">Keine Treffer</div>`;
      box.classList.toggle("open", !!inp.value.trim());
    };
    inp.addEventListener("input", () => { hits = searchPos(inp.value).slice(0, 12); sel = 0; draw(); });
    inp.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { sel = Math.min(hits.length - 1, sel + 1); draw(); e.preventDefault(); }
      if (e.key === "ArrowUp") { sel = Math.max(0, sel - 1); draw(); e.preventDefault(); }
      if (e.key === "Enter" && hits[sel]) pick(hits[sel].id);
      if (e.key === "Escape") { inp.value = ""; draw(); }
    });
    box.addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) pick(b.dataset.id); });
    const pick = (id) => { inp.value = ""; draw(); inp.blur(); focusOnPlan(id); openDetail(id); };
    document.addEventListener("click", (e) => { if (!e.target.closest(".search-wrap")) box.classList.remove("open"); });
  }
  function updateMarker(pid) {
    const m = markers.get(pid), p = POS.get(pid);
    if (!m) return;
    // Warn-Badge für offene Schäden
    const n = openDamages(pid).length;
    let dm = dmgMarkers.get(pid);
    if (n && !dm) {
      dm = L.marker(m.getLatLng(), { icon: dmgIcon(n), count: n, zIndexOffset: 1000, keyboard: false });
      dm.on("click", () => openDetail(pid));
      dm.addTo(map);
      dmgMarkers.set(pid, dm);
    } else if (n && dm) { dm.options.count = n; dm.setIcon(dmgIcon(n)); }
    else if (!n && dm) { dm.remove(); dmgMarkers.delete(pid); }
    if (!hasMT(p) && !Store.get(pid, "status")) {
      m.setStyle({ color: "#9aa4b2", fillColor: "#9aa4b2", fillOpacity: 0.06, dashArray: "4 4" });
    } else {
      const c = ST[statusOf(pid)].color;
      m.setStyle({ color: c, fillColor: c, fillOpacity: 0.22, dashArray: null });
    }
  }
  function dmgIcon(n) {
    const sz = markerR < 12 ? 14 : 20, off = markerR * 0.75;
    return L.divIcon({ className: "dmg-badge", html: `<span style="width:${sz}px;height:${sz}px;font-size:${sz * 0.62}px">${n > 1 ? n : "!"}</span>`,
      iconSize: [sz, sz], iconAnchor: [sz / 2 - off, sz / 2 + off] });
  }
  function focusOnPlan(pid) {
    const p = POS.get(pid);
    if (!p || !p.plan) return;
    showView("plan");
    const ll = map._toLL(p.plan[0], p.plan[1]);
    const drawerW = window.innerWidth > 860 ? Math.min(620, window.innerWidth) : 0;
    const z = Math.max(map.getZoom(), D.plan.maxZoom - 1.5);
    // Ziel so versetzen, dass es nicht unter dem Detail-Panel liegt
    const target = drawerW ? map.unproject(map.project(ll, z).add([drawerW / 2, 0]), z) : ll;
    map.flyTo(target, z, { duration: 0.6 });
    const m = markers.get(pid);
    if (m) {
      let n = 0;
      const blink = setInterval(() => { m.setStyle({ fillOpacity: n % 2 ? 0.22 : 0.7 }); if (++n > 7) { clearInterval(blink); updateMarker(pid); } }, 220);
    }
  }
  function searchPos(q) {
    q = q.trim().toLowerCase();
    if (!q) return [];
    const score = (p) => {
      const id = p.id.toLowerCase();
      if (id === q) return 0;
      if (id.startsWith(q)) return 1;
      if ((p.name || "").toLowerCase().includes(q)) return 2;
      if (p.geraete.some((g) => (g.artikel || "").toLowerCase().includes(q))) return 3;
      if (p.kabel.some((k) => String(k["Kabel-ID"]).toLowerCase().includes(q))) return 3;
      for (const [k, r] of Store.entries(p.id)) if (k.startsWith("sn:") && String(r.v || "").toLowerCase().includes(q)) return 4;
      if (Store.damages(p.id).some((d) => String(d.sn || "").toLowerCase().includes(q))) return 4;
      return 9;
    };
    return D.pos.map((p) => [score(p), p]).filter(([s]) => s < 9).sort((a, b) => a[0] - b[0]).map(([, p]) => p);
  }

  /* ---------------- Liste ---------------- */
  function initList() {
    const bereiche = [...new Set(D.pos.map((p) => p.bereich).filter(Boolean))];
    $("#fBereich").innerHTML += bereiche.map((b) => `<option>${esc(b)}</option>`).join("");
    $("#fStatus").innerHTML += STATUS.map((s) => `<option value="${s.id}">${s.label}</option>`).join("") + `<option value="_dmg">⚠ mit offenem Schaden</option>`;
    const rr = debounce(renderList, 120);
    ["#listSearch", "#fBereich", "#fStatus", "#fRelevant"].forEach((s) => $(s).addEventListener("input", rr));
    $("#posList").addEventListener("click", (e) => { const b = e.target.closest("[data-pos]"); if (b) openDetail(b.dataset.pos); });
  }
  function renderList() {
    const q = $("#listSearch").value, fb = $("#fBereich").value, fs = $("#fStatus").value, rel = $("#fRelevant").checked;
    let list = q.trim() ? searchPos(q) : D.pos.slice();
    list = list.filter((p) => (!fb || p.bereich === fb) && (!fs || (fs === "_dmg" ? openDamages(p.id).length > 0 : statusOf(p.id) === fs)) && (!rel || hasMT(p) || fs === "_dmg"));
    $("#listCount").textContent = `${list.length} Positionen`;
    const groups = new Map();
    for (const p of list) { const g = p.bereich || "Ohne Bereich"; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(p); }
    $("#posList").innerHTML = [...groups].map(([g, ps]) => {
      const done = ps.filter((p) => statusOf(p.id) === "erledigt").length;
      return `<div class="group"><h2><span>${esc(g)}</span><span>${done}/${ps.length} erledigt</span></h2><div class="cards">${ps.map(rowHTML).join("")}</div></div>`;
    }).join("") || `<div class="empty">Keine Positionen gefunden.</div>`;
  }
  function rowHTML(p) {
    const s = ST[statusOf(p.id)], pr = serialProgress(p), photos = Store.photos(p.id).length, dm = openDamages(p.id).length;
    const meta = [p.displays ? `${p.displays} Display${p.displays > 1 ? "s" : ""}` : "", p.zuspieler ? `${p.zuspieler} Zuspieler` : "", p.kabel.length ? `${p.kabel.length} Kabel` : "", ...p.flags.map((f) => f.label), p.plan ? "" : "nicht im Hallenplan"].filter(Boolean).join(" · ");
    return `<button class="pos-row ${hasMT(p) ? "" : "dim"}" data-pos="${esc(p.id)}">
      <span class="pid">${esc(p.id)}</span>
      <span><div class="pname">${esc(p.name || "–")}</div><div class="pmeta">${esc(meta || p.einordnung || "")}</div></span>
      <span class="sn">${pr.total ? `SN ${pr.done}/${pr.total}` : ""}${photos ? ` · ${photos} Foto${photos > 1 ? "s" : ""}` : ""}</span>
      <span class="row-end-cell">${dm ? `<span class="chip warn">${ICON.warn} ${dm}</span>` : ""}<span class="pill st-${s.id}">${s.label}</span></span></button>`;
  }

  function renderStats() {
    const rel = D.pos.filter(hasMT);
    const cnt = Object.fromEntries(STATUS.map((s) => [s.id, 0]));
    rel.forEach((p) => cnt[statusOf(p.id)]++);
    let snT = 0, snD = 0;
    rel.forEach((p) => { const r = serialProgress(p); snT += r.total; snD += r.done; });
    const dmgOpen = Store.allDamages().filter((d) => !d.behoben).length;
    $("#sideStats").innerHTML = `<div class="muted small" style="font-weight:600">Fortschritt · ${rel.length} POS</div>
      <div class="bar">${STATUS.map((s) => `<span style="width:${(cnt[s.id] / rel.length) * 100}%;background:${s.color}"></span>`).join("")}</div>
      ${STATUS.map((s) => `<div class="stat-row"><span class="pill st-${s.id}">${s.label}</span><b>${cnt[s.id]}</b></div>`).join("")}
      <div class="stat-row"><span class="muted">Seriennummern</span><b>${snD}/${snT}</b></div>
      <div class="stat-row"><span class="muted">Offene Schäden</span><b style="color:${dmgOpen ? "var(--danger)" : "inherit"}">${dmgOpen}</b></div>`;
    renderDocsStats(cnt, rel.length, snD, snT);
    renderDamageOverview();
  }

  /* ---------------- Detail ---------------- */
  function openDetail(pid, { fromHash = false } = {}) {
    current = pid;
    renderDetail(pid);
    $("#drawer").classList.add("open");
    $("#drawer").setAttribute("aria-hidden", "false");
    if (window.innerWidth <= 860) $("#drawerBackdrop").classList.add("open");
    if (!fromHash) {
      const h = "#pos/" + encodeURIComponent(pid);
      if (location.hash.startsWith("#pos/")) history.replaceState(null, "", h); else history.pushState(null, "", h);
    }
  }
  function closeDetail({ fromHash = false } = {}) {
    current = null;
    $("#drawer").classList.remove("open");
    $("#drawer").setAttribute("aria-hidden", "true");
    $("#drawerBackdrop").classList.remove("open");
    if (!fromHash && location.hash.startsWith("#pos/")) history.pushState(null, "", location.pathname + location.search);
  }

  function renderDetail(pid) {
    pendingRender = false;
    const p = POS.get(pid);
    const st = statusOf(pid), stRec = Store.get(pid, "status");
    const pr = serialProgress(p);
    const order = currentOrder();
    const idx = order.indexOf(pid);
    const bk = p.booklet || {};
    const flagChips = p.flags.map((f) => {
      const app = f.page && D.appendix.find((a) => a.page === f.page);
      return app ? `<button class="chip" data-page="${f.page}">${esc(f.label)} · S. ${f.page}</button>` : `<span class="chip ${f.label === "Zeitplan beachten" ? "warn" : ""}">${esc(f.label)}</span>`;
    }).join("");

    const kv = [
      ["Display/Output", bk.Display], ["Montageart", bk.Montage], ["Verkabelung", bk.Verkabelung], ["Rechner/Input", bk["Rechner/Input"]],
      ["Zubehör", bk["Zubehör"]], ["Beschilderung außen", bk["Beschilderung außen"]], ["Verkabelung außen", bk["Verkabelung außen"]],
      ["Hinweise", bk.Hinweise], ["Notiz Planung", p.notiz],
    ].filter(([, v]) => v);

    const devHTML = p.geraete.length ? p.geraete.map((g) => {
      const slots = g.serial ? Array.from({ length: g.menge }, (_, i) => {
        const n = i + 1, key = `sn:${g.key}:${n}`, r = Store.get(pid, key);
        return `<div class="slot"><span class="n">${n}.</span>
          <input type="text" class="${r && r.v ? "filled" : ""}" data-sn="${esc(key)}" value="${esc(r && r.v ? r.v : "")}" placeholder="Seriennummer" autocomplete="off" autocapitalize="characters" spellcheck="false">
          <span class="acts"><button class="scan-btn" data-scan="${esc(key)}" data-label="${esc(g.artikel)} – Gerät ${n}">${ICON.scan}<span>Scan</span></button></span>
          ${r && r.v ? `<span class="who">${esc(r.by)} · ${fmtTime(r.t)}</span>` : ""}</div>`;
      }).join("") : "";
      const meta = [g.kategorie, g.montage && `Montage: ${g.montage}`, g.auftrag && `Auftrag: ${g.auftrag}`, g.paket && `Paket: ${g.paket}`, g.einbauort && `Einbauort: ${g.einbauort}`].filter(Boolean);
      return `<div class="dev"><div class="dev-top"><div><div class="dev-name">${esc(g.artikel)}</div><div class="dev-meta">${meta.map((m) => `<span>${esc(m)}</span>`).join("")}</div></div><div class="dev-qty">${g.menge}×</div></div>
        ${g.notiz ? `<div class="dev-note">${esc(g.notiz)}</div>` : ""}${slots ? `<div class="slots">${slots}</div>` : ""}</div>`;
    }).join("") : `<div class="card-b muted">Keine Geräte in der Bestückung.</div>`;

    const cabHTML = p.kabel.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Kabel-ID</th><th>Verwendung</th><th>Kabel</th><th>Start → Ende</th><th>VVK</th></tr></thead><tbody>
      ${p.kabel.map((k) => `<tr><td class="mono"><b>${esc(k["Kabel-ID"])}</b></td><td>${esc(k.Verwendung || "")}</td><td>${esc(k.Artikel || [k.Kabelart, k["Gesamtlänge (m)"] && k["Gesamtlänge (m)"] + " m"].filter(Boolean).join(" "))}</td>
      <td style="white-space:nowrap">${esc(k.Start ?? "")}${k["m/f Start"] ? ` (${esc(k["m/f Start"])})` : ""} → ${esc(k.Ende ?? "")}${k["m/f Ende"] ? ` (${esc(k["m/f Ende"])})` : ""}</td><td>${esc(k.Vorverkabelung || "")}</td></tr>`).join("")}</tbody></table></div>` : "";

    const photos = Store.photos(pid);
    const noteRec = Store.get(pid, "note");
    const dmgs = Store.damages(pid), dmgOpenN = dmgs.filter((d) => !d.behoben).length;
    const dmgHTML = dmgs.map((d) => `<div class="dmg-item ${d.behoben ? "fixed" : ""}" data-dmg="${esc(d.id)}">
        <div class="dmg-top"><span class="cause ${CAUSE[d.ursache]?.cls || ""}">${esc(CAUSE[d.ursache]?.label || "–")}</span>${d.behoben ? `<span class="chip grey">behoben</span>` : ""}<span class="grow"></span><span class="muted small">${esc(d.createdBy || d.by)} · ${fmtTime(d.created || d.t)}</span></div>
        <div class="dmg-what"><b>${esc(d.artikel || "Ohne Gerätezuordnung")}</b>${d.sn ? ` · <span class="mono">SN ${esc(d.sn)}</span>` : ""}</div>
        ${d.text ? `<div class="dmg-text">${esc(d.text)}</div>` : ""}
        ${(d.photos || []).length ? `<div class="dmg-thumbs">${d.photos.map((ph) => `<img alt="" data-src="${esc(ph)}" data-dmgphoto="${esc(ph)}">`).join("")}</div>` : ""}
      </div>`).join("");

    $("#drawerInner").innerHTML = `
      <div class="d-head">
        <div class="d-head-top">
          <div class="grow">
            <div class="d-pid">POS ${esc(p.id)} · ${esc(p.bereich || "")}</div>
            <div class="d-name">${esc(p.name || "–")}</div>
            <div class="d-meta">${esc([p.einordnung, p.displays ? `${p.displays} Displays` : "", p.zuspieler ? `${p.zuspieler} Zuspieler` : ""].filter(Boolean).join(" · "))}</div>
          </div>
          <div class="d-nav">
            <button class="icon-btn" data-act="prev" title="Vorherige POS" ${idx <= 0 ? "disabled" : ""}>${ICON.left}</button>
            <button class="icon-btn" data-act="next" title="Nächste POS" ${idx < 0 || idx >= order.length - 1 ? "disabled" : ""}>${ICON.right}</button>
            <button class="icon-btn" data-act="close" title="Schließen">${ICON.x}</button>
          </div>
        </div>
        <div class="status-seg">${STATUS.map((s) => `<button data-status="${s.id}" class="${s.id === st ? "on" : ""}" style="${s.id === st ? `background:${s.color};border-color:${s.color}` : ""}"><i style="background:${s.color}"></i>${s.label}</button>`).join("")}</div>
        <div class="d-changed">${stRec ? `Status gesetzt von ${esc(stRec.by)} · ${fmtTime(stRec.t)}` : "Status noch nicht gesetzt"}</div>
      </div>
      <div class="d-body">
        ${p.timing ? `<div class="timing"><b>Zeitplan beachten:</b> ${esc(p.timing)}</div>` : ""}
        ${flagChips || p.plan ? `<div class="flags" style="margin-top:0">${p.plan ? `<button class="chip grey" data-act="plan">${ICON.pin} Im Plan zeigen</button>` : `<span class="chip grey">nicht im Hallenplan</span>`}${flagChips}</div>` : ""}

        <div class="card">
          <div class="card-h"><h2>Geräte &amp; Seriennummern</h2>${pr.total ? `<span class="progress"><span class="pbar"><span style="width:${(pr.done / pr.total) * 100}%"></span></span>${pr.done}/${pr.total}</span>` : ""}</div>
          ${devHTML}
        </div>

        <div class="card ${dmgOpenN ? "card-warn" : ""}">
          <div class="card-h"><h2>Schäden</h2>${dmgOpenN ? `<span class="chip warn">${ICON.warn} ${dmgOpenN} offen</span>` : `<span class="muted">${dmgs.length ? "alle behoben" : ""}</span>`}</div>
          ${dmgHTML}
          <div class="card-b"><button class="btn dmg-btn" data-act="dmg-new">${ICON.warn} Schaden melden</button></div>
        </div>

        <div class="card">
          <div class="card-h"><h2>Fotos</h2><span class="muted">${photos.length || ""}</span></div>
          <div class="card-b"><div class="photos" id="photoGrid">
            ${photos.map((ph) => `<div class="photo" data-photo="${esc(ph.id)}"><img alt="" data-src="${esc(ph.id)}"><span class="badge" data-badge="${esc(ph.id)}">${esc(ph.by)}</span></div>`).join("")}
            <button class="photo-add" data-act="photo">${ICON.cam}<span>Foto aufnehmen</span></button>
            <button class="photo-add" data-act="photo-file">${ICON.img}<span>Aus Galerie</span></button>
          </div></div>
        </div>

        <div class="card">
          <div class="card-h"><h2>Notiz</h2><span class="muted">${noteRec && noteRec.v ? `${esc(noteRec.by)} · ${fmtTime(noteRec.t)}` : ""}</span></div>
          <div class="card-b"><textarea id="noteInput" placeholder="Hinweise für das Team, offene Punkte …">${esc(noteRec && noteRec.v ? noteRec.v : "")}</textarea></div>
        </div>

        ${kv.length ? `<div class="card"><div class="card-h"><h2>Booklet</h2></div><div class="card-b"><dl class="kv">${kv.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl></div></div>` : ""}
        ${cabHTML ? `<div class="card"><div class="card-h"><h2>Bodenkabel</h2><span class="muted">${p.kabel.length}</span></div><div class="card-b">${cabHTML}</div></div>` : ""}
        ${p.bookletCrops.length ? `<div class="card"><div class="card-h"><h2>Booklet-Seite</h2><span class="muted">S. ${[...new Set(p.bookletCrops.map((c) => c.page))].join(", ")}</span></div><div class="card-b">
          ${p.bookletCrops.map((c) => `<img class="booklet-crop" loading="lazy" src="data/booklet/${esc(c.file)}" data-page="${c.page}" alt="Booklet Seite ${c.page}">`).join("")}</div></div>` : ""}
      </div>`;

    // Fotos laden
    $$("img[data-src]", $("#drawerInner")).forEach(async (img) => {
      const id = img.dataset.src;
      const url = await Store.photoURL(id);
      if (url) img.src = url;
    });
  }

  function currentOrder() {
    if ($("#view-list").classList.contains("active")) return $$("#posList [data-pos]").map((b) => b.dataset.pos);
    return D.pos.filter(hasMT).map((p) => p.id);
  }

  function initDrawerEvents() {
    const dr = $("#drawerInner");
    dr.addEventListener("click", async (e) => {
      const t = e.target.closest("button, img.booklet-crop, .photo, [data-dmgphoto], .dmg-item");
      if (!t || !current) return;
      const pid = current;
      if (t.dataset.status) { await Store.set(pid, "status", t.dataset.status); toast(`POS ${pid}: ${ST[t.dataset.status].label}`); return; }
      if (t.dataset.scan) return openScanner(pid, t.dataset.scan, t.dataset.label);
      if (t.dataset.page) return openBookletPage(+t.dataset.page);
      if (t.dataset.photo) return openPhoto(pid, t.dataset.photo);
      if (t.dataset.dmgphoto) { const url = await Store.photoURL(t.dataset.dmgphoto); if (url) openViewer({ src: url, caption: `POS ${pid} · Schadensfoto` }); return; }
      if (t.dataset.dmg) return openDamage(pid, t.dataset.dmg);
      const act = t.dataset.act;
      if (act === "close") closeDetail();
      if (act === "plan") { if (window.innerWidth <= 860) closeDetail(); focusOnPlan(pid); }
      if (act === "prev" || act === "next") { const o = currentOrder(), i = o.indexOf(pid); const n = o[i + (act === "next" ? 1 : -1)]; if (n) openDetail(n); }
      if (act === "dmg-new") return openDamage(pid, null);
      if (act === "photo") $("#photoInput").click();
      if (act === "photo-file") $("#photoInputMulti").click();
    });
    const saveSN = async (inp) => {
      const v = inp.value.trim();
      const old = Store.val(current, inp.dataset.sn) || "";
      if (v !== old) { await Store.set(current, inp.dataset.sn, v); checkDuplicate(current, inp.dataset.sn, v); }
    };
    dr.addEventListener("change", (e) => {
      if (e.target.dataset.sn) saveSN(e.target);
      if (e.target.id === "noteInput") { const v = e.target.value.trim(); if (v !== (Store.val(current, "note") || "")) Store.set(current, "note", v); }
    });
    dr.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.dataset.sn) e.target.blur(); });
    dr.addEventListener("focusout", () => setTimeout(() => {
      const a = document.activeElement;
      if (pendingRender && current && !(a && $("#drawer").contains(a) && a.matches("input,textarea"))) renderDetail(current);
    }, 50));
    $("#drawerBackdrop").addEventListener("click", () => closeDetail());
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && current && $("#scanModal").hidden && $("#viewer").hidden && $("#dmgModal").hidden) closeDetail();
    });
    const addPhotos = async (files) => {
      const pid = current;
      for (const f of files) {
        try { await Store.addPhoto(pid, f); } catch (err) { toast(err.message); }
      }
      if (files.length) toast(`${files.length} Foto${files.length > 1 ? "s" : ""} gespeichert`);
    };
    $("#photoInput").addEventListener("change", (e) => { addPhotos([...e.target.files]); e.target.value = ""; });
    $("#photoInputMulti").addEventListener("change", (e) => { addPhotos([...e.target.files]); e.target.value = ""; });
  }

  function checkDuplicate(pid, key, v) {
    if (!v) return;
    for (const p of D.pos) for (const [k, r] of Store.entries(p.id)) {
      if (k.startsWith("sn:") && r.v === v && !(p.id === pid && k === key)) {
        toast(`Achtung: Seriennummer ${v} ist auch bei POS ${p.id} eingetragen`, 5000);
        return;
      }
    }
  }

  /* ---------------- Scanner ---------------- */
  let scanCtx = null;
  async function openScanner(pid, key, label, cb = null, initial = "") {
    scanCtx = { pid, key, cb };
    $("#scanTarget").textContent = `POS ${pid} · ${label}`;
    $("#scanValue").value = cb ? initial : Store.val(pid, key) || "";
    $("#scanNextWrap").hidden = !!cb;
    $("#scanHint").textContent = "Barcode/QR-Code der Seriennummer ins Feld halten";
    $("#scanHint").classList.remove("hit");
    $("#scanModal").hidden = false;
    if (!Scanner.available()) { $("#scanHint").textContent = "Kamera nicht verfügbar (HTTPS nötig) – bitte eintippen"; $("#scanValue").focus(); return; }
    try {
      const caps = await Scanner.start($("#scanVideo"), onScanHit);
      $("#scanTorch").hidden = !caps.torch;
      $("#scanSwitch").hidden = !caps.multi;
    } catch (err) {
      $("#scanHint").textContent = `Kamera: ${err.name === "NotAllowedError" ? "Zugriff verweigert" : err.message} – bitte eintippen`;
      $("#scanValue").focus();
    }
  }
  let lastHit = "";
  function onScanHit(text) {
    text = String(text).trim();
    if (!text || text === lastHit) return;
    lastHit = text;
    setTimeout(() => (lastHit = ""), 1500);
    $("#scanValue").value = text;
    $("#scanHint").textContent = `Erkannt: ${text}`;
    $("#scanHint").classList.add("hit");
    if (navigator.vibrate) navigator.vibrate(60);
  }
  async function saveScan() {
    if (!scanCtx) return;
    const v = $("#scanValue").value.trim();
    if (scanCtx.cb) { const cb = scanCtx.cb; closeScanner(); cb(v); return; }
    const { pid, key } = scanCtx;
    await Store.set(pid, key, v);
    checkDuplicate(pid, key, v);
    toast(v ? `Gespeichert: ${v}` : "Seriennummer entfernt");
    if ($("#scanNext").checked && v) {
      const p = POS.get(pid);
      for (const g of serialDevices(p)) for (let n = 1; n <= g.menge; n++) {
        const k = `sn:${g.key}:${n}`;
        if (!Store.val(pid, k)) {
          scanCtx = { pid, key: k };
          $("#scanTarget").textContent = `POS ${pid} · ${g.artikel} – Gerät ${n}`;
          $("#scanValue").value = "";
          $("#scanHint").textContent = "Nächstes Gerät – Code ins Feld halten";
          $("#scanHint").classList.remove("hit");
          return;
        }
      }
    }
    closeScanner();
  }
  function closeScanner() { Scanner.stop(); $("#scanModal").hidden = true; scanCtx = null; }

  /* ---------------- Schadensmeldung ---------------- */
  let dmgCtx = null;
  function deviceOptions(p) {
    const out = [];
    for (const g of p.geraete) {
      if (g.serial && g.menge > 0) {
        for (let n = 1; n <= g.menge; n++) {
          const sn = Store.val(p.id, `sn:${g.key}:${n}`);
          out.push({ value: `${g.key}|${n}`, label: `${g.artikel}${g.menge > 1 ? ` – Gerät ${n}` : ""}${sn ? ` (SN ${sn})` : ""}`, artikel: g.artikel + (g.menge > 1 ? ` – Gerät ${n}` : ""), sn: sn || "" });
        }
      } else {
        out.push({ value: `${g.key}|0`, label: `${g.artikel}${g.menge > 1 ? ` (${g.menge}×)` : ""}`, artikel: g.artikel, sn: "" });
      }
    }
    return out;
  }
  function openDamage(pid, id) {
    const p = POS.get(pid);
    const d = id ? Store.damages(pid).find((x) => x.id === id) : null;
    const opts = deviceOptions(p);
    dmgCtx = { pid, id, cause: d ? d.ursache : "", photos: d ? [...(d.photos || [])] : [], added: [], removed: [], opts };
    $("#dmgTitle").textContent = d ? "Schaden bearbeiten" : "Schaden melden";
    $("#dmgSub").textContent = `POS ${p.id} · ${p.name || ""}${d ? ` · gemeldet von ${d.createdBy || d.by}, ${fmtTime(d.created || d.t)}` : ""}`;
    $("#dmgDevice").innerHTML = `<option value="">Kein bestimmtes Gerät / Sonstiges</option>` + opts.map((o) => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join("");
    const devVal = d && d.geraet ? `${d.geraet}|${d.slot || 0}` : "";
    $("#dmgDevice").value = opts.some((o) => o.value === devVal) ? devVal : "";
    $("#dmgArtikel").value = d && !$("#dmgDevice").value ? d.artikel || "" : "";
    $("#dmgSN").value = d ? d.sn || "" : "";
    $("#dmgText").value = d ? d.text || "" : "";
    $("#dmgFixed").checked = !!(d && d.behoben);
    $("#dmgFixedWrap").hidden = !d;
    $("#dmgDelete").hidden = !d;
    syncDmgDevice(false);
    renderDmgCause();
    renderDmgPhotos();
    $("#dmgModal").hidden = false;
  }
  function syncDmgDevice(fillSN) {
    const v = $("#dmgDevice").value;
    $("#dmgArtikelWrap").hidden = !!v;
    if (fillSN && v) {
      const o = dmgCtx.opts.find((x) => x.value === v);
      if (o && o.sn) $("#dmgSN").value = o.sn;
    }
  }
  function renderDmgCause() {
    $$("#dmgCause button").forEach((b) => b.classList.toggle("on", b.dataset.cause === dmgCtx.cause));
  }
  function renderDmgPhotos() {
    const el = $("#dmgPhotos");
    el.innerHTML = dmgCtx.photos.map((id) => `<div class="photo" data-dp="${esc(id)}"><img alt="" data-src="${esc(id)}"><button class="photo-del" data-dpdel="${esc(id)}" title="Foto entfernen">✕</button></div>`).join("")
      + `<button class="photo-add" type="button" data-dpadd="cam">${ICON.cam}<span>Foto aufnehmen</span></button>`
      + `<button class="photo-add" type="button" data-dpadd="file">${ICON.img}<span>Aus Galerie</span></button>`;
    $$("img[data-src]", el).forEach(async (img) => { const u = await Store.photoURL(img.dataset.src); if (u) img.src = u; });
  }
  async function addDmgPhotos(files) {
    for (const f of files) {
      try { const id = await Store.addBlob(f); dmgCtx.photos.push(id); dmgCtx.added.push(id); } catch (err) { toast(err.message); }
    }
    renderDmgPhotos();
  }
  async function saveDamage() {
    if (!dmgCtx.cause) { toast("Bitte die Ursache auswählen", 3000); $("#dmgCause").classList.add("shake"); setTimeout(() => $("#dmgCause").classList.remove("shake"), 500); return; }
    const { pid, id } = dmgCtx;
    const old = id ? Store.damages(pid).find((x) => x.id === id) : null;
    const dev = $("#dmgDevice").value;
    const o = dmgCtx.opts.find((x) => x.value === dev);
    const [gkey, slot] = dev ? dev.split("|") : ["", "0"];
    const artikel = o ? o.artikel : $("#dmgArtikel").value.trim();
    if (!artikel && !$("#dmgText").value.trim() && !dmgCtx.photos.length) { toast("Bitte Gerät, Beschreibung oder Foto angeben", 3000); return; }
    const data = {
      geraet: gkey, slot: +slot || null, artikel, sn: $("#dmgSN").value.trim(), ursache: dmgCtx.cause,
      text: $("#dmgText").value.trim(), photos: dmgCtx.photos, behoben: $("#dmgFixed").checked,
      created: old ? old.created || old.t : Date.now(), createdBy: old ? old.createdBy || old.by : Store.user || "?",
    };
    for (const ph of dmgCtx.removed) await Store.deleteBlob(ph);
    await Store.saveDamage(pid, id, data);
    dmgCtx = null;
    $("#dmgModal").hidden = true;
    toast(old ? "Schaden aktualisiert" : `Schaden bei POS ${pid} gemeldet`);
  }
  async function cancelDamage() {
    if (dmgCtx) for (const ph of dmgCtx.added) await Store.deleteBlob(ph);
    dmgCtx = null;
    $("#dmgModal").hidden = true;
  }
  function initDamageModal() {
    $("#dmgDevice").addEventListener("change", () => syncDmgDevice(true));
    $("#dmgCause").addEventListener("click", (e) => { const b = e.target.closest("[data-cause]"); if (b) { dmgCtx.cause = b.dataset.cause; renderDmgCause(); } });
    $("#dmgScan").onclick = () => {
      const o = dmgCtx.opts.find((x) => x.value === $("#dmgDevice").value);
      openScanner(dmgCtx.pid, null, `Schaden – ${o ? o.artikel : "Seriennummer"}`, (v) => { if (v) $("#dmgSN").value = v; }, $("#dmgSN").value);
    };
    $("#dmgPhotos").addEventListener("click", async (e) => {
      const add = e.target.closest("[data-dpadd]"), del = e.target.closest("[data-dpdel]"), ph = e.target.closest("[data-dp]");
      if (add) return add.dataset.dpadd === "cam" ? $("#dmgPhotoInput").click() : $("#dmgPhotoMulti").click();
      if (del) {
        const id = del.dataset.dpdel;
        dmgCtx.photos = dmgCtx.photos.filter((x) => x !== id);
        if (dmgCtx.added.includes(id)) { dmgCtx.added = dmgCtx.added.filter((x) => x !== id); await Store.deleteBlob(id); } else dmgCtx.removed.push(id);
        return renderDmgPhotos();
      }
      if (ph) { const u = await Store.photoURL(ph.dataset.dp); if (u) openViewer({ src: u, caption: "Schadensfoto" }); }
    });
    $("#dmgPhotoInput").addEventListener("change", (e) => { addDmgPhotos([...e.target.files]); e.target.value = ""; });
    $("#dmgPhotoMulti").addEventListener("change", (e) => { addDmgPhotos([...e.target.files]); e.target.value = ""; });
    $("#dmgSave").onclick = saveDamage;
    $("#dmgCancel").onclick = cancelDamage;
    $("#dmgClose").onclick = cancelDamage;
    $("#dmgDelete").onclick = async () => {
      if (!confirm("Schadensmeldung wirklich löschen?")) return;
      const { pid, id, photos } = dmgCtx;
      await Store.deleteDamage(pid, id);
      for (const ph of [...photos, ...dmgCtx.removed]) await Store.deleteBlob(ph);
      dmgCtx = null; $("#dmgModal").hidden = true; toast("Schadensmeldung gelöscht");
    };
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#dmgModal").hidden && $("#scanModal").hidden && $("#viewer").hidden) cancelDamage(); });
  }

  /* ---------------- Viewer ---------------- */
  let viewerCtx = null;
  function openViewer({ src, caption = "", zoomable = true, nav = null, actions = "" }) {
    viewerCtx = { nav };
    const img = $("#viewerImg");
    img.classList.remove("zoom");
    img.src = src;
    img.onclick = zoomable ? () => img.classList.toggle("zoom") : null;
    $("#viewerBar").innerHTML = `${nav ? `<button class="btn small" data-v="prev">‹</button>` : ""}<span>${esc(caption)}</span>${nav ? `<button class="btn small" data-v="next">›</button>` : ""}${actions}`;
    $("#viewer").hidden = false;
  }
  function openBookletPage(page) {
    const n = D.bookletPages.length;
    page = Math.min(n, Math.max(1, page));
    openViewer({ src: `data/booklet/${D.bookletPages[page - 1]}`, caption: `Booklet Seite ${page} / ${n}`, nav: (d) => openBookletPage(page + d) });
  }
  async function openPhoto(pid, id) {
    const ph = Store.photos(pid).find((x) => x.id === id);
    const url = await Store.photoURL(id);
    if (!url) return toast("Foto ist auf diesem Gerät nicht verfügbar");
    const list = Store.photos(pid), i = list.findIndex((x) => x.id === id);
    openViewer({
      src: url, caption: `POS ${pid} · ${ph ? `${ph.by} · ${fmtTime(ph.t)}` : ""}`,
      nav: list.length > 1 ? (d) => { const n = list[(i + d + list.length) % list.length]; openPhoto(pid, n.id); } : null,
      actions: `<a class="btn small" href="${esc(url)}" download="POS-${esc(pid)}-${esc(id)}.jpg">Speichern</a><button class="btn small" data-v="del" data-pid="${esc(pid)}" data-id="${esc(id)}">Löschen</button>`,
    });
  }

  /* ---------------- Unterlagen ---------------- */
  function renderDocs() {
    const e = D.event;
    $("#docs").innerHTML = `
      <div class="stats-grid" id="docStats"></div>
      <div class="card" id="dmgOverview"></div>
      <div class="card"><div class="card-h"><h2>Eckdaten</h2><span class="muted">importiert ${fmtTime(D.generated)}</span></div><div class="card-b"><dl class="kv">
        ${[["Kunde", e.Kunde], ["Messe", `${e.Messe || ""} ${e.Jahr || ""}`], ["Ort", e.Ort], ["Aufbau ab", fmtDate(e["Aufbau ab"])], ["Messe", `${fmtDate(e["Messe von"])} – ${fmtDate(e["Messe bis"])}`], ["Projektleitung", e.Projektleitung]].filter(([, v]) => v).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}
      </dl></div></div>
      ${D.pos.some((p) => p.timing) ? `<div class="card"><div class="card-h"><h2>Zeitkritische Positionen</h2></div><div class="card-b"><div class="tbl-wrap"><table class="tbl"><tbody>
        ${D.pos.filter((p) => p.timing).map((p) => `<tr><td><button class="chip" data-pos="${esc(p.id)}">POS ${esc(p.id)}</button></td><td><b>${esc(p.name)}</b><br>${esc(p.timing)}</td></tr>`).join("")}</tbody></table></div></div></div>` : ""}
      <div class="card"><div class="card-h"><h2>Anhang &amp; Schemata</h2><span class="muted">aus dem Booklet</span></div><div class="card-b"><div class="appendix">
        ${D.appendix.map((a) => `<button data-page="${a.page}"><img loading="lazy" src="data/booklet/${esc(a.file)}" alt=""><div class="t">${esc(a.title)}</div><div class="p">Seite ${a.page}</div></button>`).join("")}
        <button data-legend="1"><img loading="lazy" src="data/plan_legend.jpg" alt="" style="object-fit:contain;background:#fff"><div class="t">Legende Hallenplan</div><div class="p">Planzeichen</div></button>
      </div><div class="row-end" style="justify-content:flex-start"><button class="btn" data-page="1">Komplettes Booklet durchblättern</button></div></div></div>
      <div class="card"><div class="card-h"><h2>Aufträge</h2><span class="muted">${D.orders.length}</span></div><div class="card-b tbl-wrap"><table class="tbl">
        <thead><tr><th>Auftrag</th><th>Zulieferer</th><th>Miete</th><th>Ansprechpartner</th><th>Auftrags-Nr.</th><th>Status</th></tr></thead><tbody>
        ${D.orders.map((o) => `<tr><td><b>${esc(o.Auftrag)}</b></td><td>${esc(o.Zulieferer || "")}</td><td style="white-space:nowrap">${o["Miete von"] ? `${fmtDate(o["Miete von"])} – ${fmtDate(o["Miete bis"])}` : ""}</td>
          <td>${esc(o.Ansprechpartner || "")}${o["E-Mail"] ? `<br><a href="mailto:${esc(o["E-Mail"])}">${esc(o["E-Mail"])}</a>` : ""}</td><td class="mono">${esc(o["Auftrags-Nr."] || o["Angebots-Nr."] || "")}</td><td>${esc(o.Status || o.Notiz || "")}</td></tr>`).join("")}
      </tbody></table></div></div>`;
    $("#docs").addEventListener("click", (ev) => {
      const b = ev.target.closest("button");
      if (!b) return;
      if (b.dataset.page) openBookletPage(+b.dataset.page);
      if (b.dataset.legend) openViewer({ src: "data/plan_legend.jpg", caption: "Legende Hallenplan" });
      if (b.dataset.pos) openDetail(b.dataset.pos);
    });
  }
  function renderDamageOverview() {
    const el = $("#dmgOverview");
    if (!el) return;
    const all = Store.allDamages(), open = all.filter((d) => !d.behoben).length;
    el.innerHTML = `<div class="card-h"><h2>Schadensmeldungen</h2><span class="muted">${all.length ? `${open} offen · ${all.length} gesamt` : "keine"}</span></div>`
      + (all.length ? `<div class="card-b tbl-wrap"><table class="tbl"><thead><tr><th>POS</th><th>Gerät / SN</th><th>Ursache</th><th>Beschreibung</th><th>Fotos</th><th>Gemeldet</th><th></th></tr></thead><tbody>
        ${all.map((d) => { const p = POS.get(d.pos); return `<tr class="${d.behoben ? "muted" : ""}"><td><button class="chip" data-pos="${esc(d.pos)}">POS ${esc(d.pos)}</button><div class="small muted">${esc(p ? p.name : "")}</div></td>
          <td>${esc(d.artikel || "–")}${d.sn ? `<div class="mono small">SN ${esc(d.sn)}</div>` : ""}</td>
          <td><span class="cause ${CAUSE[d.ursache]?.cls || ""}">${esc(CAUSE[d.ursache]?.label || "–")}</span></td>
          <td>${esc(d.text || "")}</td><td>${(d.photos || []).length || ""}</td>
          <td style="white-space:nowrap">${esc(d.createdBy || d.by)}<div class="small muted">${fmtTime(d.created || d.t)}</div></td>
          <td>${d.behoben ? `<span class="chip grey">behoben</span>` : `<span class="chip warn">offen</span>`}</td></tr>`; }).join("")}
        </tbody></table></div>` : `<div class="card-b muted small">Noch keine Schäden gemeldet. Schäden werden in der jeweiligen Position unter „Schaden melden“ erfasst.</div>`);
  }
  function renderDocsStats(cnt, total, snD, snT) {
    const el = $("#docStats");
    if (!el) return;
    el.innerHTML = `<div class="stat"><div class="v">${total}</div><div class="l">POS mit Medientechnik</div></div>`
      + STATUS.map((s) => `<div class="stat"><div class="v" style="color:${s.color}">${cnt[s.id]}</div><div class="l">${s.label}</div></div>`).join("")
      + `<div class="stat"><div class="v">${snD}<span class="muted" style="font-size:15px">/${snT}</span></div><div class="l">Seriennummern erfasst</div></div>`;
  }

  /* ---------------- Sync & Export ---------------- */
  function renderSettings() {
    const s = Store.settings;
    $("#settings").innerHTML = `
      <div class="card"><div class="card-h"><h2>Mein Name</h2></div><div class="card-b">
        <div class="form-row"><input type="text" id="setName" value="${esc(Store.user)}" placeholder="Name oder Kürzel"><button class="btn" id="setNameSave">Speichern</button></div>
        <p class="help">Wird bei jeder Änderung (Status, Seriennummer, Foto, Notiz) mitgespeichert.</p></div></div>


      <div class="card"><div class="card-h"><h2>Sicherung &amp; Abgleich</h2></div><div class="card-b">
        <div class="form-row">
          <button class="btn" id="expJson">Sicherung exportieren (.json, inkl. Fotos)</button>
          <button class="btn" id="impJson">Sicherung importieren</button>
          <button class="btn" id="expCsv">Seriennummern &amp; Status (.csv)</button>
          <button class="btn" id="expDmg">Schäden (.csv)</button>
        </div>
        <p class="help">Alle Daten (Status, Seriennummern, Fotos, Notizen) werden <b>nur in diesem Browser auf diesem Gerät</b> gespeichert.
          Regelmäßig eine Sicherung exportieren! Zum Abgleich mit Kollegen: Sicherung exportieren und beim anderen importieren –
          die Daten werden zusammengeführt, pro Feld gewinnt die jüngste Änderung.</p>
      </div></div>`;
    $("#setNameSave").onclick = () => { const v = $("#setName").value.trim(); if (v) { Store.setUser(v); updateUser(); toast("Name gespeichert"); } };
    $("#expJson").onclick = async () => { toast("Export wird erstellt …"); const d = await Store.exportJSON(true); download(`messe-technik-${stamp()}.json`, JSON.stringify(d), "application/json"); };
    $("#impJson").onclick = () => $("#importInput").click();
    $("#expCsv").onclick = exportCSV;
    $("#expDmg").onclick = exportDamagesCSV;
  }
  function exportCSV() {
    const rows = [["POS", "Bezeichnung", "Bereich", "Status", "Status von", "Status am", "Artikel", "Kategorie", "Gerät Nr.", "Seriennummer", "erfasst von", "erfasst am", "Notiz"]];
    for (const p of D.pos) {
      const s = Store.get(p.id, "status"), note = Store.val(p.id, "note") || "";
      const base = [p.id, p.name, p.bereich, ST[statusOf(p.id)].label, s ? s.by : "", s ? fmtTime(s.t) : ""];
      const devs = serialDevices(p);
      if (!devs.length) { if (hasMT(p)) rows.push([...base, "", "", "", "", "", "", note]); continue; }
      for (const g of devs) for (let n = 1; n <= g.menge; n++) {
        const r = Store.get(p.id, `sn:${g.key}:${n}`);
        rows.push([...base, g.artikel, g.kategorie, n, r && r.v ? r.v : "", r && r.v ? r.by : "", r && r.v ? fmtTime(r.t) : "", note]);
      }
    }
    const csv = "﻿" + rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(";")).join("\r\n");
    download(`seriennummern-status-${stamp()}.csv`, csv, "text/csv;charset=utf-8");
  }
  function exportDamagesCSV() {
    const rows = [["POS", "Bezeichnung", "Bereich", "Gerät", "Seriennummer", "Ursache", "Beschreibung", "Anzahl Fotos", "Status", "gemeldet von", "gemeldet am", "zuletzt geändert von", "zuletzt geändert am"]];
    for (const d of Store.allDamages()) {
      const p = POS.get(d.pos) || {};
      rows.push([d.pos, p.name, p.bereich, d.artikel, d.sn, CAUSE[d.ursache]?.label || "", d.text, (d.photos || []).length, d.behoben ? "behoben" : "offen", d.createdBy || d.by, fmtTime(d.created || d.t), d.by, fmtTime(d.t)]);
    }
    const csv = "\ufeff" + rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(";")).join("\r\n");
    download(`schaeden-${stamp()}.csv`, csv, "text/csv;charset=utf-8");
  }
  const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  function download(name, content, type) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([content], { type }));
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  /* ---------------- Modals / allgemein ---------------- */
  function initModals() {
    initDrawerEvents();
    initDamageModal();
    $("#scanClose").onclick = closeScanner;
    $("#scanSave").onclick = saveScan;
    $("#scanValue").addEventListener("keydown", (e) => { if (e.key === "Enter") saveScan(); });
    $("#scanTorch").onclick = () => Scanner.toggleTorch();
    $("#scanSwitch").onclick = () => Scanner.switchCamera($("#scanVideo"));
    $("#scanModal").addEventListener("click", (e) => { if (e.target.id === "scanModal") closeScanner(); });
    $("#viewerClose").onclick = () => { $("#viewer").hidden = true; };
    $("#viewer").addEventListener("click", async (e) => {
      const b = e.target.closest("[data-v]");
      if (!b) { if (e.target.classList.contains("viewer-body")) $("#viewer").hidden = true; return; }
      if (b.dataset.v === "prev" && viewerCtx.nav) viewerCtx.nav(-1);
      if (b.dataset.v === "next" && viewerCtx.nav) viewerCtx.nav(1);
      if (b.dataset.v === "del" && confirm("Foto wirklich löschen?")) { await Store.deletePhoto(b.dataset.pid, b.dataset.id); $("#viewer").hidden = true; toast("Foto gelöscht"); }
    });
    document.addEventListener("keydown", (e) => {
      if ($("#viewer").hidden) return;
      if (e.key === "Escape") $("#viewer").hidden = true;
      if (e.key === "ArrowLeft" && viewerCtx.nav) viewerCtx.nav(-1);
      if (e.key === "ArrowRight" && viewerCtx.nav) viewerCtx.nav(1);
    });
    $("#nameSave").onclick = () => { const v = $("#nameInput").value.trim(); if (!v) return; Store.setUser(v); updateUser(); $("#nameModal").hidden = true; };
    $("#nameInput").addEventListener("keydown", (e) => { if (e.key === "Enter") $("#nameSave").click(); });
    $("#userChip").onclick = openNameModal;
    $("#importInput").addEventListener("change", async (e) => {
      const f = e.target.files[0]; e.target.value = "";
      if (!f) return;
      try { const ch = await Store.importJSON(JSON.parse(await f.text())); toast(`Import: ${ch.size} Position(en) aktualisiert`); }
      catch (err) { toast("Import fehlgeschlagen: " + err.message, 5000); }
    });
  }
  function openNameModal() { $("#nameInput").value = Store.user || ""; $("#nameModal").hidden = false; setTimeout(() => $("#nameInput").focus(), 50); }
  function updateUser() { $("#userChip").textContent = Store.user ? `👤 ${Store.user}` : "Name festlegen"; }
  let toastT;
  function toast(msg, ms = 2400) {
    const t = $("#toast");
    t.textContent = msg; t.classList.add("show");
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), ms);
  }

  boot().catch((e) => { console.error(e); document.body.innerHTML = `<div class="empty">App konnte nicht geladen werden: ${esc(e.message)}</div>`; });
})();
