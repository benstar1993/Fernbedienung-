#!/usr/bin/env python3
"""Erzeugt die App-Daten aus POS-Master (xlsx), Hallenplan (PDF) und Booklet (PDF).

Aufruf:
  python3 tools/build_data.py --xlsx POS-Master.xlsx --plan Plan.pdf --booklet Booklet.pdf

Ausgabe (public/data):
  project.json   – Messe, Aufträge, POS (inkl. Geräte, Kabel, Planposition, Booklet-Ausschnitte)
  tiles/z/x_y.jpg – Kachel-Pyramide des Hallenplans
  plan_legend.jpg – Legende des Hallenplans
  booklet/p<NN>.jpg, booklet/pos_<ID>_<n>.jpg – Booklet-Seiten bzw. -Ausschnitte je POS

Benötigt: openpyxl, Pillow, poppler-utils (pdftoppm, pdftotext).
"""
import argparse, datetime, json, math, os, re, shutil, subprocess, tempfile, warnings
from collections import defaultdict

import openpyxl
from PIL import Image

warnings.filterwarnings("ignore")
Image.MAX_IMAGE_PIXELS = None

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "public", "data")

# Hallenausschnitt im Plan-PDF (pt) – ohne Kopfblock links und ohne Legende
PLAN_CROP = (700, 0, 4960, 2390)
LEGEND_CROP = (700, 2390, 4960, 3118)
PLAN_DPI = 108          # 1,5 x 72 dpi → POS-Nummern ca. 48 px hoch bei voller Auflösung
TILE = 512
SERIAL_CATEGORIES = {"Display", "Zuspieler", "Peripherie", "Kameratechnik"}
WORD_RE = re.compile(r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)</word>')


def clean(v):
    if v is None:
        return None
    if isinstance(v, datetime.datetime):
        return v.date().isoformat()
    if isinstance(v, float) and v.is_integer():
        return int(v)
    if isinstance(v, str):
        v = v.strip()
        return v or None
    return v


def table(ws, first_col_name):
    rows = list(ws.iter_rows(values_only=True))
    hi = next(i for i, r in enumerate(rows) if r and r[0] == first_col_name)
    header = [h for h in rows[hi] if h is not None]
    out = []
    for r in rows[hi + 1:]:
        if r[0] is None:
            continue
        out.append({h: clean(r[i]) for i, h in enumerate(header)})
    return out


def read_excel(path):
    wb = openpyxl.load_workbook(path, data_only=True)
    ws = wb["Start"]
    rows = list(ws.iter_rows(values_only=True))
    event = {}
    for r in rows:
        if r[0] in ("Kunde", "Messe", "Jahr", "Ort", "Aufbau ab", "Messe von", "Messe bis", "Projektleitung"):
            event[r[0]] = clean(r[1])
    hi = next(i for i, r in enumerate(rows) if r[0] == "Auftrag")
    header = [h for h in rows[hi] if h is not None]
    orders = []
    for r in rows[hi + 1:]:
        if not r[0] or str(r[0]).startswith("„"):
            break
        orders.append({h: clean(r[i]) for i, h in enumerate(header)})

    pos = table(wb["POS"], "POS")
    equip = table(wb["Bestückung"], "POS")
    cables = table(wb["Kabelliste"], "Gewerk")
    return event, orders, pos, equip, cables


def run(cmd):
    subprocess.run(cmd, check=True, stderr=subprocess.DEVNULL)


def plan_positions(plan_pdf, ids, tmp):
    bbox = os.path.join(tmp, "plan.html")
    run(["pdftotext", "-bbox", plan_pdf, bbox])
    found = {}
    for x0, y0, x1, y1, t in WORD_RE.findall(open(bbox, encoding="utf-8").read()):
        x0, y0, x1, y1 = map(float, (x0, y0, x1, y1))
        # POS-Nummern stehen im Plan in großer Schrift (~32 pt)
        if t in ids and y1 - y0 > 25:
            found.setdefault(t, ((x0 + x1) / 2, (y0 + y1) / 2))
    cx, cy = PLAN_CROP[0], PLAN_CROP[1]
    k = PLAN_DPI / 72
    return {i: [round((x - cx) * k, 1), round((y - cy) * k, 1)] for i, (x, y) in found.items()}


