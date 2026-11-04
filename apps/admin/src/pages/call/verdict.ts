// What a person's minutes in a call say about why their voice went as it did.
// Worked out here from the numbers, never stored: it is a reading of them, so it
// names what it looks like and never claims more. The computer is blamed only
// where the bad minutes fall on its overload with a normal network; the network
// where the round trip or the losses went up; the retranslator where the route
// through it stands out; otherwise the voice was fine, or nothing can be said.

import type { VoiceMinute } from '@voice-room/shared/contracts/admin';

export const RTT_LIMIT_MS = 150;
export const LOSS_LIMIT_PCT = 5;
export const CONCEALED_LIMIT_PCT = 10;

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

export function verdictOf(minutes: readonly VoiceMinute[]): Verdict {
  const judged = minutes.filter((minute) => minute.level !== null);
  if (judged.length === 0) {
    return { title: 'Нет данных о связи', text: 'Клиент не присылал статистику за этот звонок.', tone: 'neutral' };
  }
  const troubled = judged.filter(worseThan);
  if (troubled.length === 0) {
    return { title: 'Голос в порядке', text: 'Связь была ровной весь звонок.', tone: 'success' };
  }

  const bad = troubled.filter((minute) => minute.level === 'bad');
  const onCritical = troubled.filter((minute) => minute.cpuPressure === 'critical');
  const onNetwork = troubled.filter(networkBad);
  const onRelay = troubled.filter((minute) => minute.transport === 'relay' || minute.transport === 'tcp');
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
  return {
    title: bad.length ? 'Были плохие минуты' : 'Были нестабильные минуты',
    text: 'Сеть и процессор в эти минуты в норме: причину по этим числам не определить.',
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
