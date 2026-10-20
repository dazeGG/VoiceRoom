// Choosing what span a chart shows, the way Grafana does: a list of
// ready-made "last …" spans, or one's own from and to.

import { CalendarRange, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { fromInputValue, rangeLabel, toInputValue, type RangePreset, type TimeRange } from './time-range.ts';
import { Button, Popover } from './ui/index.tsx';
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
  /** The span the last answer actually covered, offered as the start of a custom one. */
  resolved?: { from: number; to: number } | null | undefined;
}) {
  const [fromText, setFromText] = useState('');
  const [toText, setToText] = useState('');
  const [invalid, setInvalid] = useState(false);

  const label = rangeLabel(value, presets, withTime);
  const inputType = withTime ? 'datetime-local' : 'date';

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
    <Popover
      label="Период"
      trigger={({ open, toggle }) => (
        <button
          className="time-range-trigger"
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={`Период: ${label}`}
          onClick={() => {
            if (!open) prefill();
            toggle();
          }}
        >
          <CalendarRange size={16} aria-hidden="true" />
          <span>{label}</span>
          <ChevronDown size={16} aria-hidden="true" />
        </button>
      )}
    >
      {(close) => (
        <div className="time-range-panel">
          <div className="time-range-presets" role="listbox" aria-label="Готовые периоды">
            {presets.map((preset) => {
              const selected = value.kind === 'preset' && value.id === preset.id;
              return (
                <button
                  key={preset.id}
                  className={selected ? 'time-range-preset is-selected' : 'time-range-preset'}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => {
                    onChange({ kind: 'preset', id: preset.id });
                    close();
                  }}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
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
        </div>
      )}
    </Popover>
  );
}
