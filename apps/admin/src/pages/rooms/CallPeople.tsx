// Who was in one call and when: a row per person with a bar of the call's
// length, lit from each time they came in to when they left in the colour of
// how their voice went, minute by minute (network-bar.tsx). On a call's page a
// row picks the person, and those from one address are marked.

import type { ReactNode } from 'react';
import type { RoomCall } from '@voice-room/shared/contracts/admin';
import { formatClock, formatDuration } from '../../format.ts';
import { Avatar, Pill } from '../../ui/index.tsx';
import { AccountName, Origin, peopleOf } from './room-bits.tsx';
import { NetworkLegend, NetworkSpan } from './network-bar.tsx';

const COLUMNS = 'minmax(130px, 1fr) minmax(100px, 2fr) 70px minmax(110px, 1.1fr)';

export function CallPeople({
  call,
  onOpenAccount,
  selected = null,
  onSelect,
  sharedKeys,
  axis,
  columns = COLUMNS
}: {
  call: RoomCall;
  onOpenAccount: (accountId: string) => void;
  /** The person picked, on a call's page. */
  selected?: string | null;
  onSelect?: (personKey: string) => void;
  /** The address keys more than one person came from. */
  sharedKeys?: ReadonlySet<string>;
  /** In place of the plain ends of the call over the bars. */
  axis?: ReactNode;
  columns?: string;
}) {
  const length = Math.max(1, call.endedAt - call.startedAt);
  const share = (at: number) => ((at - call.startedAt) / length) * 100;
  return (
    <div className="call-people" role="table" aria-label="Участники звонка">
      <div className="call-people-head" role="row" style={{ '--cols': columns }}>
        <span role="columnheader">Кто</span>
        {axis ? (
          <span role="columnheader">{axis}</span>
        ) : (
          <span role="columnheader" className="call-people-span">
            <span className="ui-mono">{formatClock(call.startedAt)}</span>
            <NetworkLegend />
            <span className="ui-mono">{formatClock(call.endedAt)}</span>
          </span>
        )}
        <span role="columnheader" className="ui-cell-end">
          Сколько
        </span>
        <span role="columnheader">Откуда</span>
      </div>
      {peopleOf(call).map((person) => {
        const name = person.account ? person.account.displayName : (person.guestName ?? 'Гость');
        const avatar = (
          <Avatar
            name={name}
            src={person.account?.avatarUrl ?? null}
            colorKey={person.account?.avatarColorKey ?? ''}
            background={person.account?.avatarAccent ?? null}
            size={24}
          />
        );
        return (
          <div
            key={person.key}
            className="call-person"
            role="row"
            data-selected={selected === person.key}
            style={{ '--cols': COLUMNS }}
          >
            <span role="cell" className="call-person-who">
              {onSelect ? (
                <button
                  type="button"
                  className="call-person-pick"
                  aria-pressed={selected === person.key}
                  onClick={() => onSelect(person.key)}
                >
                  {avatar}
                  <span className="rooms-account-name">{name || person.account?.login}</span>
                  {person.account ? null : <Pill compact>гость</Pill>}
                </button>
              ) : (
                <>
                  {avatar}
                  {person.account ? (
                    <AccountName account={person.account} onOpen={onOpenAccount} withLogin={false} />
                  ) : (
                    <>
                      <span className="rooms-guest">{name}</span>
                      <Pill compact>гость</Pill>
                    </>
                  )}
                </>
              )}
            </span>
            <span
              role="cell"
              className="call-bar"
              aria-label={person.spans.map((span) => `${formatClock(span.from)}–${formatClock(span.to)}`).join(', ')}
            >
              {person.spans.map((span) => (
                <NetworkSpan
                  key={span.from}
                  from={span.from}
                  to={span.to}
                  voice={span}
                  style={{
                    left: `${String(share(span.from))}%`,
                    width: `${String(Math.max(1, share(span.to) - share(span.from)))}%`
                  }}
                />
              ))}
            </span>
            <span role="cell" className="ui-cell-end ui-num call-person-total">
              {formatDuration(person.total)}
            </span>
            <span
              role="cell"
              className="call-person-origin-code"
              data-shared={Boolean(person.seat.ipKey && sharedKeys?.has(person.seat.ipKey))}
            >
              <Origin seat={person.seat} />
            </span>
          </div>
        );
      })}
    </div>
  );
}