def build_tiles(plan_pdf, tmp):
    run(["pdftoppm", "-r", str(PLAN_DPI), "-png", "-singlefile", plan_pdf, os.path.join(tmp, "plan")])
    full = Image.open(os.path.join(tmp, "plan.png")).convert("RGB")
    k = PLAN_DPI / 72
    box = lambda c: tuple(int(v * k) for v in c)
    hall = full.crop(box(PLAN_CROP))
    leg = full.crop(box(LEGEND_CROP))
    leg.thumbnail((3000, 3000))
    leg.save(os.path.join(OUT, "plan_legend.jpg"), quality=80)

    w, h = hall.size
    maxz = math.ceil(math.log2(max(w, h) / TILE))
    tdir = os.path.join(OUT, "tiles")
    shutil.rmtree(tdir, ignore_errors=True)
    for z in range(maxz, -1, -1):
        scale = 2 ** (z - maxz)
        img = hall if z == maxz else hall.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.LANCZOS)
        os.makedirs(os.path.join(tdir, str(z)), exist_ok=True)
        for tx in range(math.ceil(img.width / TILE)):
            for ty in range(math.ceil(img.height / TILE)):
                tile = Image.new("RGB", (TILE, TILE), "white")
                tile.paste(img.crop((tx * TILE, ty * TILE, min(img.width, (tx + 1) * TILE), min(img.height, (ty + 1) * TILE))))
                tile.save(os.path.join(tdir, str(z), f"{tx}_{ty}.jpg"), quality=78)
    hall.resize((w // 8, h // 8), Image.LANCZOS).save(os.path.join(OUT, "plan_thumb.jpg"), quality=75)
    return {"width": w, "height": h, "maxZoom": maxz, "tile": TILE}


def booklet(booklet_pdf, ids, tmp):
    """Rendert alle Seiten und schneidet je POS den Abschnitt (Überschrift bis nächste Überschrift) aus."""
    bdir = os.path.join(OUT, "booklet")
    shutil.rmtree(bdir, ignore_errors=True)
    os.makedirs(bdir)
    dpi = 110
    run(["pdftoppm", "-r", str(dpi), "-jpeg", "-jpegopt", "quality=78", booklet_pdf, os.path.join(tmp, "bk")])
    bbox = os.path.join(tmp, "bk.html")
    run(["pdftotext", "-bbox-layout", booklet_pdf, bbox])
    html = open(bbox, encoding="utf-8").read()
    pages_html = html.split("<page ")[1:]
    k = dpi / 72
    page_files = sorted(f for f in os.listdir(tmp) if f.startswith("bk-") and f.endswith(".jpg"))
    pages = []
    for i, f in enumerate(page_files):
        name = f"p{i + 1:02d}.jpg"
        shutil.copy(os.path.join(tmp, f), os.path.join(bdir, name))
        pages.append(name)

    line_re = re.compile(r'<line xMin="([\d.]+)" yMin="([\d.]+)" xMax="[\d.]+" yMax="([\d.]+)">(.*?)</line>', re.S)
    # Überschriften: "POS <ID> ..." (ca. 18 pt) und Kapitel (ca. 31 pt)
    heads = []  # (page, y, kind, id)
    appendix_start = None
    for pi, ph in enumerate(pages_html):
        for x0, y0, y1, inner in line_re.findall(ph):
            words = [w[4] for w in WORD_RE.findall(inner)]
            hgt = float(y1) - float(y0)
            if not words:
                continue
            if 15 < hgt < 25 and words[0] == "POS" and len(words) > 1 and words[1] in ids:
                heads.append((pi, float(y0), "pos", words[1]))
            elif hgt >= 25:
                heads.append((pi, float(y0), "chapter", " ".join(words)))
                if words[0] == "Anhang" or (appendix_start is None and words[0] in ("Bodenkabel",)):
                    appendix_start = appendix_start or pi
    footer_y = 800.0
    sections = defaultdict(list)
    for n, (pi, y, kind, ident) in enumerate(heads):
        if kind != "pos" or pi < 4:
            continue
        nxt = heads[n + 1] if n + 1 < len(heads) else None
        segs = []
        if nxt and nxt[0] == pi:
            segs.append((pi, y - 6, nxt[1] - 6))
        else:
            segs.append((pi, y - 6, footer_y))
            # Fortsetzung auf der Folgeseite, falls dort oben keine neue Überschrift steht
            if nxt and nxt[0] == pi + 1 and nxt[1] > 120:
                segs.append((pi + 1, 30, nxt[1] - 6))
        for j, (p, a, b) in enumerate(segs):
            img = Image.open(os.path.join(bdir, pages[p]))
            crop = img.crop((0, int(a * k), img.width, int(min(b, footer_y) * k)))
            fn = f"pos_{re.sub(r'[^A-Za-z0-9_-]', '_', ident)}_{j}.jpg"
            crop.save(os.path.join(bdir, fn), quality=80)
            sections[ident].append({"file": fn, "page": p + 1})

    # Inhaltsverzeichnis (Seiten 2–3) für Titel der Anhangseiten
    toc_txt = subprocess.run(["pdftotext", "-layout", "-f", "2", "-l", "3", booklet_pdf, "-"],
                             capture_output=True, text=True).stdout
    toc = {}
    for line in toc_txt.splitlines():
        for t, n in re.findall(r"([A-Za-zÄÖÜäöü][^\n]*?)\s{2,}(\d{1,2})(?=\s{2,}|\s*$)", line):
            t = t.strip()
            if not t.startswith("POS "):
                toc.setdefault(int(n), t)
    # Anhang: alle Seiten ab der ersten Seite mit Titel "Anhang: …"
    appendix = []
    in_app = False
    for pi, ph in enumerate(pages_html):
        lines = line_re.findall(ph)
        title = None
        for x0, y0, y1, inner in lines:
            if float(y1) - float(y0) >= 25:
                title = " ".join(w[4] for w in WORD_RE.findall(inner))
                break
        if title and title.startswith("Anhang:"):
            in_app = True
            title = title[len("Anhang:"):].strip()
        if in_app or (title and title.startswith("Gesamtplan")):
            if not title or not title[0].isalpha():
                title = toc.get(pi + 1) or (appendix[-1]["title"].replace(" (Forts.)", "") + " (Forts.)" if appendix else f"Seite {pi + 1}")
            appendix.append({"page": pi + 1, "title": title, "file": pages[pi]})
    return pages, sections, appendix


def booklet_flags(booklet_pdf, ids):
    """Kennzeichnungen (nur HDMI, KVM, Detailzeichnung …) je POS aus dem Booklet-Text, inkl. Seitenverweis."""
    txt = subprocess.run(["pdftotext", "-layout", booklet_pdf, "-"], capture_output=True, text=True).stdout
    flags = {}
    known = ("Zeitplan beachten", "nur HDMI", "ClickShare-Raum", "Regiezuspielung", "Detailzeichnung", "KVM")
    lines = txt.splitlines()
    for i, line in enumerate(lines):
        m = re.match(r"POS (\S+) ", line)
        if not (m and m.group(1) in ids) or re.search(r"\s\d+\s*$", line):
            continue
        nxt = next((l.strip() for l in lines[i + 1:i + 4] if l.strip()), "")
        if not nxt.startswith(known):
            continue
        out = []
        for seg in re.split(r"\s{2,}", nxt):
            label = seg.split("·")[0].strip()
            if label in known:
                pm = re.search(r"S\. (\d+)", seg)
                out.append({"label": label, "page": int(pm.group(1)) if pm else None})
        flags[m.group(1)] = out
    # Zeitkritische Hinweise (Eckdaten)
    timing = {}
    m = re.search(r"Zeitkritische Positionen(.*?)So liest du", txt, re.S)
    if m:
        cur = None
        for line in m.group(1).splitlines():
            mm = re.match(r"\s*POS (\S+)\s{2,}", line)
            if mm:
                cur = mm.group(1)
                timing[cur] = []
            elif cur and line.strip():
                timing[cur].append(line.strip())
    return flags, {k: " ".join(v) for k, v in timing.items()}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--xlsx", required=True)
    ap.add_argument("--plan", required=True)
    ap.add_argument("--booklet", required=True)
    a = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)

    event, orders, pos_rows, equip, cables = read_excel(a.xlsx)
    ids = [str(p["POS"]) for p in pos_rows]
    idset = set(ids)
    with tempfile.TemporaryDirectory() as tmp:
        print("Plan …")
        plan = build_tiles(a.plan, tmp)
        coords = plan_positions(a.plan, idset, tmp)
        print("Booklet …")
        pages, sections, appendix = booklet(a.booklet, idset, tmp)
    flags, timing = booklet_flags(a.booklet, idset)

    eq_by = defaultdict(list)
    for i, e in enumerate(equip):
        pid = str(e["POS"])
        # stabiler Schlüssel für Seriennummern: Artikel + laufende Nr. innerhalb der POS
        occ = sum(1 for x in eq_by[pid] if x["artikel"] == e.get("Artikel"))
        eq_by[pid].append({
            "key": f"{e.get('Artikel')}#{occ}",
            "artikel": e.get("Artikel"), "kategorie": e.get("Kategorie"), "menge": e.get("Menge") or 0,
            "montage": e.get("Montageart"), "notiz": e.get("Notiz"), "auftrag": e.get("Auftrag"),
            "paket": e.get("Paket"), "einbauort": e.get("Einbauort"), "angebot": e.get("Im Angebot"),
            "serial": e.get("Kategorie") in SERIAL_CATEGORIES,
        })
    cab_by = defaultdict(list)
    for c in cables:
        if not c.get("Kabel-ID"):
            continue
        item = {k: c.get(k) for k in ("Kabel-ID", "Gewerk", "Start", "m/f Start", "Ende", "m/f Ende", "Kabelart",
                                          "Länge (m)", "Gesamtlänge (m)", "Verwendung", "Vorverkabelung", "Artikel", "Auftrag")}
        item["Ziel-POS"] = str(c.get("Ziel-POS"))
        touched = {str(c.get("Ziel-POS")), str(c.get("Start")), str(c.get("Ende"))}
        for pid in touched & idset:
            cab_by[pid].append(item)

    out_pos = []
    for p in pos_rows:
        pid = str(p["POS"])
        bk = {k[len("Booklet "):]: p[k] for k in p if k.startswith("Booklet ") and p[k]}
        out_pos.append({
            "id": pid, "name": p.get("Bezeichnung"), "bereich": p.get("Bereich"), "einordnung": p.get("Einordnung"),
            "notiz": p.get("Notiz"), "positionen": p.get("Positionen"), "displays": p.get("Displays"),
            "zuspieler": p.get("Zuspieler"), "pruefung": p.get("Prüfung"), "relevant": p.get("Relevant") == "Ja",
            "nurHdmi": p.get("nur HDMI") == "Ja", "clickshare": p.get("ClickShare-Raum") == "Ja",
            "regie": p.get("Regiezuspielung") == "Ja", "booklet": bk, "flags": flags.get(pid, []),
            "timing": timing.get(pid), "plan": coords.get(pid), "bookletCrops": sections.get(pid, []),
            "geraete": eq_by.get(pid, []), "kabel": cab_by.get(pid, []),
        })

    data = {"generated": datetime.datetime.now().isoformat(timespec="seconds"), "event": event, "orders": orders,
            "plan": plan, "bookletPages": pages, "appendix": appendix, "pos": out_pos}
    with open(os.path.join(OUT, "project.json"), "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    # zusätzlich als Script, damit die App ohne Webserver (Doppelklick auf index.html) läuft
    with open(os.path.join(OUT, "project.js"), "w", encoding="utf-8") as f:
        f.write("window.PROJECT_DATA = ")
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")
    print(f"{len(out_pos)} POS, {len(coords)} im Plan, {len(sections)} mit Booklet-Ausschnitt, {len(appendix)} Anhangseiten")
    print("ohne Planposition:", [i for i in ids if i not in coords])


if __name__ == "__main__":
    main()
