import { defineStore } from 'pinia';
import { markRaw, ref } from 'vue';
import { consumeOwnerLink, createMeetApi } from '@/adapters/meet-api';
import { createMeetIdentity } from '@/adapters/meet-identity';
import { createMeetTransport } from '@/adapters/meet-transport';

export const useMeetStore = defineStore('meet', () => {
  const api = createMeetApi();
  const identity = createMeetIdentity();
  const transport = markRaw(createMeetTransport(api));
  const owner = ref<'guest' | 'checking' | 'ready' | 'rejected'>('guest');

  async function exchangeOwnerLink(): Promise<void> {
    const token = consumeOwnerLink();
    if (!token) return;
    owner.value = 'checking';
    try {
      await api.exchangeOwnerLink(token);
      owner.value = 'ready';
    } catch {
      owner.value = 'rejected';
    }
  }

  return { api, identity, transport, owner, exchangeOwnerLink };
});
