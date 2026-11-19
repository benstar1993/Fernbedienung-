// Infrarot Senden/Empfangen ueber das RMT-Peripheral des ESP32-S3 (ESP-IDF 5 API).
// Der StickS3 kann IR nur ueber RMT empfangen (nicht per GPIO-Interrupt).
#include "ir.h"

#include <driver/rmt_rx.h>
#include <driver/rmt_tx.h>
#include <driver/rmt_encoder.h>
#include <freertos/semphr.h>

#include "config.h"

namespace {

constexpr uint32_t RMT_RES_HZ = 1000000;  // 1 Tick = 1 us
constexpr size_t RX_SYMBOLS = 96;          // 2 Speicherbloecke a 48 Symbole

// NEC-Timing in us
constexpr uint16_t NEC_HDR_MARK = 9000;
constexpr uint16_t NEC_HDR_SPACE = 4500;
constexpr uint16_t NEC_RPT_SPACE = 2250;
constexpr uint16_t NEC_BIT_MARK = 560;
constexpr uint16_t NEC_ZERO_SPACE = 560;
constexpr uint16_t NEC_ONE_SPACE = 1690;
constexpr uint32_t NEC_FRAME_GAP_MS = 45;  // Pause nach einem Frame (~108 ms Periode)

rmt_channel_handle_t txChan = nullptr;
rmt_channel_handle_t rxChan = nullptr;
rmt_encoder_handle_t copyEnc = nullptr;
SemaphoreHandle_t txMutex = nullptr;

rmt_symbol_word_t rxBuf[RX_SYMBOLS];
volatile size_t rxCount = 0;
volatile bool rxReady = false;
bool rxEnabled = false;

LearnState learnState = LearnState::Idle;
uint32_t learnStart = 0;
IrCode learned;

bool IRAM_ATTR onRxDone(rmt_channel_handle_t, const rmt_rx_done_event_data_t *ed, void *) {
  rxCount = ed->num_symbols;
  rxReady = true;
  return false;
}

inline bool near(uint32_t value, uint32_t target, uint32_t tolPct = 30) {
  uint32_t tol = target * tolPct / 100;
  return value + tol >= target && value <= target + tol;
}

bool armReceive() {
  rmt_receive_config_t rc = {};
  rc.signal_range_min_ns = 1250;      // kuerzere Stoerimpulse ignorieren
  rc.signal_range_max_ns = 12000000;  // 12 ms Ruhe = Ende des Frames
  rxReady = false;
  return rmt_receive(rxChan, rxBuf, sizeof(rxBuf), &rc) == ESP_OK;
}

void stopReceive() {
  if (rxEnabled) {
    rmt_disable(rxChan);
    rxEnabled = false;
  }
}

// RMT-Symbole -> Liste abwechselnder Puls/Pause-Zeiten (beginnend mit Puls).
// Der IR-Empfaenger ist active-low: Pegel 0 = Traeger erkannt (Puls).
std::vector<uint16_t> toDurations(const rmt_symbol_word_t *sym, size_t n) {
  std::vector<uint16_t> d;
  int lastLevel = -1;
  auto push = [&](int level, uint16_t dur) {
    if (dur == 0) return;
    bool mark = (level == 0);
    if (d.empty() && !mark) return;  // fuehrende Pause verwerfen
    if (lastLevel == (int)mark) {
      d.back() = (uint16_t)min<uint32_t>(0xFFFF, (uint32_t)d.back() + dur);
    } else {
      d.push_back(dur);
      lastLevel = mark;
    }
  };
  for (size_t i = 0; i < n; i++) {
    push(sym[i].level0, sym[i].duration0);
    push(sym[i].level1, sym[i].duration1);
  }
  if (!d.empty() && d.size() % 2 == 0) d.pop_back();  // mit Puls enden
  return d;
}

bool decodeNec(const std::vector<uint16_t> &d, uint16_t &addr, uint8_t &cmd) {
  if (d.size() < 67) return false;
  if (!near(d[0], NEC_HDR_MARK, 25) || !near(d[1], NEC_HDR_SPACE, 25)) return false;
  uint32_t data = 0;
  for (int bit = 0; bit < 32; bit++) {
    uint16_t m = d[2 + bit * 2];
    uint16_t s = d[3 + bit * 2];
    if (!near(m, NEC_BIT_MARK, 50)) return false;
    if (near(s, NEC_ONE_SPACE, 35)) data |= (1UL << bit);
    else if (!near(s, NEC_ZERO_SPACE, 50)) return false;
  }
  uint8_t c = (data >> 16) & 0xFF;
  uint8_t ci = (data >> 24) & 0xFF;
  if ((uint8_t)(c ^ ci) != 0xFF) return false;
  addr = data & 0xFFFF;
  cmd = c;
  return true;
}

bool isNecRepeat(const std::vector<uint16_t> &d) {
  return d.size() <= 3 && d.size() >= 2 && near(d[0], NEC_HDR_MARK, 25) && near(d[1], NEC_RPT_SPACE, 25);
}

inline rmt_symbol_word_t sym(uint16_t mark, uint16_t space) {
  rmt_symbol_word_t s;
  s.level0 = 1;
  s.duration0 = mark;
  s.level1 = 0;
  s.duration1 = space;
  return s;
}

bool transmit(const rmt_symbol_word_t *s, size_t n) {
  rmt_transmit_config_t tc = {};
  tc.loop_count = 0;
  if (rmt_transmit(txChan, copyEnc, s, n * sizeof(rmt_symbol_word_t), &tc) != ESP_OK) return false;
  return rmt_tx_wait_all_done(txChan, 1000) == ESP_OK;
}

}  // namespace

