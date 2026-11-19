#pragma once
#include <Arduino.h>

// Fuehrt Makros in einem eigenen FreeRTOS-Task aus, damit Display,
// Tasten und Web-Interface waehrenddessen bedienbar bleiben.
namespace macro {

struct Status {
  bool running = false;
  String name;
  String current;  // aktueller Schritt als Text
  int step = 0;    // 1-basiert
  int total = 0;
  String error;    // z.B. "Taste MENU ist nicht angelernt"
};

void begin();
// Startet das Makro mit dem gegebenen Index. false, wenn bereits eins laeuft.
bool run(size_t index, String &err);
void stop();
Status status();

}  // namespace macro
