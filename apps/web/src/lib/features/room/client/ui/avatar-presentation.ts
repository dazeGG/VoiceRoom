import { getAvatarColor } from '$lib/visual/tokens';
import { getInitials } from '../core/utils';
import type { Participant } from '../core/types';

export function getAvatarPresentation(
  participant: Pick<Participant, 'avatarColorKey' | 'name' | 'isLocal'>
): {
  background: string;
  foreground: string;
  shadow: string;
  initials: string;
  label: string;
} {
  const palette = getAvatarColor(participant.avatarColorKey);
  return {
    background: palette.background,
    foreground: palette.foreground,
    shadow: palette.shadow,
    initials: getInitials(participant.name),
    label: participant.isLocal ? 'вы' : participant.name
  };
}