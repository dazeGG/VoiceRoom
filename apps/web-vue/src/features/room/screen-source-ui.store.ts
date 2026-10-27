import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { DesktopCaptureSource } from './client/core/types';

export const useScreenSourceUiStore = defineStore('screen-source-ui', () => {
  const open = ref(false);
  const sources = ref<DesktopCaptureSource[]>([]);
  const tab = ref<'screens' | 'windows'>('screens');
  const selectedSourceId = ref<string | null>(null);
  const mode = ref<'games' | 'text'>('games');
  const quality = ref<'balanced' | 'high'>('balanced');
  const fps = ref<'30' | '60'>('30');
  const audio = ref(true);
  const popOpen = ref(false);
  return { open, sources, tab, selectedSourceId, mode, quality, fps, audio, popOpen };
});
