// ============================================================
//  SENTINEL — Mobile Security Controller
//  Flutter app for HC-05/HC-06 Bluetooth Classic
//
//  Features:
//   • Scan & Connect to HC-05/06
//   • Arm / Disarm with confirmation
//   • Background high-priority alarm notifications
//   • Full event log with timestamps
// ============================================================

import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_bluetooth_serial/flutter_bluetooth_serial.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:intl/intl.dart';

// ── Notification Setup ────────────────────────────────────────
final FlutterLocalNotificationsPlugin _notifPlugin =
    FlutterLocalNotificationsPlugin();

Future<void> initNotifications() async {
  const androidSettings =
      AndroidInitializationSettings('@mipmap/ic_launcher');
  const iosSettings = DarwinInitializationSettings(
    requestAlertPermission: true,
    requestBadgePermission: true,
    requestSoundPermission: true,
  );
  const settings = InitializationSettings(
    android: androidSettings,
    iOS: iosSettings,
  );
  await _notifPlugin.initialize(settings);
}

Future<void> showAlarmNotification() async {
  const androidDetails = AndroidNotificationDetails(
    'sentinel_alarm',
    'SENTINEL Alarms',
    channelDescription: 'High-priority laser breach alerts',
    importance: Importance.max,
    priority: Priority.high,
    fullScreenIntent: true,
    playSound: true,
    enableVibration: true,
    vibrationPattern: Int64List.fromList([0, 500, 200, 500, 200, 500]),
    color: Color(0xFFFF2244),
    ledColor: Color(0xFFFF2244),
    ledOnMs: 100,
    ledOffMs: 100,
    ticker: 'LASER BREACH DETECTED',
  );
  const iosDetails = DarwinNotificationDetails(
    presentAlert: true,
    presentBadge: true,
    presentSound: true,
    interruptionLevel: InterruptionLevel.critical,
  );
  const details =
      NotificationDetails(android: androidDetails, iOS: iosDetails);

  await _notifPlugin.show(
    0,
    '🚨 SENTINEL ALARM',
    'Laser perimeter breach detected! Disarm immediately.',
    details,
  );
}

// ── App Entry Point ───────────────────────────────────────────
Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await initNotifications();
  runApp(const SentinelApp());
}

// ── Theme ─────────────────────────────────────────────────────
class SentinelColors {
  static const bg       = Color(0xFF050810);
  static const bg2      = Color(0xFF080d1a);
  static const panel    = Color(0xFF0c1528);
  static const cyan     = Color(0xFF00DCFF);
  static const green    = Color(0xFF00FF88);
  static const red      = Color(0xFFFF2244);
  static const amber    = Color(0xFFFFAA00);
  static const textDim  = Color(0xFF5a6a80);
  static const textMain = Color(0xFFc8d8f0);
}

// ── Data Models ───────────────────────────────────────────────
enum SystemState { offline, disarmed, armed, alarm }

class LogEntry {
  final DateTime timestamp;
  final String message;
  final SystemState type;

  LogEntry(this.message, this.type) : timestamp = DateTime.now();

  String get timeStr => DateFormat('HH:mm:ss').format(timestamp);
}

// ── Root App Widget ───────────────────────────────────────────
class SentinelApp extends StatelessWidget {
  const SentinelApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'SENTINEL',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        useMaterial3: true,
        colorScheme: ColorScheme.dark(
          primary: SentinelColors.cyan,
          secondary: SentinelColors.green,
          error: SentinelColors.red,
          surface: SentinelColors.bg,
        ),
        scaffoldBackgroundColor: SentinelColors.bg,
        fontFamily: 'monospace',
      ),
      home: const SentinelHome(),
    );
  }
}

// ── Main Screen ───────────────────────────────────────────────
class SentinelHome extends StatefulWidget {
  const SentinelHome({super.key});

  @override
  State<SentinelHome> createState() => _SentinelHomeState();
}

