import { state } from '@voiceroom/call/engine/core/room-runtime.store';
import { createInitialRoomState } from '@voiceroom/call/engine/model/room-state';
import { useCallFeedbackStore } from '@/features/call-feedback/call-feedback.store';
import { buildDiagnostics } from '@/features/support/diagnostics';
import { clearLogBuffer, createLogger, reportVoiceJoinOutcome } from '@/shared/log';
import { isDiagnosticsReport } from '@voiceroom/shared/contracts/diagnostics';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { participant } from '../fixtures/participant';

const at = new Date(2026, 10, 28, 14, 8);

function readReport(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('Expected a text report'));
    };
    reader.onerror = () => reject(reader.error ?? new Error('Could not read report'));
    reader.readAsText(file);
  });
}

beforeEach(() => {
  setActivePinia(createPinia());
  clearLogBuffer();
  Object.assign(state, createInitialRoomState());
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, 'voiceRoomRuntime');
});

test('writes every diagnostic section from the existing room, call, device and browser data', async () => {
  window.voiceRoomRuntime = { isDesktop: true, version: '2.3.4' };
  vi.stubEnv('VITE_APP_VERSION', '1.6.0');
  vi.stubGlobal('navigator', {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/133.0.0.0 Safari/537.36 Edg/133.0.2.0',
    language: 'ru-RU',
    mediaDevices: {
      enumerateDevices: async () => [
        { kind: 'audioinput', deviceId: 'mic-private-id', groupId: '', label: 'USB microphone' },
        { kind: 'audiooutput', deviceId: 'default', groupId: '', label: 'Line out' },
        { kind: 'videoinput', deviceId: 'cam-private-id', groupId: '', label: 'HD Webcam' }
      ]
    },
    permissions: { query: vi.fn(async () => ({ state: 'granted' })) }
  });
  state.joined = true;
  state.roomName = 'Evening games';
  state.self = participant({ id: 'host', isLocal: true });
  state.peers.set('peer', participant({ name: 'Private Name' }));
  state.voiceConnection = 'reconnecting';
  state.serverConnection = 'connected';
  state.localNetwork = { transport: 'udp', inboundLossPct: 3, outboundLossPct: 2, jitterMs: 7 };
  state.localPingMs = 26;
  state.microphoneDeviceId = 'mic-private-id';
  state.cameraDeviceId = 'cam-private-id';
  state.noiseMode = 'rnnoise';

  useCallFeedbackStore().call = {
    roomId: 'room-id',
    durationS: 60,
    peers: 1,
    platform: 'desktop_app',
    quality: {
      reconnects: 3,
      transport: 'relay',
      rttAvgMs: 25,
      rttMaxMs: 90,
      inboundLossAvgPct: 2,
      inboundLossMaxPct: 9,
      outboundLossAvgPct: 1,
      outboundLossMaxPct: 7,
      jitterAvgMs: 3,
      jitterMaxMs: 20,
      cpuPressureMax: 'serious',
      appCpuAvgPct: 7,
      systemCpuAvgPct: 52
    }
  };
  createLogger('room').info('voice join outcome', { elapsedMs: 55 });
  const file = await buildDiagnostics(at);
  expect(file.name).toBe('voiceroom-diagnostics-2026-11-28-1408.txt');
  expect(file.type).toBe('text/plain');
  expect(file.lastModified).toBe(at.getTime());
  const report = await readReport(file);
  expect(isDiagnosticsReport(report)).toBe(true);
  for (const line of [
    '[Application and system]',
    'Web version: 1.6.0',
    'Desktop version: 2.3.4',
    'Browser: Edge 133.0.2.0',
    'OS: Windows 10.0',
    'Language: ru-RU',
    'Time zone: ' + Intl.DateTimeFormat().resolvedOptions().timeZone,
    '[Room]',
    'Name: [redacted]',
    'Participants: 2',
    '[Connection]',
    'Room events: connected',
    'Voice: reconnecting',
    'Reconnects in last call: 3',
    'Transport: udp',
    '[Call quality]',
    'Current RTT (ms): 26',
    'Current inbound loss (%): 3',
    'Current outbound loss (%): 2',
    'Current jitter (ms): 7',
    'RTT (ms) average: 25',
    'RTT (ms) worst: 90',
    'Inbound loss (%) average: 2',
    'Inbound loss (%) worst: 9',
    'Outbound loss (%) average: 1',
    'Outbound loss (%) worst: 7',
    'Jitter (ms) average: 3',
    'Jitter (ms) worst: 20',
    '[CPU pressure]',
    'Peak: serious',
    'VoiceRoom average CPU (%): 7',
    'System average CPU (%): 52',
    '[Devices]',
    'Microphone: USB device',
    'Speakers: [redacted]',
    'Camera: [redacted]',
    'Microphone permission: granted',
    'Noise suppression: rnnoise',
    '[Client log]',
    'voice join outcome elapsedMs=55'
  ])
    expect(report).toContain(line);
});

