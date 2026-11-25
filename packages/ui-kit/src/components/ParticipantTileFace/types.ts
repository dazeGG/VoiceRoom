export interface ParticipantTileFaceProps {
  name: string;
  initials: string;
  avatarSrc?: string | null | undefined;
  local?: boolean | undefined;
  statusLabel?: string | undefined;
  state?: 'connected' | 'reconnecting' | 'absent' | undefined;
}
