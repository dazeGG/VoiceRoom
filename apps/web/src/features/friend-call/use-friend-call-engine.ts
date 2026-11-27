import { watch } from 'vue';
import { t } from '@/shared/i18n';
import { useToastsStore } from '@/features/home/model/toasts.store';
import { callPeer, useFriendCallStore } from './friend-call.store';

/** Mount at the signed-in shell. The view may come and go while this owns voice. */
export function useFriendCallEngine(): void {
  const calls = useFriendCallStore();
  const toasts = useToastsStore();
  watch(
    () => calls.voice,
    (seat, _, onCleanup) => {
      if (!seat) return;
      let disposed = false;
      let unmount: (() => void) | undefined;
      onCleanup(() => {
        disposed = true;
        unmount?.();
      });
      void import('@voiceroom/call/engine/main').then(({ mountRoomClient }) => {
        const { callId, roomId, peerId, seatToken } = seat;
        const call = calls.record(callId)?.call;
        if (disposed || !call) return;
        unmount = mountRoomClient(document, {
          roomId,
          embedded: true,
          friendCall: {
            callId,
            initiator: call.caller.id === calls.userId,
            name: callPeer(call, calls.userId).displayName,
            session: { peerId, sessionToken: seatToken },
            onMissingMicrophone: () =>
              toasts.pushToast(t('Не удалось включить микрофон'), {
                variant: 'error',
                description: t('Разрешите доступ к микрофону в браузере')
              }),
            onJoinFailed: () => void calls.leave()
          }
        });
      });
    },
    { flush: 'post' }
  );
}
