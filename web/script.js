'use strict';

// ── State ─────────────────────────────────────────────────────
const state = {
  port: null, reader: null, writer: null,
  connected: false, demoMode: false,
  systemState: 'OFFLINE',
  breachCount: 0, ldrBaseline: null, ldrCurrent: null,
  btConnected: false, btDeviceName: '',
  startTime: null, uptimeInterval: null,
  demoInterval: null,
};

// ── DOM ───────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const dom = {
  statusPill:    $('statusPill'),   statusDot:  $('statusDot'),
  statusText:    $('statusText'),   portLabel:  $('portLabel'),
  demoBadge:     $('demoBadge'),    btnDemo:    $('btnDemo'),
  btnConnect:    $('btnConnect'),   btnDisconnect: $('btnDisconnect'),
  btnArm:        $('btnArm'),       btnDisarm:  $('btnDisarm'),
  bigRing:       $('bigRing'),      ringIcon:   $('ringIcon'),
  ringState:     $('ringState'),    ringSub:    $('ringSub'),
  alarmFlash:    $('alarmFlash'),   eventLog:   $('eventLog'),
  btnClear:      $('btnClear'),     sysTime:    $('sysTime'),
  telBase:       $('telBase'),      telCurrent: $('telCurrent'),
  telLast:       $('telLast'),      telBreaches:$('telBreaches'),
  telUptime:     $('telUptime'),    footerStatus:$('footerStatus'),
  // BT
  btDot:         $('btDot'),        btDeviceName:$('btDeviceName'),
  btStatusSub:   $('btStatusSub'), btIcon: document.querySelector('.bt-icon'),
  btInput:       $('btInput'),      btnBtSend:  $('btnBtSend'),
  btLastCmd:     $('btLastCmd'),
  // Demo modal
  demoOverlay:   $('demoOverlay'),  demoClose:  $('demoClose'),
  demoArm:       $('demoArm'),      demoDisarm: $('demoDisarm'),
  demoAlarm:     $('demoAlarm'),    demoLdr:    $('demoLdr'),
  demoCalib:     $('demoCalib'),    demoBtConnect:$('demoBtConnect'),
  demoBtDisconnect:$('demoBtDisconnect'),
  waveCanvas:    $('waveCanvas'),
};

// ── Clock ─────────────────────────────────────────────────────
setInterval(() => {
  dom.sysTime.textContent = new Date().toTimeString().slice(0,8);
  if (state.startTime) {
    const s = Math.floor((Date.now() - state.startTime) / 1000);
    const h = String(Math.floor(s/3600)).padStart(2,'0');
    const m = String(Math.floor((s%3600)/60)).padStart(2,'0');
    const sec = String(s%60).padStart(2,'0');
    dom.telUptime.textContent = `${h}:${m}:${sec}`;
  }
}, 1000);

// ── Audio Engine ──────────────────────────────────────────────
let audioCtx = null;
let alarmOscillators = [];
let alarmPlaying = false;

function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

function playAlarmSound() {
  if (alarmPlaying) return;
  alarmPlaying = true;
  const ctx = getAudioCtx();

  function makeBeep() {
    if (!alarmPlaying) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = 'square';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.setValueAtTime(660, ctx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.2);
    alarmOscillators.push(osc);
    setTimeout(makeBeep, 400);
  }
  makeBeep();
}

function stopAlarmSound() {
  alarmPlaying = false;
  alarmOscillators.forEach(o => { try { o.stop(); } catch(e){} });
  alarmOscillators = [];
}

function playTone(freq, duration, type='sine', vol=0.15) {
  try {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = type; osc.frequency.value = freq;
    gain.gain.setValueAtTime(vol, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration);
  } catch(e) {}
}

function playArmSound() {
  playTone(440, 0.1, 'square', 0.1);
  setTimeout(() => playTone(660, 0.15, 'square', 0.12), 120);
  setTimeout(() => playTone(880, 0.2, 'square', 0.15), 260);
}

