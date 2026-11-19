// Display- und Tastenbedienung am StickS3
//
// Bedienung am Geraet:
//   Taste A (Front)  kurz : ausgewaehltes Makro starten / laufendes Makro stoppen
//   Taste A (Front)  lang : WLAN-Infos ein-/ausblenden
//   Taste B (Seite)  kurz : naechstes Makro
//   Taste B (Seite)  lang : vorheriges Makro
// Einrichtung (Tasten anlernen, Makros bearbeiten) ueber das Web-Interface.
#include <M5Unified.h>

#include "ui.h"

#include "config.h"
#include "ir.h"
#include "macro.h"
#include "ota.h"
#include "store.h"
#include "web.h"

namespace {

M5Canvas canvas(&M5.Display);
size_t selected = 0;
bool showInfo = false;
String flashMsg;
uint32_t flashUntil = 0;
uint32_t lastInput = 0;
bool dimmed = false;
uint32_t lastDraw = 0;

constexpr uint16_t COL_BG = TFT_BLACK;
constexpr uint16_t COL_ACC = 0x2C7F;  // blau
constexpr uint16_t COL_MUT = 0x9CF3;  // grau
constexpr uint16_t COL_OK = 0x2E8B;
constexpr uint16_t COL_WARN = 0xFC60;

void flash(const String &m, uint32_t ms = 2500) {
  flashMsg = m;
  flashUntil = millis() + ms;
}

void header(const char *title) {
  canvas.fillRect(0, 0, canvas.width(), 20, COL_ACC);
  canvas.setTextColor(TFT_WHITE);
  canvas.setFont(&fonts::FreeSansBold9pt7b);
  canvas.setTextDatum(middle_left);
  canvas.drawString(title, 4, 10);
  int bat = M5.Power.getBatteryLevel();
  if (bat >= 0) {
    canvas.setFont(&fonts::Font2);
    canvas.setTextDatum(middle_right);
    canvas.drawString(String(bat) + "%", canvas.width() - 4, 10);
  }
}

void drawWrapped(const String &text, int x, int y, int w, int lineH) {
  String line, word;
  String t = text + " ";
  for (size_t i = 0; i < t.length(); i++) {
    char c = t[i];
    if (c == ' ') {
      String test = line.length() ? line + " " + word : word;
      if (canvas.textWidth(test) > w && line.length()) {
        canvas.drawString(line, x, y);
        y += lineH;
        line = word;
      } else {
        line = test;
      }
      word = "";
    } else {
      word += c;
    }
  }
  if (line.length()) canvas.drawString(line, x, y);
}

void drawInfo() {
  header("WLAN");
  canvas.setFont(&fonts::Font2);
  canvas.setTextDatum(top_left);
  canvas.setTextColor(TFT_WHITE);
  int y = 26;
  canvas.drawString("AP: " + web::apSsid(), 4, y); y += 18;
  canvas.drawString("PW: " + store::settings.apPass, 4, y); y += 18;
  canvas.drawString("http://" + web::apIp(), 4, y); y += 18;
  String sta = web::staIp();
  if (store::settings.staSsid.length()) {
    canvas.setTextColor(sta.length() ? COL_OK : COL_WARN);
    canvas.drawString(store::settings.staSsid + ": " + (sta.length() ? sta : String("verbinde...")), 4, y);
  }
  canvas.setTextColor(COL_MUT);
  canvas.drawString(String("FW ") + FW_VERSION + "   A lang: zurueck", 4, canvas.height() - 18);
}

void drawLearn() {
  header("Lernmodus");
  canvas.setFont(&fonts::FreeSans9pt7b);
  canvas.setTextDatum(top_left);
  canvas.setTextColor(TFT_WHITE);
  drawWrapped(web::learnMessage(), 4, 28, canvas.width() - 8, 20);
  canvas.setFont(&fonts::Font2);
  canvas.setTextColor(COL_MUT);
  canvas.drawString("Original-FB auf Oberseite richten", 4, canvas.height() - 18);
}

void drawRunning(const macro::Status &s) {
  header("Makro laeuft");
  canvas.setFont(&fonts::FreeSansBold9pt7b);
  canvas.setTextDatum(top_left);
  canvas.setTextColor(TFT_WHITE);
  drawWrapped(s.name, 4, 26, canvas.width() - 8, 20);
  canvas.setFont(&fonts::FreeSans9pt7b);
  canvas.setTextColor(COL_OK);
  canvas.drawString(s.current, 4, 72);
  int w = canvas.width() - 8;
  canvas.drawRect(4, 96, w, 10, COL_MUT);
  if (s.total > 0) canvas.fillRect(5, 97, (w - 2) * s.step / s.total, 8, COL_OK);
  canvas.setFont(&fonts::Font2);
  canvas.setTextColor(COL_MUT);
  canvas.drawString("A: Stopp", 4, canvas.height() - 18);
}

void drawList() {
  header("NEC M431 IR");
  const auto &ms = store::macros;
  canvas.setFont(&fonts::FreeSans9pt7b);
  canvas.setTextDatum(middle_left);
  if (ms.empty()) {
    canvas.setTextColor(COL_MUT);
    canvas.drawString("Keine Makros", 4, 50);
  } else {
    if (selected >= ms.size()) selected = 0;
    const int rowH = 23, rows = 4;
    size_t first = selected >= (size_t)rows ? selected - rows + 1 : 0;
    for (int r = 0; r < rows && first + r < ms.size(); r++) {
      size_t i = first + r;
      int y = 22 + r * rowH;
      if (i == selected) {
        canvas.fillRoundRect(2, y + 1, canvas.width() - 4, rowH - 2, 4, 0x18E3);
        canvas.setTextColor(TFT_WHITE);
      } else {
        canvas.setTextColor(COL_MUT);
      }
      String name = ms[i].name;
      while (name.length() > 3 && canvas.textWidth(name) > canvas.width() - 14) name.remove(name.length() - 1);
      canvas.drawString(name, 7, y + rowH / 2);
    }
  }
  canvas.setFont(&fonts::Font2);
  canvas.setTextDatum(top_left);
  if (millis() < flashUntil) {
    canvas.setTextColor(COL_WARN);
    canvas.drawString(flashMsg, 4, canvas.height() - 18);
  } else {
    canvas.setTextColor(COL_MUT);
    canvas.drawString("A: Start  B: Weiter  A lang: WLAN", 4, canvas.height() - 18);
  }
}

void drawOta() {
  header("Firmware-Update");
  canvas.setFont(&fonts::FreeSans9pt7b);
  canvas.setTextDatum(top_left);
  canvas.setTextColor(TFT_WHITE);
  drawWrapped(ota::message(), 4, 28, canvas.width() - 8, 20);
  int p = ota::progress();
  if (p >= 0) {
    int w = canvas.width() - 8;
    canvas.drawRect(4, 96, w, 10, COL_MUT);
    canvas.fillRect(5, 97, (w - 2) * p / 100, 8, COL_OK);
  }
  canvas.setFont(&fonts::Font2);
  canvas.setTextColor(COL_WARN);
  canvas.drawString("Nicht ausschalten!", 4, canvas.height() - 18);
}

void draw() {
  canvas.fillSprite(COL_BG);
  macro::Status s = macro::status();
  if (ota::active()) drawOta();
  else if (web::learnKey().length()) drawLearn();
  else if (s.running) drawRunning(s);
  else if (showInfo) drawInfo();
  else drawList();
  canvas.pushSprite(0, 0);
}

void wake() {
  lastInput = millis();
  if (dimmed) {
    M5.Display.setBrightness(160);
    dimmed = false;
  }
}

}  // namespace

