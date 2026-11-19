# NEC M431 – IR-Fernbedienung mit Makros (M5Stack StickS3)

Firmware für den **M5Stack StickS3** (ESP32-S3, IR-Sender + IR-Empfänger), mit der sich
**NEC MultiSync M431** Displays (und andere NEC-Displays) per Infrarot steuern lassen.
Makros führen ganze Abläufe automatisch aus, z.B. *Einschalten → 8 s warten → HDMI 1*
oder eine Menü-Navigation im OSD.

## Funktionen

- **Makros** am Gerät auswählen und starten (Taste A/B) oder per Handy/Laptop im Browser
- **Tasten anlernen** von der Original-NEC-Fernbedienung (NEC-Protokoll wird dekodiert,
  andere Protokolle als Rohsignal gespeichert)
- NEC-Codes alternativ **manuell als Hex** eintragen (`ADRESSE:BEFEHL`, z.B. `18E9:0A`)
- **Makro-Editor**: Tasten, Anzahl Wiederholungen, Pausen und Wartezeiten
- Makros werden vor dem Start geprüft – fehlt ein Code, läuft nichts halb an
- **Backup/Restore** als JSON-Datei → identische Konfiguration auf mehrere Sticks verteilen
- Eigener WLAN-Access-Point (kein Internet nötig), optional zusätzlich im Hallen-WLAN
- Alles bleibt im Flash gespeichert (LittleFS)

## Bedienung am StickS3

| Taste | kurz | lang |
|---|---|---|
| **A** (Front, unter dem Display) | Makro starten / laufendes Makro stoppen / Lernen abbrechen | WLAN-Infos ein/aus |
| **B** (Seite) | nächstes Makro | vorheriges Makro |

Nach 60 s ohne Bedienung wird das Display gedimmt; der erste Tastendruck weckt es nur auf.

## Erste Einrichtung

1. Firmware flashen (siehe unten).
2. Mit dem WLAN **`NEC-IR-xxxx`** verbinden, Passwort **`necremote`**
   (Name/Passwort stehen auch am Stick: Taste A lang drücken).
3. Im Browser **http://192.168.4.1** öffnen.
4. Reiter **Tasten**: bei jeder benötigten Taste *Lernen* antippen, dann die
   Original-Fernbedienung aus ca. 30 cm auf die **Oberseite** des StickS3 richten
   und die Taste kurz drücken. Der gelernte Code (z.B. `NEC E718:08`) erscheint sofort.
5. Reiter **Makros bearbeiten**: Abläufe zusammenstellen, *Makros speichern*.
6. Reiter **Einstellungen**: AP-Passwort ändern und ein **Backup** herunterladen.

> Die mitgelieferten Makros sind Vorlagen. Besonders die Menü-Navigation muss an das
> tatsächliche OSD der M431 (Firmware-Stand, Menüsprache) angepasst werden – am besten
> Schritt für Schritt mit der Original-Fernbedienung nachdrücken und mitschreiben.

### Tipps für zuverlässige Makros

- Nach **POWER ON** braucht das Display einige Sekunden, bevor es weitere Befehle annimmt
  → Warteschritt (z.B. 8000 ms) einfügen.
- Im OSD **300–600 ms Pause** zwischen Tastendrücken lassen.
- Mit mehrfachem **EXIT** am Ende in einen definierten Zustand zurückkehren.
- Ist am Display eine **Remote-ID** gesetzt bzw. die IR-Sperre aktiv, die Codes mit
  derselben Einstellung der Original-Fernbedienung anlernen.
- Der IR-Empfänger des Displays sitzt im Bedienteil/Sensor-Modul – Sichtlinie beachten.

## Firmware bauen & flashen

### Fertiges Image (GitHub Actions)

Jeder Push baut die Firmware automatisch (*Actions → Firmware bauen → Artifacts*).
`nec-ir-sticks3-full.bin` enthält Bootloader, Partitionen und App und wird an
Adresse `0x0` geschrieben, z.B. mit dem Browser-Tool https://espressif.github.io/esptool-js/
oder:

```bash
esptool.py --chip esp32s3 write_flash 0x0 nec-ir-sticks3-full.bin
```

Lässt sich der Stick nicht ansprechen, ihn wie in der M5Stack-Dokumentation zum StickS3
beschrieben in den Download-Modus versetzen und erneut flashen.

### Selbst bauen (PlatformIO)

```bash
pip install platformio
pio run -t upload        # baut und flasht über USB-C
pio device monitor       # serielle Ausgabe
```

Abhängigkeiten: Arduino-ESP32 3.x (pioarduino), M5Unified ≥ 0.3.0, ArduinoJson 7.

## Aufbau

| Datei | Inhalt |
|---|---|
| `src/ir.cpp` | IR senden/empfangen über das RMT-Peripheral (38 kHz, NEC-Encoder/-Decoder, Rohsignale) |
| `src/store.cpp` | Tasten, Makros, Einstellungen als JSON im LittleFS |
| `src/macro.cpp` | Makro-Ausführung in eigenem Task (stoppbar) |
| `src/web.cpp`, `src/web_ui.h` | WLAN, REST-API und Web-Oberfläche |
| `src/main.cpp` | Display & Tasten am StickS3 |
| `src/config.h` | Pins (IR-TX GPIO46, IR-RX GPIO42), Timings, Standardwerte |

### REST-API (für Automatisierung, z.B. Companion/Stream Deck)

| Methode | Pfad | Body |
|---|---|---|
| GET | `/api/state` | – |
| POST | `/api/run` | `{"index": 0}` |
| POST | `/api/stop` | `{}` |
| POST | `/api/send` | `{"key": "HDMI1", "times": 1}` |
| POST | `/api/learn` | `{"key": "MENU"}` (leer = abbrechen) |
| GET/POST | `/api/backup` / `/api/restore` | Backup-JSON |

## Hinweise

- Die IR-Codes der M431 sind **nicht** fest hinterlegt, weil sie je nach Fernbedienung und
  Remote-ID variieren können; sie werden einmal angelernt und per Backup verteilt.
- Für sehr zuverlässige Festinstallationen unterstützen NEC-Displays zusätzlich
  Steuerung per LAN/RS-232 (NEC External Control). IR erfordert Sichtverbindung.
