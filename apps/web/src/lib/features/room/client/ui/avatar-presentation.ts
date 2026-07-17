import { getAvatarColor } from '$lib/visual/tokens';
import { getInitials } from '../core/utils';
import type { Participant } from '../core/types';

export function getAvatarPresentation(
  participant: Pick<Participant, 'avatarColorKey' | 'name' | 'isLocal'> &
    Partial<Pick<Participant, 'avatarAccent' | 'avatarUrl'>>
): {
  background: string;
  foreground: string;
  shadow: string;
  initials: string;
  label: string;
  src: string | null;
} {
  const accent = typeof participant.avatarAccent === 'string' && /^#[0-9a-f]{6}$/i.test(participant.avatarAccent)
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
    initials: getInitials(participant.name),
    label: participant.isLocal ? 'вы' : participant.name,
    src: participant.avatarUrl || null
  };
}
