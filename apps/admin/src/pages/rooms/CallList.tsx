// Finished calls by day, a row per call: when (and how long), the room, who
// was in it. A row opens its people with when each was there; a room's name
// narrows the history to that room.

import { ChevronDown, ChevronUp } from 'lucide-react';
import type { RoomCall } from '@voice-room/shared/contracts/admin';
import { formatClock, formatCount, formatDayHeading, formatDuration, formatPeople, plural } from '../../format.ts';
import { AvatarStack } from '../../ui/index.tsx';
import { CallPeople } from './CallPeople.tsx';
import { RoomTitle, peopleOf } from './room-bits.tsx';

const COLUMNS = '132px minmax(0, 1.3fr) minmax(0, 1fr) 28px';

const dayOf = (at: number) => new Date(at).setHours(0, 0, 0, 0);

/** The calls on a page, by the day each began on, in the page's order. */
function byDay(calls: readonly RoomCall[]): { day: number; calls: RoomCall[] }[] {
  const days: { day: number; calls: RoomCall[] }[] = [];
  for (const call of calls) {
    const day = dayOf(call.startedAt);
    const last = days.at(-1);
    if (last?.day === day) last.calls.push(call);
    else days.push({ day, calls: [call] });
  }
  return days;
}

export function CallList({
  calls,
  now,
  open,
  onToggle,
  onFilterRoom,
  onOpenAccount
}: {
  calls: readonly RoomCall[];
  now: number;
  open: ReadonlySet<string>;
  onToggle: (callId: string) => void;
  onFilterRoom: (call: RoomCall) => void;
  onOpenAccount: (accountId: string) => void;
}) {
  return (
    <div className="calls">
      {byDay(calls).map(({ day, calls: ofDay }) => {
        const total = ofDay.reduce((sum, call) => sum + (call.endedAt - call.startedAt), 0);
        return (
          <section key={day} className="calls-day" aria-label={formatDayHeading(day, now)}>
            <header className="calls-day-head">
              <span className="calls-day-name">{formatDayHeading(day, now)}</span>
              <span className="calls-day-line" aria-hidden="true" />
              <span className="calls-day-sum">
                {`${formatCount(ofDay.length)} ${plural(ofDay.length, ['звонок', 'звонка', 'звонков'])} · ${formatDuration(total)}`}
              </span>
            </header>
            <ul className="ui-panel calls-card" data-flush="true">
              {ofDay.map((call) => {
                const expanded = open.has(call.id);
                const people = peopleOf(call);
                const Chevron = expanded ? ChevronUp : ChevronDown;
                const peopleId = `call-people-${call.id}`;
                return (
                  <li key={call.id} className="call" data-open={expanded}>
                    <div
                      className="ui-tr ui-row-link call-row"
                      style={{ '--cols': COLUMNS }}
                      onClick={() => onToggle(call.id)}
                    >
                      <span className="call-when">
                        <span className="ui-mono call-time">
                          {formatClock(call.startedAt)}–{formatClock(call.endedAt)}
                        </span>
                        <span className="call-length">{formatDuration(call.endedAt - call.startedAt)}</span>
                      </span>
                      <button
                        type="button"
                        className="call-room"
                        title="Показать только эту комнату"
                        onClick={(event) => {
                          event.stopPropagation();
                          onFilterRoom(call);
                        }}
                      >
                        <RoomTitle roomId={call.roomId} name={call.roomName} isStatic={call.isStatic} size={30} />
                      </button>
                      <span className="live-people">
                        <AvatarStack
                          people={people.map((person) => ({
                            key: person.key,
                            name: person.account ? person.account.displayName : (person.guestName ?? 'Гость'),
                            src: person.account?.avatarUrl ?? null,
                            colorKey: person.account?.avatarColorKey ?? '',
                            background: person.account?.avatarAccent ?? null
                          }))}
                        />
                        <span className="live-count">{formatPeople(people.length)}</span>
                      </span>
                      <button
                        type="button"
                        className="live-toggle"
                        aria-expanded={expanded}
                        aria-controls={peopleId}
                        aria-label={`Кто был в звонке ${formatClock(call.startedAt)}–${formatClock(call.endedAt)}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          onToggle(call.id);
                        }}
                      >
                        <Chevron size={16} aria-hidden="true" />
                      </button>
                    </div>
                    {expanded ? (
                      <div id={peopleId} className="call-detail">
                        <CallPeople call={call} onOpenAccount={onOpenAccount} />
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
