import type { StaticRoomsFilter, StaticRoomsSort } from '@voiceroom/shared/contracts/admin';

export interface StaticRoomsView {
  q: string;
  filter: StaticRoomsFilter;
  sort: StaticRoomsSort;
  page: number;
}

export const FIRST_STATIC_VIEW: StaticRoomsView = { q: '', filter: 'all', sort: 'lastCall', page: 1 };
