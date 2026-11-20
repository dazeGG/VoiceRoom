import type { SelectOption } from '@voice-room/ui/components';

export interface CallAvatar {
  src: string | null;
  initials: string;
  background: string;
  foreground: string;
}

export type CallDevice = 'microphone' | 'output' | 'camera';

export interface CallDeviceSettings {
  microphoneId: string;
  outputDeviceId: string;
  cameraId: string;
  noiseMode: string;
  microphoneOptions: SelectOption[];
  outputOptions: SelectOption[];
  cameraOptions: SelectOption[];
  outputDisabled: boolean;
  microphoneVolume: number;
}
