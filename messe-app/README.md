# Messe-Technik – POS-App

Web-App für den Messeaufbau, die **POS-Master (Excel)**, **Hallenplan (PDF)** und **Medientechnik-Booklet (PDF)**
an einer Stelle zusammenführt.

- **Hallenplan** zoom- und verschiebbar; jede POS-Nummer im Plan ist anklickbar (Farbe = Status)
- **POS-Detail**: Geräte aus der Bestückung, Booklet-Angaben (Display, Montage, Verkabelung, Rechner, Zubehör,
  Hinweise), Bodenkabel aus der Kabelliste, Kennzeichnungen (nur HDMI, KVM, ClickShare, Detailzeichnung …)
  mit Sprung auf die Anhangseite, Booklet-Ausschnitt der POS
- **Seriennummern** je verbautem Gerät (Display, Zuspieler, Peripherie, Kameratechnik) per **Kamera-Scan**
  (Barcode/QR) oder Eintippen; Warnung bei doppelt vergebener Seriennummer; „nächstes Gerät scannen“
- **Status** je POS: Vorbereitet · In Bearbeitung · Zum Prüfen · Erledigt (mit Name + Zeit)
- **Fotos** je POS (Kamera oder Galerie, werden auf max. 1920 px verkleinert), **Notiz** je POS
- **Positionsliste** mit Suche (auch nach Gerät, Kabel-ID, Seriennummer) und Filtern nach Bereich/Status
- **Unterlagen**: Eckdaten, zeitkritische POS, Anhang/Schemata, ganzes Booklet, Aufträge mit Ansprechpartnern
- **Offline-fähig** (PWA, „Zum Home-Bildschirm hinzufügen“), Daten liegen lokal im Browser
- **Sync-Server** optional: alle Geräte sehen denselben Stand; offline gesammelte Änderungen werden
  nachgereicht. Ohne Server: Abgleich per Export/Import-Datei
- **Export** als CSV (Seriennummern + Status, für Excel) und JSON-Sicherung inkl. Fotos

## Starten

Voraussetzung: Node.js ≥ 18 (keine weiteren Pakete nötig).

```bash
cd messe-app
node server/server.js
```

Dann im Browser `http://localhost:8080` öffnen. Der Server zeigt beim Start auch die Adressen im lokalen Netz an.

| Variable | Bedeutung |
|---|---|
| `PORT` | Port (Standard 8080) |
| `TOKEN` | Zugangscode – ohne ihn sind Sync und Fotos nicht abrufbar |
| `DATA_DIR` | Ablage für Stände und Fotos (Standard `server/data`) |
| `TLS_CERT`, `TLS_KEY` | Zertifikat + Schlüssel → Server läuft mit HTTPS |

### Kamera auf Handys braucht HTTPS

Browser geben die Kamera nur über `https://` (oder `localhost`) frei. Möglichkeiten:

1. Server hinter einem vorhandenen HTTPS-Reverse-Proxy betreiben, oder
2. eigenes Zertifikat verwenden:
   ```bash
   openssl req -x509 -newkey rsa:2048 -nodes -days 365 -keyout server/key.pem -out server/cert.pem -subj "/CN=messe-technik"
   ```
   ```bash
   TLS_CERT=server/cert.pem TLS_KEY=server/key.pem TOKEN=meincode node server/server.js
   ```
   Beim ersten Aufruf die Zertifikatswarnung bestätigen.

Ohne Kamera lässt sich die Seriennummer jederzeit eintippen.

### Nur statisch (ohne Server)

Der Ordner `public/` kann auf jedem Webserver mit HTTPS liegen. Dann speichert jedes Gerät lokal;
unter **Sync & Export** kann zusätzlich die Adresse eines Sync-Servers eingetragen werden
(der Server erlaubt dafür CORS). Achtung: `public/data` enthält die Projektdaten – nur auf nicht-öffentlichen
Servern ablegen.

## Daten aktualisieren

Bei neuem POS-Master, Plan oder Booklet die App-Daten neu erzeugen
(benötigt Python 3 mit `openpyxl` und `Pillow` sowie `poppler-utils`):

```bash
python3 tools/build_data.py --xlsx POS-Master.xlsx --plan Hallenplan.pdf --booklet Booklet.pdf
```

Das Skript

- liest die Blätter `Start` (Eckdaten, Aufträge), `POS`, `Bestückung` und `Kabelliste`,
- findet die POS-Nummern im Plan-PDF über ihre Textposition (große Beschriftung) und
  rendert den Plan als Kachel-Pyramide (`public/data/tiles`),
- rendert das Booklet seitenweise und schneidet je POS den Abschnitt aus (`public/data/booklet`),
- liest Kennzeichnungen und zeitkritische Hinweise aus dem Booklet-Text.

Erfasste Status, Seriennummern und Fotos bleiben beim Neuaufbau erhalten (Seriennummern sind über
Artikelname + laufende Nummer innerhalb der POS zugeordnet). Ändert sich Kunde/Messe/Jahr, beginnt ein neues
Projekt mit eigenem Datenstand.

POS ohne Nummer im Hallenplan (Vertical Area, NCC West, 310) erscheinen in der Liste und sind über die
Suche erreichbar, aber nicht im Plan markiert.

## Aufbau

| Pfad | Inhalt |
|---|---|
| `public/index.html`, `style.css` | Oberfläche |
| `public/app.js` | Plan, Liste, POS-Detail, Unterlagen, Export |
| `public/store.js` | lokale Datenhaltung (IndexedDB) und Sync |
| `public/scanner.js` | Kamera-Scanner (BarcodeDetector bzw. ZXing) |
| `public/sw.js` | Offline-Cache |
| `public/vendor/` | Leaflet 1.9.4 (Plan), ZXing 0.21.3 (Barcodes) |
| `public/data/` | erzeugte Projektdaten |
| `server/server.js` | Sync-Server + Auslieferung der App |
| `tools/build_data.py` | Import der drei Dokumente |

### Abgleich

Jede Änderung ist ein Feld (`status`, `note`, `sn:<Gerät>:<Nr>`, `photo:<id>`) mit Zeitstempel und Name.
Beim Zusammenführen gewinnt pro Feld die jüngste Änderung – zwei Personen können also gleichzeitig an
verschiedenen Geräten derselben POS arbeiten. Fotos werden separat hochgeladen; der Server speichert sie
unter `DATA_DIR/photos`.