void uiSetup() {
  auto cfg = M5.config();
  M5.begin(cfg);
  M5.Speaker.end();                 // Verstaerker aus, sonst stoert er den IR-Empfang
  M5.Power.setExtOutput(true);      // Versorgung fuer IR-LED
  M5.Display.setRotation(1);        // Querformat 240x135
  M5.Display.setBrightness(160);
  canvas.setColorDepth(16);
  canvas.createSprite(M5.Display.width(), M5.Display.height());

  Serial.begin(115200);
  if (!store::begin()) flash("Speicherfehler!", 5000);
  if (!ir::begin()) flash("IR-Init fehlgeschlagen!", 5000);
  macro::begin();
  web::begin();
  lastInput = millis();
  draw();
}

void uiLoop() {
  M5.update();
  web::loop();

  bool anyBtn = M5.BtnA.wasPressed() || M5.BtnB.wasPressed();
  if (anyBtn && dimmed) {
    wake();
    // Erster Tastendruck weckt nur das Display auf
    while (M5.BtnA.isPressed() || M5.BtnB.isPressed()) { M5.update(); delay(10); }
    return;
  }
  if (anyBtn) wake();

  macro::Status s = macro::status();
  if (!ota::active() && M5.BtnA.wasClicked()) {
    if (s.running) {
      macro::stop();
    } else if (web::learnKey().length()) {
      web::cancelLearn();
    } else if (!showInfo && !store::macros.empty()) {
      String err;
      if (!macro::run(selected, err)) flash(err, 4000);
    }
  }
  if (M5.BtnA.wasHold()) showInfo = !showInfo;
  if (!s.running && !showInfo && !store::macros.empty()) {
    size_t n = store::macros.size();
    if (M5.BtnB.wasClicked()) selected = (selected + 1) % n;
    if (M5.BtnB.wasHold()) selected = (selected + n - 1) % n;
  }

  if (s.running || web::learnKey().length() || ota::active()) lastInput = millis();
  if (!dimmed && millis() - lastInput > 60000) {
    M5.Display.setBrightness(20);
    dimmed = true;
  }

  if (millis() - lastDraw > 100) {
    lastDraw = millis();
    draw();
  }
  delay(5);
}
