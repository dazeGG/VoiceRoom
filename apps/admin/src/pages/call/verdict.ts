// What a person's minutes in a call say about why their voice went as it did.
// Worked out here from the numbers, never stored: it is a reading of them, so it
// names what it looks like and never claims more. The computer is blamed only
// where the bad minutes fall on its overload with a normal network; the network
// where the round trip or the losses went up; the retranslator where the route
// through it stands out; a delay where a person's voice took too long to arrive;
// otherwise the voice was fine, or nothing more can be said. The lines it reads
// against are the ones the room is judged by (voice-quality.ts, network-quality.ts).

import type { VoiceMinute, VoiceMinuteHeard } from '@voice-room/shared/contracts/admin';
import { CONCEALMENT_THRESHOLDS, NETWORK_THRESHOLDS } from '@voice-room/shared/network-quality';
import { VOICE_CODEC_DELAY_MS, VOICE_THRESHOLDS } from '@voice-room/shared/voice-quality';

export const RTT_LIMIT_MS = NETWORK_THRESHOLDS.unstable.rttMs;
export const LOSS_LIMIT_PCT = NETWORK_THRESHOLDS.unstable.lossPct;
export const CONCEALED_LIMIT_PCT = CONCEALMENT_THRESHOLDS.noticeablePct;
export const DELAY_LIMIT_MS = VOICE_THRESHOLDS.unstable.mouthToEarMs;

/** How long one stats poll covers. */
export const POLL_SECONDS = 3;

export type VerdictTone = 'success' | 'warning' | 'danger' | 'neutral';

export interface Verdict {
  title: string;
  text: string;
  tone: VerdictTone;
}

const average = (values: readonly number[]) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

const known = (values: readonly (number | null | undefined)[]) =>
  values.filter((value): value is number => typeof value === 'number');

const worseThan = (minute: VoiceMinute) => minute.level === 'bad' || minute.level === 'unstable';

const networkBad = (minute: VoiceMinute) =>
  (minute.rttMs ?? 0) >= RTT_LIMIT_MS || (minute.uplinkLossPct ?? 0) >= LOSS_LIMIT_PCT;

/**
 * About how long a person's voice took to reach the others: its round trip,
 * taken for both sides' halves, the jitter buffer and the codec; null without
 * both numbers. The server reads the real two sides, this minute only has one.
 */
export function delayOf(minute: Pick<VoiceMinute, 'jitterBufferMs' | 'rttMs'>): number | null {
  if (minute.rttMs === null || minute.jitterBufferMs === null) return null;
  return minute.rttMs + minute.jitterBufferMs + VOICE_CODEC_DELAY_MS;
}

/** What the server gave for the minute's polls; its numbers only for a minute from before those were kept. */
const delayed = (minute: VoiceMinute) => {
  const causes = minute.causes;
  if (causes) return causes.delay > 0 && causes.delay * 2 >= causes.delay + causes.heard_badly + causes.hears_badly;
  return (delayOf(minute) ?? 0) >= DELAY_LIMIT_MS;
};

/** From this share of a call's polls short troubles are worth a word of their own, though no minute was coloured. */
const BRIEF_TROUBLE_SHARE = 0.1;

