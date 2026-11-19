#include "ota.h"

#include <ArduinoOTA.h>
#include <Update.h>

#include "ir.h"
#include "macro.h"
#include "store.h"

namespace ota {

namespace {

volatile bool running = false;
volatile int pct = -1;
size_t written = 0;
String msg;
String err;

void prepare() {
  macro::stop();
  ir::cancelLearn();
  running = true;
  pct = -1;
  written = 0;
  err = "";
}

}  // namespace

void begin() {
  String host = store::settings.apSsid;
  host.toLowerCase();
  host.replace("_", "-");
  host.replace(" ", "-");
  ArduinoOTA.setHostname(host.c_str());
  if (store::settings.apPass.length()) ArduinoOTA.setPassword(store::settings.apPass.c_str());
  ArduinoOTA.setRebootOnSuccess(true);

  ArduinoOTA.onStart([] {
    prepare();
    msg = "OTA-Update (IDE) laeuft";
  });
  ArduinoOTA.onProgress([](unsigned int done, unsigned int total) {
    pct = total ? (int)(done * 100ULL / total) : -1;
  });
  ArduinoOTA.onEnd([] {
    pct = 100;
    msg = "Update fertig - Neustart";
  });
  ArduinoOTA.onError([](ota_error_t e) {
    running = false;
    err = "OTA-Fehler " + String((int)e);
    msg = err;
  });
  ArduinoOTA.begin();
}

void loop() { ArduinoOTA.handle(); }

bool active() { return running; }
String message() { return msg; }
int progress() { return pct; }
String lastError() { return err; }

bool webStart() {
  prepare();
  msg = "Firmware wird empfangen";
  if (!Update.begin(UPDATE_SIZE_UNKNOWN, U_FLASH)) {
    err = Update.errorString();
    running = false;
    return false;
  }
  return true;
}

bool webWrite(const uint8_t *data, size_t len) {
  if (!running || err.length()) return false;
  if (Update.write(const_cast<uint8_t *>(data), len) != len) {
    err = Update.errorString();
    Update.abort();
    running = false;
    msg = "Update fehlgeschlagen: " + err;
    return false;
  }
  written += len;
  msg = "Empfangen: " + String(written / 1024) + " KB";
  return true;
}

bool webFinish() {
  if (!running || err.length()) return false;
  if (!Update.end(true)) {
    err = Update.errorString();
    running = false;
    msg = "Update fehlgeschlagen: " + err;
    return false;
  }
  pct = 100;
  msg = "Update fertig - Neustart";
  return true;
}

void webAbort() {
  if (running) Update.abort();
  running = false;
  if (!err.length()) err = "Upload abgebrochen";
  msg = err;
}

}  // namespace ota
