<script lang="ts">
  import type { VolumeSliderProps } from './types';

  let {
    value = $bindable(100),
    min = 0,
    max = 200,
    step = 1,
    defaultValue = 100,
    snap = true,
    snapThreshold = 6,
    label = 'Громкость',
    showValue = true,
    showScale = true,
    disabled = false,
    ariaLabel,
    icon,
    onValueChange
  }: VolumeSliderProps = $props();

  // Fraction (0–1) the thumb sits at; drives the fill width and thumb offset via CSS calc.
  const fraction = $derived(
    max > min ? Math.min(1, Math.max(0, (value - min) / (max - min))) : 0
  );
  const percentText = $derived(`${Math.round(value)}%`);

  // Magnet-to-center only while dragging, so keyboard stepping can still pass
  // through the default value instead of getting stuck on it.
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
    if (snap && pointerActive && Math.abs(next - defaultValue) <= snapThreshold) {
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
  class="volume-slider"
  class:volume-slider--disabled={disabled}
  style:--volume-fraction={fraction}
>
  {#if label}
    <div class="volume-slider-head">
      <span class="volume-slider-label">
        {#if icon}
          {@render icon()}
        {:else}
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
            <path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path>
          </svg>
        {/if}
        <span>{label}</span>
      </span>
      {#if showValue}
        <output class="volume-slider-value">{percentText}</output>
      {/if}
    </div>
  {/if}

  <div class="volume-slider-control">
    <span class="volume-slider-track" aria-hidden="true">
      <span class="volume-slider-fill"></span>
      <span class="volume-slider-thumb"></span>
    </span>
    <input
      class="volume-slider-input"
      type="range"
      {min}
      {max}
      {step}
      {disabled}
      value={value}
      aria-label={ariaLabel || label || 'Громкость'}
      aria-valuetext={percentText}
      oninput={handleInput}
      onpointerdown={() => setPointerActive(true)}
      onpointerup={() => setPointerActive(false)}
      onpointercancel={() => setPointerActive(false)}
      onblur={() => setPointerActive(false)}
    />
  </div>

  {#if showScale}
    <div class="volume-slider-scale" aria-hidden="true">
      <span>{min}%</span>
      <span>{defaultValue}%</span>
      <span>{max}%</span>
    </div>
  {/if}
</div>

<style>
  .volume-slider {
    --volume-thumb: 16px;
    --volume-track-h: 8px;
    display: grid;
    gap: 9px;
    min-width: 0;
  }

  .volume-slider-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-sm, 12px);
  }

  .volume-slider-label {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    color: var(--ink, #ece7d9);
    font-family: var(--font-sans, sans-serif);
    font-size: 13.5px;
    font-weight: 700;
  }

  .volume-slider-label svg {
    flex: none;
    color: var(--muted, #9a9484);
  }

  .volume-slider-value {
    flex: none;
    color: var(--ink, #ece7d9);
    font-family: var(--font-sans, sans-serif);
    font-size: 13.5px;
    font-weight: 800;
    font-variant-numeric: tabular-nums;
  }

  .volume-slider-control {
    position: relative;
    display: grid;
    align-items: center;
    min-width: 0;
    height: var(--volume-thumb);
  }

  .volume-slider-track {
    position: relative;
    height: var(--volume-track-h);
    border-radius: 999px;
    background: oklch(15% 0.014 92);
  }

  .volume-slider-fill {
    position: absolute;
    inset: 0 auto 0 0;
    width: calc(var(--volume-thumb) / 2 + (100% - var(--volume-thumb)) * var(--volume-fraction));
    border-radius: inherit;
    background: var(--green, oklch(72% 0.16 164));
  }

  .volume-slider-thumb {
    position: absolute;
    top: 50%;
    left: calc(var(--volume-thumb) / 2 + (100% - var(--volume-thumb)) * var(--volume-fraction));
    width: var(--volume-thumb);
    height: var(--volume-thumb);
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.45);
    transform: translate(-50%, -50%);
  }

  /* Native input drives keyboard + a11y; its visuals are transparent and overlaid
     on the painted track/fill/thumb above. */
  .volume-slider-input {
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

  .volume-slider-input::-webkit-slider-runnable-track {
    height: 100%;
    background: transparent;
    border: 0;
  }

  .volume-slider-input::-webkit-slider-thumb {
    width: var(--volume-thumb);
    height: var(--volume-thumb);
    border: 0;
    border-radius: 50%;
    background: transparent;
    -webkit-appearance: none;
    appearance: none;
  }

  .volume-slider-input::-moz-range-track {
    height: 100%;
    background: transparent;
    border: 0;
  }

  .volume-slider-input::-moz-range-thumb {
    width: var(--volume-thumb);
    height: var(--volume-thumb);
    border: 0;
    border-radius: 50%;
    background: transparent;
  }

  .volume-slider-control:focus-within .volume-slider-thumb {
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.45), 0 0 0 4px color-mix(in oklch, var(--green, oklch(72% 0.16 164)) 45%, transparent);
  }

  .volume-slider-scale {
    display: flex;
    align-items: center;
    justify-content: space-between;
    color: var(--muted, #9a9484);
    font-family: var(--font-mono, monospace);
    font-size: 11px;
    letter-spacing: 0.02em;
  }

  .volume-slider--disabled {
    opacity: 0.55;
  }

  .volume-slider--disabled .volume-slider-input {
    cursor: not-allowed;
  }
</style>
