// A stay's network on a bar: its client's own judgement over time, green while
// good, yellow while unstable, red while bad, grey where it never said (stays
// from before clients reported it, or a client that cannot).

import type { CSSProperties } from 'react';
import type { NetworkLevel, NetworkPoint } from '@voice-room/shared/contracts/rooms';
import { formatClock } from '../../format.ts';
import './network-bar.css';

export const NETWORK_LABELS: Record<NetworkLevel, string> = {
  good: 'сеть в порядке',
  unstable: 'сеть нестабильна',
  bad: 'сеть плохая'
};
const UNKNOWN_LABEL = 'нет данных о сети';

/** The first report comes a few stats polls after joining; a gap that short takes its level. */
export const FIRST_REPORT_GRACE_MS = 30_000;

export interface NetworkStretch {
  from: number;
  to: number;
  /** Null where the client had not said. */
  level: NetworkLevel | null;
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

const describe = (stretch: NetworkStretch) =>
  `${formatClock(stretch.from)}–${formatClock(stretch.to)} · ${stretch.level ? NETWORK_LABELS[stretch.level] : UNKNOWN_LABEL}`;

/** One stay on its call bar, coloured stretch by stretch. */
export function NetworkSpan({
  from,
  to,
  points,
  style
}: {
  from: number;
  to: number;
  points: readonly NetworkPoint[];
  style?: CSSProperties;
}) {
  const stretches = networkStretches({ from, to }, points);
  return (
    <span className="net-span" style={style}>
      {stretches.map((stretch) => (
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

/** A description of a stay's network for a screen reader. */
export const describeNetwork = (span: { from: number; to: number }, points: readonly NetworkPoint[]) =>
  networkStretches(span, points).map(describe).join(', ');
