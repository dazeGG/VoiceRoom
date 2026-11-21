import type { RoomCall, VoiceMinute, VoiceQuality } from '@voice-room/shared/contracts/admin';

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
