#include "macro.h"

#include <freertos/semphr.h>
#include <vector>

#include "ir.h"
#include "store.h"

namespace macro {

namespace {

struct Job {
  String label;
  IrCode code;
  uint16_t times;
  uint16_t pause;
  uint32_t wait;
};

SemaphoreHandle_t mtx = nullptr;
Status st;
std::vector<Job> jobs;
volatile bool stopFlag = false;
TaskHandle_t task = nullptr;

void setStep(int i, const String &text) {
  xSemaphoreTake(mtx, portMAX_DELAY);
  st.step = i;
  st.current = text;
  xSemaphoreGive(mtx);
}

// Wartet in kleinen Schritten, damit "Stopp" sofort greift.
bool sleepMs(uint32_t ms) {
  uint32_t start = millis();
  while (millis() - start < ms) {
    if (stopFlag) return false;
    vTaskDelay(pdMS_TO_TICKS(20));
  }
  return !stopFlag;
}

void runner(void *) {
  for (;;) {
    ulTaskNotifyTake(pdTRUE, portMAX_DELAY);
    bool ok = true;
    for (size_t i = 0; i < jobs.size() && ok; i++) {
      const Job &j = jobs[i];
      if (j.label.length() == 0) {
        setStep(i + 1, "Warten " + String(j.wait / 1000.0f, 1) + " s");
        ok = sleepMs(j.wait);
        continue;
      }
      for (uint16_t n = 0; n < j.times && ok; n++) {
        String t = j.label;
        if (j.times > 1) t += " (" + String(n + 1) + "/" + String(j.times) + ")";
        setStep(i + 1, t);
        if (stopFlag) { ok = false; break; }
        ir::send(j.code);
        ok = sleepMs(j.pause);
      }
    }
    xSemaphoreTake(mtx, portMAX_DELAY);
    st.running = false;
    st.current = ok ? "fertig" : "abgebrochen";
    xSemaphoreGive(mtx);
  }
}

}  // namespace

void begin() {
  mtx = xSemaphoreCreateMutex();
  xTaskCreatePinnedToCore(runner, "macro", 6144, nullptr, 2, &task, 1);
}

bool run(size_t index, String &err) {
  if (index >= store::macros.size()) {
    err = "Makro nicht gefunden";
    return false;
  }
  xSemaphoreTake(mtx, portMAX_DELAY);
  bool busy = st.running;
  xSemaphoreGive(mtx);
  if (busy) {
    err = "Es laeuft bereits ein Makro";
    return false;
  }

  // Alle Schritte vorab pruefen und Codes kopieren -> kein halb ausgefuehrtes Makro
  const Macro &m = store::macros[index];
  std::vector<Job> list;
  for (const auto &s : m.steps) {
    if (s.key.length() == 0) {
      list.push_back({"", IrCode(), 0, 0, s.wait});
      continue;
    }
    Key *k = store::findKey(s.key);
    if (!k) {
      err = "Taste " + s.key + " existiert nicht";
      return false;
    }
    if (k->code.proto == IrProto::None) {
      err = "Taste " + k->label + " ist nicht angelernt";
      return false;
    }
    list.push_back({k->label, k->code, s.times, s.pause, 0});
  }

  jobs = list;
  stopFlag = false;
  xSemaphoreTake(mtx, portMAX_DELAY);
  st.running = true;
  st.name = m.name;
  st.step = 0;
  st.total = jobs.size();
  st.current = "Start";
  st.error = "";
  xSemaphoreGive(mtx);
  xTaskNotifyGive(task);
  return true;
}

void stop() { stopFlag = true; }

Status status() {
  xSemaphoreTake(mtx, portMAX_DELAY);
  Status s = st;
  xSemaphoreGive(mtx);
  return s;
}

}  // namespace macro
