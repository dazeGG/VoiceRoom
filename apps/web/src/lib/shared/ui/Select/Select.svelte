<script lang="ts">
  import { tick } from 'svelte';
  import { Ellipsis } from '../Ellipsis';
  import { Popover } from '../Popover';
  import type { SelectOption, SelectProps } from './types';

  let {
    value = $bindable(''),
    options = [],
    label = '',
    disabled = false,
    placement = 'bottom-start',
    flip = false,
    variant = 'field',
    onValueChange
  }: SelectProps = $props();

  const selectedLabel = $derived(
    options.find((option) => option.value === value)?.label
      ?? options[0]?.label
      ?? '—'
  );
  const selectedIndex = $derived(Math.max(0, options.findIndex((option) => option.value === value)));

  let open = $state(false);
  let activeIndex = $state(0);
  let optionRefs: HTMLButtonElement[] = [];
  let typeahead = '';
  let typeaheadTimer: ReturnType<typeof setTimeout> | null = null;

  async function focusOption(index = selectedIndex): Promise<void> {
    await tick();
    const nextIndex = Math.min(Math.max(index, 0), options.length - 1);
    activeIndex = nextIndex;
    optionRefs[nextIndex]?.focus();
  }

  async function openAndFocus(index = selectedIndex): Promise<void> {
    if (disabled || options.length === 0) return;
    activeIndex = Math.min(Math.max(index, 0), options.length - 1);
    open = true;
    await focusOption(activeIndex);
  }

  function registerOption(node: HTMLButtonElement, index: number) {
    optionRefs[index] = node;
    return {
      update(nextIndex: number) {
        delete optionRefs[index];
        index = nextIndex;
        optionRefs[index] = node;
      },
      destroy() {
        delete optionRefs[index];
      }
    };
  }

  function choose(next: string, close: (restoreFocus?: boolean) => void): void {
    if (disabled) return;
    const changed = next !== value;
    value = next;
    if (changed) onValueChange?.(next);
    close();
  }

  function move(delta: number): void {
    if (options.length === 0) return;
    const next = (activeIndex + delta + options.length) % options.length;
    void focusOption(next);
  }

  function matchTypeahead(char: string): void {
    if (typeaheadTimer) clearTimeout(typeaheadTimer);
    typeahead += char.toLocaleLowerCase();
    typeaheadTimer = setTimeout(() => {
      typeahead = '';
      typeaheadTimer = null;
    }, 700);

    const start = (activeIndex + 1) % options.length;
    const ordered = [...options.slice(start), ...options.slice(0, start)];
    const matched = ordered.find((option) => option.label.toLocaleLowerCase().startsWith(typeahead));
    if (!matched) return;
    void focusOption(options.findIndex((option) => option.value === matched.value));
  }

  function onTriggerKeydown(event: KeyboardEvent): void {
    if (disabled) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      void openAndFocus(selectedIndex);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      void openAndFocus(selectedIndex > 0 ? selectedIndex : options.length - 1);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      void openAndFocus(selectedIndex);
    }
  }

  function onOptionKeydown(event: KeyboardEvent, option: SelectOption, close: (restoreFocus?: boolean) => void): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      move(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      move(-1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      void focusOption(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      void focusOption(options.length - 1);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      choose(option.value, close);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'Tab') {
      close(false);
    } else if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      matchTypeahead(event.key);
    }
  }
</script>

