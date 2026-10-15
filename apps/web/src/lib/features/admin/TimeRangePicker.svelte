<script lang="ts">
  // Choosing what span a chart shows, the way Grafana does: a list of
  // ready-made "last …" spans, or one's own from and to.
  import { CalendarRange, ChevronDown } from '@lucide/svelte';
  import { Button, Popover } from '$lib/shared/ui';
  import type { PopoverContentState, PopoverTriggerState } from '$lib/shared/ui/Popover';
  import { iconSm } from '$lib/shared/ui/icons';
  import { fromInputValue, rangeLabel, toInputValue, type RangePreset, type TimeRange } from './time-range';

  let {
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
    resolved?: { from: number; to: number } | null;
  } = $props();

  let fromText = $state('');
  let toText = $state('');
  let invalid = $state(false);

  const label = $derived(rangeLabel(value, presets, withTime));

  function prefill(): void {
    const now = Date.now();
    const span =
      value.kind === 'custom' ? { from: value.from, to: value.to } : (resolved ?? { from: now - 86_400_000, to: now });
    fromText = toInputValue(span.from, withTime);
    toText = toInputValue(span.to, withTime);
    invalid = false;
  }

  function choose(id: string, close: () => void): void {
    onChange({ kind: 'preset', id });
    close();
  }

  function apply(close: () => void): void {
    const from = fromInputValue(fromText, withTime);
    const to = fromInputValue(toText, withTime);
    if (from === null || to === null || from > to) {
      invalid = true;
      return;
    }
    onChange({ kind: 'custom', from, to });
    close();
  }
</script>

<Popover placement="bottom-start" flip floating role="dialog" ariaLabel="Период" rootClass="time-range">
  {#snippet trigger({ open, toggle, panelId }: PopoverTriggerState)}
    <button
      class="time-range-trigger"
      type="button"
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-controls={panelId}
      aria-label={`Период: ${label}`}
      onclick={() => {
        if (!open) prefill();
        toggle();
      }}
    >
      <CalendarRange {...iconSm} aria-hidden="true" />
      <span>{label}</span>
      <ChevronDown {...iconSm} aria-hidden="true" />
    </button>
  {/snippet}

  {#snippet content({ close }: PopoverContentState)}
    <div class="time-range-panel">
      <div class="time-range-presets" role="listbox" aria-label="Готовые периоды">
        {#each presets as preset (preset.id)}
          {@const selected = value.kind === 'preset' && value.id === preset.id}
          <button
            class="time-range-preset"
            class:is-selected={selected}
            type="button"
            role="option"
            aria-selected={selected}
            onclick={() => choose(preset.id, close)}
          >
            {preset.label}
          </button>
        {/each}
      </div>
      <form
        class="time-range-custom"
        onsubmit={(event) => {
          event.preventDefault();
          apply(close);
        }}
      >
        <span class="time-range-title">Свой период</span>
        <label>
          <span>С</span>
          <input
            type={withTime ? 'datetime-local' : 'date'}
            bind:value={fromText}
            oninput={() => (invalid = false)}
            aria-invalid={invalid}
          />
        </label>
        <label>
          <span>По</span>
          <input
            type={withTime ? 'datetime-local' : 'date'}
            bind:value={toText}
            oninput={() => (invalid = false)}
            aria-invalid={invalid}
          />
        </label>
        {#if invalid}<p class="time-range-error" role="alert">Начало должно быть раньше конца.</p>{/if}
        <Button type="submit" variant="primary" class="compact">Показать</Button>
      </form>
    </div>
  {/snippet}
</Popover>

<style>
  .time-range-trigger {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-height: 34px;
    padding: 0 12px;
    border: 1px solid var(--vr-line-strong);
    border-radius: 10px;
    background: var(--vr-surface);
    color: var(--vr-text);
    font: inherit;
    font-size: 13px;
    cursor: pointer;
  }

  .time-range-trigger:hover,
  .time-range-trigger[aria-expanded='true'] {
    background: var(--vr-surface-2);
  }

  .time-range-panel {
    display: grid;
    grid-template-columns: minmax(170px, auto) minmax(220px, 1fr);
    gap: 14px;
    padding: 10px;
  }

  .time-range-presets {
    display: grid;
    align-content: start;
    gap: 2px;
    padding-right: 12px;
    border-right: 1px solid var(--vr-line);
  }

  .time-range-preset {
    padding: 7px 10px;
    border: 0;
    border-radius: 8px;
    background: none;
    color: var(--vr-text-2);
    font: inherit;
    font-size: 13px;
    text-align: left;
    cursor: pointer;
  }

  .time-range-preset:hover {
    background: var(--vr-hover);
    color: var(--vr-text);
  }

  .time-range-preset.is-selected {
    background: var(--vr-accent-soft);
    color: var(--vr-accent-ink);
  }

  .time-range-custom {
    display: grid;
    align-content: start;
    gap: 10px;
  }

  .time-range-title {
    color: var(--vr-text);
    font-size: 13px;
    font-weight: 600;
  }

  .time-range-custom label {
    display: grid;
    gap: 4px;
    color: var(--vr-text-2);
    font-size: 12px;
  }

  .time-range-custom input {
    min-height: 36px;
    padding: 0 10px;
    border: 1px solid var(--vr-line-strong);
    border-radius: 10px;
    background: var(--vr-surface-2);
    color: var(--vr-text);
    font: inherit;
    font-size: 13px;
    color-scheme: dark light;
  }

  .time-range-custom input[aria-invalid='true'] {
    border-color: var(--vr-danger);
  }

  .time-range-error {
    margin: 0;
    color: var(--vr-danger);
    font-size: 12px;
  }

  @media (max-width: 560px) {
    .time-range-panel {
      grid-template-columns: 1fr;
    }

    .time-range-presets {
      padding-right: 0;
      padding-bottom: 10px;
      border-right: 0;
      border-bottom: 1px solid var(--vr-line);
    }
  }
</style>
