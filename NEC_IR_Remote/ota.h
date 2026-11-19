#pragma once
#include <Arduino.h>

// Over-the-Air-Updates:
//  1. Web-Interface: Reiter "Einstellungen" -> Firmware-Datei (.bin) hochladen
//  2. Arduino IDE / PlatformIO: Netzwerk-Port (ArduinoOTA), Passwort = AP-Passwort
namespace ota {

void begin();  // nach dem Start des WLANs aufrufen
void loop();

bool active();     // laeuft gerade ein Update?
String message();  // Statustext fuer Display/Web
int progress();    // 0-100, -1 = unbekannt

// Fuer den Upload ueber das Web-Interface (Datei kommt in Bloecken)
bool webStart();
bool webWrite(const uint8_t *data, size_t len);
bool webFinish();
void webAbort();
String lastError();

}  // namespace ota