function playDisarmSound() {
  playTone(880, 0.1, 'sine', 0.12);
  setTimeout(() => playTone(660, 0.1, 'sine', 0.1), 120);
  setTimeout(() => playTone(440, 0.2, 'sine', 0.08), 240);
}

// Unlock audio on first click
document.addEventListener('click', () => { try { getAudioCtx(); } catch(e){} }, { once: true });

// ── Waveform Canvas ───────────────────────────────────────────
const waveHistory = new Array(120).fill(0.5);
let waveAnimId = null;

function drawWave() {
  const canvas = dom.waveCanvas;
  const ctx = canvas.getContext('2d');
  const W = canvas.offsetWidth * (window.devicePixelRatio || 1);
  const H = canvas.offsetHeight * (window.devicePixelRatio || 1);
  canvas.width = W; canvas.height = H;

  ctx.clearRect(0, 0, W, H);

  // Background grid lines
  ctx.strokeStyle = 'rgba(0,220,255,0.06)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = (H / 4) * i;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }

  // Determine color based on state
  let waveColor = '#00dcff';
  let glowColor = 'rgba(0,220,255,0.4)';
  if (state.systemState === 'ALARM') { waveColor = '#ff2244'; glowColor = 'rgba(255,34,68,0.5)'; }
  else if (state.systemState === 'ARMED') { waveColor = '#ffaa00'; glowColor = 'rgba(255,170,0,0.4)'; }
  else if (state.systemState === 'DISARMED') { waveColor = '#00ff88'; glowColor = 'rgba(0,255,136,0.4)'; }

  // Add new sample
  let newVal = 0.5;
  if (state.systemState === 'ALARM') {
    newVal = 0.5 + (Math.random() - 0.5) * 0.9;
  } else if (state.systemState === 'ARMED') {
    newVal = 0.5 + Math.sin(Date.now() * 0.004) * 0.15 + (Math.random() - 0.5) * 0.05;
  } else if (state.systemState === 'DISARMED') {
    newVal = 0.5 + Math.sin(Date.now() * 0.002) * 0.08 + (Math.random() - 0.5) * 0.02;
  } else {
    newVal = 0.5 + (Math.random() - 0.5) * 0.02;
  }
  waveHistory.push(Math.max(0.02, Math.min(0.98, newVal)));
  waveHistory.shift();

  // Draw glow pass
  ctx.shadowBlur = 8;
  ctx.shadowColor = glowColor;
  ctx.strokeStyle = waveColor;
  ctx.lineWidth = 1.5 * (window.devicePixelRatio || 1);
  ctx.beginPath();
  const step = W / (waveHistory.length - 1);
  waveHistory.forEach((v, i) => {
    const x = i * step;
    const y = v * H;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.stroke();

  // Fill under wave
  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'transparent';
  ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath();
  ctx.fillStyle = `${waveColor}18`;
  ctx.fill();

  waveAnimId = requestAnimationFrame(drawWave);
}
drawWave();

// ── Event Log ─────────────────────────────────────────────────
function logEvent(message, type = 'system') {
  const entry = document.createElement('div');
  entry.className = `log-entry log-${type}`;
  const time = document.createElement('span');
  time.className = 'log-time';
  time.textContent = new Date().toTimeString().slice(0,8);
  const msg = document.createElement('span');
  msg.className = 'log-msg';
  msg.textContent = message;
  entry.appendChild(time);
  entry.appendChild(msg);
  dom.eventLog.appendChild(entry);
  dom.eventLog.scrollTop = dom.eventLog.scrollHeight;
  dom.telLast.textContent = new Date().toTimeString().slice(0,8);
}

dom.btnClear.addEventListener('click', () => {
  dom.eventLog.innerHTML = '';
  logEvent('Log cleared.', 'system');
});

// ── UI State Machine ──────────────────────────────────────────
const STATE_CONFIG = {
  OFFLINE:  { text:'OFFLINE',  icon:'⚫', sub:'Connect device to begin',        cls:'' },
  DISARMED: { text:'DISARMED', icon:'🟢', sub:'System is safe — beam active',   cls:'state-disarmed' },
  ARMED:    { text:'ARMED',    icon:'🔴', sub:'Monitoring perimeter…',           cls:'state-armed' },
  ALARM:    { text:'ALARM',    icon:'⚠️', sub:'BREACH DETECTED — disarm now',   cls:'state-alarm' },
};

function applySystemState(newState) {
  state.systemState = newState;
  const cfg = STATE_CONFIG[newState] || STATE_CONFIG.OFFLINE;
  document.body.classList.remove('state-disarmed','state-armed','state-alarm');
  if (cfg.cls) document.body.classList.add(cfg.cls);
  dom.statusText.textContent = newState;
  dom.ringState.textContent  = cfg.text;
  dom.ringIcon.textContent   = cfg.icon;
  dom.ringSub.textContent    = cfg.sub;
  dom.alarmFlash.classList.toggle('hidden', newState !== 'ALARM');
  dom.footerStatus.textContent = newState;
}

function setConnectedUI(connected) {
  state.connected = connected;
  dom.btnConnect.classList.toggle('hidden', connected);
  dom.btnDisconnect.classList.toggle('hidden', !connected);
  dom.btnArm.disabled    = !connected && !state.demoMode;
  dom.btnDisarm.disabled = !connected && !state.demoMode;
  if (connected) { state.startTime = Date.now(); }
  else { state.startTime = null; dom.telUptime.textContent = '00:00:00'; }
}

// ── Bluetooth Panel ───────────────────────────────────────────
function setBtConnected(connected, deviceName = '') {
  state.btConnected = connected;
  state.btDeviceName = deviceName;

  dom.btDot.classList.toggle('connected', connected);
  dom.btIcon.classList.toggle('connected', connected);
  dom.btDeviceName.classList.toggle('connected', connected);

  if (connected) {
    dom.btDeviceName.textContent = deviceName || 'UNKNOWN DEVICE';
    dom.btStatusSub.textContent  = 'Mobile app linked — commands active';
    logEvent(`BT: Mobile connected — "${deviceName}"`, 'bt');
  } else {
    dom.btDeviceName.textContent = 'NO MOBILE CONNECTED';
    dom.btStatusSub.textContent  = 'Waiting for HC-05 pairing via mobile app';
    if (deviceName) logEvent(`BT: Mobile disconnected — "${deviceName}"`, 'bt');
  }
}

// Preset BT command buttons
document.querySelectorAll('.preset-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const cmd = btn.dataset.cmd;
    dom.btInput.value = cmd;
  });
});

