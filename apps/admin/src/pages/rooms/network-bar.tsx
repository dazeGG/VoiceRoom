// A stay's voice on a bar: green while good, yellow while unstable, red while
// bad, grey where nothing is known. A stay since the server judged the room
// has a row per minute it sent stats in (VoiceMinute), each with its numbers in
// the tooltip, and a missing minute is grey. Older stays carry their client's
// own changes of level (NetworkPoint).

import type { CSSProperties } from 'react';
import type { VoiceMinute } from '@voice-room/shared/contracts/admin';
import type { NetworkLevel, NetworkPoint, VoiceCause } from '@voice-room/shared/contracts/rooms';
import { formatClock, formatCount, formatMs, formatPercent } from '../../format.ts';
import './network-bar.css';

export const NETWORK_LABELS: Record<NetworkLevel, string> = {
  good: 'голос в порядке',
  unstable: 'голос нестабилен',
  bad: 'плохая связь'
};
const UNKNOWN_LABEL = 'нет данных';

/** Whose side the trouble is on, as the live call names it. */
export const CAUSE_LABELS: Record<VoiceCause, string> = {
  heard_badly: 'его плохо слышно',
  hears_badly: 'плохо слышит других',
  delay: 'большая задержка'
};

/** The first report comes a few stats polls after joining; a gap that short takes its level. */
export const FIRST_REPORT_GRACE_MS = 30_000;
const MINUTE_MS = 60_000;

export interface NetworkStretch {
  from: number;
  to: number;
  /** Null where nothing is known. */
  level: NetworkLevel | null;
  /** The minute it shows, for a stay with minutes. */
  minute?: VoiceMinute;
}

/** What a stay says of its voice: its minutes, or the changes its client reported before. */
export interface StayVoice {
  network?: readonly NetworkPoint[] | undefined;
  minutes?: readonly VoiceMinute[] | undefined;
}

/** The stretches of one level that make up a stay from `from` to `to`, in order and without gaps. */
export function networkStretches(
  span: { from: number; to: number },
  points: readonly NetworkPoint[]
): NetworkStretch[] {
  const stretches: NetworkStretch[] = [];
  const push = (from: number, to: number, level: NetworkLevel | null) => {
    if (to <= from) return;
    const last = stretches.at(-1);
    if (last && last.level === level) last.to = to;
    else stretches.push({ from, to, level });
  };
  let at = span.from;
  let level: NetworkLevel | null = null;
  points.forEach((point, index) => {
    const change = Math.min(Math.max(point.at, span.from), span.to);
    if (index === 0 && change - span.from <= FIRST_REPORT_GRACE_MS) {
      level = point.level;
      return;
    }
    push(at, change, level);
    at = Math.max(at, change);
    level = point.level;
  });
  push(at, span.to, level);
  return stretches.length ? stretches : [{ from: span.from, to: Math.max(span.to, span.from), level: null }];
}

/** A stretch per minute of the stay, cut to its span, and a grey one for each run of minutes without stats. */
export function minuteStretches(span: { from: number; to: number }, minutes: readonly VoiceMinute[]): NetworkStretch[] {
  const stretches: NetworkStretch[] = [];
  let at = span.from;
  for (const minute of minutes) {
    const from = Math.max(minute.at, at);
    const to = Math.min(minute.at + MINUTE_MS, span.to);
    if (to <= from) continue;
    if (from > at) stretches.push({ from: at, to: from, level: null });
    stretches.push({ from, to, level: minute.level, minute });
    at = to;
  }
  if (span.to > at) stretches.push({ from: at, to: span.to, level: null });
  return stretches.length ? stretches : [{ from: span.from, to: Math.max(span.to, span.from), level: null }];
}

export const stayStretches = (span: { from: number; to: number }, voice: StayVoice): NetworkStretch[] =>
  voice.minutes?.length ? minuteStretches(span, voice.minutes) : networkStretches(span, voice.network ?? []);

const TRANSPORT_LABELS: Record<string, string> = { relay: 'через ретранслятор', tcp: 'через TCP' };

/** A minute's numbers: what the person heard, how they were heard, their uplink, ping, buffer and route. */
function minuteDetails(minute: VoiceMinute): string[] {
  const parts: string[] = [];
  if (minute.heard) {
    parts.push(
      `слышал других: пропуски ${formatPercent(minute.heard.concealedPct)}, ${formatCount(minute.heard.gapsPerMin)} разрывов/мин`
    );
  }
  if (minute.heardBy) {
    parts.push(
      `его слышали: пропуски ${formatPercent(minute.heardBy.concealedPct)}, ${formatCount(minute.heardBy.gapsPerMin)} разрывов/мин`
    );
  }
  if (minute.uplinkLossPct !== null) parts.push(`потери от него ${formatPercent(minute.uplinkLossPct)}`);
  if (minute.rttMs !== null) parts.push(`пинг ${formatMs(minute.rttMs)}`);
  if (minute.jitterBufferMs !== null) parts.push(`буфер ${formatMs(minute.jitterBufferMs)}`);
  const transport = minute.transport ? TRANSPORT_LABELS[minute.transport] : undefined;
  if (transport) parts.push(transport);
  return parts;
}

const describe = (stretch: NetworkStretch) =>
  [
    `${formatClock(stretch.from)}–${formatClock(stretch.to)}`,
    stretch.level ? NETWORK_LABELS[stretch.level] : UNKNOWN_LABEL,
    ...(stretch.minute ? minuteDetails(stretch.minute) : [])
  ].join(' · ');

/** One stay on its call bar, coloured stretch by stretch. */
export function NetworkSpan({
  from,
  to,
  voice,
  style
}: {
  from: number;
  to: number;
  voice: StayVoice;
  style?: CSSProperties;
}) {
  return (
    <span className="net-span" style={style}>
      {stayStretches({ from, to }, voice).map((stretch) => (
        <span
          key={stretch.from}
          className="net-stretch"
          data-net={stretch.level ?? 'unknown'}
          title={describe(stretch)}
          style={{ flexGrow: Math.max(1, stretch.to - stretch.from) }}
        />
      ))}
    </span>
  );
}

/** What the colours mean. */
export function NetworkLegend() {
  return (
    <span className="net-legend">
      {(['good', 'unstable', 'bad', 'unknown'] as const).map((level) => (
        <span key={level} className="net-legend-item">
          <span className="net-dot" data-net={level} aria-hidden="true" />
          {level === 'unknown' ? UNKNOWN_LABEL : NETWORK_LABELS[level]}
        </span>
      ))}
    </span>
  );
}

/** A description of a stay's voice for a screen reader: the level of each stretch. */
export const describeNetwork = (span: { from: number; to: number }, voice: StayVoice) =>
  stayStretches(span, voice)
    .map(
      (stretch) =>
        `${formatClock(stretch.from)}–${formatClock(stretch.to)} · ${stretch.level ? NETWORK_LABELS[stretch.level] : UNKNOWN_LABEL}`
    )
    .join(', ');
