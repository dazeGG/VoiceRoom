import { CPU_PRESSURE_STATES } from './feedback.ts';

// The downloadable report is plain text. Keep the writer and the reader on
// the same versioned grammar so a diagnostics slot cannot carry free text.
const TITLE = 'VoiceRoom diagnostics v1';
const UNAVAILABLE = 'Unavailable';
const LOG_SECTION = '[Client log]';
const WITHHELD = '[event details withheld]';
export const DIAGNOSTICS_LOG_LIMIT = 300;
export const DIAGNOSTICS_JOIN_EVENT = 'voice join outcome';

const JOIN_STAGES = ['started', 'microphone', 'token', 'connect', 'publish'] as const;
const JOIN_OUTCOMES = ['success', 'failure', 'cancel'] as const;
export type DiagnosticsJoinStage = (typeof JOIN_STAGES)[number];
export type DiagnosticsJoinOutcome = (typeof JOIN_OUTCOMES)[number];

const LEVELS = ['debug', 'info', 'warn', 'error', UNAVAILABLE];
const EVENTS = [
  'joining without a microphone: an earlier microphone operation is unresolved',
  'joining without a microphone',
  DIAGNOSTICS_JOIN_EVENT,
  'call quality',
  'server was unreachable',
  'cpu pressure unavailable',
  'uncaught error',
  'unhandled rejection',
  'call feedback not sent',
  'device list failed',
  'microphone publication failed',
  'microphone track ended',
  'microphone still unavailable',
  'device change handling failed',
  'output device follow failed',
  'device action failed',
  'capture_recovery'
] as const;
const METRICS = [
  'durationS',
  'peersMax',
  'elapsedMs',
  'reconnects',
  'rttAvgMs',
  'rttMaxMs',
  'inboundLossAvgPct',
  'inboundLossMaxPct',
  'outboundLossAvgPct',
  'outboundLossMaxPct',
  'jitterAvgMs',
  'jitterMaxMs',
  'appCpuAvgPct',
  'appCpuMaxPct',
  'systemCpuAvgPct'
] as const;
export const DIAGNOSTICS_DEVICE_LABELS = [
  'USB device',
  'Bluetooth device',
  'Wireless device',
  'Built-in device'
] as const;
const DEVICE = oneOf([...DIAGNOSTICS_DEVICE_LABELS, 'System default (label unavailable)', '[redacted]']);

function oneOf(values: readonly string[]): RegExp {
  return new RegExp('^(?:' + values.map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')$');
}

const NUMBER = /^-?(?:0|[1-9]\d{0,20})(?:\.\d{1,20})?(?:e[+-]\d{1,3})?$/;
const COUNT = /^(?:0|[1-9]\d{0,8})$/;
const VERSION = /^\d[\da-zA-Z.+-]{0,39}$/;
const SECTIONS = [
  [
    '[Application and system]',
    {
      'Web version': VERSION,
      'Desktop version': VERSION,
      Browser: /^(?:Edge|Opera|Firefox|Chrome|Safari) \d[\d.]{0,39}$/,
      OS: /^(?:Android|iOS|Windows|macOS) \d[\d.]{0,39}$|^Linux$/,
      Language: /^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8}){0,8}$/,
      'Time zone': /^[a-zA-Z][a-zA-Z0-9_+/-]{0,63}$/
    }
  ],
  ['[Room]', { Name: oneOf(['[redacted]']), Participants: COUNT }],
  [
    '[Connection]',
    {
      'Room events': oneOf(['idle', 'connecting', 'reconnecting', 'connected']),
      Voice: oneOf([
        'idle',
        'connecting',
        'connected',
        'reconnecting',
        'signal-reconnecting',
        'lost',
        'error',
        'no-route',
        'playback-blocked'
      ]),
      'Reconnects in last call': COUNT,
      Transport: oneOf(['udp', 'tcp', 'relay'])
    }
  ],
  [
    '[Call quality]',
    {
      'Current RTT (ms)': NUMBER,
      'Current inbound loss (%)': NUMBER,
      'Current outbound loss (%)': NUMBER,
      'Current jitter (ms)': NUMBER,
      'RTT (ms) average': NUMBER,
      'RTT (ms) worst': NUMBER,
      'Inbound loss (%) average': NUMBER,
      'Inbound loss (%) worst': NUMBER,
      'Outbound loss (%) average': NUMBER,
      'Outbound loss (%) worst': NUMBER,
      'Jitter (ms) average': NUMBER,
      'Jitter (ms) worst': NUMBER
    }
  ],
  [
    '[CPU pressure]',
    {
      Peak: oneOf(CPU_PRESSURE_STATES),
      'VoiceRoom average CPU (%)': NUMBER,
      'System average CPU (%)': NUMBER
    }
  ],
  [
    '[Devices]',
    {
      Microphone: DEVICE,
      Speakers: DEVICE,
      Camera: DEVICE,
      'Microphone permission': oneOf(['granted', 'denied', 'prompt']),
      'Noise suppression': oneOf(['browser', 'off', 'rnnoise'])
    }
  ]
] as const;

