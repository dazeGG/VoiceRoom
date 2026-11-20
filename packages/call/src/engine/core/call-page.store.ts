import { defineStore } from 'pinia';
import { ref } from 'vue';
import { getCallPinia } from '../ports';

export type CallScreen = '' | 'start' | 'checking' | 'room' | 'entry-error' | 'not-found' | 'moderation';

export const useCallPageStore = defineStore('call-page', () => {
  const screen = ref<CallScreen>('');
  const screenView = ref(false);
  const stripCollapsed = ref(false);
  const stageSummary = ref<'' | 'hidden'>('');
  const desktopScreenFullscreen = ref(false);
  return { screen, screenView, stripCollapsed, stageSummary, desktopScreenFullscreen };
});

export function callPageState(): ReturnType<typeof useCallPageStore> {
  return useCallPageStore(getCallPinia());
}