dom.btnBtSend.addEventListener('click', sendBtCommand);
dom.btInput.addEventListener('keydown', e => { if (e.key === 'Enter') sendBtCommand(); });

function sendBtCommand() {
  const cmd = dom.btInput.value.trim();
  if (!cmd) return;
  dom.btLastCmd.textContent = `Last sent: ${cmd} @ ${new Date().toTimeString().slice(0,8)}`;
  logEvent(`BT CMD sent: "${cmd}"`, 'bt');
  dom.btInput.value = '';

  // If also USB connected, relay the command
  if (state.writer && (cmd === '1' || cmd === '0')) {
    sendCommand(cmd);
  }
  // In demo mode, process the command
  if (state.demoMode) {
    if (cmd === '1') handleArduinoMessage('STATUS:ARMED');
    if (cmd === '0') handleArduinoMessage('STATUS:DISARMED');
  }
}

// ── Web Serial ────────────────────────────────────────────────
if (!('serial' in navigator)) {
  logEvent('⚠ Web Serial not supported. Use Chrome/Edge 89+.', 'alarm');
  dom.btnConnect.disabled = true;
  dom.btnConnect.textContent = 'BROWSER UNSUPPORTED';
}

dom.btnConnect.addEventListener('click', connectSerial);
dom.btnDisconnect.addEventListener('click', disconnectSerial);

