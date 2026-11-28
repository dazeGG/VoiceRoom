// The official account's avatar: the VoiceRoom brand icon, stored like any
// account's avatar (a content-addressed WebP in the uploads directory, its key
// on the account). The migration that creates the account runs where the
// uploads volume is not mounted, so the API writes the file once it starts.
// Saving it on every start also restores a file a fresh volume lost.

import { OFFICIAL_ACCOUNT_ID } from '@voiceroom/shared/official-account';
import { createAvatarKey, renderVectorAvatar } from '../../lib/avatar-processing.ts';

/** The same mark as apps/web/public/voiceroom-icon.svg; the API image does not ship the web app. */
export const BRAND_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" rx="26" fill="#080800"></rect>
  <path d="M20 38 L20 10 L41 29 L59 29 L80 10 L80 38 Q85 46 85 56 Q85 86 50 86 Q15 86 15 56 Q15 46 20 38 Z" fill="#c1f100"></path>
  <rect x="10" y="44" width="80" height="22" fill="#080800"></rect>
  <circle cx="38" cy="55" r="6.5" fill="#c1f100"></circle>
  <circle cx="62" cy="55" r="6.5" fill="#c1f100"></circle>
</svg>`;

export interface OfficialAvatarDeps {
  storage: { save(key: string, buffer: Buffer): Promise<unknown> };
  users: {
    getUserById(userId: string): Promise<{ avatarKey?: string | null } | null>;
    swapAvatar(input: { userId: string; avatarKey: string; avatarAccent: string }): Promise<unknown>;
  };
}

/** Writes the brand avatar and points the account at it; `missing` when the account does not exist. */
export async function ensureOfficialAvatar(deps: OfficialAvatarDeps): Promise<'missing' | 'kept' | 'updated'> {
  const account = await deps.users.getUserById(OFFICIAL_ACCOUNT_ID);
  if (!account) return 'missing';
  const avatar = await renderVectorAvatar(BRAND_ICON_SVG);
  const avatarKey = createAvatarKey('user', OFFICIAL_ACCOUNT_ID, avatar.hash);
  await deps.storage.save(avatarKey, avatar.buffer);
  if (account.avatarKey === avatarKey) return 'kept';
  await deps.users.swapAvatar({ userId: OFFICIAL_ACCOUNT_ID, avatarKey, avatarAccent: avatar.accent });
  return 'updated';
}
