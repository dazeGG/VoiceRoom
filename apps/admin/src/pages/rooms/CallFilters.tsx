// Who the call history is narrowed to: an address key and a browser (or app)
// id, set by a click on a participant's ip· or # (see Origin) and shown over
// the history as chips that a click takes off. Both describe one participant.

import { X } from 'lucide-react';
import { shortGuestId } from '../../origin.ts';

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

export function FilterChips({
  filters,
  onChange
}: {
  filters: CallOriginFilters;
  onChange: (filters: CallOriginFilters) => void;
}) {
  return (
    <>
      {filters.ipKey ? (
        <button
          type="button"
          className="rooms-filter"
          title={`Ключ адреса ${filters.ipKey}`}
          onClick={() => onChange(toggledFilter(filters, 'ipKey', filters.ipKey ?? ''))}
        >
          IP
          <span className="ui-mono">{filters.ipKey.slice(0, 6)}</span>
          <X size={13} aria-label="Снять фильтр по IP" />
        </button>
      ) : null}
      {filters.clientId ? (
        <button
          type="button"
          className="rooms-filter"
          title={`ID браузера / приложения ${filters.clientId}`}
          onClick={() => onChange(toggledFilter(filters, 'clientId', filters.clientId ?? ''))}
        >
          ID
          <span className="ui-mono">{shortGuestId(filters.clientId)}</span>
          <X size={13} aria-label="Снять фильтр по ID" />
        </button>
      ) : null}
    </>
  );
}
