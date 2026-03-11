/* ============================================================
   SENTINEL — Web Serial API Controller
   Communicates with Arduino Uno R3 over USB at 9600 baud
   ============================================================ */

'use strict';

// ── State ─────────────────────────────────────────────────────
const state = {
  port:       null,
  reader:     null,
  writer:     null,
  connected:  false,
  systemState: 'OFFLINE',   // OFFLINE | DISARMED | ARMED | ALARM
  breachCount: 0,
  ldrBaseline: '—',
};

// ── DOM References ────────────────────────────────────────────
const $ = id => document.getElementById(id);

const dom = {
  statusPill:    $('statusPill'),
  statusDot:     $('statusDot'),
  statusText:    $('statusText'),
  portLabel:     $('portLabel'),
  btnConnect:    $('btnConnect'),
  btnDisconnect: $('btnDisconnect'),
  btnArm:        $('btnArm'),
  btnDisarm:     $('btnDisarm'),
  bigRing:       $('bigRing'),
  ringIcon:      $('ringIcon'),
  ringState:     $('ringState'),
  ringSub:       $('ringSub'),
  alarmFlash:    $('alarmFlash'),
  eventLog:      $('eventLog'),
  btnClear:      $('btnClear'),
  sysTime:       $('sysTime'),
  telBase:       $('telBase'),
  telLast:       $('telLast'),
  telBreaches:   $('telBreaches'),
  footerStatus:  $('footerStatus'),
};

// ── Clock ─────────────────────────────────────────────────────
function tickClock() {
  const now = new Date();
  dom.sysTime.textContent = now.toTimeString().slice(0, 8);
}
setInterval(tickClock, 1000);
tickClock();

// ── Event Log ─────────────────────────────────────────────────
function logEvent(message, type = 'system') {
  const entry = document.createElement('div');
  entry.className = `log-entry log-${type}`;

  const time = document.createElement('span');
  time.className = 'log-time';
  const now = new Date();
  time.textContent = now.toTimeString().slice(0, 8);

  const msg = document.createElement('span');
  msg.className = 'log-msg';
  msg.textContent = message;

  entry.appendChild(time);
  entry.appendChild(msg);
  dom.eventLog.appendChild(entry);
  dom.eventLog.scrollTop = dom.eventLog.scrollHeight;

  // Update last event telemetry
  dom.telLast.textContent = now.toTimeString().slice(0, 8);
}

dom.btnClear.addEventListener('click', () => {
  dom.eventLog.innerHTML = '';
  logEvent('Log cleared.', 'system');
});

// ── UI State Machine ──────────────────────────────────────────
const STATE_CONFIG = {
  OFFLINE:   { text: 'OFFLINE',   icon: '⚫', sub: 'Connect device to begin',     cls: '' },
  DISARMED:  { text: 'DISARMED',  icon: '🟢', sub: 'System is safe — beam active', cls: 'state-disarmed' },
  ARMED:     { text: 'ARMED',     icon: '🔴', sub: 'Monitoring perimeter…',        cls: 'state-armed' },
  ALARM:     { text: 'ALARM',     icon: '⚠️', sub: 'BREACH DETECTED — disarm now', cls: 'state-alarm' },
};

function applySystemState(newState) {
  state.systemState = newState;
  const cfg = STATE_CONFIG[newState] || STATE_CONFIG.OFFLINE;

  // Remove all state classes
  document.body.classList.remove('state-disarmed', 'state-armed', 'state-alarm');
  if (cfg.cls) document.body.classList.add(cfg.cls);

  dom.statusText.textContent = newState;
  dom.ringState.textContent  = cfg.text;
  dom.ringIcon.textContent   = cfg.icon;
  dom.ringSub.textContent    = cfg.sub;

  // Alarm flash banner
  dom.alarmFlash.classList.toggle('hidden', newState !== 'ALARM');

  // Footer
  dom.footerStatus.textContent = newState;
}

function setConnectedUI(connected) {
  state.connected = connected;

  dom.btnConnect.classList.toggle('hidden', connected);
  dom.btnDisconnect.classList.toggle('hidden', !connected);
  dom.btnArm.disabled    = !connected;
  dom.btnDisarm.disabled = !connected;
}

// ── Web Serial API ────────────────────────────────────────────
if (!('serial' in navigator)) {
  logEvent('⚠ Web Serial API not supported. Use Chrome or Edge 89+.', 'alarm');
  dom.btnConnect.disabled = true;
  dom.btnConnect.textContent = 'BROWSER NOT SUPPORTED';
}

dom.btnConnect.addEventListener('click', connectSerial);
dom.btnDisconnect.addEventListener('click', disconnectSerial);

