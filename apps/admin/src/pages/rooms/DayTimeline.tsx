// One day on a line from 00:00 to 24:00, a row per room: each finished call a
// bar with how many were in it, the calls going on now hatched up to a dashed
// "now" line. A finished call's bar picks it; a live one opens its room above.

import type { LiveRoom, RoomCall } from '@voice-room/shared/contracts/admin';
import { formatClock, formatDuration, formatPeople } from '../../format.ts';
import { RoomTitle, peopleOf } from './room-bits.tsx';

const DAY = 24 * 60 * 60 * 1000;
const HOURS = [0, 3, 6, 9, 12, 15, 18, 21, 24];

interface Row {
  roomId: string;
  name: string | null;
  isStatic: boolean | null;
  avatarUrl: string | null;
  calls: RoomCall[];
  live: LiveRoom | null;
}

/** Rooms in the order they were last busy: live ones first, then by their latest call. */
function rowsOf(calls: readonly RoomCall[], live: readonly LiveRoom[]): Row[] {
  const rows = new Map<string, Row>();
  for (const room of live) {
    rows.set(room.roomId, {
      roomId: room.roomId,
      name: room.name,
      isStatic: room.isStatic,
      avatarUrl: room.avatarUrl,
      calls: [],
      live: room
    });
  }
  for (const call of calls) {
    const row = rows.get(call.roomId);
    if (row) row.calls.push(call);
    else
      rows.set(call.roomId, {
        roomId: call.roomId,
        name: call.roomName,
        isStatic: call.isStatic,
        avatarUrl: call.avatarUrl ?? null,
        calls: [call],
        live: null
      });
  }
  return [...rows.values()];
}

export function DayTimeline({
  dayStart,
  now,
  calls,
  live,
  selectedId,
  onSelect,
  onOpenLive
}: {
  dayStart: number;
  now: number;
  calls: readonly RoomCall[];
  live: readonly LiveRoom[];
  selectedId: string | null;
  onSelect: (call: RoomCall) => void;
  onOpenLive: (room: LiveRoom) => void;
}) {
  const at = (time: number) => Math.min(100, Math.max(0, ((time - dayStart) / DAY) * 100));
  const place = (from: number, to: number) => ({
    left: `${String(at(from))}%`,
    width: `${String(Math.max(0.4, at(to) - at(from)))}%`
  });
  const rows = rowsOf(calls, live);
  const nowShown = now >= dayStart && now < dayStart + DAY;
  return (
    <div className="ui-table-scroll">
      <div className="timeline" style={{ '--table-min': '900px' }}>
        <div className="timeline-axis" aria-hidden="true">
          <span />
          <span className="timeline-track">
            {HOURS.map((hour) => (
              <span
                key={hour}
                className="timeline-hour ui-mono"
                data-edge={hour === 0 ? 'start' : hour === 24 ? 'end' : undefined}
                style={{ left: `${String((hour / 24) * 100)}%` }}
              >
                {`${String(hour).padStart(2, '0')}:00`}
              </span>
            ))}
          </span>
        </div>
        <div className="timeline-body">
          <ul className="timeline-rows" aria-label="Звонки за день">
            {rows.map((row) => (
              <li key={row.roomId} className="timeline-row">
                <RoomTitle roomId={row.roomId} name={row.name} isStatic={null} avatarUrl={row.avatarUrl} size={26} />
                <span className="timeline-track">
                  {HOURS.map((hour) => (
                    <span key={hour} className="timeline-grid" style={{ left: `${String((hour / 24) * 100)}%` }} />
                  ))}
                  {row.calls.map((call) => {
                    const people = peopleOf(call).length;
                    const wide = call.endedAt - call.startedAt > 30 * 60_000;
                    return (
                      <button
                        key={call.id}
                        type="button"
                        className="timeline-bar"
                        aria-pressed={call.id === selectedId}
                        title={`${formatClock(call.startedAt)}–${formatClock(call.endedAt)} · ${formatDuration(call.endedAt - call.startedAt)} · ${formatPeople(people)}`}
                        aria-label={`Звонок ${formatClock(call.startedAt)}–${formatClock(call.endedAt)}, ${formatPeople(people)}`}
                        style={place(call.startedAt, call.endedAt)}
                        onClick={() => onSelect(call)}
                      >
                        {wide ? people : null}
                      </button>
                    );
                  })}
                  {row.live?.since ? (
                    <button
                      type="button"
                      className="timeline-bar"
                      data-live="true"
                      title={`${formatClock(row.live.since)} — сейчас · ${formatPeople(row.live.peers.length)}`}
                      aria-label={`Идёт с ${formatClock(row.live.since)}, ${formatPeople(row.live.peers.length)}`}
                      style={place(row.live.since, now)}
                      onClick={() => row.live && onOpenLive(row.live)}
                    >
                      {now - row.live.since > 30 * 60_000 ? row.live.peers.length : null}
                    </button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
          {/* Over every row, past the names: the moment it is now. */}
          {nowShown ? <span className="timeline-now" aria-hidden="true" style={{ '--at': at(now) / 100 }} /> : null}
        </div>
      </div>
    </div>
  );
}
