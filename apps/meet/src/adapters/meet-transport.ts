import type { CallTransport } from '@voiceroom/call/engine/transport';
import { createGuestTransport } from '@voiceroom/call/guest';
import { MEET_CHAT_MAX_BYTES, type ServerEvents } from '@voiceroom/shared/contracts/realtime';
import type { RoomCapabilities } from '@voiceroom/shared/contracts/rooms';
import { computed, shallowRef, type Ref, type ShallowRef } from 'vue';
import { MeetApiError, meetErrorMessage, type MeetApi } from '@/adapters/meet-api';

const CHAT_HISTORY_LIMIT = 100;
const CHAT_REQUEST_PREFIX = 'meet-chat-';

export type MeetChatMessage = ServerEvents['meet.chat.message'];

export interface MeetTransport extends CallTransport {
  disconnect(): void;
  capabilities: Readonly<ShallowRef<RoomCapabilities | null>>;
  chat: {
    ready: Readonly<Ref<boolean>>;
    messages: Readonly<ShallowRef<readonly MeetChatMessage[]>>;
    error: Readonly<ShallowRef<string | null>>;
    send: (text: string) => boolean;
  };
}

export function createMeetTransport(
  api: Pick<MeetApi, 'status' | 'admit'>,
  socketOptions?: Parameters<typeof createGuestTransport>[2]
): MeetTransport {
  const messages = shallowRef<readonly MeetChatMessage[]>([]);
  const error = shallowRef<string | null>(null);
  let sequence = 0;
  const transport = createGuestTransport(
    '/api/meet/ws',
    {
      ...api,
      message: meetErrorMessage,
      failure: (error) => (error instanceof MeetApiError ? error : null),
      receiveHostFrame(frame, rosterAttached) {
        if (frame.type === 'meet.chat.message') {
          if (rosterAttached) messages.value = [...messages.value.slice(1 - CHAT_HISTORY_LIMIT), frame.payload];
          return true;
        }
        if (frame.type === 'error' && frame.id?.startsWith(CHAT_REQUEST_PREFIX)) {
          if (ready.value) error.value = frame.error.code;
          return true;
        }
        return false;
      },
      onLeave() {
        messages.value = [];
        error.value = null;
      }
    },
    socketOptions
  );
  const ready = computed(() => transport.rosterAttached.value && transport.capabilities.value?.chat === 'ephemeral');

  function send(text: string): boolean {
    text = text.trim();
    if (!ready.value || !text || new TextEncoder().encode(text).byteLength > MEET_CHAT_MAX_BYTES) return false;
    error.value = null;
    return transport.send({ id: `${CHAT_REQUEST_PREFIX}${++sequence}`, type: 'meet.chat.send', payload: { text } });
  }

  return { ...transport, chat: { ready, messages, error, send } };
}
