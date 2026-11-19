#include "store.h"

#include <LittleFS.h>
#include <WiFi.h>

#include "config.h"

namespace store {

std::vector<Key> keys;
std::vector<Macro> macros;
Settings settings;

namespace {

// Tastenbelegung angelehnt an die Fernbedienung der NEC MultiSync M-Serie.
// Die IR-Codes sind leer und werden per Lernmodus von der Original-
// Fernbedienung uebernommen (oder im Web-Interface manuell eingetragen).
struct DefaultKey {
  const char *id;
  const char *label;
};
const DefaultKey DEFAULT_KEYS[] = {
    {"POWER_ON", "Power ON"},   {"STANDBY", "Standby"},     {"HDMI1", "HDMI 1"},
    {"HDMI2", "HDMI 2"},        {"HDMI3", "HDMI 3"},        {"DPORT", "DisplayPort"},
    {"OPTION", "Option/CMS"},   {"MP", "Media Player"},     {"INPUT", "Input"},
    {"MENU", "Menu"},           {"EXIT", "Exit"},           {"UP", "Hoch"},
    {"DOWN", "Runter"},         {"LEFT", "Links (-)"},      {"RIGHT", "Rechts (+)"},
    {"SET", "Set / OK"},        {"VOL_UP", "Vol +"},        {"VOL_DOWN", "Vol -"},
    {"MUTE", "Mute"},           {"PIC_MODE", "Picture Mode"}, {"ASPECT", "Aspect"},
    {"DISPLAY", "Display/Info"}, {"AUTO_SET", "Auto Setup"}, {"STILL", "Still"},
    {"PIP", "PIP"},             {"ID_SET", "Remote ID Set"}, {"ID_CLR", "Remote ID Clear"},
};

void defaultMacros() {
  macros.clear();
  macros.push_back({"Einschalten + HDMI 1",
                    {{"POWER_ON", 1, 400, 0}, {"", 1, 0, 8000}, {"HDMI1", 1, 400, 0}}});
  macros.push_back({"Ausschalten (Standby)", {{"STANDBY", 1, 400, 0}}});
  macros.push_back({"Eingang DisplayPort", {{"DPORT", 1, 400, 0}}});
  macros.push_back({"Ton stumm", {{"MUTE", 1, 400, 0}}});
  // Beispiel fuer eine Menue-Navigation – Schritte an das echte OSD anpassen!
  macros.push_back({"Beispiel: Menue-Navigation",
                    {{"MENU", 1, 600, 0},
                     {"DOWN", 2, 350, 0},
                     {"SET", 1, 500, 0},
                     {"RIGHT", 3, 300, 0},
                     {"EXIT", 3, 300, 0}}});
}

void defaultSettings() {
  uint8_t mac[6];
  WiFi.macAddress(mac);
  char ssid[32];
  snprintf(ssid, sizeof(ssid), "%s%02X%02X", DEFAULT_AP_SSID_PREFIX, mac[4], mac[5]);
  settings.apSsid = ssid;
  settings.apPass = DEFAULT_AP_PASS;
  settings.staSsid = "";
  settings.staPass = "";
}

bool readJson(const char *path, JsonDocument &doc) {
  File f = LittleFS.open(path, "r");
  if (!f) return false;
  DeserializationError e = deserializeJson(doc, f);
  f.close();
  return !e;
}

bool writeJson(const char *path, const JsonDocument &doc) {
  String tmp = String(path) + ".tmp";
  File f = LittleFS.open(tmp, "w");
  if (!f) return false;
  size_t n = serializeJson(doc, f);
  f.close();
  if (n == 0) return false;
  LittleFS.remove(path);
  return LittleFS.rename(tmp, path);
}

const char *protoName(IrProto p) {
  switch (p) {
    case IrProto::Nec: return "nec";
    case IrProto::Raw: return "raw";
    default: return "";
  }
}

}  // namespace

Key *findKey(const String &id) {
  for (auto &k : keys)
    if (k.id == id) return &k;
  return nullptr;
}

void keysToJson(JsonArray arr) {
  for (const auto &k : keys) {
    JsonObject o = arr.add<JsonObject>();
    o["id"] = k.id;
    o["label"] = k.label;
    o["proto"] = protoName(k.code.proto);
    if (k.code.proto == IrProto::Nec) {
      o["addr"] = k.code.addr;
      o["cmd"] = k.code.cmd;
    } else if (k.code.proto == IrProto::Raw) {
      JsonArray r = o["raw"].to<JsonArray>();
      for (auto v : k.code.raw) r.add(v);
    }
  }
}

void macrosToJson(JsonArray arr) {
  for (const auto &m : macros) {
    JsonObject o = arr.add<JsonObject>();
    o["name"] = m.name;
    JsonArray steps = o["steps"].to<JsonArray>();
    for (const auto &s : m.steps) {
      JsonObject so = steps.add<JsonObject>();
      if (s.key.length()) {
        so["key"] = s.key;
        so["times"] = s.times;
        so["pause"] = s.pause;
      } else {
        so["wait"] = s.wait;
      }
    }
  }
}

bool keysFromJson(JsonArrayConst arr, String &err) {
  std::vector<Key> out;
  for (JsonObjectConst o : arr) {
    Key k;
    k.id = o["id"] | "";
    k.id.trim();
    k.id.toUpperCase();
    k.id.replace(" ", "_");
    if (!k.id.length()) {
      err = "Taste ohne ID";
      return false;
    }
    for (auto &e : out)
      if (e.id == k.id) {
        err = "Doppelte Tasten-ID: " + k.id;
        return false;
      }
    k.label = o["label"] | k.id.c_str();
    String proto = o["proto"] | "";
    if (proto == "nec") {
      k.code.proto = IrProto::Nec;
      k.code.addr = o["addr"] | 0;
      k.code.cmd = o["cmd"] | 0;
    } else if (proto == "raw") {
      k.code.proto = IrProto::Raw;
      for (JsonVariantConst v : o["raw"].as<JsonArrayConst>()) {
        if (k.code.raw.size() >= MAX_RAW_LEN) break;
        k.code.raw.push_back(v.as<uint16_t>());
      }
      if (k.code.raw.size() < 2) k.code.proto = IrProto::None;
    }
    out.push_back(k);
  }
  keys = out;
  return true;
}

bool macrosFromJson(JsonArrayConst arr, String &err) {
  std::vector<Macro> out;
  for (JsonObjectConst o : arr) {
    Macro m;
    m.name = o["name"] | "";
    m.name.trim();
    if (!m.name.length()) {
      err = "Makro ohne Namen";
      return false;
    }
    for (JsonObjectConst so : o["steps"].as<JsonArrayConst>()) {
      if (m.steps.size() >= MAX_MACRO_STEP) {
        err = "Zu viele Schritte in " + m.name;
        return false;
      }
      MacroStep s;
      s.key = so["key"] | "";
      if (s.key.length()) {
        s.times = constrain((int)(so["times"] | 1), 1, 50);
        s.pause = constrain((int)(so["pause"] | 400), 0, 10000);
      } else {
        s.wait = constrain((long)(so["wait"] | 1000), 0L, 600000L);
      }
      m.steps.push_back(s);
    }
    out.push_back(m);
  }
  macros = out;
  return true;
}

bool saveKeys() {
  JsonDocument doc;
  keysToJson(doc.to<JsonArray>());
  return writeJson(FILE_KEYS, doc);
}

bool saveMacros() {
  JsonDocument doc;
  macrosToJson(doc.to<JsonArray>());
  return writeJson(FILE_MACROS, doc);
}

bool saveSettings() {
  JsonDocument doc;
  doc["ap_ssid"] = settings.apSsid;
  doc["ap_pass"] = settings.apPass;
  doc["sta_ssid"] = settings.staSsid;
  doc["sta_pass"] = settings.staPass;
  return writeJson(FILE_SETTINGS, doc);
}

void resetToDefaults() {
  keys.clear();
  for (const auto &d : DEFAULT_KEYS) keys.push_back({d.id, d.label, IrCode()});
  defaultMacros();
  saveKeys();
  saveMacros();
}

bool begin() {
  if (!LittleFS.begin(true)) return false;
  String err;

  JsonDocument kd;
  if (!readJson(FILE_KEYS, kd) || !keysFromJson(kd.as<JsonArrayConst>(), err) || keys.empty()) {
    keys.clear();
    for (const auto &d : DEFAULT_KEYS) keys.push_back({d.id, d.label, IrCode()});
    saveKeys();
  }

  JsonDocument md;
  if (!readJson(FILE_MACROS, md) || !macrosFromJson(md.as<JsonArrayConst>(), err)) {
    defaultMacros();
    saveMacros();
  }

  defaultSettings();
  JsonDocument sd;
  if (readJson(FILE_SETTINGS, sd)) {
    settings.apSsid = sd["ap_ssid"] | settings.apSsid.c_str();
    settings.apPass = sd["ap_pass"] | settings.apPass.c_str();
    settings.staSsid = sd["sta_ssid"] | "";
    settings.staPass = sd["sta_pass"] | "";
  } else {
    saveSettings();
  }
  return true;
}

}  // namespace store
