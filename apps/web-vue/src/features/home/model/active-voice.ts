// The call this device is in, as the sidebar's call card shows and drives it.

export interface ActiveVoice {
  roomName: string;
  avatarUrl: string | null;
  muted: boolean;
  deafened: boolean;
  open: () => void;
  toggleMic: () => void;
  toggleDeafen: () => void;
  leave: () => void;
}
