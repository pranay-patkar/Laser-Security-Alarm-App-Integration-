[README.md](https://github.com/user-attachments/files/25896139/README.md)
# ⬡ SENTINEL — Laser Security System

A triple-interface laser perimeter security system built on Arduino Uno R3, featuring a Web Dashboard (Web Serial API), Flutter Mobile App (Bluetooth Classic), and full Arduino firmware.

---

## 📁 Repository Structure

```
sentinel-laser-security/
├── firmware/
│   └── laser_security/
│       └── laser_security.ino       ← Arduino sketch
├── web/
│   ├── index.html                   ← Dashboard UI
│   ├── style.css                    ← HUD styling
│   └── script.js                    ← Web Serial API logic
├── mobile/
│   ├── pubspec.yaml                 ← Flutter dependencies
│   └── lib/
│       └── main.dart                ← Full Flutter app
├── hardware/
│   └── hardware_schematic.html      ← Wiring guide & schematic
└── README.md
```

---

## ⚡ Quick Start

### 1. Flash the Arduino
- Open `firmware/laser_security/laser_security.ino` in Arduino IDE
- Select **Board: Arduino Uno** and the correct COM port
- Upload

### 2. Run the Web Dashboard
- Open `web/index.html` in **Chrome or Edge** (Web Serial API required)
- Click **Connect via USB**, select your Arduino port

### 3. Run the Mobile App
- Pair HC-05 in Android Bluetooth settings (PIN: `1234`)
- Run `flutter pub get` then `flutter run` inside `mobile/`

---

## 🔧 Hardware

| Component | Pin |
|---|---|
| LDR | A0 + 10kΩ pull-down |
| Buzzer | D8 |
| HC-05 TX | D10 |
| HC-05 RX | D11 via 1kΩ/2kΩ divider |

⚠️ **The HC-05 RX pin requires a voltage divider (5V → 3.3V). See `hardware/hardware_schematic.html`.**

---

## 📡 Commands

| Command | Action |
|---|---|
| `1` | Arm system |
| `0` | Disarm system |
| `ALARM` | Breach detected (sent by Arduino) |

---

## 🌐 Live Web Dashboard

Hosted via GitHub Pages: `https://<your-username>.github.io/sentinel-laser-security/web/`

> Note: Web Serial API requires Chrome/Edge. It does **not** work on Firefox or Safari.

---

## 📱 Mobile App Dependencies

- `flutter_bluetooth_serial` — HC-05/06 Classic Bluetooth
- `flutter_local_notifications` — Background alarm alerts
- `permission_handler` — Runtime permissions

---

## License

MIT
