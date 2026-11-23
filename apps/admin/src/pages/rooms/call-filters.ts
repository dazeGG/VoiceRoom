// Who the call history is narrowed to: an address key and a browser (or app)
// id, set by a click on a participant's ip· or # (see Origin) and shown over
// the history as chips that a click takes off. Both describe one participant.

export interface CallOriginFilters {
  clientId?: string;
  ipKey?: string;
}

/** What a participant's ip· and # do: the filters they toggle, and the address keys others in the call share. */
export interface OriginPick {
  filters: CallOriginFilters;
  onChange: (filters: CallOriginFilters) => void;
}

/** The filters with one of them set to `value`, or taken off when it already is. */
export function toggledFilter(
  filters: CallOriginFilters,
  key: keyof CallOriginFilters,
  value: string
): CallOriginFilters {
  const { [key]: current, ...rest } = filters;
  return current === value ? rest : { ...rest, [key]: value };
}

/** Whether a seat is the one the filters describe: every filter set matches it. */
export function seatMatches(
  seat: { ipKey: string | null; clientId?: string | null | undefined; guestId: string | null },
  filters: CallOriginFilters
): boolean {
  if (!filters.ipKey && !filters.clientId) return false;
  const clientId = seat.clientId ?? seat.guestId;
  return (!filters.ipKey || seat.ipKey === filters.ipKey) && (!filters.clientId || clientId === filters.clientId);
}
