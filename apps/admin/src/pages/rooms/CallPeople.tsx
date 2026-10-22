// Who was in one call and when: a row per person with a bar of the call's
// length, lit from each time they came in to when they left; accounts in the
// accent colour, guests in the warning one.

import type { RoomCall } from '@voice-room/shared/contracts/admin';
import { formatClock, formatDuration } from '../../format.ts';
import { Avatar, Pill } from '../../ui/index.tsx';
import { AccountName, Origin, peopleOf } from './room-bits.tsx';

const COLUMNS = 'minmax(130px, 1fr) minmax(100px, 2fr) 70px minmax(110px, 1.1fr)';

export function CallPeople({ call, onOpenAccount }: { call: RoomCall; onOpenAccount: (accountId: string) => void }) {
  const length = Math.max(1, call.endedAt - call.startedAt);
  const share = (at: number) => ((at - call.startedAt) / length) * 100;
  return (
    <div className="call-people" role="table" aria-label="Участники звонка">
      <div className="call-people-head" role="row" style={{ '--cols': COLUMNS }}>
        <span role="columnheader">Кто</span>
        <span role="columnheader" className="call-people-span">
          <span className="ui-mono">{formatClock(call.startedAt)}</span>
          <span className="ui-mono">{formatClock(call.endedAt)}</span>
        </span>
        <span role="columnheader" className="ui-cell-end">
          Сколько
        </span>
        <span role="columnheader">Откуда</span>
      </div>
      {peopleOf(call).map((person) => (
        <div key={person.key} className="call-person" role="row" style={{ '--cols': COLUMNS }}>
          <span role="cell" className="call-person-who">
            <Avatar
              name={person.account ? person.account.displayName : (person.guestName ?? 'Гость')}
              src={person.account?.avatarUrl ?? null}
              colorKey={person.account?.avatarColorKey ?? ''}
              background={person.account?.avatarAccent ?? null}
              size={24}
            />
            {person.account ? (
              <AccountName account={person.account} onOpen={onOpenAccount} withLogin={false} />
            ) : (
              <>
                <span className="rooms-guest">{person.guestName ?? 'Гость'}</span>
                <Pill compact>гость</Pill>
              </>
            )}
          </span>
          <span
            role="cell"
            className="call-bar"
            data-guest={!person.account}
            aria-label={person.spans.map((span) => `${formatClock(span.from)}–${formatClock(span.to)}`).join(', ')}
          >
            {person.spans.map((span) => (
              <span
                key={span.from}
                className="call-bar-span"
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
          <span role="cell">
            <Origin seat={person.seat} />
          </span>
        </div>
      ))}
    </div>
  );
}