async function connectSerial() {
  if (state.demoMode) { logEvent('Exit demo mode first.', 'system'); return; }
  try {
    const port = await navigator.serial.requestPort();
    await port.open({ baudRate:9600, dataBits:8, stopBits:1, parity:'none' });
    state.port = port;
    state.writer = port.writable.getWriter();
    const info = port.getInfo();
    const label = info.usbVendorId
      ? `USB VID:${info.usbVendorId.toString(16).toUpperCase()} PID:${info.usbProductId.toString(16).toUpperCase()}`
      : 'USB Serial Device';
    dom.portLabel.textContent = label;
    setConnectedUI(true);
    applySystemState('DISARMED');
    logEvent(`Connected: ${label}`, 'system');
    playDisarmSound();
    readLoop(port);
  } catch(err) {
    if (err.name !== 'NotFoundError') logEvent(`Connect error: ${err.message}`, 'alarm');
  }
}

async function disconnectSerial() {
  try {
    if (state.reader) { await state.reader.cancel(); state.reader = null; }
    if (state.writer) { state.writer.releaseLock(); state.writer = null; }
    if (state.port)   { await state.port.close();   state.port = null; }
  } catch(e) {}
  stopAlarmSound();
  setConnectedUI(false);
  applySystemState('OFFLINE');
  dom.portLabel.textContent = 'NO DEVICE CONNECTED';
  logEvent('Device disconnected.', 'system');
}

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
      buffer = lines.pop();
      for (const raw of lines) {
        const line = raw.trim();
        if (line) handleArduinoMessage(line);
      }
    }
  } catch(err) {
    if (err.name !== 'AbortError') logEvent(`Read error: ${err.message}`, 'alarm');
  }
}

// ── Message Handler ───────────────────────────────────────────
function handleArduinoMessage(line) {
  if (line === 'ALARM') {
    state.breachCount++;
    dom.telBreaches.textContent = state.breachCount;
    applySystemState('ALARM');
    logEvent('⚠ BEAM BREACH DETECTED', 'alarm');
    playAlarmSound();
    triggerBrowserNotif();
    return;
  }
  if (line === 'STATUS:ARMED') {
    stopAlarmSound();
    applySystemState('ARMED');
    logEvent('System armed — laser perimeter active.', 'arm');
    playArmSound();
    return;
  }
  if (line === 'STATUS:DISARMED') {
    stopAlarmSound();
    applySystemState('DISARMED');
    logEvent('System disarmed.', 'disarm');
    playDisarmSound();
    return;
  }
  // BT_CONNECT:DeviceName
  const btMatch = line.match(/^BT_CONNECT:(.+)$/);
  if (btMatch) { setBtConnected(true, btMatch[1]); return; }
  if (line === 'BT_DISCONNECT') { setBtConnected(false, state.btDeviceName); return; }

  const baseMatch = line.match(/^CAL:BASELINE=(\d+)$/);
  if (baseMatch) {
    state.ldrBaseline = parseInt(baseMatch[1]);
    dom.telBase.textContent = baseMatch[1];
    return;
  }
  const ldrMatch = line.match(/^LDR:(\d+)$/);
  if (ldrMatch) {
    dom.telCurrent.textContent = ldrMatch[1];
    return;
  }
  if (line.startsWith('CAL:'))  { logEvent(`[CAL] ${line.slice(4)}`, 'system'); return; }
  if (line.startsWith('BOOT:')) { logEvent(`[BOOT] ${line.slice(5)}`, 'system'); return; }
  logEvent(`[RAW] ${line}`, 'system');
}

async function sendCommand(char) {
  if (!state.writer) return;
  try {
    await state.writer.write(new TextEncoder().encode(char));
  } catch(e) { logEvent(`Send error: ${e.message}`, 'alarm'); }
}

