// How a voice went on one line: the share of its minutes that were good,
// unstable and bad. A minute nothing is known of counts for nothing here.

import type { RoomCall, VoiceMinute, VoiceQuality } from '@voice-room/shared/contracts/admin';
import './QualityBar.css';

/** From this share of bad minutes a line asks for attention. */
export const BAD_SHARE_ALARM_PCT = 8;

export function qualityOfMinutes(minutes: readonly Pick<VoiceMinute, 'level'>[]): VoiceQuality | null {
  const quality = { good: 0, unstable: 0, bad: 0 };
  for (const { level } of minutes) if (level) quality[level] += 1;
  return quality.good + quality.unstable + quality.bad > 0 ? quality : null;
}

export const qualityOfCall = (call: Pick<RoomCall, 'stays'>) =>
  qualityOfMinutes(call.stays.flatMap((stay) => stay.minutes ?? []));

export function qualityShares({ good, unstable, bad }: VoiceQuality): VoiceQuality {
  const total = Math.max(1, good + unstable + bad);
  const share = (minutes: number) => Math.round((minutes / total) * 100);
  return { good: share(good), unstable: share(unstable), bad: share(bad) };
}

/** "10% плохих минут", or the unstable ones where none was bad. */
export function qualityShort(quality: VoiceQuality): string {
  const { unstable, bad } = qualityShares(quality);
  if (bad) return `${bad}% плохих минут`;
  return unstable ? `${unstable}% нестабильных` : 'связь в порядке';
}

/** "90% в порядке · 2% плохо". */
export function qualityLong(quality: VoiceQuality): string {
  const { good, bad } = qualityShares(quality);
  return bad ? `${good}% в порядке · ${bad}% плохо` : `${good}% в порядке`;
}

export const qualityAlarming = (quality: VoiceQuality) => qualityShares(quality).bad >= BAD_SHARE_ALARM_PCT;

export function QualityBar({ quality, height = 6 }: { quality: VoiceQuality; height?: number }) {
  const { good, unstable, bad } = qualityShares(quality);
  return (
    <span
      className="quality-bar"
      role="img"
      aria-label={`Минуты связи: в порядке ${good}%, нестабильно ${unstable}%, плохо ${bad}%`}
      style={{ height }}
    >
      {quality.good ? <span data-net="good" style={{ flexGrow: quality.good }} /> : null}
      {quality.unstable ? <span data-net="unstable" style={{ flexGrow: quality.unstable }} /> : null}
      {quality.bad ? <span data-net="bad" style={{ flexGrow: quality.bad }} /> : null}
    </span>
  );
}

/** The bar with its line under it; `long` says the good share too. */
export function QualityCell({
  quality,
  long = false,
  none = 'нет данных'
}: {
  quality: VoiceQuality | null;
  long?: boolean;
  none?: string;
}) {
  if (!quality) return <span className="quality-none">{none}</span>;
  return (
    <span className="quality-cell">
      <QualityBar quality={quality} />
      <span className="quality-text" data-alarm={qualityAlarming(quality)}>
        {long ? qualityLong(quality) : qualityShort(quality)}
      </span>
    </span>
  );
}
