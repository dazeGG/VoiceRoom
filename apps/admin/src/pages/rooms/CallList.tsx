// Finished calls by day, a row per call: when (and how long), the room, who
// was in it, how its voice went. A row (or its chevron) opens its people with
// when each was there, the arrow opens the call's page, and a room's name
// narrows the history to that room. Narrowed to a participant, a row names the
// people it matched.

import { ArrowUpRight, ChevronDown, ChevronRight } from 'lucide-react';
import type { RoomCall } from '@voice-room/shared/contracts/admin';
import { formatClock, formatCount, formatDayHeading, formatDuration, formatPeople, plural } from '../../format.ts';
import type { OriginPick } from './CallFilters.tsx';
import { AvatarStack } from '../../ui/index.tsx';
import { CallPeople } from './CallPeople.tsx';
import { QualityCell, qualityOfCall } from './QualityBar.tsx';
import { RoomTitle, matchedPeople, peopleOf } from './room-bits.tsx';

const COLUMNS = '28px 132px minmax(200px, 1.3fr) minmax(180px, 1fr) minmax(170px, 0.9fr) 28px';

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
  onOpen,
  onOpenAccount,
  pick
}: {
  calls: readonly RoomCall[];
  now: number;
  open: ReadonlySet<string>;
  onToggle: (callId: string) => void;
  /** Narrows the history to the call's room; without it the room is not a button. */
  onFilterRoom?: ((call: RoomCall) => void) | undefined;
  onOpen: (call: RoomCall) => void;
  onOpenAccount: (accountId: string) => void;
  /** The history's filters, toggled by each participant's ip· and #. */
  pick?: OriginPick | undefined;
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
                const matched = pick ? matchedPeople(call, pick.filters) : new Set<string>();
                const matchedNames = people
                  .filter((person) => matched.has(person.key))
                  .map((person) => (person.account ? person.account.displayName : (person.guestName ?? 'Гость')));
                const Chevron = expanded ? ChevronDown : ChevronRight;
                const peopleId = `call-people-${call.id}`;
                const when = `${formatClock(call.startedAt)}–${formatClock(call.endedAt)}`;
                return (
                  <li key={call.id} className="call" data-open={expanded}>
                    {/* The whole row opens the people; the chevron is the control for the keyboard. */}
                    <div
                      className="ui-tr ui-row-link call-row"
                      style={{ '--cols': COLUMNS }}
                      onClick={() => onToggle(call.id)}
                    >
                      <button
                        type="button"
                        className="live-toggle"
                        aria-expanded={expanded}
                        aria-controls={peopleId}
                        aria-label={`Кто был в звонке ${when}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          onToggle(call.id);
                        }}
                      >
                        <Chevron size={16} aria-hidden="true" />
                      </button>
                      <span className="call-when">
                        <span className="ui-mono call-time">{when}</span>
                        <span className="call-length">{formatDuration(call.endedAt - call.startedAt)}</span>
                      </span>
                      {onFilterRoom ? (
                        <button
                          type="button"
                          className="call-room"
                          title="Показать только эту комнату"
                          onClick={(event) => {
                            event.stopPropagation();
                            onFilterRoom(call);
                          }}
                        >
                          <RoomTitle
                            roomId={call.roomId}
                            name={call.roomName}
                            isStatic={call.isStatic}
                            avatarUrl={call.avatarUrl ?? null}
                            kind={call.kind}
                            size={30}
                          />
                        </button>
                      ) : (
                        <RoomTitle
                          roomId={call.roomId}
                          name={call.roomName}
                          isStatic={call.isStatic}
                          avatarUrl={call.avatarUrl ?? null}
                          kind={call.kind}
                          size={30}
                        />
                      )}
                      <span className="call-people-cell">
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
                        {matchedNames.length ? (
                          <span className="call-match">
                            <span className="call-match-dot" aria-hidden="true" />
                            <span className="call-match-text">{`совпадение: ${matchedNames.join(', ')}`}</span>
                          </span>
                        ) : null}
                      </span>
                      <span className="call-quality">
                        <QualityCell quality={qualityOfCall(call)} />
                      </span>
                      <button
                        type="button"
                        className="live-history"
                        aria-label={`Подробно о звонке ${when}`}
                        title="Подробно о звонке"
                        onClick={(event) => {
                          event.stopPropagation();
                          onOpen(call);
                        }}
                      >
                        <ArrowUpRight size={16} aria-hidden="true" />
                      </button>
                    </div>
                    {expanded ? (
                      <div id={peopleId} className="call-detail">
                        <CallPeople call={call} onOpenAccount={onOpenAccount} pick={pick} />
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