dom.btnArm.addEventListener('click', async () => {
  if (state.demoMode) { handleArduinoMessage('STATUS:ARMED'); return; }
  await sendCommand('1');
  logEvent('CMD: ARM sent via USB.', 'arm');
});
dom.btnDisarm.addEventListener('click', async () => {
  if (state.demoMode) { handleArduinoMessage('STATUS:DISARMED'); return; }
  await sendCommand('0');
  logEvent('CMD: DISARM sent via USB.', 'disarm');
});

// ── Browser Notification ──────────────────────────────────────
async function triggerBrowserNotif() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') await Notification.requestPermission();
  if (Notification.permission === 'granted') {
    new Notification('🚨 SENTINEL ALARM', {
      body: 'Laser perimeter breach detected!',
      requireInteraction: true,
      tag: 'sentinel-alarm',
    });
  }
}
document.addEventListener('click', () => {
  if ('Notification' in window && Notification.permission === 'default')
    Notification.requestPermission();
}, { once: true });

// ── DEMO MODE ─────────────────────────────────────────────────
let ldrSimInterval = null;

dom.btnDemo.addEventListener('click', () => {
  dom.demoOverlay.classList.remove('hidden');
  if (!state.demoMode) {
    state.demoMode = true;
    dom.btnDemo.classList.add('active');
    dom.demoBadge.classList.remove('hidden');
    dom.btnArm.disabled    = false;
    dom.btnDisarm.disabled = false;
    if (state.systemState === 'OFFLINE') {
      applySystemState('DISARMED');
      dom.portLabel.textContent = 'DEMO MODE — No hardware required';
      logEvent('Demo mode activated.', 'system');
    }
  }
});

dom.demoClose.addEventListener('click', () => {
  dom.demoOverlay.classList.add('hidden');
});
dom.demoOverlay.addEventListener('click', e => {
  if (e.target === dom.demoOverlay) dom.demoOverlay.classList.add('hidden');
});

dom.demoArm.addEventListener('click', () => {
  handleArduinoMessage('STATUS:ARMED');
  dom.demoOverlay.classList.add('hidden');
});
dom.demoDisarm.addEventListener('click', () => {
  handleArduinoMessage('STATUS:DISARMED');
  dom.demoOverlay.classList.add('hidden');
});
dom.demoAlarm.addEventListener('click', () => {
  handleArduinoMessage('STATUS:ARMED');
  setTimeout(() => handleArduinoMessage('ALARM'), 800);
  dom.demoOverlay.classList.add('hidden');
});
dom.demoLdr.addEventListener('click', () => {
  if (ldrSimInterval) { clearInterval(ldrSimInterval); ldrSimInterval = null; logEvent('LDR simulation stopped.', 'system'); return; }
  let tick = 0;
  const baseline = 820;
  state.ldrBaseline = baseline;
  dom.telBase.textContent = baseline;
  logEvent('LDR simulation started.', 'system');
  ldrSimInterval = setInterval(() => {
    tick++;
    const val = Math.round(baseline + Math.sin(tick * 0.3) * 30 + (Math.random()-0.5)*20);
    dom.telCurrent.textContent = val;
    if (tick % 40 === 0 && state.systemState === 'ARMED') handleArduinoMessage('ALARM');
  }, 200);
});
dom.demoCalib.addEventListener('click', () => {
  handleArduinoMessage('BOOT: Sentinel v1.0');
  setTimeout(() => handleArduinoMessage('CAL:STARTING'), 300);
  setTimeout(() => handleArduinoMessage('CAL:BASELINE=847'), 900);
  setTimeout(() => handleArduinoMessage('CAL:DONE'), 1200);
  logEvent('Calibration sequence simulated.', 'system');
});
dom.demoBtConnect.addEventListener('click', () => {
  setBtConnected(true, 'PIXEL-8-DEMO');
});
dom.demoBtDisconnect.addEventListener('click', () => {
  setBtConnected(false, state.btDeviceName);
});

// ── Init ──────────────────────────────────────────────────────
applySystemState('OFFLINE');
