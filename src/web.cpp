#include "web.h"

#include <ArduinoJson.h>
#include <WebServer.h>
#include <WiFi.h>

#include "ir.h"
#include "macro.h"
#include "store.h"
#include "web_ui.h"

namespace web {

namespace {

WebServer server(80);

String learnId;       // Taste, die gerade angelernt wird
String learnMsg;      // letzte Meldung des Lernmodus
uint32_t learnMsgAt = 0;
bool restartPending = false;
uint32_t restartAt = 0;

void sendJson(int code, const JsonDocument &doc) {
  String out;
  serializeJson(doc, out);
  server.send(code, "application/json", out);
}

void sendOk() {
  JsonDocument d;
  d["ok"] = true;
  sendJson(200, d);
}

void sendErr(const String &msg, int code = 400) {
  JsonDocument d;
  d["ok"] = false;
  d["error"] = msg;
  sendJson(code, d);
}

bool parseBody(JsonDocument &doc) {
  if (!server.hasArg("plain")) {
    sendErr("Kein Inhalt");
    return false;
  }
  if (deserializeJson(doc, server.arg("plain"))) {
    sendErr("Ungueltiges JSON");
    return false;
  }
  return true;
}

void handleState() {
  JsonDocument d;
  store::keysToJson(d["keys"].to<JsonArray>());
  store::macrosToJson(d["macros"].to<JsonArray>());

  macro::Status s = macro::status();
  JsonObject r = d["run"].to<JsonObject>();
  r["running"] = s.running;
  r["name"] = s.name;
  r["step"] = s.step;
  r["total"] = s.total;
  r["current"] = s.current;

  JsonObject l = d["learn"].to<JsonObject>();
  l["key"] = learnId;
  l["msg"] = learnMsg;

  JsonObject w = d["wifi"].to<JsonObject>();
  w["ap_ssid"] = store::settings.apSsid;
  w["ap_ip"] = apIp();
  w["sta_ssid"] = store::settings.staSsid;
  w["sta_ip"] = staIp();
  sendJson(200, d);
}

void handleSend() {
  JsonDocument b;
  if (!parseBody(b)) return;
  String id = b["key"] | "";
  Key *k = store::findKey(id);
  if (!k) return sendErr("Unbekannte Taste");
  if (k->code.proto == IrProto::None) return sendErr("Taste ist nicht angelernt");
  IrCode c = k->code;
  int times = constrain((int)(b["times"] | 1), 1, 20);
  for (int i = 0; i < times; i++) ir::send(c);
  sendOk();
}

void handleLearn() {
  JsonDocument b;
  if (!parseBody(b)) return;
  String id = b["key"] | "";
  if (id.length() == 0) {
    cancelLearn();
    return sendOk();
  }
  if (!store::findKey(id)) return sendErr("Unbekannte Taste");
  if (macro::status().running) return sendErr("Waehrend eines Makros nicht moeglich");
  startLearn(id);
  sendOk();
}

void handleSaveKeys() {
  JsonDocument b;
  if (!parseBody(b)) return;
  String err;
  if (!store::keysFromJson(b["keys"].as<JsonArrayConst>(), err)) return sendErr(err);
  if (!store::saveKeys()) return sendErr("Speichern fehlgeschlagen", 500);
  sendOk();
}

void handleSaveMacros() {
  JsonDocument b;
  if (!parseBody(b)) return;
  String err;
  if (!store::macrosFromJson(b["macros"].as<JsonArrayConst>(), err)) return sendErr(err);
  if (!store::saveMacros()) return sendErr("Speichern fehlgeschlagen", 500);
  sendOk();
}

void handleRun() {
  JsonDocument b;
  if (!parseBody(b)) return;
  String err;
  if (!macro::run(b["index"] | 9999, err)) return sendErr(err);
  sendOk();
}

void handleStop() {
  macro::stop();
  sendOk();
}

void handleBackup() {
  JsonDocument d;
  d["type"] = "nec-ir-remote-backup";
  d["version"] = 1;
  store::keysToJson(d["keys"].to<JsonArray>());
  store::macrosToJson(d["macros"].to<JsonArray>());
  String out;
  serializeJsonPretty(d, out);
  server.sendHeader("Content-Disposition", "attachment; filename=\"nec-ir-backup.json\"");
  server.send(200, "application/json", out);
}

void handleRestore() {
  JsonDocument b;
  if (!parseBody(b)) return;
  String err;
  auto oldKeys = store::keys;
  if (!store::keysFromJson(b["keys"].as<JsonArrayConst>(), err)) return sendErr(err);
  if (!store::macrosFromJson(b["macros"].as<JsonArrayConst>(), err)) {
    store::keys = oldKeys;
    return sendErr(err);
  }
  store::saveKeys();
  store::saveMacros();
  sendOk();
}

void handleReset() {
  store::resetToDefaults();
  sendOk();
}

void handleSettings() {
  JsonDocument b;
  if (!parseBody(b)) return;
  String apSsid = b["ap_ssid"] | store::settings.apSsid.c_str();
  String apPass = b["ap_pass"] | store::settings.apPass.c_str();
  if (apSsid.length() < 1 || apSsid.length() > 32) return sendErr("AP-Name: 1-32 Zeichen");
  if (apPass.length() > 0 && (apPass.length() < 8 || apPass.length() > 63))
    return sendErr("AP-Passwort: 8-63 Zeichen oder leer");
  store::settings.apSsid = apSsid;
  store::settings.apPass = apPass;
  store::settings.staSsid = b["sta_ssid"] | "";
  if (b["sta_pass"].is<const char *>()) store::settings.staPass = b["sta_pass"].as<String>();
  store::saveSettings();
  restartPending = true;
  restartAt = millis() + 1500;
  sendOk();
}

void startWifi() {
  const auto &s = store::settings;
  WiFi.mode(s.staSsid.length() ? WIFI_AP_STA : WIFI_AP);
  WiFi.softAP(s.apSsid.c_str(), s.apPass.length() ? s.apPass.c_str() : nullptr);
  if (s.staSsid.length()) {
    WiFi.setAutoReconnect(true);
    WiFi.begin(s.staSsid.c_str(), s.staPass.c_str());
  }
}

}  // namespace

void begin() {
  startWifi();

  server.on("/", HTTP_GET, [] { server.send_P(200, "text/html; charset=utf-8", INDEX_HTML); });
  server.on("/api/state", HTTP_GET, handleState);
  server.on("/api/send", HTTP_POST, handleSend);
  server.on("/api/learn", HTTP_POST, handleLearn);
  server.on("/api/keys", HTTP_POST, handleSaveKeys);
  server.on("/api/macros", HTTP_POST, handleSaveMacros);
  server.on("/api/run", HTTP_POST, handleRun);
  server.on("/api/stop", HTTP_POST, handleStop);
  server.on("/api/backup", HTTP_GET, handleBackup);
  server.on("/api/restore", HTTP_POST, handleRestore);
  server.on("/api/reset", HTTP_POST, handleReset);
  server.on("/api/settings", HTTP_POST, handleSettings);
  server.onNotFound([] { server.send(404, "text/plain", "Nicht gefunden"); });
  server.begin();
}

void loop() {
  server.handleClient();

  if (learnId.length()) {
    IrCode c;
    LearnState ls = ir::pollLearn(c);
    if (ls == LearnState::Done) {
      Key *k = store::findKey(learnId);
      if (k) {
        k->code = c;
        store::saveKeys();
        learnMsg = k->label + " gelernt: " + ir::describe(c);
      }
      learnId = "";
      learnMsgAt = millis();
    } else if (ls == LearnState::Timeout) {
      learnMsg = "Kein Signal empfangen (Zeit abgelaufen)";
      learnId = "";
      learnMsgAt = millis();
    }
  }
  if (learnMsg.length() && !learnId.length() && millis() - learnMsgAt > 10000) learnMsg = "";

  if (restartPending && (int32_t)(millis() - restartAt) > 0) ESP.restart();
}

void startLearn(const String &keyId) {
  Key *k = store::findKey(keyId);
  if (!k) return;
  learnId = keyId;
  learnMsg = "Taste \"" + k->label + "\" auf der Original-Fernbedienung druecken";
  ir::startLearn();
}

void cancelLearn() {
  ir::cancelLearn();
  learnId = "";
  learnMsg = "Lernen abgebrochen";
  learnMsgAt = millis();
}

String apSsid() { return store::settings.apSsid; }
String apIp() { return WiFi.softAPIP().toString(); }
String staIp() { return WiFi.status() == WL_CONNECTED ? WiFi.localIP().toString() : String(); }
String learnKey() { return learnId; }
String learnMessage() { return learnMsg; }

}  // namespace web
