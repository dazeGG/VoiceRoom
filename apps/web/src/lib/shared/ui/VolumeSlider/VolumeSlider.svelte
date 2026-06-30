<script lang="ts">
  import { Slider } from '../Slider';
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

  const percentText = $derived(`${Math.round(value)}%`);
</script>

<div class="volume-slider">
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

  <Slider
    bind:value
    {min}
    {max}
    {step}
    {defaultValue}
    {snap}
    {snapThreshold}
    {disabled}
    ariaLabel={ariaLabel || label || 'Громкость'}
    ariaValueText={percentText}
    {onValueChange}
  />

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

  .volume-slider-scale {
    display: flex;
    align-items: center;
    justify-content: space-between;
    color: var(--muted, #9a9484);
    font-family: var(--font-mono, monospace);
    font-size: 11px;
    letter-spacing: 0.02em;
  }
</style>