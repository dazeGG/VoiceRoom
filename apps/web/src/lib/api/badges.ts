// The accounts that carry a mark, for the name everywhere they appear.

import type { BadgeList } from '@voice-room/shared/contracts/users';
import { setAccountBadges } from '$lib/shared/badges.svelte';
import { api } from './client';

/** Loads the marks; a failure leaves names without them rather than failing anything. */
export async function loadAccountBadges(): Promise<void> {
  try {
    setAccountBadges((await api.get<BadgeList>('/api/badges', { fallback: 'Не удалось загрузить отметки' })).badges);
  } catch {
    // Names simply show without a mark until the next load.
  }
}
