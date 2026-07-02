import type { DesktopCaptureSource } from './client/core/types';

export const screenSourceUi = $state({
  open: false,
  sources: [] as DesktopCaptureSource[],
  tab: 'screens' as 'screens' | 'windows',
  selectedSourceId: null as string | null,
  mode: 'games' as 'games' | 'text',
  quality: 'balanced' as 'balanced' | 'high',
  audio: true,
  popOpen: false,
});
