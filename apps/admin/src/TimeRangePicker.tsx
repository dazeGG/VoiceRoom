// Choosing what span a chart shows: a row of ready-made "last …" spans, or
// one's own from and to behind "Свой период", with the span the last answer
// covered written beside them.

import { Calendar } from 'lucide-react';
import { useState } from 'react';
import { fromInputValue, rangeLabel, toInputValue, type RangePreset, type TimeRange } from './time-range.ts';
import { Button, Popover, Segment } from './ui/index.tsx';
import './TimeRangePicker.css';

function lastDay(): { from: number; to: number } {
  const now = Date.now();
  return { from: now - 86_400_000, to: now };
}

export function TimeRangePicker({
  value,
  presets,
  withTime,
  onChange,
  resolved = null
}: {
  value: TimeRange;
  presets: readonly RangePreset[];
  /** Moments with hours and minutes (server), or whole days (product). */
  withTime: boolean;
  onChange: (range: TimeRange) => void;
  /** The span the last answer actually covered, written beside the choices and offered as the start of a custom one. */
  resolved?: { from: number; to: number } | null | undefined;
}) {
  const [fromText, setFromText] = useState('');
  const [toText, setToText] = useState('');
  const [invalid, setInvalid] = useState(false);

  const custom = value.kind === 'custom';
  const inputType = withTime ? 'datetime-local' : 'date';
  const covered = resolved ? rangeLabel({ kind: 'custom', ...resolved }, presets, withTime) : '';

  function prefill(): void {
    const span = value.kind === 'custom' ? { from: value.from, to: value.to } : (resolved ?? lastDay());
    setFromText(toInputValue(span.from, withTime));
    setToText(toInputValue(span.to, withTime));
    setInvalid(false);
  }

  function apply(close: () => void): void {
    const from = fromInputValue(fromText, withTime);
    const to = fromInputValue(toText, withTime);
    if (from === null || to === null || from > to) {
      setInvalid(true);
      return;
    }
    onChange({ kind: 'custom', from, to });
    close();
  }

  return (
    <div className="time-range">
      <Segment
        ariaLabel="Период"
        value={value.kind === 'preset' ? value.id : ''}
        onChange={(id) => onChange({ kind: 'preset', id })}
        options={presets.map((preset) => ({ value: preset.id, label: preset.short }))}
      />
      <Popover
        label="Период"
        trigger={({ open, toggle }) => (
          <button
            className="time-range-trigger"
            type="button"
            aria-haspopup="dialog"
            aria-expanded={open}
            data-active={custom}
            aria-label={custom ? `Свой период: ${rangeLabel(value, presets, withTime)}` : 'Свой период'}
            onClick={() => {
              if (!open) prefill();
              toggle();
            }}
          >
            <Calendar size={15} aria-hidden="true" />
            <span>{custom ? rangeLabel(value, presets, withTime) : 'Свой период'}</span>
          </button>
        )}
      >
        {(close) => (
          <form
            className="time-range-custom"
            onSubmit={(event) => {
              event.preventDefault();
              apply(close);
            }}
          >
            <span className="time-range-title">Свой период</span>
            <label>
              <span>С</span>
              <input
                type={inputType}
                value={fromText}
                onChange={(event) => {
                  setFromText(event.target.value);
                  setInvalid(false);
                }}
                aria-invalid={invalid}
              />
            </label>
            <label>
              <span>По</span>
              <input
                type={inputType}
                value={toText}
                onChange={(event) => {
                  setToText(event.target.value);
                  setInvalid(false);
                }}
                aria-invalid={invalid}
              />
            </label>
            {invalid ? (
              <p className="time-range-error" role="alert">
                Начало должно быть раньше конца.
              </p>
            ) : null}
            <Button type="submit" variant="primary">
              Показать
            </Button>
          </form>
        )}
      </Popover>
      {covered && !custom ? <span className="time-range-covered">{covered}</span> : null}
    </div>
  );
}
