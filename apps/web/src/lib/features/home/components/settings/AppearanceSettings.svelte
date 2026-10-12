<script lang="ts">
  // The colour theme: a card per theme with a small preview painted in that
  // theme's own colours; picking one applies it to the whole app at once.
  import { Check } from '@lucide/svelte';
  import { setTheme, themeState, THEMES } from '$lib/shared/theme/theme.svelte';
  import { iconSm } from '$lib/shared/ui/icons';
</script>

<div class="settings-appearance">
  <span class="settings-section-title">Тема</span>
  <div class="settings-themes" role="radiogroup" aria-label="Цветовая тема">
    {#each THEMES as theme (theme.id)}
      {@const selected = themeState.current === theme.id}
      <button
        class="settings-theme"
        class:is-selected={selected}
        type="button"
        role="radio"
        aria-checked={selected}
        data-theme={theme.id}
        onclick={() => setTheme(theme.id)}
      >
        <span class="settings-theme-preview" aria-hidden="true">
          <span class="settings-theme-side">
            <span class="settings-theme-mark"></span>
            <span class="settings-theme-line"></span>
            <span class="settings-theme-line is-short"></span>
          </span>
          <span class="settings-theme-main">
            <span class="settings-theme-line is-wide"></span>
            <span class="settings-theme-button"></span>
          </span>
        </span>
        <span class="settings-theme-label">
          {theme.label}
          {#if selected}<Check {...iconSm} aria-hidden="true" />{/if}
        </span>
      </button>
    {/each}
  </div>
</div>

<style>
  .settings-appearance {
    display: grid;
    gap: 14px;
  }
  .settings-themes {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 14px;
  }
  .settings-theme {
    display: grid;
    gap: 10px;
    padding: 10px;
    border: 1px solid var(--vr-line-strong);
    border-radius: 14px;
    background: var(--vr-surface-2);
    color: var(--vr-text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .settings-theme.is-selected {
    border-color: transparent;
    box-shadow: 0 0 0 2px var(--vr-accent);
  }
  .settings-theme-preview {
    display: flex;
    height: 112px;
    overflow: hidden;
    border-radius: 10px;
    background: var(--vr-bg);
    box-shadow: inset 0 0 0 1px var(--vr-line);
  }
  .settings-theme-side {
    display: flex;
    flex: none;
    flex-direction: column;
    gap: 8px;
    width: 38%;
    padding: 12px 10px;
    background: var(--vr-surface);
  }
  .settings-theme-mark {
    width: 16px;
    height: 16px;
    background: var(--vr-accent);
    mask: url('/voiceroom-mascot.svg') center / contain no-repeat;
  }
  .settings-theme-line {
    display: block;
    height: 7px;
    border-radius: 4px;
    background: var(--vr-surface-3);
  }
  .settings-theme-line.is-short {
    width: 60%;
  }
  .settings-theme-main {
    display: flex;
    flex: 1;
    flex-direction: column;
    justify-content: space-between;
    padding: 12px 10px;
  }
  .settings-theme-line.is-wide {
    width: 70%;
  }
  .settings-theme-button {
    align-self: flex-end;
    width: 46px;
    height: 16px;
    border-radius: 6px;
    background: var(--vr-accent);
  }
  .settings-theme-label {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 2px;
    font-size: 14px;
    font-weight: 500;
  }
  .settings-theme-label :global(svg) {
    color: var(--vr-accent);
  }
</style>
