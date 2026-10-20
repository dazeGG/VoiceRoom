// Which accounts carry a mark, loaded once for the names the panel shows.

import { useEffect, useState } from 'react';
import { BadgeList } from '@voice-room/shared/contracts/users';
import type { AccountBadge } from '@voice-room/shared/contracts/users';
import { api } from './api/client.ts';

let loaded: Promise<Map<string, AccountBadge>> | null = null;

function loadBadges(): Promise<Map<string, AccountBadge>> {
  if (loaded) return loaded;
  const pending: Promise<Map<string, AccountBadge>> = api
    .get('/api/badges', BadgeList, 'Не удалось загрузить отметки')
    .then((list) => new Map(list.badges.map((entry) => [entry.userId, entry.badge])))
    .catch(() => {
      // A name without its mark is better than a failed page; the next look asks again.
      if (loaded === pending) loaded = null;
      return new Map();
    });
  loaded = pending;
  return pending;
}

export function useBadges(): Map<string, AccountBadge> {
  const [badges, setBadges] = useState<Map<string, AccountBadge>>(new Map());
  useEffect(() => {
    let alive = true;
    void loadBadges().then((value) => {
      if (alive) setBadges(value);
    });
    return () => {
      alive = false;
    };
  }, []);
  return badges;
}

/** After a mark changes in the panel, the next look loads them again. */
export function forgetBadges(): void {
  loaded = null;
}
