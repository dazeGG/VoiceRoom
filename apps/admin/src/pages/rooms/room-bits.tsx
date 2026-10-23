// What the rooms section's tables share: a client's icon, an account by name
// and login (a button to its card), where a seat came from, a room by its name
// or code, and a call's stays folded into the people who made them.

import { AppWindow, Globe, Smartphone, type LucideIcon } from 'lucide-react';
import type { ClientKind, RoomAccount, RoomCall, RoomStay } from '@voice-room/shared/contracts/admin';
import { deviceLabel, shortGuestId, shortIpKey } from '../../origin.ts';
import { AccountBadge, Pill, RoomAvatar } from '../../ui/index.tsx';

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

type Seat = Pick<RoomStay, 'client' | 'os' | 'browser' | 'guestId' | 'ipKey' | 'location'>;

/** The device and the place, never the address: equal ip· keys are the same address. */
export function Origin({ seat }: { seat: Seat }) {
  const device = deviceLabel(seat);
  const parts = [device, seat.location].filter((part): part is string => Boolean(part));
  if (!parts.length && !seat.ipKey && !seat.guestId) return null;
  // The dots between the parts are drawn by the stylesheet.
  return (
    <span className="rooms-origin">
      <ClientIcon client={seat.client} size={14} />
      <span className="rooms-origin-parts">
        {parts.map((part) => (
          <span key={part}>{part}</span>
        ))}
        {seat.ipKey ? (
          <span className="rooms-code ui-mono" title={`Ключ адреса ${seat.ipKey}`}>
            {shortIpKey(seat.ipKey)}
          </span>
        ) : null}
        {seat.guestId ? (
          <span className="rooms-code ui-mono" title={`Браузер гостя ${seat.guestId}`}>
            {shortGuestId(seat.guestId)}
          </span>
        ) : null}
      </span>
    </span>
  );
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
  size = 34
}: {
  roomId: string;
  /** Null once the room is gone; empty, or the id itself, for an unnamed temporary room. */
  name: string | null;
  isStatic: boolean | null;
  avatarUrl?: string | null;
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
  spans: { from: number; to: number }[];
  /** Time in the call, the gaps between their stays left out. */
  total: number;
}

/** The same account, the same guest browser or else the same guest name is one person. */
function personKey(stay: RoomStay): string {
  if (stay.account) return `a:${stay.account.id}`;
  if (stay.guestId) return `g:${stay.guestId}`;
  if (stay.guestName) return `n:${stay.guestName}`;
  return `s:${stay.id}`;
}

export function peopleOf(call: Pick<RoomCall, 'stays'>): CallPerson[] {
  const people = new Map<string, CallPerson>();
  for (const stay of call.stays) {
    const key = personKey(stay);
    const span = { from: stay.joinedAt, to: stay.leftAt };
    const known = people.get(key);
    if (known) {
      known.spans.push(span);
      known.total += span.to - span.from;
      known.seat = stay;
    } else {
      people.set(key, {
        key,
        account: stay.account,
        guestName: stay.guestName,
        seat: stay,
        spans: [span],
        total: span.to - span.from
      });
    }
  }
  return [...people.values()];
}
