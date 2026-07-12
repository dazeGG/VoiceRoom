<script lang="ts">
  import { RotateCcw } from '@lucide/svelte';
  import { iconSm } from '$lib/shared/ui/icons';
  import {
    formatHotkeyBinding,
    hotkeyBindingFromEvent,
    isHotkeyModifierCode
  } from './hotkey.js';
  import type { HotkeyRecorderProps } from './types';

  let {
    value = $bindable(null),
    defaultValue = null,
    disabled = false,
    ariaLabel = 'Горячая клавиша',
    onValueChange
  }: HotkeyRecorderProps = $props();

  let recording = $state(false);
  let recorderButton = $state<HTMLButtonElement>();

  function startRecording(): void {
    if (disabled) return;
    recording = true;
    recorderButton?.focus();
  }

  function stopRecording(): void {
    recording = false;
  }

  function captureKey(event: KeyboardEvent): void {
    if (!recording) return;
    event.preventDefault();
    event.stopImmediatePropagation();

    if (event.key === 'Escape') {
      stopRecording();
      return;
    }
    if (isHotkeyModifierCode(event.code)) return;

    const next = hotkeyBindingFromEvent(event);
    if (!next) return;
    value = next;
    stopRecording();
    onValueChange?.(next);
  }

  function reset(): void {
    if (disabled) return;
    value = defaultValue;
    stopRecording();
    onValueChange?.(defaultValue);
  }

  function handleFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget instanceof Node && event.currentTarget.contains(next)) return;
    stopRecording();
  }
</script>

<svelte:window onkeydown={captureKey} />

<div class="hotkey-recorder" onfocusout={handleFocusOut}>
  <button
    bind:this={recorderButton}
    class="hotkey-recorder-field"
    type="button"
    {disabled}
    data-hotkey-recorder-recording={recording}
    aria-label={ariaLabel}
    aria-pressed={recording}
    onclick={startRecording}
  >
    <span class="hotkey-recorder-value" data-empty={!value}>
      {recording ? 'Нажмите клавиши…' : formatHotkeyBinding(value)}
    </span>
  </button>
  <button
    class="hotkey-recorder-reset"
    type="button"
    {disabled}
    aria-label={`Сбросить: ${ariaLabel}`}
    title="Сбросить"
    onclick={reset}
  >
    <RotateCcw {...iconSm} aria-hidden="true" />
  </button>
</div>

<style>
  .hotkey-recorder {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 38px;
    gap: 8px;
  }

  .hotkey-recorder-field,
  .hotkey-recorder-reset {
    min-height: 38px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.045);
    color: var(--warm-ink, #f1ecdf);
    cursor: pointer;
    transition: border-color 150ms ease, background 150ms ease;
  }

  .hotkey-recorder-field {
    min-width: 0;
    padding: 0 12px;
    text-align: left;
  }

  .hotkey-recorder-field:hover,
  .hotkey-recorder-reset:hover {
    border-color: rgba(255, 255, 255, 0.22);
    background: rgba(255, 255, 255, 0.08);
  }

  .hotkey-recorder-field:focus-visible,
  .hotkey-recorder-reset:focus-visible,
  .hotkey-recorder-field[aria-pressed='true'] {
    border-color: var(--green, #64c99a);
    outline: none;
    box-shadow: 0 0 0 2px color-mix(in oklch, var(--green, #64c99a) 18%, transparent);
  }

  .hotkey-recorder-value {
    display: block;
    overflow: hidden;
    font-family: var(--font-ui, system-ui);
    font-size: 13px;
    font-weight: 700;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .hotkey-recorder-value[data-empty='true'] {
    color: var(--warm-faint, #8f897b);
    font-weight: 600;
  }

  .hotkey-recorder-reset {
    display: grid;
    place-items: center;
    padding: 0;
    color: var(--warm-muted, #aaa394);
  }

  button:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }
</style>
