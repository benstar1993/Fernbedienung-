#pragma once
#include <Arduino.h>

namespace web {

void begin();
void loop();

// Infos fuer die Anzeige auf dem StickS3
String apSsid();
String apIp();
String staIp();  // leer, wenn nicht mit einem WLAN verbunden

// Laufender Lernvorgang (leer, wenn keiner aktiv)
String learnKey();
String learnMessage();
void startLearn(const String &keyId);
void cancelLearn();

}  // namespace web