export function verdictOf(minutes: readonly VoiceMinute[]): Verdict {
  const judged = minutes.filter((minute) => minute.level !== null);
  if (judged.length === 0) {
    return { title: 'Нет данных о связи', text: 'Клиент не присылал статистику за этот звонок.', tone: 'neutral' };
  }
  const troubled = judged.filter(worseThan);
  if (troubled.length === 0) {
    const brief = judged.reduce((sum, minute) => sum + minute.polls.unstable + minute.polls.bad, 0);
    const all = judged.reduce((sum, minute) => sum + minute.polls.good + minute.polls.unstable + minute.polls.bad, 0);
    if (brief > 0 && brief >= all * BRIEF_TROUBLE_SHARE) {
      return {
        title: 'Были повторяющиеся сбои',
        text: `Каждый короткий, но вместе ${brief * POLL_SECONDS} с из ${all * POLL_SECONDS} с: на слух это заметно.`,
        tone: 'warning'
      };
    }
    return {
      title: 'Голос в порядке',
      text: brief
        ? `Были отдельные короткие сбои, всего ${brief * POLL_SECONDS} с за звонок.`
        : 'Связь была ровной весь звонок.',
      tone: 'success'
    };
  }

  const bad = troubled.filter((minute) => minute.level === 'bad');
  const onCritical = troubled.filter((minute) => minute.cpuPressure === 'critical');
  const onNetwork = troubled.filter(networkBad);
  const onRelay = troubled.filter((minute) => minute.transport === 'relay' || minute.transport === 'tcp');
  const onDelay = troubled.filter(delayed);
  const systemPct = average(known(onCritical.map((minute) => minute.cpuSystemPct)));
  const appPct = average(known(onCritical.map((minute) => minute.cpuAppPct)));
  const load =
    systemPct === null || appPct === null
      ? ''
      : ` Система занята на ${Math.round(systemPct)} %, сам VoiceRoom брал ${Math.round(appPct)} %.`;

  // Most of the trouble falls on the overload, and the network was not the reason.
  if (onCritical.length * 2 >= troubled.length && onNetwork.length * 2 < troubled.length) {
    return {
      title: 'Похоже, перегружен процессор',
      text: `Плохие минуты совпадают с перегрузкой компьютера, сеть при этом ровная: задержка не растёт.${load}`,
      tone: 'warning'
    };
  }
  if (onNetwork.length * 2 >= troubled.length) {
    if (onCritical.length * 2 >= troubled.length) {
      return {
        title: 'Плохая сеть и загруженный процессор',
        text: `Задержка или потери вышли за норму, и компьютер в эти же минуты был перегружен.${load}`,
        tone: 'danger'
      };
    }
    return {
      title: 'Плохая сеть',
      text: 'В минуты с плохой связью задержка или потери выходили за норму.',
      tone: bad.length ? 'danger' : 'warning'
    };
  }
  if (onRelay.length * 2 >= troubled.length) {
    return {
      title: 'Связь шла через ретранслятор',
      text: 'Прямой путь к серверу был закрыт: большая часть плохих минут пришлась на TURN или TCP.',
      tone: 'warning'
    };
  }
  if (onDelay.length * 2 >= troubled.length) {
    const rtt = average(known(onDelay.map((minute) => minute.rttMs)));
    const buffer = average(known(onDelay.map((minute) => minute.jitterBufferMs)));
    const parts =
      rtt === null || buffer === null ? '' : ` Из них пинг ${Math.round(rtt)} мс, буфер ${Math.round(buffer)} мс.`;
    return {
      title: 'Большая задержка голоса',
      text: `Голос доходил дольше ${DELAY_LIMIT_MS} мс, собеседники могут перебивать друг друга.${parts} Большой буфер значит, что пакеты приходили неровно.`,
      tone: 'warning'
    };
  }
  return {
    title: bad.length ? 'Были плохие минуты' : 'Были нестабильные минуты',
    text: 'В самом звуке были разрывы, а пинг, потери и процессор в норме: пакеты могли опаздывать к воспроизведению. Точнее по этим числам не сказать.',
    tone: bad.length ? 'danger' : 'warning'
  };
}

export interface Series {
  avg: number | null;
  peak: number | null;
}

export function seriesOf(values: readonly (number | null | undefined)[]): Series {
  const numbers = known(values);
  return { avg: average(numbers), peak: numbers.length ? Math.max(...numbers) : null };
}

export interface HeardSummary {
  /** Over all the speech: a minute with a minute of speech counts for more than one with three seconds. */
  concealedPct: number;
  /** The worst 15 seconds of any one speaker; the minute's own number where it was not kept. */
  worstConcealedPct: number;
  /** The most gaps in those 15 seconds; null where it was not kept. */
  worstGaps: number | null;
}

/**
 * A minute's worst of a side: its worst window, or its own number where that is
 * higher, as for speakers who never said enough in one window to judge it by.
 */
export const worstOf = (side: VoiceMinuteHeard | null | undefined) =>
  side ? Math.max(side.worstConcealedPct ?? 0, side.concealedPct) : null;

/** One side of a person's voice over their minutes; null with too little speech in any of them. */
export function heardSummary(sides: readonly (VoiceMinuteHeard | null | undefined)[]): HeardSummary | null {
  const heard = sides.filter((side): side is VoiceMinuteHeard => Boolean(side));
  if (heard.length === 0) return null;
  const weight = (side: VoiceMinuteHeard) => side.speechS ?? 1;
  const total = heard.reduce((sum, side) => sum + weight(side), 0);
  const gaps = known(heard.map((side) => side.worstGaps));
  return {
    concealedPct: heard.reduce((sum, side) => sum + side.concealedPct * weight(side), 0) / Math.max(1, total),
    worstConcealedPct: Math.max(...known(heard.map(worstOf))),
    worstGaps: gaps.length ? Math.max(...gaps) : null
  };
}

/** How long the person's trouble lasted in a minute. */
export function troubleSeconds(polls: VoiceMinute['polls']): number {
  return (polls.unstable + polls.bad) * POLL_SECONDS;
}