class _SentinelHomeState extends State<SentinelHome>
    with TickerProviderStateMixin {
  // BT
  BluetoothConnection? _connection;
  final List<BluetoothDevice> _devices = [];
  bool _scanning = false;
  String _connectedDeviceName = '';
  String _btBuffer = '';

  // System state
  SystemState _systemState = SystemState.offline;
  final List<LogEntry> _log = [];
  int _breachCount = 0;
  bool _appReady = false;

  // Animation
  late AnimationController _ringController;
  late AnimationController _alarmController;
  late Animation<double> _alarmAnim;

  @override
  void initState() {
    super.initState();
    _ringController = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 6),
    )..repeat();

    _alarmController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 400),
    );
    _alarmAnim = Tween<double>(begin: 1.0, end: 0.3).animate(_alarmController);

    _initPermissions();
    _addLog('SENTINEL initialized.', SystemState.disarmed);
  }

  @override
  void dispose() {
    _ringController.dispose();
    _alarmController.dispose();
    _connection?.dispose();
    super.dispose();
  }

  // ── Permissions ─────────────────────────────────────────────
  Future<void> _initPermissions() async {
    await [
      Permission.bluetooth,
      Permission.bluetoothScan,
      Permission.bluetoothConnect,
      Permission.notification,
      Permission.location,
    ].request();
    setState(() => _appReady = true);
  }

  // ── Bluetooth Scan ───────────────────────────────────────────
  Future<void> _scanDevices() async {
    setState(() {
      _scanning = true;
      _devices.clear();
    });

    try {
      // Get paired devices first (HC-05 must be paired in system settings)
      final paired = await FlutterBluetoothSerial.instance.getBondedDevices();
      setState(() => _devices.addAll(paired));
    } catch (e) {
      _showSnack('Scan error: $e');
    } finally {
      setState(() => _scanning = false);
    }
  }

  // ── Connect ──────────────────────────────────────────────────
  Future<void> _connectToDevice(BluetoothDevice device) async {
    try {
      final conn = await BluetoothConnection.toAddress(device.address);
      setState(() {
        _connection = conn;
        _connectedDeviceName = device.name ?? device.address;
        _systemState = SystemState.disarmed;
      });
      _addLog('Connected to $_connectedDeviceName', SystemState.disarmed);

      // Listen for data
      conn.input!.listen(
        _onDataReceived,
        onDone: _onDisconnected,
        cancelOnError: true,
      );
    } catch (e) {
      _showSnack('Connection failed: $e');
    }
  }

  void _onDataReceived(Uint8List data) {
    _btBuffer += utf8.decode(data, allowMalformed: true);
    final lines = _btBuffer.split('\n');
    _btBuffer = lines.removeLast(); // keep partial line

    for (final raw in lines) {
      final line = raw.trim();
      if (line.isNotEmpty) _handleMessage(line);
    }
  }

  void _handleMessage(String line) {
    debugPrint('[BT] $line');

    if (line == 'ALARM') {
      setState(() {
        _systemState = SystemState.alarm;
        _breachCount++;
      });
      _alarmController.repeat(reverse: true);
      _addLog('⚠ BEAM BREACH DETECTED', SystemState.alarm);
      showAlarmNotification();
      HapticFeedback.heavyImpact();
      return;
    }

    if (line == 'STATUS:ARMED') {
      setState(() => _systemState = SystemState.armed);
      _alarmController.stop();
      _alarmController.reset();
      _addLog('System armed — perimeter active.', SystemState.armed);
      return;
    }

    if (line == 'STATUS:DISARMED') {
      setState(() => _systemState = SystemState.disarmed);
      _alarmController.stop();
      _alarmController.reset();
      _addLog('System disarmed.', SystemState.disarmed);
      return;
    }

    if (line.startsWith('CAL:') || line.startsWith('BOOT:')) {
      _addLog('[SYS] $line', SystemState.disarmed);
      return;
    }

    _addLog('[RAW] $line', SystemState.disarmed);
  }

  void _onDisconnected() {
    setState(() {
      _systemState = SystemState.offline;
      _connection = null;
      _connectedDeviceName = '';
    });
    _alarmController.stop();
    _addLog('Device disconnected.', SystemState.offline);
  }

  // ── Send Commands ────────────────────────────────────────────
  void _sendCommand(String cmd) {
    _connection?.output.add(Uint8List.fromList(utf8.encode(cmd)));
  }

  void _arm() {
    _sendCommand('1');
    _addLog('CMD: ARM sent via Bluetooth.', SystemState.armed);
  }

  void _disarm() {
    _sendCommand('0');
    _addLog('CMD: DISARM sent via Bluetooth.', SystemState.disarmed);
  }

  // ── Log ──────────────────────────────────────────────────────
  void _addLog(String msg, SystemState type) {
    setState(() => _log.insert(0, LogEntry(msg, type)));
  }

  void _showSnack(String msg) {
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(msg)));
  }

  // ── Build ────────────────────────────────────────────────────
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: SentinelColors.bg,
      appBar: _buildAppBar(),
      body: Column(
        children: [
          _buildStatusBar(),
          Expanded(
            child: _connection == null
                ? _buildScanPanel()
                : _buildControlPanel(),
          ),
        ],
      ),
    );
  }

  AppBar _buildAppBar() {
    return AppBar(
      backgroundColor: SentinelColors.bg2,
      title: Row(
        children: [
          const Text('⬡ ', style: TextStyle(color: SentinelColors.cyan, fontSize: 22)),
          Text(
            'SENTINEL',
            style: TextStyle(
              color: SentinelColors.cyan,
              fontFamily: 'monospace',
              fontWeight: FontWeight.bold,
              fontSize: 20,
              letterSpacing: 4,
              shadows: [Shadow(color: SentinelColors.cyan.withOpacity(0.8), blurRadius: 12)],
            ),
          ),
        ],
      ),
      actions: [
        if (_connection != null)
          IconButton(
            icon: const Icon(Icons.bluetooth_disabled, color: SentinelColors.red),
            tooltip: 'Disconnect',
            onPressed: () {
              _connection?.dispose();
              _onDisconnected();
            },
          ),
      ],
    );
  }

  Widget _buildStatusBar() {
    final cfg = _stateConfig(_systemState);
    return AnimatedBuilder(
      animation: _alarmAnim,
      builder: (ctx, _) => Opacity(
        opacity: _systemState == SystemState.alarm ? _alarmAnim.value : 1.0,
        child: Container(
          width: double.infinity,
          padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 20),
          color: cfg.color.withOpacity(0.15),
          child: Row(
            children: [
              Container(
                width: 10,
                height: 10,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: cfg.color,
                  boxShadow: [BoxShadow(color: cfg.color.withOpacity(0.8), blurRadius: 8)],
                ),
              ),
              const SizedBox(width: 12),
              Text(
                cfg.label,
                style: TextStyle(
                  color: cfg.color,
                  fontFamily: 'monospace',
                  fontWeight: FontWeight.bold,
                  letterSpacing: 3,
                  fontSize: 13,
                ),
              ),
              const Spacer(),
              if (_connection != null)
                Text(
                  _connectedDeviceName,
                  style: const TextStyle(color: SentinelColors.textDim, fontSize: 11),
                ),
            ],
          ),
        ),
      ),
    );
  }

  // ── Scan Panel ───────────────────────────────────────────────
  Widget _buildScanPanel() {
    return Padding(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const SizedBox(height: 20),
          // Bluetooth icon
          Center(
            child: AnimatedBuilder(
              animation: _ringController,
              builder: (ctx, _) => Transform.rotate(
                angle: _ringController.value * 6.28,
                child: Container(
                  width: 100,
                  height: 100,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    border: Border.all(color: SentinelColors.cyan.withOpacity(0.4), width: 1.5),
                  ),
                  child: const Center(
                    child: Icon(Icons.bluetooth, color: SentinelColors.cyan, size: 48),
                  ),
                ),
              ),
            ),
          ),
          const SizedBox(height: 24),
          const Text(
            'PAIR HC-05/HC-06 IN SYSTEM\nSETTINGS FIRST, THEN SCAN',
            textAlign: TextAlign.center,
            style: TextStyle(color: SentinelColors.textDim, fontSize: 11, letterSpacing: 2, height: 1.6),
          ),
          const SizedBox(height: 28),
          _hudButton(
            label: _scanning ? 'SCANNING…' : 'SCAN FOR PAIRED DEVICES',
            color: SentinelColors.cyan,
            onTap: _appReady && !_scanning ? _scanDevices : null,
            icon: Icons.radar,
          ),
          const SizedBox(height: 20),
          if (_devices.isNotEmpty) ...[
            const Text(
              'PAIRED DEVICES',
              style: TextStyle(color: SentinelColors.textDim, fontSize: 11, letterSpacing: 3),
            ),
            const SizedBox(height: 10),
            Expanded(
              child: ListView.builder(
                itemCount: _devices.length,
                itemBuilder: (ctx, i) {
                  final d = _devices[i];
                  return _DeviceTile(
                    device: d,
                    onTap: () => _connectToDevice(d),
                  );
                },
              ),
            ),
          ] else if (!_scanning)
            const Expanded(
              child: Center(
                child: Text(
                  'No paired devices found.\nPair HC-05 in Android Bluetooth settings\nusing PIN: 1234 or 0000',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: SentinelColors.textDim, fontSize: 12, height: 1.7),
                ),
              ),
            ),
        ],
      ),
    );
  }

  // ── Control Panel ────────────────────────────────────────────
  Widget _buildControlPanel() {
    return Column(
      children: [
        // Big status orb
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 20),
          child: _BigStatusOrb(state: _systemState, ringController: _ringController),
        ),

        // Control buttons
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 20),
          child: Row(
            children: [
              Expanded(
                child: _hudButton(
                  label: 'ARM',
                  color: SentinelColors.red,
                  onTap: _systemState != SystemState.armed ? _arm : null,
                  icon: Icons.security,
                ),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: _hudButton(
                  label: 'DISARM',
                  color: SentinelColors.green,
                  onTap: _systemState != SystemState.disarmed ? _disarm : null,
                  icon: Icons.lock_open,
                ),
              ),
            ],
          ),
        ),

        const SizedBox(height: 16),

        // Breach counter
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 20),
          child: _InfoRow(label: 'BREACH COUNT', value: '$_breachCount'),
        ),

        const SizedBox(height: 16),

        // Event log
        const Padding(
          padding: EdgeInsets.symmetric(horizontal: 20),
          child: Align(
            alignment: Alignment.centerLeft,
            child: Text(
              'EVENT LOG',
              style: TextStyle(color: SentinelColors.textDim, fontSize: 10, letterSpacing: 3),
            ),
          ),
        ),
        const SizedBox(height: 8),
        Expanded(
          child: ListView.builder(
            padding: const EdgeInsets.symmetric(horizontal: 14),
            itemCount: _log.length,
            itemBuilder: (ctx, i) => _LogTile(entry: _log[i]),
          ),
        ),
      ],
    );
  }

  // ── Helpers ──────────────────────────────────────────────────
  Widget _hudButton({
    required String label,
    required Color color,
    required VoidCallback? onTap,
    required IconData icon,
  }) {
    return GestureDetector(
      onTap: onTap,
      child: AnimatedOpacity(
        duration: const Duration(milliseconds: 200),
        opacity: onTap == null ? 0.3 : 1.0,
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 14),
          decoration: BoxDecoration(
            border: Border.all(color: color, width: 1.5),
            borderRadius: BorderRadius.circular(4),
            color: color.withOpacity(0.08),
            boxShadow: onTap != null
                ? [BoxShadow(color: color.withOpacity(0.3), blurRadius: 12)]
                : null,
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icon, color: color, size: 18),
              const SizedBox(width: 8),
              Text(
                label,
                style: TextStyle(
                  color: color,
                  fontFamily: 'monospace',
                  fontWeight: FontWeight.bold,
                  letterSpacing: 3,
                  fontSize: 13,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  _StateConfig _stateConfig(SystemState s) {
    switch (s) {
      case SystemState.offline:   return _StateConfig(SentinelColors.textDim, 'OFFLINE');
      case SystemState.disarmed:  return _StateConfig(SentinelColors.green, 'DISARMED');
      case SystemState.armed:     return _StateConfig(SentinelColors.amber, 'ARMED');
      case SystemState.alarm:     return _StateConfig(SentinelColors.red, '⚠ ALARM ⚠');
    }
  }
}

// ── Sub-Widgets ───────────────────────────────────────────────
class _StateConfig {
  final Color color;
  final String label;
  const _StateConfig(this.color, this.label);
}

class _BigStatusOrb extends StatelessWidget {
  final SystemState state;
  final AnimationController ringController;
  const _BigStatusOrb({required this.state, required this.ringController});

  Color get _color {
    switch (state) {
      case SystemState.offline:  return SentinelColors.textDim;
      case SystemState.disarmed: return SentinelColors.green;
      case SystemState.armed:    return SentinelColors.amber;
      case SystemState.alarm:    return SentinelColors.red;
    }
  }

  String get _label {
    switch (state) {
      case SystemState.offline:  return 'OFFLINE';
      case SystemState.disarmed: return 'DISARMED';
      case SystemState.armed:    return 'ARMED';
      case SystemState.alarm:    return 'ALARM';
    }
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: ringController,
      builder: (ctx, _) => Container(
        width: 160,
        height: 160,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          border: Border.all(color: _color.withOpacity(0.5), width: 2),
          boxShadow: [BoxShadow(color: _color.withOpacity(0.25), blurRadius: 30)],
        ),
        child: Stack(
          alignment: Alignment.center,
          children: [
            Transform.rotate(
              angle: ringController.value * 6.28,
              child: Container(
                width: 145,
                height: 145,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  border: Border.all(color: Colors.transparent, width: 1),
                  gradient: SweepGradient(
                    colors: [_color.withOpacity(0.6), Colors.transparent],
                  ),
                ),
              ),
            ),
            Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Text(
                  _label,
                  style: TextStyle(
                    color: _color,
                    fontFamily: 'monospace',
                    fontWeight: FontWeight.bold,
                    letterSpacing: 2,
                    fontSize: 14,
                    shadows: [Shadow(color: _color.withOpacity(0.8), blurRadius: 10)],
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _DeviceTile extends StatelessWidget {
  final BluetoothDevice device;
  final VoidCallback onTap;
  const _DeviceTile({required this.device, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        margin: const EdgeInsets.only(bottom: 8),
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          border: Border.all(color: SentinelColors.cyan.withOpacity(0.3)),
          borderRadius: BorderRadius.circular(4),
          color: SentinelColors.panel,
        ),
        child: Row(
          children: [
            const Icon(Icons.bluetooth, color: SentinelColors.cyan, size: 20),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    device.name ?? 'Unknown Device',
                    style: const TextStyle(color: SentinelColors.textMain, fontWeight: FontWeight.bold),
                  ),
                  Text(
                    device.address,
                    style: const TextStyle(color: SentinelColors.textDim, fontSize: 11),
                  ),
                ],
              ),
            ),
            const Icon(Icons.arrow_forward_ios, color: SentinelColors.cyan, size: 14),
          ],
        ),
      ),
    );
  }
}

class _LogTile extends StatelessWidget {
  final LogEntry entry;
  const _LogTile({required this.entry});

  Color get _color {
    switch (entry.type) {
      case SystemState.alarm:    return SentinelColors.red;
      case SystemState.armed:    return SentinelColors.amber;
      case SystemState.disarmed: return SentinelColors.green;
      default:                   return SentinelColors.cyan;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 6),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      decoration: BoxDecoration(
        border: Border(left: BorderSide(color: _color, width: 2)),
        color: _color.withOpacity(0.06),
        borderRadius: const BorderRadius.only(
          topRight: Radius.circular(4),
          bottomRight: Radius.circular(4),
        ),
      ),
      child: Row(
        children: [
          Text(
            entry.timeStr,
            style: const TextStyle(color: SentinelColors.textDim, fontSize: 10, fontFamily: 'monospace'),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              entry.message,
              style: TextStyle(color: _color, fontSize: 12, fontFamily: 'monospace'),
            ),
          ),
        ],
      ),
    );
  }
}

class _InfoRow extends StatelessWidget {
  final String label;
  final String value;
  const _InfoRow({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
      decoration: BoxDecoration(
        border: Border.all(color: SentinelColors.cyan.withOpacity(0.15)),
        borderRadius: BorderRadius.circular(4),
        color: SentinelColors.panel,
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: const TextStyle(color: SentinelColors.textDim, fontSize: 11, letterSpacing: 2)),
          Text(value, style: const TextStyle(color: SentinelColors.cyan, fontWeight: FontWeight.bold, fontSize: 16)),
        ],
      ),
    );
  }
}
