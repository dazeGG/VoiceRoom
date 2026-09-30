import type { DesktopCaptureSource } from './client/core/types';

export const screenSourceUi = $state({
  open: false,
  sources: [] as DesktopCaptureSource[],
  tab: 'screens' as 'screens' | 'windows',
  selectedSourceId: null as string | null,
  mode: 'games' as 'games' | 'text',
  quality: 'balanced' as 'balanced' | 'high',
  fps: '30' as '30' | '60',
  audio: true,
  popOpen: false
});
