#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>
#include <vector>

#include "ir.h"

// Eine Taste der Fernbedienung (z.B. "MENU") mit ihrem IR-Code.
struct Key {
  String id;     // eindeutiger Name, wird in Makros referenziert
  String label;  // Anzeigename
  IrCode code;
};

// Ein Makro-Schritt: entweder eine Taste senden oder warten.
struct MacroStep {
  String key;           // leer = reiner Warteschritt
  uint16_t times = 1;   // wie oft die Taste gedrueckt wird
  uint16_t pause = 400; // Pause nach jedem Tastendruck (ms)
  uint32_t wait = 0;    // Warteschritt (ms)
};

struct Macro {
  String name;
  std::vector<MacroStep> steps;
};

struct Settings {
  String apSsid;
  String apPass;
  String staSsid;
  String staPass;
};

namespace store {

extern std::vector<Key> keys;
extern std::vector<Macro> macros;
extern Settings settings;

bool begin();

Key *findKey(const String &id);

bool saveKeys();
bool saveMacros();
bool saveSettings();

// JSON <-> Datenstrukturen (fuer Dateien und Web-API)
void keysToJson(JsonArray arr);
void macrosToJson(JsonArray arr);
bool keysFromJson(JsonArrayConst arr, String &err);
bool macrosFromJson(JsonArrayConst arr, String &err);

void resetToDefaults();

}  // namespace store
