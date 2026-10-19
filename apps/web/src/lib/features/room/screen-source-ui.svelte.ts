import type { DesktopCaptureSource } from './client/core/types';

interface ScreenSourceUiState {
  open: boolean;
  sources: DesktopCaptureSource[];
  tab: 'screens' | 'windows';
  selectedSourceId: string | null;
  mode: 'games' | 'text';
  quality: 'balanced' | 'high';
  fps: '30' | '60';
  audio: boolean;
  popOpen: boolean;
}

export const screenSourceUi = $state<ScreenSourceUiState>({
  open: false,
  sources: [],
  tab: 'screens',
  selectedSourceId: null,
  mode: 'games',
  quality: 'balanced',
  fps: '30',
  audio: true,
  popOpen: false
});