<div class="select-root">
  <Popover bind:open {placement} {flip} role="listbox" ariaLabel={label} panelClass="select-panel">
    {#snippet trigger({ open, toggle, panelId })}
      <button
        class="select-trigger select-trigger--{variant}"
        type="button"
        {disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={label || undefined}
        onclick={toggle}
        onkeydown={onTriggerKeydown}
      >
        <span class="select-trigger-label">
          <Ellipsis text={selectedLabel} title={selectedLabel} />
        </span>
        <span class="select-trigger-chevron" aria-hidden="true">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
        </span>
      </button>
    {/snippet}

    {#snippet content({ close })}
      {#each options as option, index (option.value)}
        <button
          use:registerOption={index}
          class="popover-option"
          type="button"
          role="option"
          aria-selected={option.value === value}
          data-selected={option.value === value}
          tabindex={index === activeIndex ? 0 : -1}
          onclick={() => choose(option.value, close)}
          onkeydown={(event) => onOptionKeydown(event, option, close)}
          onfocus={() => (activeIndex = index)}
        >
          <Ellipsis text={option.label} title={option.label} />
        </button>
      {/each}
    {/snippet}
  </Popover>
</div>

<style>
  .select-root {
    width: 100%;
    min-width: 0;
  }

  .select-trigger {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    width: 100%;
    min-width: 0;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 12px;
    padding: 13px 14px 13px 15px;
    background: #0c0b08;
    color: #ece7d9;
    font-family: var(--font-sans);
    font-size: 14.5px;
    font-weight: 500;
    text-align: left;
    cursor: pointer;
    transition: border-color 0.15s ease, background 0.15s ease;
  }

  .select-trigger:hover:not(:disabled),
  .select-trigger[aria-expanded='true'] {
    border-color: rgba(154, 143, 106, 0.7);
  }

  .select-trigger:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }

  .select-trigger-label {
    flex: 1 1 auto;
    min-width: 0;
  }

  .select-trigger-chevron {
    flex: none;
    display: inline-flex;
    color: #9a9484;
    transition: transform 0.16s ease;
  }

  .select-trigger[aria-expanded='true'] .select-trigger-chevron {
    transform: rotate(180deg);
  }

  /* Panel chrome lives on the Popover-owned div (passed via panelClass), so it must be global. */
  :global(.select-panel) {
    left: 0;
    right: 0;
    width: auto;
    min-width: 100%;
    max-height: min(280px, 50vh);
    overflow: auto;
    padding: 6px;
  }

  .select-trigger--field {
    font-size: 14px;
  }

  .select-trigger--home {
    border-color: rgba(154, 143, 106, 0.55);
  }

  .select-trigger--home:hover:not(:disabled),
  .select-trigger--home[aria-expanded='true'] {
    border-color: rgba(154, 143, 106, 0.7);
    background: #0c0b08;
  }

  .select-trigger--compact {
    width: auto;
    min-width: 0;
    padding: 9px 30px 9px 12px;
    border: none;
    border-radius: 0;
    background: transparent;
    color: #bdb7a8;
    font-size: 13px;
  }

  .select-trigger--compact:hover:not(:disabled),
  .select-trigger--compact[aria-expanded='true'] {
    border-color: transparent;
    background: rgba(255, 255, 255, 0.04);
    color: #e7e2d4;
  }

  .select-trigger--dock {
    position: relative;
    justify-content: flex-start;
    gap: 0;
    border-color: oklch(34% 0.02 92);
    border-radius: var(--radius-sm, 10px);
    padding: 10px 36px 10px 12px;
    background: oklch(15% 0.014 92);
    color: oklch(96% 0.008 92);
    font-size: 14px;
  }

  .select-trigger--dock .select-trigger-chevron {
    position: absolute;
    right: 11px;
    top: 50%;
    transform: translateY(-50%);
  }

  .select-trigger--dock:hover:not(:disabled),
  .select-trigger--dock[aria-expanded='true'] {
    border-color: oklch(42% 0.02 92);
  }

  .select-trigger--dock[aria-expanded='true'] .select-trigger-chevron {
    transform: translateY(-50%) rotate(180deg);
  }

  /* Selected option row — rendered inside Select's content snippet, scoped here. */
  .popover-option {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    min-width: 0;
    padding: 10px 12px;
    border: none;
    border-radius: 10px;
    background: transparent;
    font-family: var(--font-sans);
    font-size: 14px;
    font-weight: 500;
    color: #e7e2d4;
    text-align: left;
    cursor: pointer;
    transition: background 0.14s ease;
  }

  .popover-option:hover {
    background: rgba(255, 255, 255, 0.05);
  }

  .popover-option[data-selected='true'] {
    background: rgba(255, 255, 255, 0.08);
  }

  .popover-option:disabled {
    cursor: default;
    opacity: 0.55;
  }
</style>
