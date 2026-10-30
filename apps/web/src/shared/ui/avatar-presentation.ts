import { getAvatarColor } from '@/visual/tokens';
import { avatarInitial } from '@/shared/utils/avatar-initial';

export function getAvatarPresentation(participant: {
  avatarColorKey: string;
  name: string;
  isLocal: boolean;
  avatarAccent?: string | undefined;
  avatarUrl?: string | undefined;
}): {
  background: string;
  foreground: string;
  shadow: string;
  initials: string;
  label: string;
  src: string | null;
} {
  const accent =
    typeof participant.avatarAccent === 'string' && /^#[0-9a-f]{6}$/i.test(participant.avatarAccent)
      ? participant.avatarAccent
      : null;

  let background: string;
  let foreground: string;
  if (accent) {
    background = accent;
    foreground = '#ffffff';
  } else {
    const palette = getAvatarColor(participant.avatarColorKey);
    background = palette.background;
    foreground = palette.foreground;
  }

  return {
    background,
    foreground,
    shadow: 'none',
    initials: avatarInitial(participant.name || 'Гость'),
    label: participant.isLocal ? 'вы' : participant.name,
    src: participant.avatarUrl || null
  };
}