namespace ir {

bool begin() {
  txMutex = xSemaphoreCreateMutex();

  rmt_tx_channel_config_t txc = {};
  txc.gpio_num = (gpio_num_t)PIN_IR_TX;
  txc.clk_src = RMT_CLK_SRC_DEFAULT;
  txc.resolution_hz = RMT_RES_HZ;
  txc.mem_block_symbols = 48;
  txc.trans_queue_depth = 4;
  if (rmt_new_tx_channel(&txc, &txChan) != ESP_OK) return false;

  rmt_carrier_config_t cc = {};
  cc.frequency_hz = IR_CARRIER_HZ;
  cc.duty_cycle = IR_CARRIER_DUTY;
  rmt_apply_carrier(txChan, &cc);

  rmt_copy_encoder_config_t ec = {};
  if (rmt_new_copy_encoder(&ec, &copyEnc) != ESP_OK) return false;
  rmt_enable(txChan);

  rmt_rx_channel_config_t rxc = {};
  rxc.gpio_num = (gpio_num_t)PIN_IR_RX;
  rxc.clk_src = RMT_CLK_SRC_DEFAULT;
  rxc.resolution_hz = RMT_RES_HZ;
  rxc.mem_block_symbols = RX_SYMBOLS;
  if (rmt_new_rx_channel(&rxc, &rxChan) != ESP_OK) return false;

  rmt_rx_event_callbacks_t cbs = {};
  cbs.on_recv_done = onRxDone;
  rmt_rx_register_event_callbacks(rxChan, &cbs, nullptr);
  return true;
}

bool send(const IrCode &code) {
  if (!txChan || code.proto == IrProto::None) return false;
  xSemaphoreTake(txMutex, portMAX_DELAY);
  bool ok = false;

  if (code.proto == IrProto::Nec) {
    uint32_t data = (uint32_t)code.addr | ((uint32_t)code.cmd << 16) | ((uint32_t)(uint8_t)~code.cmd << 24);
    rmt_symbol_word_t s[34];
    s[0] = sym(NEC_HDR_MARK, NEC_HDR_SPACE);
    for (int bit = 0; bit < 32; bit++) {
      s[1 + bit] = sym(NEC_BIT_MARK, (data >> bit) & 1 ? NEC_ONE_SPACE : NEC_ZERO_SPACE);
    }
    s[33] = sym(NEC_BIT_MARK, 200);
    ok = transmit(s, 34);
  } else if (code.proto == IrProto::Raw && code.raw.size() >= 2) {
    std::vector<rmt_symbol_word_t> s;
    s.reserve(code.raw.size() / 2 + 1);
    for (size_t i = 0; i < code.raw.size(); i += 2) {
      uint16_t m = min<uint16_t>(code.raw[i], 32767);
      uint16_t p = (i + 1 < code.raw.size()) ? min<uint16_t>(code.raw[i + 1], 32767) : 200;
      s.push_back(sym(m, p));
    }
    ok = transmit(s.data(), s.size());
  }

  vTaskDelay(pdMS_TO_TICKS(NEC_FRAME_GAP_MS));
  xSemaphoreGive(txMutex);
  return ok;
}

void startLearn() {
  if (!rxChan) return;
  stopReceive();
  rmt_enable(rxChan);
  rxEnabled = true;
  learned = IrCode();
  learnStart = millis();
  learnState = armReceive() ? LearnState::Waiting : LearnState::Timeout;
}

void cancelLearn() {
  stopReceive();
  learnState = LearnState::Idle;
}

LearnState pollLearn(IrCode &result) {
  if (learnState != LearnState::Waiting) {
    if (learnState == LearnState::Done) result = learned;
    return learnState;
  }

  if (rxReady) {
    size_t n = rxCount;
    auto d = toDurations(rxBuf, n);
    uint16_t addr;
    uint8_t cmd;
    if (decodeNec(d, addr, cmd)) {
      learned.proto = IrProto::Nec;
      learned.addr = addr;
      learned.cmd = cmd;
      learned.raw.clear();
      learnState = LearnState::Done;
    } else if (d.size() >= 7 && !isNecRepeat(d)) {
      // Unbekanntes Protokoll: Rohdaten speichern
      learned.proto = IrProto::Raw;
      if (d.size() > MAX_RAW_LEN) d.resize(MAX_RAW_LEN - 1);  // ungerade -> endet mit Puls
      learned.raw = d;
      learnState = LearnState::Done;
    } else {
      armReceive();  // Stoersignal oder Wiederholcode -> weiter warten
    }
    if (learnState == LearnState::Done) {
      stopReceive();
      result = learned;
      return learnState;
    }
  }

  if (millis() - learnStart > LEARN_TIMEOUT_MS) {
    stopReceive();
    learnState = LearnState::Timeout;
  }
  return learnState;
}

String describe(const IrCode &c) {
  char buf[48];
  switch (c.proto) {
    case IrProto::Nec:
      snprintf(buf, sizeof(buf), "NEC %04X:%02X", c.addr, c.cmd);
      return buf;
    case IrProto::Raw:
      snprintf(buf, sizeof(buf), "RAW (%u Zeiten)", (unsigned)c.raw.size());
      return buf;
    default:
      return "nicht belegt";
  }
}

}  // namespace ir
