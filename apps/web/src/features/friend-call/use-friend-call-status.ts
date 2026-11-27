import { computed } from 'vue';
import { formatCallClock, useCallClock } from '@voiceroom/ui-kit/components';
import type { CallSnapshot } from '@voiceroom/shared/contracts/rings';
import { t } from '@/shared/i18n';

export interface FriendCallStatus {
  ringing: boolean;
  noAnswer: boolean;
  declined: boolean;
  deadline: number | undefined;
  subtitle: string;
  timed: boolean;
}

export function useFriendCallStatus(record: () => { call: CallSnapshot; offset: number } | undefined) {
  const ringClock = useCallClock(() => {
    const current = record();
    if (current?.call.phase === 'ringing') return current.call.ringingExpiresAt + current.offset;
  }, 'until');
  const elapsed = useCallClock(() => {
    const current = record();
    if (current && current.call.phase !== 'ringing' && current.call.phase !== 'closed') {
      return (current.call.firstConnectedAt ?? current.call.startedAt) + current.offset;
    }
  }, 'since');

  return computed<FriendCallStatus | undefined>(() => {
    const current = record();
    if (!current) return undefined;
    const { call, offset } = current;
    const ringing = call.phase === 'ringing' && ringClock.value > 0;
    const noAnswer = call.attemptResult === 'no_answer' || (call.phase === 'ringing' && !ringing);
    const declined = call.phase === 'closed' && call.endReason === 'declined';
    const reconnecting = call.seats?.some((seat) => seat.status === 'reconnecting');
    const timed = !noAnswer && !reconnecting && (call.phase === 'connected' || call.phase === 'alone');
    let subtitle = t('Подключаемся…');
    if (declined) subtitle = t('Звонок отклонён');
    else if (ringing) subtitle = t('Звоним…');
    else if (noAnswer) subtitle = t('Нет ответа');
    else if (reconnecting) subtitle = t('Переподключаемся…');
    else if (timed)
      subtitle = t('в звонке · {time}', { time: formatCallClock(Math.floor(elapsed.value / 1000), true) });
    return {
      ringing,
      noAnswer,
      declined,
      subtitle,
      timed,
      deadline: !ringing && !declined && call.aloneDeadline !== null ? call.aloneDeadline + offset : undefined
    };
  });
}