test('retains 300 safe log records and withholds names, message text, URLs, credentials and device IDs', async () => {
  state.roomName = 'Games Former Peer https://example.test/room?query-secret=yes#fragment-secret token=token-secret';
  state.joined = true;
  state.sessionToken = 'raw-session-token';
  state.microphoneDeviceId = 'mic-private-id';
  state.peers.set('peer-id', participant({ name: 'Private Person' }));
  vi.stubGlobal('navigator', {
    language: 'ru-RU',
    userAgent: 'unknown?user-agent-secret',
    mediaDevices: {
      enumerateDevices: async () => [
        {
          kind: 'audioinput',
          deviceId: 'mic-private-id',
          groupId: 'hidden-group-id',
          label:
            'Wi-Fi speaker 192.168.1.42 [fe80::21b:7aff:fe03:ca2a] mic-private-id hidden-group-id raw-session-token'
        },
        { kind: 'audiooutput', deviceId: 'default', label: "Nadia's AirPods nadia@example.test" },
        { kind: 'videoinput', deviceId: 'default', label: 'Network camera at 2001:db8::1 and 10.0.0.15' }
      ]
    }
  });
  const logger = createLogger('chat:Private Person');
  for (let index = 0; index < 305; index += 1) {
    logger.info('voice join outcome', { elapsedMs: index, body: 'private message', token: 'token-secret' });
  }
  logger.info('Private Person sent: private message', { rttAvgMs: 15 });
  createLogger('room:quality').info('call quality', { reconnects: 2, transport: 'tcp', cpuPressureMax: 'fair' });
  const report = await readReport(await buildDiagnostics(at));
  expect(report).toContain('Name: [redacted]');
  expect(report).toContain('Microphone: Wireless device');
  expect(report).toContain('Speakers: [redacted]');
  expect(report).toContain('Camera: Wireless device');
  expect(report).toContain('Reconnects in last call: 2');
  expect(report).toContain('Transport: tcp');
  expect(report).toContain('Peak: fair');
  expect(report).toContain('[event details withheld]');
  const logLines = report.split('[Client log]\n')[1]?.trim().split('\n');
  expect(logLines).toHaveLength(300);
  expect(logLines?.[0]).toContain('elapsedMs=7');
  for (const secret of [
    'Private Person',
    'Former Peer',
    'Nadia',
    'nadia@example.test',
    '192.168.1.42',
    'fe80::21b:7aff:fe03:ca2a',
    '2001:db8::1',
    '10.0.0.15',
    'private message',
    'query-secret',
    'fragment-secret',
    'token-secret',
    'mic-private-id',
    'hidden-group-id',
    'raw-session-token',
    'user-agent-secret',
    'https://example.test'
  ])
    expect(report).not.toContain(secret);
  expect(isDiagnosticsReport(report)).toBe(true);
});

