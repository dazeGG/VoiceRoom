import { state } from '@voiceroom/call/engine/core/room-runtime.store';
import { CAMERA_DEVICE_STORAGE_KEY } from '@voiceroom/call/engine/core/config';
import { readStorage } from '@/shared/storage';
import { DIAGNOSTICS_DEVICE_LABELS, formatDiagnosticsReport } from '@voiceroom/shared/contracts/diagnostics';
import { DIAGNOSTICS_MIME_TYPE, diagnosticsFileName } from '@voiceroom/shared/contracts/media';
import { normalizeDesktopShellVersion } from '@voiceroom/shared/contracts/realtime';
import { readSoundSettings } from '@/features/home/model/sound-settings';
import { useCallFeedbackStore } from '@/features/call-feedback/call-feedback.store';
import { readDesktopRuntime } from '@/platform/desktop-system';
import { readLogBuffer } from '@/shared/log';

const LOOKUP_TIMEOUT_MS = 2_000;
const BROWSERS = [
  ['Edge', /(?:Edg|EdgA|EdgiOS)\/([\d.]+)/],
  ['Opera', /OPR\/([\d.]+)/],
  ['Firefox', /(?:Firefox|FxiOS)\/([\d.]+)/],
  ['Chrome', /(?:Chrome|CriOS)\/([\d.]+)/],
  ['Safari', /Version\/([\d.]+).*Safari/]
] as const;

const SYSTEMS = [
  ['Android', /Android ([\d.]+)/],
  ['iOS', /(?:iPhone|iPad).*OS ([\d_]+)/],
  ['Windows', /Windows NT ([\d.]+)/],
  ['macOS', /Mac OS X ([\d_.]+)/],
  ['Linux', /Linux/]
] as const;

function platformLabel(agent: string, patterns: ReadonlyArray<readonly [string, RegExp]>): string | undefined {
  for (const [label, pattern] of patterns) {
    const match = pattern.exec(agent);
    if (match) return [label, match[1]?.replaceAll('_', '.')].filter(Boolean).join(' ');
  }
  return undefined;
}

// Neither browser lookup takes an AbortSignal. Stop waiting when the report
// deadline or the initiating session ends, and ignore any late result.
function readBefore<T>(read: () => Promise<T> | undefined, signal: AbortSignal): Promise<T | undefined> {
  if (signal.aborted) return Promise.resolve(undefined);
  return new Promise<T | undefined>((resolve) => {
    const onAbort = () => resolve(undefined);
    signal.addEventListener('abort', onAbort, { once: true });
    void Promise.resolve()
      .then(() => (signal.aborted ? undefined : read()))
      .then(resolve, onAbort)
      .finally(() => signal.removeEventListener('abort', onAbort));
  });
}

const DEVICE_KINDS = [/\busb\b/i, /\bbluetooth\b/i, /\b(?:wireless|wi-fi|network)\b/i, /\b(?:built-in|integrated)\b/i];

function selectedDevice(
  devices: readonly MediaDeviceInfo[] | undefined,
  kind: MediaDeviceKind,
  selected: string
): string | undefined {
  const options = devices?.filter((candidate) => candidate.kind === kind) ?? [];
  const device =
    options.find((candidate) => candidate.deviceId === (selected || 'default')) ?? (selected ? undefined : options[0]);
  if (device?.label) {
    // A label can contain names, email addresses, IPs and device IDs. Only
    // return a fixed descriptor, never a substring copied from the label.
    return DIAGNOSTICS_DEVICE_LABELS[DEVICE_KINDS.findIndex((pattern) => pattern.test(device.label))] ?? '[redacted]';
  }
  return selected ? undefined : 'System default (label unavailable)';
}

function measurement(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function enumText(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** Builds a local snapshot when the user asks for one. Browser lookups do not prompt for permission. */
export async function buildDiagnostics(at = new Date(), signal?: AbortSignal): Promise<File> {
  signal?.throwIfAborted();
  const desktop = readDesktopRuntime();
  const feedback = useCallFeedbackStore().call;
  const audio = readSoundSettings();
  const cameraId = state.joined ? state.cameraDeviceId : (readStorage(CAMERA_DEVICE_STORAGE_KEY) ?? '');
  const micId = state.joined ? state.microphoneDeviceId : audio.microphoneDeviceId;
  const speakerId = state.joined ? state.outputDeviceId : audio.outputDeviceId;
  const room = state.roomName;
  const participants = state.joined ? state.peers.size + Number(Boolean(state.self)) : undefined;
  const voice = state.voiceConnection;
  const server = state.serverConnection;
  const network = { ...state.localNetwork };
  const ping = state.localPingMs;
  const noise = state.joined ? state.noiseMode : audio.noiseMode;
  const logs = readLogBuffer();
  const loggedQuality = logs.findLast((record) => record.ns === 'room:quality' && record.msg === 'call quality')?.ctx;
  const quality = feedback?.quality ?? loggedQuality;
  const deadline = AbortSignal.timeout(LOOKUP_TIMEOUT_MS);
  const lookupSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
  const [devices, permission] = await Promise.all([
    readBefore(() => navigator.mediaDevices?.enumerateDevices(), lookupSignal),
    readBefore(() => navigator.permissions?.query({ name: 'microphone' }), lookupSignal)
  ]);
  signal?.throwIfAborted();
  const agent = navigator.userAgent;
  const report = formatDiagnosticsReport(
    at,
    {
      'Web version': import.meta.env.VITE_APP_VERSION,
      'Desktop version': normalizeDesktopShellVersion(desktop?.isDesktop ? desktop.version : undefined),
      Browser: platformLabel(agent, BROWSERS),
      OS: platformLabel(agent, SYSTEMS),
      Language: navigator.language,
      'Time zone': Intl.DateTimeFormat().resolvedOptions().timeZone,
      Name: room.trim() ? '[redacted]' : undefined,
      Participants: participants,
      'Room events': server,
      Voice: voice,
      'Reconnects in last call': measurement(quality?.reconnects),
      Transport: network.transport ?? enumText(quality?.transport),
      'Current RTT (ms)': ping,
      'Current inbound loss (%)': network.inboundLossPct,
      'Current outbound loss (%)': network.outboundLossPct,
      'Current jitter (ms)': network.jitterMs,
      'RTT (ms) average': measurement(quality?.rttAvgMs),
      'RTT (ms) worst': measurement(quality?.rttMaxMs),
      'Inbound loss (%) average': measurement(quality?.inboundLossAvgPct),
      'Inbound loss (%) worst': measurement(quality?.inboundLossMaxPct),
      'Outbound loss (%) average': measurement(quality?.outboundLossAvgPct),
      'Outbound loss (%) worst': measurement(quality?.outboundLossMaxPct),
      'Jitter (ms) average': measurement(quality?.jitterAvgMs),
      'Jitter (ms) worst': measurement(quality?.jitterMaxMs),
      Peak: enumText(quality?.cpuPressureMax),
      'VoiceRoom average CPU (%)': measurement(quality?.appCpuAvgPct),
      'System average CPU (%)': measurement(quality?.systemCpuAvgPct),
      Microphone: selectedDevice(devices, 'audioinput', micId),
      Speakers: selectedDevice(devices, 'audiooutput', speakerId),
      Camera: selectedDevice(devices, 'videoinput', cameraId),
      'Microphone permission': permission?.state,
      'Noise suppression': noise
    },
    logs
  );
  return new File([report], diagnosticsFileName(at), {
    type: DIAGNOSTICS_MIME_TYPE,
    lastModified: at.getTime()
  });
}
