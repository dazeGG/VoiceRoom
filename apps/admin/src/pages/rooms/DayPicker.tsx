// Which day the timeline shows: a day back or forward, any day on the
// calendar, and back to today. Days are local midnights; nothing after today
// and nothing older than the history keeps.

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { fromInputValue, toInputValue } from '../../time-range.ts';
import { Button } from '../../ui/index.tsx';

export const startOfDay = (at: number) => new Date(at).setHours(0, 0, 0, 0);

/** The midnight `days` days from `dayStart`, by the calendar rather than by 24 hours. */
export function shiftDay(dayStart: number, days: number): number {
  const date = new Date(dayStart);
  date.setDate(date.getDate() + days);
  return startOfDay(date.getTime());
}

export function DayPicker({
  dayStart,
  today,
  keepDays,
  onChange
}: {
  dayStart: number;
  today: number;
  /** How far back the history still has calls. */
  keepDays: number;
  onChange: (dayStart: number) => void;
}) {
  const earliest = shiftDay(today, -keepDays);
  const pick = (at: number) => onChange(Math.min(today, Math.max(earliest, startOfDay(at))));
  return (
    <span className="day-picker" role="group" aria-label="День ленты">
      <Button
        variant="ghost"
        className="day-picker-step"
        aria-label="Предыдущий день"
        disabled={dayStart <= earliest}
        onClick={() => pick(shiftDay(dayStart, -1))}
      >
        <ChevronLeft size={15} aria-hidden="true" />
      </Button>
      <input
        type="date"
        className="day-picker-date"
        aria-label="День"
        value={toInputValue(dayStart, false)}
        min={toInputValue(earliest, false)}
        max={toInputValue(today, false)}
        onChange={(event) => {
          const at = fromInputValue(event.target.value, false);
          if (at !== null) pick(at);
        }}
      />
      <Button
        variant="ghost"
        className="day-picker-step"
        aria-label="Следующий день"
        disabled={dayStart >= today}
        onClick={() => pick(shiftDay(dayStart, 1))}
      >
        <ChevronRight size={15} aria-hidden="true" />
      </Button>
      {dayStart < today ? (
        <Button variant="ghost" onClick={() => pick(today)}>
          Сегодня
        </Button>
      ) : null}
    </span>
  );
}
