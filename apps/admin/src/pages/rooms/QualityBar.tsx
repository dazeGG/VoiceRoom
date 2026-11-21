// How a voice went on one line: the share of its minutes that were good,
// unstable and bad. A minute nothing is known of counts for nothing here.

import type { VoiceQuality } from '@voice-room/shared/contracts/admin';
import { qualityAlarming, qualityLong, qualityShares, qualityShort } from './quality.ts';
import './QualityBar.css';

export {
  BAD_SHARE_ALARM_PCT,
  qualityAlarming,
  qualityLong,
  qualityOfCall,
  qualityOfMinutes,
  qualityShares,
  qualityShort
} from './quality.ts';

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