test('exports a real join outcome and microphone event without their identifiers or free-text context', async () => {
  const send = vi.fn(async () => new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', send);
  reportVoiceJoinOutcome({
    outcome: 'failure',
    stage: 'connect',
    elapsedMs: 410,
    roomId: 'private-room-id',
    reportedGuestId: 'private-guest-id'
  });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  createLogger('room').warn('joining without a microphone', { message: 'private device name' });
  createLogger('room').info('voice join outcome', { stage: 'forged-stage', outcome: 'forged-outcome' });
  const report = await readReport(await buildDiagnostics(at));
  expect(report).toContain('voice join outcome elapsedMs=410 stage=connect outcome=failure');
  expect(report).toContain('warn joining without a microphone');
  expect(report).not.toMatch(/private-room-id|private-guest-id|private device name|forged-stage|forged-outcome/);
  expect(isDiagnosticsReport(report)).toBe(true);
  expect(send).toHaveBeenCalledTimes(1);
});

test('missing or refused diagnostics still produce a usable text file', async () => {
  vi.stubEnv('VITE_APP_VERSION', '');
  vi.stubGlobal('navigator', {
    userAgent: '',
    mediaDevices: { enumerateDevices: vi.fn().mockRejectedValue(new Error('denied')) },
    permissions: { query: vi.fn().mockRejectedValue(new Error('unsupported')) }
  });
  const report = await readReport(await buildDiagnostics(at));
  for (const key of [
    'Web version',
    'Desktop version',
    'Browser',
    'OS',
    'Language',
    'Name',
    'Participants',
    'Reconnects in last call',
    'Transport',
    'RTT (ms) worst',
    'Peak',
    'Microphone permission'
  ])
    expect(report).toContain(key + ': Unavailable');
  expect(report).toContain('Microphone: System default (label unavailable)');
  expect(report).toContain('[Client log]\nUnavailable');
  expect(isDiagnosticsReport(report)).toBe(true);
});

test.each(['devices', 'permission', 'both'])('returns a partial report when %s never resolves', async (stalled) => {
  vi.useFakeTimers();
  vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
    const deadline = new AbortController();
    setTimeout(() => deadline.abort(new DOMException('Lookup timed out', 'TimeoutError')), ms);
    return deadline.signal;
  });
  const pending = new Promise<never>(() => {});
  vi.stubGlobal('navigator', {
    userAgent: '',
    mediaDevices: {
      enumerateDevices: () =>
        stalled === 'permission'
          ? Promise.resolve([{ kind: 'audioinput', deviceId: 'default', label: 'USB Mic' }])
          : pending
    },
    permissions: { query: () => (stalled === 'devices' ? Promise.resolve({ state: 'granted' }) : pending) }
  });
  const finished = vi.fn();
  const file = buildDiagnostics(at);
  void file.then(finished);
  await vi.advanceTimersByTimeAsync(1_999);
  expect(finished).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(finished).toHaveBeenCalledOnce();
  vi.useRealTimers();
  const report = await readReport(await file);
  expect(report).toContain(
    stalled === 'permission' ? 'Microphone: USB device' : 'Microphone: System default (label unavailable)'
  );
  expect(report).toContain(
    stalled === 'devices' ? 'Microphone permission: granted' : 'Microphone permission: Unavailable'
  );
  expect(isDiagnosticsReport(report)).toBe(true);
});

test('session cancellation ends both stalled lookups immediately', async () => {
  const pending = new Promise<never>(() => {});
  const lookup = vi.fn(() => pending);
  vi.stubGlobal('navigator', { mediaDevices: { enumerateDevices: lookup }, permissions: { query: lookup } });
  const session = new AbortController();
  const file = buildDiagnostics(at, session.signal);
  const result = expect(file).rejects.toMatchObject({ name: 'AbortError' });
  await Promise.resolve();
  expect(lookup).toHaveBeenCalledTimes(2);
  session.abort();
  await result;
});