type KeysOfUnion<T> = T extends unknown ? keyof T : never;
type Field = KeysOfUnion<(typeof SECTIONS)[number][1]>;
export type DiagnosticsFields = Record<Field, string | number | null | undefined>;
type DiagnosticsLog = { at: number; level: string; msg: string; ctx?: Record<string, unknown> | undefined };

function timestamp(value: string | undefined): boolean {
  if (!value || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)) return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}

function matches(pattern: RegExp, text: string): boolean {
  const matched = pattern.exec(text)?.[0] === text;
  return matched && (pattern !== NUMBER || String(Number(text)) === text);
}

function formatLog({ at, level, msg, ctx }: DiagnosticsLog): string {
  const date = new Date(at);
  const prefix = [
    Number.isFinite(date.getTime()) && timestamp(date.toISOString()) ? date.toISOString() : UNAVAILABLE,
    LEVELS.includes(level) ? level : UNAVAILABLE
  ];
  if (!EVENTS.some((event) => event === msg)) return [...prefix, WITHHELD].join(' ');
  const details = METRICS.flatMap((key) => {
    const value = ctx?.[key];
    return typeof value === 'number' && Number.isFinite(value) ? [`${key}=${value}`] : [];
  });
  if (msg === DIAGNOSTICS_JOIN_EVENT) {
    const stage = JOIN_STAGES.find((value) => value === ctx?.stage);
    const outcome = JOIN_OUTCOMES.find((value) => value === ctx?.outcome);
    if (stage) details.push('stage=' + stage);
    if (outcome) details.push('outcome=' + outcome);
  }
  return [...prefix, msg, ...details].join(' ');
}

const sectionLines = SECTIONS.flatMap(([heading, fields]) => [
  { prefix: '', label: '', pattern: null },
  { prefix: heading, label: '', pattern: null },
  ...Object.entries(fields).map(([label, pattern]) => ({ prefix: label + ': ', label, pattern }))
]);

export function formatDiagnosticsReport(at: Date, fields: DiagnosticsFields, logs: readonly DiagnosticsLog[]): string {
  const values: Record<string, string | number | null | undefined> = fields;
  const lines = sectionLines.map(({ prefix, label, pattern }) => {
    if (!pattern) return prefix;
    const value = String(values[label] ?? '');
    return prefix + (matches(pattern, value) ? value : UNAVAILABLE);
  });
  return [
    TITLE,
    at.toISOString(),
    ...lines,
    '',
    LOG_SECTION,
    ...(logs.length ? logs.slice(-DIAGNOSTICS_LOG_LIMIT).map(formatLog) : [UNAVAILABLE]),
    ''
  ].join('\n');
}

const metricPatterns = METRICS.map((metric) => `(?: ${metric}=(${NUMBER.source.slice(1, -1)}))?`).join('');
const eventPatterns = EVENTS.map((event) => {
  const join =
    event === DIAGNOSTICS_JOIN_EVENT
      ? `(?: stage=(?:${JOIN_STAGES.join('|')}))?(?: outcome=(?:${JOIN_OUTCOMES.join('|')}))?`
      : '';
  return new RegExp(`^${event}${metricPatterns}${join}$`);
});

function validLog(line: string): boolean {
  const [at, level] = line.split(' ', 2);
  if (!at || !level || (at !== UNAVAILABLE && !timestamp(at)) || !LEVELS.includes(level)) return false;
  const detail = line.slice(at.length + level.length + 2);
  if (detail === WITHHELD) return true;
  for (const pattern of eventPatterns) {
    const match = pattern.exec(detail);
    if (match?.[0] === detail) {
      return match.slice(1).every((value) => value === undefined || String(Number(value)) === value);
    }
  }
  return false;
}

export function isDiagnosticsReport(text: string): boolean {
  const [title, at, ...lines] = text.split('\n');
  if (title !== TITLE || !timestamp(at)) return false;
  for (const { prefix, pattern } of sectionLines) {
    const line = lines.shift();
    if (!pattern) {
      if (line !== prefix) return false;
      continue;
    }
    if (!line?.startsWith(prefix)) return false;
    const value = line.slice(prefix.length);
    if (value !== UNAVAILABLE && !matches(pattern, value)) return false;
  }
  if (lines.shift() !== '' || lines.shift() !== LOG_SECTION || lines.pop() !== '') return false;
  return (
    (lines.length === 1 && lines[0] === UNAVAILABLE) ||
    (lines.length > 0 && lines.length <= DIAGNOSTICS_LOG_LIMIT && lines.every(validLog))
  );
}
