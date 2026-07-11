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
  const palette = getAvatarColor(participant.avatarColorKey);
  const accent = typeof participant.avatarAccent === 'string' && /^#[0-9a-f]{6}$/i.test(participant.avatarAccent)
    ? participant.avatarAccent
    : null;
  return {
    background: accent || palette.background,
    foreground: accent ? '#ffffff' : palette.foreground,
    shadow: accent ? `0 14px 32px color-mix(in srgb, ${accent} 42%, transparent)` : palette.shadow,
    initials: getInitials(participant.name),
    label: participant.isLocal ? 'вы' : participant.name,
    src: participant.avatarUrl || null
  };
}
