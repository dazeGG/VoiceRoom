// Which accounts carry a mark next to their name: the service's own account
// (and, later, verified people). They are few and public, so the app loads
// them once and every surface looks a name up by its account id.

import { reactive } from 'vue';
import type { AccountBadge } from '@voice-room/shared/contracts/users';

export type { AccountBadge };

const badges = reactive(new Map<string, AccountBadge>());

export function setAccountBadges(list: readonly { userId: string; badge: AccountBadge }[]): void {
  badges.clear();
  for (const { userId, badge } of list) badges.set(userId, badge);
}

export function badgeOf(userId: string | null | undefined): AccountBadge | null {
  return userId ? (badges.get(userId) ?? null) : null;
}
