/*
 * ============================================================
 *  TRIPLE-INTERFACE LASER SECURITY SYSTEM
 *  Target: Arduino Uno R3
 *
 *  Interfaces:
 *    - USB Serial (Hardware)   → Web Dashboard
 *    - SoftwareSerial Pin10/11 → HC-05/06 Bluetooth → Mobile App
 *
 *  Commands received: '1' = Arm  |  '0' = Disarm
 *  Events sent:       "ALARM"    |  "ARMED"  |  "DISARMED"
 *
 *  NO delay() used — fully non-blocking via millis()
 * ============================================================
 */

#include <SoftwareSerial.h>

// ── Pin Definitions ──────────────────────────────────────────
#define BT_RX_PIN      10      // Arduino RX  ← HC-05 TX
#define BT_TX_PIN      11      // Arduino TX  → HC-05 RX  (via voltage divider!)
#define LDR_PIN        A0      // Photoresistor + 10 kΩ pull-down
#define BUZZER_PIN      8      // Piezo buzzer

// ── Tuning Parameters ─────────────────────────────────────────
// During setup() the LDR baseline is sampled; any reading that
// drops more than BEAM_BREAK_THRESHOLD below baseline means
// the laser beam is broken (less light reaching the LDR).
const int   BEAM_BREAK_THRESHOLD = 150;   // ADC counts (0-1023)
const int   CALIBRATION_SAMPLES  = 50;    // Readings averaged at boot
const unsigned long CALIBRATION_DELAY_MS = 10; // ms between samples

// ── Buzzer Alarm Pattern ──────────────────────────────────────
const unsigned long BUZZ_ON_MS   = 100;
const unsigned long BUZZ_OFF_MS  = 100;

// ── Objects ───────────────────────────────────────────────────
SoftwareSerial btSerial(BT_RX_PIN, BT_TX_PIN);

// ── State ─────────────────────────────────────────────────────
enum SystemState { DISARMED, ARMED, ALARM };
SystemState state = DISARMED;

int  ldrBaseline   = 0;        // Calibrated "beam present" reading
bool buzzerOn      = false;
unsigned long lastBuzzToggle = 0;

// ─────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(9600);          // USB  ↔ Web Dashboard
  btSerial.begin(9600);        // BT   ↔ Mobile App (match HC-05 baud)

  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW);

  Serial.println("BOOT: Laser Security System v1.0");
  btSerial.println("BOOT: Laser Security System v1.0");

  calibrateLDR();

  Serial.println("STATUS:DISARMED");
  btSerial.println("STATUS:DISARMED");
}

// ─────────────────────────────────────────────────────────────
void loop() {
  handleSerialCommands();
  handleBTCommands();

  if (state == ARMED) {
    checkBeam();
  }

  if (state == ALARM) {
    runBuzzerPattern();
  } else {
    // Silence buzzer if not in alarm state
    if (buzzerOn) {
      digitalWrite(BUZZER_PIN, LOW);
      buzzerOn = false;
    }
  }
}

// ─────────────────────────────────────────────────────────────
//  LDR Calibration — average N readings with laser beam active
// ─────────────────────────────────────────────────────────────
void calibrateLDR() {
  Serial.println("CAL:STARTING");
  btSerial.println("CAL:STARTING");

  long sum = 0;
  for (int i = 0; i < CALIBRATION_SAMPLES; i++) {
    sum += analogRead(LDR_PIN);
    delay(CALIBRATION_DELAY_MS);   // OK to use delay() in setup()
  }
  ldrBaseline = sum / CALIBRATION_SAMPLES;

  Serial.print("CAL:BASELINE=");
  Serial.println(ldrBaseline);
  btSerial.print("CAL:BASELINE=");
  btSerial.println(ldrBaseline);
  Serial.println("CAL:DONE");
  btSerial.println("CAL:DONE");
}

// ─────────────────────────────────────────────────────────────
//  Command parsers — read one char at a time (non-blocking)
// ─────────────────────────────────────────────────────────────
void handleSerialCommands() {
  while (Serial.available()) {
    char c = (char)Serial.read();
    processCommand(c);
  }
}

void handleBTCommands() {
  while (btSerial.available()) {
    char c = (char)btSerial.read();
    processCommand(c);
  }
}

void processCommand(char c) {
  if (c == '1') {
    armSystem();
  } else if (c == '0') {
    disarmSystem();
  }
}

// ─────────────────────────────────────────────────────────────
//  State transitions
// ─────────────────────────────────────────────────────────────
void armSystem() {
  if (state != ARMED) {
    state = ARMED;
    broadcast("STATUS:ARMED");
  }
}

void disarmSystem() {
  // Works from ANY state — even mid-alarm
  state = DISARMED;
  digitalWrite(BUZZER_PIN, LOW);
  buzzerOn = false;
  broadcast("STATUS:DISARMED");
}

void triggerAlarm() {
  state = ALARM;
  broadcast("ALARM");
}

// ─────────────────────────────────────────────────────────────
//  Beam detection
// ─────────────────────────────────────────────────────────────
void checkBeam() {
  int ldrValue = analogRead(LDR_PIN);
  // Beam broken  → reading drops significantly below baseline
  if ((ldrBaseline - ldrValue) > BEAM_BREAK_THRESHOLD) {
    triggerAlarm();
  }
}

// ─────────────────────────────────────────────────────────────
//  Non-blocking pulsing buzzer pattern
// ─────────────────────────────────────────────────────────────
void runBuzzerPattern() {
  unsigned long now = millis();
  unsigned long interval = buzzerOn ? BUZZ_ON_MS : BUZZ_OFF_MS;

  if (now - lastBuzzToggle >= interval) {
    buzzerOn = !buzzerOn;
    digitalWrite(BUZZER_PIN, buzzerOn ? HIGH : LOW);
    lastBuzzToggle = now;
  }
}

// ─────────────────────────────────────────────────────────────
//  Broadcast a message to both USB Serial and Bluetooth
// ─────────────────────────────────────────────────────────────
void broadcast(const char* message) {
  Serial.println(message);
  btSerial.println(message);
}
