// NEC M431 IR-Fernbedienung mit Makros fuer M5Stack StickS3
//
// Arduino IDE:
//   Boardverwalter : "esp32" von Espressif (>= 3.0)
//   Board          : "ESP32S3 Dev Module" (oder "M5StickS3", falls vorhanden)
//   Flash Size     : 8MB
//   Partition      : "8M with spiffs (3MB APP/1.5MB SPIFFS)"  (zwei App-Slots fuer OTA)
//   USB CDC On Boot: Enabled
//   Bibliotheken   : M5Unified (>= 0.3.0), ArduinoJson (>= 7)
//
// Die eigentliche Logik steckt in den .cpp-Dateien dieses Ordners.
#include "ui.h"

void setup() { uiSetup(); }

void loop() { uiLoop(); }
