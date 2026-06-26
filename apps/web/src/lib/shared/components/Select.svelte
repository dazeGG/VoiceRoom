<script lang="ts">
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
    variant = 'field',
    onValueChange
  }: {
    value?: string;
    options?: SelectOption[];
    label?: string;
    disabled?: boolean;
    placement?: 'bottom-end' | 'bottom-start' | 'top-end' | 'top-start';
    variant?: SelectVariant;
    onValueChange?: (value: string) => void;
  } = $props();

  const selectedLabel = $derived(
    options.find((option) => option.value === value)?.label
      ?? options[0]?.label
      ?? '—'
  );

  function choose(next: string, close: () => void): void {
    if (disabled) return;
    const changed = next !== value;
    value = next;
    if (changed) onValueChange?.(next);
    close();
  }
</script>

<div class="select-root">
  <Popover {placement} role="listbox" ariaLabel={label} panelClass="select-panel">
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
      {#each options as option (option.value)}
        <button
          class="popover-option"
          type="button"
          role="option"
          aria-selected={option.value === value}
          data-selected={option.value === value}
          onclick={() => choose(option.value, close)}
        >
          <Ellipsis text={option.label} title={option.label} />
        </button>
      {/each}
    {/snippet}
  </Popover>
</div>