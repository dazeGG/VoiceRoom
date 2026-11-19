// What the rooms section's tables share: a client's icon, an account by name
// and login (a button to its card), where a seat came from, a room by its name
// or code, and a call's stays folded into the people who made them.

import { AppWindow, Globe, Smartphone, type LucideIcon } from 'lucide-react';
import type {
  ClientKind,
  RoomAccount,
  RoomCall,
  RoomKind,
  RoomStay,
  VoiceMinute
} from '@voice-room/shared/contracts/admin';
import type { NetworkPoint } from '@voice-room/shared/contracts/rooms';
import { deviceLabel, shortGuestId, shortIpKey } from '../../origin.ts';
import { AccountBadge, Pill, RoomAvatar } from '../../ui/index.tsx';
import { seatMatches, toggledFilter, type CallOriginFilters, type OriginPick } from './CallFilters.tsx';

export const CLIENTS: Record<ClientKind, { label: string; icon: LucideIcon }> = {
  desktop_app: { label: 'приложение', icon: AppWindow },
  browser: { label: 'браузер', icon: Globe },
  mobile_app: { label: 'Android', icon: Smartphone },
  mobile: { label: 'телефон', icon: Smartphone }
};

export function ClientIcon({ client, size = 15 }: { client: ClientKind | null; size?: number }) {
  if (!client) return null;
  const { label, icon: Icon } = CLIENTS[client];
  return (
    <span className="rooms-client" title={label} aria-label={label} role="img">
      <Icon size={size} aria-hidden="true" />
    </span>
  );
}

export const nameOf = (account: RoomAccount) => account.displayName || account.login;

/**
 * An account's name (with its mark) and login, or only the login; a click
 * opens its card without opening the row it sits in.
 */
export function AccountName({
  account,
  onOpen,
  withLogin = true,
  loginOnly = false
}: {
  account: RoomAccount;
  onOpen: (accountId: string) => void;
  withLogin?: boolean;
  loginOnly?: boolean;
}) {
  return (
    <button
      type="button"
      className="rooms-account"
      title={loginOnly ? nameOf(account) : undefined}
      onClick={(event) => {
        event.stopPropagation();
        onOpen(account.id);
      }}
    >
      {loginOnly ? null : (
        <>
          <span className="rooms-account-name">{nameOf(account)}</span>
          <AccountBadge userId={account.id} />
        </>
      )}
      {withLogin || loginOnly ? <span className="rooms-login ui-mono">@{account.login}</span> : null}
    </button>
  );
}

type Seat = Pick<RoomStay, 'client' | 'os' | 'browser' | 'guestId' | 'clientId' | 'ipKey' | 'location'>;

/**
 * An address key or a browser id in short. With a pick it is a button that
 * narrows the call history to it (pressed while it does); the full value is in
 * its title either way.
 */
function OriginToken({
  label,
  value,
  short,
  field,
  pick,
  shared = false
}: {
  label: string;
  value: string;
  short: string;
  field: keyof CallOriginFilters;
  pick?: OriginPick | undefined;
  shared?: boolean;
}) {
  if (!pick) {
    return (
      <span className="origin-token" data-static="true" data-shared={shared} title={`${label} ${value}`}>
        {short}
      </span>
    );
  }
  const on = pick.filters[field] === value;
  return (
    <button
      type="button"
      className="origin-token"
      data-on={on}
      data-shared={!on && shared}
      aria-pressed={on}
      title={`${label} ${value}${shared ? ' · тот же IP у другого участника' : ''}`}
      onClick={(event) => {
        event.stopPropagation();
        pick.onChange(toggledFilter(pick.filters, field, value));
      }}
    >
      {short}
    </button>
  );
}

/**
 * The device and the place, never the address; under them the address key
 * (equal ip· keys are the same address) and the browser or app id. With a
 * pick both narrow the call history; `shared` marks an address someone else in
 * the call came from too.
 */