async function connectSerial() {
  try {
    const port = await navigator.serial.requestPort();
    await port.open({ baudRate: 9600, dataBits: 8, stopBits: 1, parity: 'none' });

    state.port = port;
    state.writer = port.writable.getWriter();

    const portInfo = port.getInfo();
    const label = portInfo.usbVendorId
      ? `USB VID:${portInfo.usbVendorId.toString(16).toUpperCase()} PID:${portInfo.usbProductId.toString(16).toUpperCase()}`
      : 'USB Serial Device';
    dom.portLabel.textContent = label;

    setConnectedUI(true);
    applySystemState('DISARMED');
    logEvent(`Connected: ${label}`, 'system');

    // Start reading in background
    readLoop(port);

  } catch (err) {
    if (err.name !== 'NotFoundError') {
      logEvent(`Connection error: ${err.message}`, 'alarm');
      console.error(err);
    }
  }
}

async function disconnectSerial() {
  try {
    if (state.reader) {
      await state.reader.cancel();
      state.reader = null;
    }
    if (state.writer) {
      state.writer.releaseLock();
      state.writer = null;
    }
    if (state.port) {
      await state.port.close();
      state.port = null;
    }
  } catch (err) {
    console.warn('Disconnect error:', err);
  } finally {
    setConnectedUI(false);
    applySystemState('OFFLINE');
    dom.portLabel.textContent = 'NO DEVICE CONNECTED';
    logEvent('Device disconnected.', 'system');
  }
}

// ── Read Loop ─────────────────────────────────────────────────
async function readLoop(port) {
  const decoder = new TextDecoderStream();
  port.readable.pipeTo(decoder.writable);
  const reader = decoder.readable.getReader();
  state.reader = reader;

  let buffer = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;

      buffer += value;
      const lines = buffer.split('\n');
      buffer = lines.pop();   // keep incomplete line

      for (const raw of lines) {
        const line = raw.trim();
        if (line) handleArduinoMessage(line);
      }
    }
  } catch (err) {
    if (err.name !== 'AbortError') {
      logEvent(`Read error: ${err.message}`, 'alarm');
    }
  }
}

// ── Message Handler ───────────────────────────────────────────
function handleArduinoMessage(line) {
  console.log('[Arduino]', line);

  if (line === 'ALARM') {
    state.breachCount++;
    dom.telBreaches.textContent = state.breachCount;
    applySystemState('ALARM');
    logEvent('⚠ BEAM BREACH DETECTED', 'alarm');
    triggerBrowserAlert();
    return;
  }

  if (line === 'STATUS:ARMED') {
    applySystemState('ARMED');
    logEvent('System armed — laser perimeter active.', 'arm');
    return;
  }

  if (line === 'STATUS:DISARMED') {
    applySystemState('DISARMED');
    logEvent('System disarmed.', 'disarm');
    return;
  }

  // Calibration telemetry
  const baseMatch = line.match(/^CAL:BASELINE=(\d+)$/);
  if (baseMatch) {
    state.ldrBaseline = baseMatch[1];
    dom.telBase.textContent = baseMatch[1];
    return;
  }

  if (line.startsWith('CAL:')) {
    logEvent(`[CAL] ${line.slice(4)}`, 'system');
    return;
  }

  if (line.startsWith('BOOT:')) {
    logEvent(`[BOOT] ${line.slice(5)}`, 'system');
    return;
  }

  // Unknown — log it anyway
  logEvent(`[RAW] ${line}`, 'system');
}

// ── Write Commands ────────────────────────────────────────────
async function sendCommand(char) {
  if (!state.writer) return;
  try {
    const encoder = new TextEncoder();
    await state.writer.write(encoder.encode(char));
  } catch (err) {
    logEvent(`Send error: ${err.message}`, 'alarm');
  }
}

dom.btnArm.addEventListener('click', async () => {
  await sendCommand('1');
  logEvent('CMD: ARM sent via USB.', 'arm');
});

dom.btnDisarm.addEventListener('click', async () => {
  await sendCommand('0');
  logEvent('CMD: DISARM sent via USB.', 'disarm');
});

// ── Browser Notification on Alarm ─────────────────────────────
async function triggerBrowserAlert() {
  if (!('Notification' in window)) return;

  if (Notification.permission === 'default') {
    await Notification.requestPermission();
  }

  if (Notification.permission === 'granted') {
    new Notification('🚨 SENTINEL ALARM', {
      body: 'Laser perimeter breach detected!',
      icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">⚠️</text></svg>',
      requireInteraction: true,
      tag: 'sentinel-alarm',
    });
  }
}

// Pre-request notification permission on first user gesture
document.addEventListener('click', () => {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}, { once: true });

// ── Init ──────────────────────────────────────────────────────
applySystemState('OFFLINE');
