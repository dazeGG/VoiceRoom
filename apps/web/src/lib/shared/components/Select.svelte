<script lang="ts">
  import { tick } from 'svelte';
  import Ellipsis from '$lib/shared/components/Ellipsis.svelte';
  import Popover from '$lib/shared/components/Popover.svelte';
  import type { SelectOption } from '$lib/shared/components/select-types';
  import '$lib/shared/styles/select.css';

  export type { SelectOption } from '$lib/shared/components/select-types';

  export type SelectVariant = 'field' | 'home' | 'compact' | 'dock';

  let {
    value = $bindable(''),
    options = [],
    label = '',
    disabled = false,
    placement = 'bottom-start',
    flip = false,
    variant = 'field',
    onValueChange
  }: {
    value?: string;
    options?: SelectOption[];
    label?: string;
    disabled?: boolean;
    placement?: 'bottom-end' | 'bottom-start' | 'top-end' | 'top-start';
    flip?: boolean;
    variant?: SelectVariant;
    onValueChange?: (value: string) => void;
  } = $props();

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