export function Origin({
  seat,
  pick,
  shared = false
}: {
  seat: Seat;
  pick?: OriginPick | undefined;
  shared?: boolean;
}) {
  const clientId = seat.clientId ?? seat.guestId;
  const line = [deviceLabel(seat), seat.location].filter((part): part is string => Boolean(part)).join(' · ');
  const codes = Boolean(seat.ipKey || clientId || pick);
  if (!line && !seat.client && !codes) return null;
  return (
    <span className="rooms-origin">
      {line || seat.client ? (
        <span className="rooms-origin-line">
          <ClientIcon client={seat.client} size={14} />
          {line ? <span className="rooms-origin-text">{line}</span> : null}
        </span>
      ) : null}
      {codes ? (
        <span className="rooms-origin-codes">
          {seat.ipKey ? (
            <OriginToken
              label="Ключ адреса"
              value={seat.ipKey}
              short={shortIpKey(seat.ipKey)}
              field="ipKey"
              pick={pick}
              shared={shared}
            />
          ) : (
            <span className="origin-token" data-none="true">
              нет IP
            </span>
          )}
          {clientId ? (
            <OriginToken
              label={seat.clientId ? 'ID браузера / приложения' : 'Браузер гостя'}
              value={clientId}
              short={shortGuestId(clientId)}
              field="clientId"
              pick={pick}
            />
          ) : null}
        </span>
      ) : null}
    </span>
  );
}

/** The address keys more than one of these came from: the same IP. */
export function sharedIpKeys(seats: readonly { key: string; ipKey: string | null }[]): Set<string> {
  const owners = new Map<string, Set<string>>();
  for (const seat of seats) {
    if (!seat.ipKey) continue;
    const keys = owners.get(seat.ipKey) ?? new Set<string>();
    keys.add(seat.key);
    owners.set(seat.ipKey, keys);
  }
  return new Set([...owners].filter(([, keys]) => keys.size > 1).map(([ipKey]) => ipKey));
}

/**
 * A room as a table shows it: its avatar, its name (an unnamed temporary room
 * goes by its code, in mono) and its kind; a gone one says so.
 */
export function RoomTitle({
  roomId,
  name,
  isStatic,
  avatarUrl = null,
  kind,
  size = 34
}: {
  roomId: string;
  /** Null once the room is gone; empty, or the id itself, for an unnamed temporary room. */
  name: string | null;
  isStatic: boolean | null;
  avatarUrl?: string | null;
  /** A widget room says so in place of temporary. */
  kind?: RoomKind | undefined;
  size?: number;
}) {
  const named = Boolean(name) && name !== roomId;
  return (
    <span className="rooms-title">
      <RoomAvatar roomId={roomId} name={named ? name : null} src={avatarUrl} size={size} />
      <span className={named ? 'rooms-title-name' : 'rooms-title-name ui-mono'}>{named ? name : roomId}</span>
      {name === null ? (
        <Pill tone="danger" compact>
          удалена
        </Pill>
      ) : kind === 'widget' ? (
        <Pill tone="info" compact>
          виджет
        </Pill>
      ) : isStatic ? (
        <Pill tone="accent" compact>
          постоянная
        </Pill>
      ) : isStatic === false ? (
        <Pill compact>временная</Pill>
      ) : null}
    </span>
  );
}

/** Someone in a call: their stays (one, or more if they came back) under one name. */
export interface CallPerson {
  key: string;
  account: RoomAccount | null;
  guestName: string | null;
  /** The latest stay's seat: where they last came from. */
  seat: Seat;
  /** The stays that make them up. */
  stayIds: string[];
  /** Each stay with its voice minutes, or the network changes of an older one. */
  spans: { from: number; to: number; network: NetworkPoint[]; minutes: VoiceMinute[] }[];
  /** Time in the call, the gaps between their stays left out. */
  total: number;
}

/** The same account, the same guest browser or else the same guest name is one person. */
export function personKey(stay: RoomStay): string {
  if (stay.account) return `a:${stay.account.id}`;
  if (stay.guestId) return `g:${stay.guestId}`;
  if (stay.guestName) return `n:${stay.guestName}`;
  return `s:${stay.id}`;
}

export function peopleOf(call: Pick<RoomCall, 'stays'>): CallPerson[] {
  const people = new Map<string, CallPerson>();
  for (const stay of call.stays) {
    const key = personKey(stay);
    const span = { from: stay.joinedAt, to: stay.leftAt, network: stay.network ?? [], minutes: stay.minutes ?? [] };
    const known = people.get(key);
    if (known) {
      known.stayIds.push(stay.id);
      known.spans.push(span);
      known.total += span.to - span.from;
      known.seat = stay;
    } else {
      people.set(key, {
        key,
        account: stay.account,
        guestName: stay.guestName,
        seat: stay,
        stayIds: [stay.id],
        spans: [span],
        total: span.to - span.from
      });
    }
  }
  return [...people.values()];
}

/** The people of a call one of whose stays the history's filters describe. */
export function matchedPeople(call: Pick<RoomCall, 'stays'>, filters: CallOriginFilters): Set<string> {
  return new Set(call.stays.filter((stay) => seatMatches(stay, filters)).map(personKey));
}
