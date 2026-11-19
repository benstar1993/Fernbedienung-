#pragma once
#include <Arduino.h>
#include <vector>

// Ein gespeicherter IR-Befehl.
//   NEC : 16-Bit-Adresse + 8-Bit-Befehl (Standard- oder Extended-NEC)
//   RAW : gelernte Rohzeiten in Mikrosekunden (Puls, Pause, Puls, ...)
enum class IrProto : uint8_t { None = 0, Nec = 1, Raw = 2 };

struct IrCode {
  IrProto proto = IrProto::None;
  uint16_t addr = 0;  // NEC: Low-Byte = Adresse, High-Byte = ~Adresse bzw. Extended
  uint8_t cmd = 0;
  std::vector<uint16_t> raw;
};

enum class LearnState : uint8_t { Idle, Waiting, Done, Timeout };

namespace ir {

bool begin();

// Sendet einen Code (blockierend, ca. 70-110 ms). Thread-sicher.
bool send(const IrCode &code);

// Lernmodus: wartet auf ein Signal der Original-Fernbedienung.
void startLearn();
void cancelLearn();
// Muss regelmaessig aufgerufen werden; liefert den aktuellen Zustand.
LearnState pollLearn(IrCode &result);

String describe(const IrCode &code);

}  // namespace ir
