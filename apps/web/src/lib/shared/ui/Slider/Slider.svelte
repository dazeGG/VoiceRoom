<script lang="ts">
  import type { SliderProps } from './types';

  let {
    value = $bindable(0),
    min = 0,
    max = 100,
    step = 1,
    defaultValue = min,
    snap = false,
    snapThreshold = 0,
    disabled = false,
    ariaLabel = 'Значение',
    ariaValueText,
    onValueChange
  }: SliderProps = $props();

  const fraction = $derived(
    max > min ? Math.min(1, Math.max(0, (value - min) / (max - min))) : 0
  );

  let pointerActive = false;

  function commit(next: number): void {
    const clamped = Math.min(max, Math.max(min, next));
    if (clamped === value) return;
    value = clamped;
    onValueChange?.(clamped);
  }

  function handleInput(event: Event): void {
    const input = event.currentTarget as HTMLInputElement;
    let next = Number.parseFloat(input.value);
    if (!Number.isFinite(next)) next = defaultValue;
    if (snap && pointerActive && snapThreshold > 0 && Math.abs(next - defaultValue) <= snapThreshold) {
      next = defaultValue;
      input.value = String(next);
    }
    commit(next);
  }

  function setPointerActive(active: boolean): void {
    pointerActive = active;
  }
</script>

<div
  class="vr-slider"
  class:vr-slider--disabled={disabled}
  style:--slider-fraction={fraction}
>
  <div class="vr-slider-control">
    <span class="vr-slider-track" aria-hidden="true">
      <span class="vr-slider-fill"></span>
      <span class="vr-slider-thumb"></span>
    </span>
    <input
      class="vr-slider-input"
      type="range"
      {min}
      {max}
      {step}
      {disabled}
      value={value}
      aria-label={ariaLabel}
      aria-valuetext={ariaValueText}
      oninput={handleInput}
      onpointerdown={() => setPointerActive(true)}
      onpointerup={() => setPointerActive(false)}
      onpointercancel={() => setPointerActive(false)}
      onblur={() => setPointerActive(false)}
    />
  </div>
</div>

<style>
  .vr-slider {
    --slider-thumb: 16px;
    --slider-track-h: 8px;
    display: grid;
    min-width: 0;
  }

  .vr-slider-control {
    position: relative;
    display: grid;
    align-items: center;
    min-width: 0;
    height: var(--slider-thumb);
  }

  .vr-slider-track {
    position: relative;
    height: var(--slider-track-h);
    border-radius: 999px;
    background: oklch(15% 0.014 92);
  }

  .vr-slider-fill {
    position: absolute;
    inset: 0 auto 0 0;
    width: calc(var(--slider-thumb) / 2 + (100% - var(--slider-thumb)) * var(--slider-fraction));
    border-radius: inherit;
    background: var(--slider-fill, var(--green, oklch(72% 0.16 164)));
  }

  .vr-slider-thumb {
    position: absolute;
    top: 50%;
    left: calc(var(--slider-thumb) / 2 + (100% - var(--slider-thumb)) * var(--slider-fraction));
    width: var(--slider-thumb);
    height: var(--slider-thumb);
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.45);
    transform: translate(-50%, -50%);
  }

  .vr-slider-input {
    position: absolute;
    inset: 0;
    z-index: 2;
    width: 100%;
    height: 100%;
    margin: 0;
    padding: 0;
    border: 0;
    background: transparent;
    -webkit-appearance: none;
    appearance: none;
    cursor: pointer;
    outline: none;
  }

  .vr-slider-input::-webkit-slider-runnable-track {
    height: 100%;
    background: transparent;
    border: 0;
  }

  .vr-slider-input::-webkit-slider-thumb {
    width: var(--slider-thumb);
    height: var(--slider-thumb);
    border: 0;
    border-radius: 50%;
    background: transparent;
    -webkit-appearance: none;
    appearance: none;
  }

  .vr-slider-input::-moz-range-track {
    height: 100%;
    background: transparent;
    border: 0;
  }

  .vr-slider-input::-moz-range-thumb {
    width: var(--slider-thumb);
    height: var(--slider-thumb);
    border: 0;
    border-radius: 50%;
    background: transparent;
  }

  .vr-slider-control:focus-within .vr-slider-thumb {
    box-shadow:
      0 1px 3px rgba(0, 0, 0, 0.45),
      0 0 0 3px var(--focus-ring, color-mix(in oklch, var(--green, oklch(72% 0.16 164)) 28%, transparent));
  }

  .vr-slider--disabled {
    opacity: 0.55;
  }

  .vr-slider--disabled .vr-slider-input {
    cursor: not-allowed;
  }
</style>