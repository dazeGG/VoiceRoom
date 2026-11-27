import { computed } from 'vue';
import { clientRoomName, useVoiceSessionStore } from '@voiceroom/call/engine';
import { formatCallClock, useCallClock } from '@voiceroom/ui-kit/components';
import { t } from '@/shared/i18n';
import { useFriendCallStore } from './friend-call.store';

export type CallEntryMode = 'start' | 'return' | 'join';

export function useCallEntry(peerId: () => string | undefined, online: () => boolean) {
  const calls = useFriendCallStore();
  const voice = useVoiceSessionStore();
  const call = computed(() => calls.callForPeer(peerId() ?? ''));
  const mode = computed<CallEntryMode>(() => {
    if (!call.value) return 'start';
    return calls.voice?.callId === call.value.id ? 'return' : 'join';
  });
  const clock = useCallClock(() => {
    const current = call.value;
    const record = current && calls.record(current.id);
    return record && current.firstConnectedAt !== null ? current.firstConnectedAt + record.offset : undefined;
  }, 'since');

  return computed(() => {
    const id = peerId();
    const state = mode.value;
    const roomId = voice.roomId;
    const roomName = roomId && roomId !== calls.voice?.roomId ? clientRoomName(roomId) || roomId : '';
    const offline = state === 'start' && !online();
    const leaveRoom = state !== 'return' && roomName ? t('Вы покинете «{room}»', { room: roomName }) : '';
    const description = [leaveRoom, offline ? t('Не в сети. Звонок придёт уведомлением') : '']
      .filter(Boolean)
      .join(' ');
    const labels = {
      start: t('Позвонить'),
      return: t('Вернуться в звонок'),
      join: t('Присоединиться')
    };
    const label = labels[state];
    return {
      visible: Boolean(id && calls.enabled),
      disabled:
        Boolean(calls.busy) ||
        Boolean(
          state === 'join' && call.value?.phase === 'ringing' && call.value.attemptInviterUserId === calls.userId
        ),
      label,
      description: description || undefined,
      menuLabel: state === 'join' ? t('Присоединиться к звонку') : label,
      menuHint: [leaveRoom, offline ? t('не в сети') : ''].filter(Boolean).join(' · ') || undefined,
      accent: state !== 'start',
      mode: state,
      peerInCall: Boolean(call.value?.seats?.some((seat) => seat.userId === id && seat.status !== 'absent')),
      connectedCaption:
        state === 'return' && call.value?.phase === 'connected'
          ? t('В звонке · {time}', { time: formatCallClock(Math.floor(clock.value / 1000), true) })
          : '',
      open: () => (id ? calls.dial(id) : Promise.resolve())
    };
  });
}
