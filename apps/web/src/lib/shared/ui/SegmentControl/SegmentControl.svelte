<script lang="ts" generics="T extends string">
  import type { SegmentControlProps } from './types';

  let {
    options,
    value,
    onChange,
    ariaLabel,
    kind = 'radio',
    size = 'md',
    class: className = ''
  }: SegmentControlProps<T> = $props();

  const itemRole = $derived(kind === 'tabs' ? 'tab' : 'radio');

  function move(event: KeyboardEvent, index: number): void {
    if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(event.key)) return;
    event.preventDefault();
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1;
    const buttons = (event.currentTarget as HTMLElement).parentElement?.querySelectorAll<HTMLElement>('button');
    for (let offset = 1; offset <= options.length; offset += 1) {
      const nextIndex = (index + step * offset + options.length * offset) % options.length;
      const next = options[nextIndex];
      if (next.disabled) continue;
      onChange(next.value);
      queueMicrotask(() => buttons?.[nextIndex]?.focus());
      return;
    }
  }
</script>

<div
  class="ui-segment ui-segment--{size} {className}"
  role={kind === 'tabs' ? 'tablist' : 'radiogroup'}
  aria-label={ariaLabel}
>
  {#each options as option, index (option.value)}
    {@const selected = option.value === value}
    <button
      class="ui-segment-item"
      class:is-selected={selected}
      type="button"
      role={itemRole}
      aria-selected={kind === 'tabs' ? selected : undefined}
      aria-checked={kind === 'radio' ? selected : undefined}
      tabindex={selected ? 0 : -1}
      disabled={option.disabled}
      onclick={() => onChange(option.value)}
      onkeydown={(event) => move(event, index)}
    >
      {#if option.dot}<span class="ui-segment-dot" aria-hidden="true"></span>{/if}
      <span>{option.label}</span>
      {#if option.suffix}{@render option.suffix()}{/if}
    </button>
  {/each}
</div>

<style>
  .ui-segment {
    display: inline-flex;
    gap: 2px;
    padding: 3px;
    border: 1px solid var(--vr-line);
    border-radius: 14px;
    background: var(--vr-surface-2);
  }

  .ui-segment-item {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-height: 34px;
    padding: 0 14px;
    border: none;
    border-radius: 11px;
    background: transparent;
    color: var(--vr-text-2);
    font-family: var(--font-ui);
    font-size: 13.5px;
    font-weight: 500;
    white-space: nowrap;
    cursor: pointer;
    transition:
      background 0.15s ease,
      color 0.15s ease;
  }

  .ui-segment--sm .ui-segment-item {
    min-height: 28px;
    padding: 0 12px;
    border-radius: 9px;
    font-size: 13px;
  }

  .ui-segment-item:hover:not(:disabled):not(.is-selected) {
    background: var(--vr-hover);
    color: var(--vr-text);
  }

  .ui-segment-item.is-selected {
    background: var(--vr-surface-3);
    color: var(--vr-text);
  }

  .ui-segment-item:focus-visible {
    outline: 2px solid var(--vr-accent);
    outline-offset: 1px;
  }

  .ui-segment-item:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }

  .ui-segment-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--vr-accent);
  }
</style>
