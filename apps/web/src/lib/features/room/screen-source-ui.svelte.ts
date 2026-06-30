import type { DesktopCaptureSource } from './client/core/types';

export const screenSourceUi = $state({
  open: false,
  sources: [] as DesktopCaptureSource[]
});