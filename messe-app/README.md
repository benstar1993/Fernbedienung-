# Messe-Technik – POS-App

Reine Browser-App (HTML, CSS, JavaScript) für den Messeaufbau. Sie führt **POS-Master (Excel)**,
**Hallenplan (PDF)** und **Medientechnik-Booklet (PDF)** an einer Stelle zusammen.
**Kein Server, kein Node.js, keine Installation** – `public/index.html` per Doppelklick öffnen.

## Funktionen

- **Hallenplan** zoom- und verschiebbar; jede POS-Nummer im Plan ist anklickbar (Farbe = Status)
- **POS-Detail**: Geräte aus der Bestückung, Booklet-Angaben (Display, Montage, Verkabelung, Rechner, Zubehör,
  Hinweise), Bodenkabel aus der Kabelliste, Kennzeichnungen (nur HDMI, KVM, ClickShare, Detailzeichnung …)
  mit Sprung auf die Anhangseite, Booklet-Ausschnitt der POS
- **Seriennummern** je verbautem Gerät (Display, Zuspieler, Peripherie, Kameratechnik) per **Kamera-Scan**
  (Barcode/QR) oder Eintippen; Warnung bei doppelt vergebener Seriennummer; „nächstes Gerät scannen“
- **Status** je POS: Vorbereitet · In Bearbeitung · Zum Prüfen · Erledigt (mit Name + Zeit)
- **Fotos** je POS (Kamera oder Galerie, verkleinert auf max. 1920 px) und **Notiz** je POS
- **Positionsliste** mit Suche (auch nach Gerät, Kabel-ID, Seriennummer) und Filtern nach Bereich/Status
- **Unterlagen**: Eckdaten, zeitkritische POS, Anhang/Schemata, ganzes Booklet, Aufträge mit Ansprechpartnern
- **Sicherung**: Export/Import als JSON (inkl. Fotos), CSV-Export der Seriennummern und Status für Excel

## Benutzung

1. Ordner auf den Rechner kopieren.
2. `index.html` im Ordner `public` mit Chrome oder Edge öffnen (Doppelklick).
3. Beim ersten Start Namen eingeben.

**Wo liegen die Daten?** Status, Seriennummern, Fotos und Notizen werden im Browser auf diesem Gerät
gespeichert (IndexedDB) – nicht in der Datei selbst. Deshalb:

- immer denselben Browser und denselben Ordnerpfad verwenden,
- regelmäßig unter **Sicherung** eine Sicherung (.json) exportieren,
- Abgleich mit Kollegen: Sicherung exportieren und beim anderen **importieren**. Die Daten werden
  zusammengeführt – pro Feld (Status, einzelne Seriennummer, Foto …) gewinnt die jüngste Änderung.

**Kamera:** Chrome/Edge erlauben die Kamera auch bei per Doppelklick geöffneten Dateien. Auf Handys/Tablets
lässt sich eine lokale HTML-Datei meist nicht sinnvoll öffnen – dafür den Ordner `public` auf einen beliebigen
Webspace mit HTTPS legen (reine statische Dateien, kein Server-Programm nötig). Achtung: `public/data`
enthält Kundendaten, also nur auf geschützten, nicht-öffentlichen Webspace.

## Daten aktualisieren

Bei neuem POS-Master, Plan oder Booklet die App-Daten neu erzeugen
(einmalig nötig: Python 3 mit `openpyxl` und `Pillow` sowie `poppler-utils`):

```bash
python3 tools/build_data.py --xlsx POS-Master.xlsx --plan Hallenplan.pdf --booklet Booklet.pdf
```

Das Skript schreibt `public/data/` (Projektdaten `project.js`, Plan-Kacheln, Booklet-Seiten und -Ausschnitte).
Bereits erfasste Status, Seriennummern und Fotos bleiben erhalten (Seriennummern sind über Artikelname +
laufende Nummer innerhalb der POS zugeordnet).

POS ohne Nummer im Hallenplan (Vertical Area, NCC West, 310) erscheinen in der Liste und in der Suche,
sind aber nicht im Plan markiert.

`public/data/` ist bewusst nicht im Git-Repository (Kundendaten).

## Aufbau

| Pfad | Inhalt |
|---|---|
| `public/index.html`, `style.css` | Oberfläche |
| `public/app.js` | Plan, Liste, POS-Detail, Unterlagen, Export |
| `public/store.js` | Datenhaltung im Browser (IndexedDB), Export/Import |
| `public/scanner.js` | Kamera-Scanner (BarcodeDetector bzw. ZXing) |
| `public/vendor/` | Leaflet 1.9.4 (Plan), ZXing 0.21.3 (Barcodes) – lokal, ohne Internet |
| `public/data/` | erzeugte Projektdaten |
| `tools/build_data.py` | Import der drei Dokumente |
