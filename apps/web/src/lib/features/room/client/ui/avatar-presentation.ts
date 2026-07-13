import { getAvatarColor } from '$lib/visual/tokens';
import { getInitials } from '../core/utils';
import type { Participant } from '../core/types';

export function getAvatarPresentation(
  participant: Pick<Participant, 'avatarColorKey' | 'name' | 'isLocal'> &
    Partial<Pick<Participant, 'accountUserId' | 'avatarAccent' | 'avatarUrl' | 'id'>>
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
    const identity = participant.accountUserId || participant.id || `${participant.avatarColorKey}:${participant.name}`;
    let hash = 2166136261;
    for (const character of identity) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
    const hue = Math.abs(hash >>> 0) % 360;
    const lightness = 48 + ((hash >>> 9) % 9);
    const chroma = 0.13 + ((hash >>> 17) % 5) * 0.012;
    const uniqueAccent = `oklch(${lightness}% ${chroma.toFixed(3)} ${hue})`;
    background = `color-mix(in oklch, ${palette.background} 54%, ${uniqueAccent})`;
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
