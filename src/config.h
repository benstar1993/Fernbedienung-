#pragma once
#include <Arduino.h>

// ---------------------------------------------------------------------------
// Hardware: M5Stack StickS3 (ESP32-S3-PICO-1-N8R8)
// ---------------------------------------------------------------------------
// IR-Sender (IR-LED)    : GPIO46
// IR-Empfaenger         : GPIO42 (nur ueber RMT auslesbar)
// Taste A (Front)       : GPIO11  -> M5.BtnA
// Taste B (Seite)       : GPIO12  -> M5.BtnB
static constexpr int PIN_IR_TX = 46;
static constexpr int PIN_IR_RX = 42;

// Infrarot-Parameter (NEC-Protokoll, 38 kHz Traeger)
static constexpr uint32_t IR_CARRIER_HZ   = 38000;
static constexpr float    IR_CARRIER_DUTY = 0.33f;

// Wie lange wartet der Lernmodus auf ein Signal der Original-Fernbedienung
static constexpr uint32_t LEARN_TIMEOUT_MS = 15000;

// Standard-WLAN (Access Point), kann im Web-Interface geaendert werden
static constexpr const char *DEFAULT_AP_SSID_PREFIX = "NEC-IR-";
static constexpr const char *DEFAULT_AP_PASS        = "necremote";

// Dateien im internen Flash (LittleFS)
static constexpr const char *FILE_KEYS     = "/keys.json";
static constexpr const char *FILE_MACROS   = "/macros.json";
static constexpr const char *FILE_SETTINGS = "/settings.json";

// Grenzen
static constexpr size_t MAX_RAW_LEN    = 200;  // max. Rohdaten-Zeiten (us) pro Taste
static constexpr size_t MAX_MACRO_STEP = 64;
