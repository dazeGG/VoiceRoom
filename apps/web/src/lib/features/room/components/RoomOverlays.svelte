<script lang="ts">
  import { AppWindow, Check, Monitor, Play, Settings, Type, X } from '@lucide/svelte';
  import { iconMd, iconSm, iconXs } from '$lib/shared/ui/icons';
  import { onMount } from 'svelte';
  import {
    cancelScreenSourcePicker,
    closeScreenSourceOnBackdrop,
    confirmScreenSourcePicker,
    switchScreenTab
  } from '../client/ui/screen-source-picker';
  import { guestNameUi } from '../guest-name-ui.svelte';
  import { screenSourceUi } from '../screen-source-ui.svelte';
  import { dismissToastUi, toastUi } from '../toast-ui.svelte';
  import { ToastStack } from '$lib/shared/ui';
  import { startUi } from '../start-ui.svelte';
  import { unlockAudio } from '../client/services/media-playback-service';
  import {
    clearGuestNameError,
    handleGuestNameDialogClick,
    handleGuestNameDialogKeydown,
    handleGuestNameSubmit,
    syncGuestNameDialogInert
  } from '../client/ui/names';
  import { createLogger, errorContext } from '$lib/shared/log';

  const log = createLogger('room:overlays');

  let guestNameDialog: HTMLDivElement | undefined;
  let guestNameInput: HTMLInputElement | undefined;

  const hasScreenSources = $derived(screenSourceUi.sources.some((s) => s.type === 'screen'));
  const hasWindowSources = $derived(screenSourceUi.sources.some((s) => s.type !== 'screen'));
  const showTabs = $derived(hasScreenSources && hasWindowSources);
  const filteredSources = $derived(
    screenSourceUi.sources.filter((s) => (screenSourceUi.tab === 'screens' ? s.type === 'screen' : s.type !== 'screen'))
  );
  const selectedSource = $derived(screenSourceUi.sources.find((s) => s.id === screenSourceUi.selectedSourceId));
  const qualityLabel = $derived(
    screenSourceUi.mode === 'text' ? 'Источник' : screenSourceUi.quality === 'high' ? '1080p' : '720p'
  );
  const fpsLabel = $derived(screenSourceUi.mode === 'text' ? '5 к/с' : `${screenSourceUi.fps} к/с`);
  const summaryName = $derived(selectedSource?.name ?? 'Не выбрано');
  const summaryDetail = $derived(
    `${screenSourceUi.mode === 'text' ? 'Текст' : screenSourceUi.quality === 'high' ? 'HD' : 'SD'} · ${qualityLabel} · ${fpsLabel}${screenSourceUi.audio ? ' · звук' : ''}`
  );

  $effect(() => {
    syncGuestNameDialogInert(guestNameUi.open, guestNameDialog ?? null);
  });

  onMount(() => {
    return () => syncGuestNameDialogInert(false, guestNameDialog ?? null);
  });
</script>

<ToastStack id="toast" toasts={toastUi.items} onDismiss={dismissToastUi} />

<div
  bind:this={guestNameDialog}
  class="guest-name-dialog"
  id="guestNameDialog"
  role="dialog"
  aria-modal="true"
  aria-labelledby="guestNameTitle"
  hidden={!guestNameUi.open}
  tabindex="-1"
  onclick={(event) => handleGuestNameDialogClick(event, guestNameInput ?? null)}
  onkeydown={(event) => guestNameDialog && handleGuestNameDialogKeydown(event, guestNameDialog, guestNameInput ?? null)}
>
  <section class="guest-name-panel">
    <div class="guest-name-heading">
      <p class="eyebrow">вход в комнату</p>
      <h2 id="guestNameTitle">Как вас зовут?</h2>
      <p>Имя будет видно участникам этой голосовой комнаты.</p>
    </div>

    <form class="guest-name-form" id="guestNameForm" onsubmit={handleGuestNameSubmit}>
      <label class="field" for="guestNameInput">
        <span>Ваше имя</span>
        <input
          bind:this={guestNameInput}
          id="guestNameInput"
          bind:value={guestNameUi.inputValue}
          maxlength="40"
          autocomplete="name"
          placeholder="Ваше имя"
          oninput={clearGuestNameError}
        />
      </label>
      <p class="guest-name-error" id="guestNameError" role="alert" aria-live="polite">{guestNameUi.error}</p>
      <button class="primary-button" id="guestNameSubmitButton" type="submit">Войти в комнату</button>
    </form>
  </section>
</div>

<div
  class="screen-source-dialog"
  id="screenSourceDialog"
  role="dialog"
  aria-modal="true"
  aria-labelledby="screenSourceTitle"
  hidden={!screenSourceUi.open}
  tabindex="-1"
  onpointerdown={closeScreenSourceOnBackdrop}
>
  <section class="screen-source-panel">
    <!-- Header -->
    <div class="screen-source-heading">
      <h2 id="screenSourceTitle">Выберите, что показать</h2>
      <button class="screen-source-close" type="button" aria-label="Отменить выбор" onclick={cancelScreenSourcePicker}>
        <X {...iconMd} aria-hidden="true" />
      </button>
    </div>

    <!-- Tabs -->
    {#if showTabs}
      <div class="screen-source-tabs">
        <button
          class="screen-source-tab"
          aria-pressed={screenSourceUi.tab === 'screens'}
          onclick={() => switchScreenTab('screens')}
        >
          <Monitor {...iconSm} aria-hidden="true" />
          Экраны
        </button>
        <button
          class="screen-source-tab"
          aria-pressed={screenSourceUi.tab === 'windows'}
          onclick={() => switchScreenTab('windows')}
        >
          <AppWindow {...iconSm} aria-hidden="true" />
          Окна
        </button>
      </div>
    {/if}

    <!-- Source grid -->
    <div class="screen-source-options" id="screenSourceOptions">
      {#each filteredSources as source (source.id)}
        {@const selected = source.id === screenSourceUi.selectedSourceId}
        <button
          class="screen-source-option"
          type="button"
          aria-pressed={selected}
          aria-label={source.name}
          onclick={() => {
            screenSourceUi.selectedSourceId = source.id;
          }}
        >
          <span class="screen-source-preview">
            {#if source.thumbnail}
              <img alt="" src={source.thumbnail} />
            {:else}
              <span class="screen-source-placeholder" aria-hidden="true">
                <span class="screen-source-ph-bar"></span>
                <span class="screen-source-ph-left"></span>
                <span class="screen-source-ph-right"></span>
              </span>
            {/if}
            {#if selected}
              <span class="screen-source-check" aria-hidden="true">
                <Check {...iconXs} color="var(--vr-accent-ink)" aria-hidden="true" />
              </span>
            {/if}
          </span>
          <span class="screen-source-label">
            {#if source.appIcon}
              <img alt="" src={source.appIcon} />
            {:else if source.type === 'screen'}
              <Monitor {...iconSm} aria-hidden="true" />
            {:else}
              <AppWindow {...iconSm} aria-hidden="true" />
            {/if}
            <span>{source.name}</span>
          </span>
        </button>
      {/each}
    </div>

    <!-- Footer bar -->
    <div class="screen-source-footer">
      <div class="screen-source-summary">
        <span class="screen-source-summary-icon" aria-hidden="true">
          <Monitor {...iconSm} aria-hidden="true" />
        </span>
        <div class="screen-source-summary-text">
          <div class="screen-source-summary-name">{summaryName}</div>
          <div class="screen-source-summary-detail">{summaryDetail}</div>
        </div>
      </div>

      <div class="screen-source-footer-actions">
        <!-- SD / HD toggle -->
        {#if screenSourceUi.mode === 'games'}
          <div class="screen-source-res-toggle" role="group" aria-label="Качество">
            <button
              class="screen-source-res-btn"
              aria-pressed={screenSourceUi.quality === 'balanced'}
              onclick={() => {
                screenSourceUi.quality = 'balanced';
              }}>SD</button
            >
            <button
              class="screen-source-res-btn"
              aria-pressed={screenSourceUi.quality === 'high'}
              onclick={() => {
                screenSourceUi.quality = 'high';
              }}>HD</button
            >
          </div>
          <div class="screen-source-res-toggle" role="group" aria-label="Частота кадров">
            <button
              class="screen-source-res-btn"
              aria-pressed={screenSourceUi.fps === '30'}
              onclick={() => {
                screenSourceUi.fps = '30';
              }}>30</button
            >
            <button
              class="screen-source-res-btn"
              aria-pressed={screenSourceUi.fps === '60'}
              title="60 к/с: плавнее, но вдвое больше нагрузки на кодирование и сеть"
              onclick={() => {
                screenSourceUi.fps = '60';
              }}>60</button
            >
          </div>
        {/if}

        <!-- Settings gear + popover -->
        <div class="screen-source-gear-wrap">
          <button
            class="screen-source-gear"
            aria-pressed={screenSourceUi.popOpen}
            title="Настройки стрима"
            onclick={() => {
              screenSourceUi.popOpen = !screenSourceUi.popOpen;
            }}
          >
            <Settings {...iconMd} aria-hidden="true" />
          </button>

          {#if screenSourceUi.popOpen}
            <div class="screen-source-popover" role="dialog" aria-label="Настройки стрима">
              <div class="screen-source-pop-label">Режим стрима</div>
              <div class="screen-source-pop-presets">
                <button
                  class="screen-source-pop-preset"
                  aria-pressed={screenSourceUi.mode === 'games'}
                  onclick={() => {
                    screenSourceUi.mode = 'games';
                  }}
                >
                  <span class="screen-source-pop-icon">
                    <Play {...iconSm} aria-hidden="true" />
                  </span>
                  <span class="screen-source-pop-info">
                    <span class="screen-source-pop-title">Плавное видео</span>
                    <span class="screen-source-pop-desc">30–60 к/с · для игр и видео</span>
                  </span>
                  <span class="screen-source-pop-radio" aria-hidden="true">
                    {#if screenSourceUi.mode === 'games'}<span class="screen-source-pop-dot"></span>{/if}
                  </span>
                </button>
                <button
                  class="screen-source-pop-preset"
                  aria-pressed={screenSourceUi.mode === 'text'}
                  onclick={() => {
                    screenSourceUi.mode = 'text';
                  }}
                >
                  <span class="screen-source-pop-icon">
                    <Type {...iconSm} aria-hidden="true" />
                  </span>
                  <span class="screen-source-pop-info">
                    <span class="screen-source-pop-title">Чёткая картинка</span>
                    <span class="screen-source-pop-desc">5 к/с · для текста и кода</span>
                  </span>
                  <span class="screen-source-pop-radio" aria-hidden="true">
                    {#if screenSourceUi.mode === 'text'}<span class="screen-source-pop-dot"></span>{/if}
                  </span>
                </button>
              </div>
              <div class="screen-source-pop-sep"></div>
              <button
                class="screen-source-pop-audio"
                role="switch"
                aria-checked={screenSourceUi.audio}
                onclick={() => {
                  screenSourceUi.audio = !screenSourceUi.audio;
                }}
              >
                <span class="screen-source-pop-audio-label">Звук стрима</span>
                <span class="screen-source-toggle" aria-hidden="true" data-on={screenSourceUi.audio}>
                  <span class="screen-source-toggle-knob"></span>
                </span>
              </button>
            </div>
          {/if}
        </div>

        <!-- Launch -->
        <button
          class="screen-source-launch"
          type="button"
          disabled={!screenSourceUi.selectedSourceId}
          onclick={confirmScreenSourcePicker}
        >
          <Play {...iconSm} fill="currentColor" aria-hidden="true" />
          Запустить
        </button>
      </div>
    </div>
  </section>
</div>

<button
  class="sound-button"
  id="soundButton"
  type="button"
  hidden={!startUi.soundButtonVisible}
  onclick={() => unlockAudio().catch((error) => log.warn('audio unlock failed', errorContext(error)))}
  >Разрешить звук</button
>

<style>
  :global(.guest-name-dialog) {
    position: fixed;
    inset: 0;
    z-index: 22;
    display: grid;
    place-items: center;
    padding: var(--space-lg);
    background: color-mix(in srgb, var(--vr-bg) 76%, transparent);
  }
  :global(.guest-name-panel) {
    display: grid;
    width: min(430px, 100%);
    gap: var(--space-lg);
    border: 1px solid var(--vr-text-3);
    border-radius: var(--radius-md);
    padding: var(--space-lg);
    background: var(--vr-surface-2);
    box-shadow: var(--vr-shadow-popover);
  }
  :global(.guest-name-form) {
    display: grid;
    gap: var(--space-md);
  }
  :global(.guest-name-error) {
    min-height: 1.2em;
    margin: calc(var(--space-xs) * -1) 0 0;
    color: color-mix(in oklch, var(--vr-danger), var(--vr-text) 22%);
    font-size: 0.84rem;
    font-weight: 750;
  }
  :global(.screen-source-close) {
    display: grid;
    width: 38px;
    height: 38px;
    flex: 0 0 auto;
    place-items: center;
    border: 1px solid var(--vr-line-strong);
    border-radius: 11px;
    padding: 0;
    background: var(--vr-surface-3);
    color: var(--vr-text-2);
    transition:
      background 140ms var(--ease-out),
      color 140ms var(--ease-out);
  }
  :where(.screen-source-close):hover {
    background: var(--vr-surface-3-hover);
    color: var(--vr-text);
  }
  :global(.screen-source-tabs) {
    display: inline-flex;
    gap: 4px;
    margin: 20px 28px 0;
    padding: 4px;
    background: var(--vr-bg);
    border: 1px solid var(--vr-line);
    border-radius: 13px;
  }
  :global(.screen-source-tab) {
    display: flex;
    align-items: center;
    gap: 7px;
    border: none;
    border-radius: 9px;
    padding: 8px 15px;
    background: transparent;
    color: var(--vr-text-2);
    font-size: 0.84rem;
    font-weight: 600;
    transition: color 140ms var(--ease-out);
  }
  :where(.screen-source-tab)[aria-pressed='true'] {
    background: var(--vr-accent);
    color: var(--vr-accent-ink);
    font-weight: 700;
  }
  :where(.screen-source-tab):not([aria-pressed='true']):hover {
    color: var(--vr-text);
  }
  :global(.screen-source-option) {
    display: grid;
    min-width: 0;
    grid-template-rows: auto minmax(42px, auto);
    gap: 0;
    border: 1.5px solid var(--vr-line);
    border-radius: 15px;
    padding: 9px;
    background: var(--vr-surface);
    color: inherit;
    text-align: left;
    transition:
      border-color 140ms var(--ease-out),
      background 140ms var(--ease-out);
  }
  :where(.screen-source-option)[aria-pressed='true'] {
    border-color: color-mix(in oklch, var(--vr-text) 70%, transparent);
    background: var(--vr-surface-3);
  }
  :where(.screen-source-option):not([aria-pressed='true']):hover,
  :where(.screen-source-option):not([aria-pressed='true']):focus-visible {
    border-color: var(--vr-line-strong);
    background: var(--vr-surface-3);
  }
  :global(.screen-source-preview) {
    position: relative;
    display: block;
    width: 100%;
    aspect-ratio: 16 / 10;
    border-radius: 11px;
    overflow: hidden;
    background: var(--vr-bg);
  }
  :where(.screen-source-preview) img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  :global(.screen-source-placeholder) {
    position: absolute;
    inset: 0;
    background-image: repeating-linear-gradient(
      135deg,
      color-mix(in oklch, var(--vr-line-strong) 40%, transparent) 0 2px,
      transparent 2px 11px
    );
  }
  :global(.screen-source-ph-bar) {
    position: absolute;
    left: 11px;
    top: 11px;
    right: 11px;
    height: 7px;
    border-radius: 3px;
    background: var(--vr-surface-3-hover);
  }
  :global(.screen-source-ph-left) {
    position: absolute;
    left: 11px;
    top: 26px;
    width: 38%;
    bottom: 12px;
    border-radius: 6px;
    background: var(--vr-surface-3);
  }
  :global(.screen-source-ph-right) {
    position: absolute;
    left: calc(38% + 20px);
    top: 26px;
    right: 11px;
    bottom: 12px;
    border-radius: 6px;
    background: var(--vr-surface-3);
  }
  :global(.screen-source-check) {
    position: absolute;
    top: 9px;
    right: 9px;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: var(--vr-text);
  }
  :global(.screen-source-label) {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    padding: 12px 4px 2px;
    color: var(--vr-text-2);
    font-size: 0.875rem;
    font-weight: 700;
    letter-spacing: -0.01em;
    transition: color 140ms var(--ease-out);
  }
  :where(.screen-source-option)[aria-pressed='true'] .screen-source-label {
    color: var(--vr-text);
  }
  :where(.screen-source-label) img {
    width: 20px;
    height: 20px;
    flex: 0 0 auto;
  }
  :global(.screen-source-label svg) {
    flex: 0 0 auto;
    color: var(--vr-text-3);
    transition: color 140ms var(--ease-out);
  }
  :global(.screen-source-option[aria-pressed='true'] .screen-source-label svg) {
    color: var(--vr-text);
  }
  :where(.screen-source-label) > span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  :global(.screen-source-footer) {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 16px 20px;
    border-top: 1px solid var(--vr-line);
    background: color-mix(in oklch, var(--vr-bg), transparent 50%);
    flex-wrap: wrap;
  }
  :global(.screen-source-summary) {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    flex: 1;
  }
  :global(.screen-source-summary-icon) {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
    width: 36px;
    height: 36px;
    border: 1px solid var(--vr-line);
    border-radius: 10px;
    background: var(--vr-surface-3);
    color: var(--vr-text-2);
  }
  :global(.screen-source-summary-text) {
    min-width: 0;
  }
  :global(.screen-source-summary-name) {
    font-size: 0.84rem;
    font-weight: 700;
    color: var(--vr-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  :global(.screen-source-summary-detail) {
    font-size: 0.69rem;
    font-family: var(--font-mono, monospace);
    color: var(--vr-text-3);
    margin-top: 2px;
  }
  :global(.screen-source-footer-actions) {
    display: flex;
    align-items: center;
    gap: 10px;
    flex: 0 0 auto;
  }
  :global(.screen-source-res-toggle) {
    display: inline-flex;
    gap: 3px;
    padding: 3px;
    background: var(--vr-bg);
    border: 1px solid var(--vr-line);
    border-radius: 11px;
  }
  :global(.screen-source-res-btn) {
    border: none;
    border-radius: 8px;
    padding: 8px 16px;
    background: transparent;
    color: var(--vr-text-2);
    font-size: 0.81rem;
    font-weight: 600;
    transition:
      background 140ms var(--ease-out),
      color 140ms var(--ease-out);
  }
  :where(.screen-source-res-btn)[aria-pressed='true'] {
    background: var(--vr-accent);
    color: var(--vr-accent-ink);
    font-weight: 700;
  }
  :where(.screen-source-res-btn):not([aria-pressed='true']):hover {
    color: var(--vr-text);
  }
  :global(.screen-source-gear-wrap) {
    position: relative;
  }
  :global(.screen-source-gear) {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 42px;
    height: 42px;
    flex: 0 0 auto;
    border: 1px solid var(--vr-line);
    border-radius: 11px;
    background: var(--vr-surface-3);
    color: var(--vr-text-2);
    transition:
      background 140ms var(--ease-out),
      color 140ms var(--ease-out),
      border-color 140ms var(--ease-out);
  }
  :where(.screen-source-gear)[aria-pressed='true'] {
    border-color: color-mix(in oklch, var(--vr-text) 70%, transparent);
    background: var(--vr-surface-3);
    color: var(--vr-text);
  }
  :where(.screen-source-gear):not([aria-pressed='true']):hover {
    background: var(--vr-surface-3-hover);
    color: var(--vr-text);
  }
  :global(.screen-source-popover) {
    position: absolute;
    right: 0;
    bottom: calc(100% + 10px);
    width: 320px;
    z-index: 30;
    padding: 16px;
    background: var(--vr-surface-2);
    border: 1px solid var(--vr-line-strong);
    border-radius: 16px;
    box-shadow: 0 24px 60px oklch(0% 0 0 / 0.55);
    animation: screen-pop 160ms var(--ease-out);
    transform-origin: bottom right;
  }
  :global(.screen-source-pop-label) {
    padding: 2px 4px 12px;
    font-family: var(--font-ui, sans-serif);
    font-size: 0.66rem;
    font-weight: 500;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--vr-text-3);
  }
  :global(.screen-source-pop-presets) {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  :global(.screen-source-pop-preset) {
    display: flex;
    align-items: center;
    gap: 11px;
    width: 100%;
    padding: 9px;
    border: 1px solid transparent;
    border-radius: 11px;
    background: transparent;
    color: inherit;
    text-align: left;
    transition:
      background 140ms var(--ease-out),
      border-color 140ms var(--ease-out);
  }
  :where(.screen-source-pop-preset)[aria-pressed='true'] {
    background: var(--vr-surface-3);
    border-color: color-mix(in oklch, var(--vr-text) 28%, transparent);
  }
  :where(.screen-source-pop-preset):not([aria-pressed='true']):hover {
    background: var(--vr-surface-3);
  }
  :global(.screen-source-pop-icon) {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
    width: 34px;
    height: 34px;
    border-radius: 9px;
    background: var(--vr-surface-3);
    color: var(--vr-text-2);
    transition:
      background 140ms var(--ease-out),
      color 140ms var(--ease-out);
  }
  :where(.screen-source-pop-preset)[aria-pressed='true'] .screen-source-pop-icon {
    background: var(--vr-surface-3-hover);
    color: var(--vr-text);
  }
  :global(.screen-source-pop-info) {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
  }
  :global(.screen-source-pop-title) {
    font-size: 0.84rem;
    font-weight: 700;
    letter-spacing: -0.01em;
    color: var(--vr-text-2);
    transition: color 140ms var(--ease-out);
  }
  :where(.screen-source-pop-preset)[aria-pressed='true'] .screen-source-pop-title {
    color: var(--vr-text);
  }
  :global(.screen-source-pop-desc) {
    font-size: 0.72rem;
    color: var(--vr-text-3);
    margin-top: 1px;
  }
  :global(.screen-source-pop-radio) {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
    width: 18px;
    height: 18px;
    border: 1.6px solid color-mix(in oklch, var(--vr-text) 22%, transparent);
    border-radius: 50%;
    transition: border-color 140ms var(--ease-out);
  }
  :where(.screen-source-pop-preset)[aria-pressed='true'] .screen-source-pop-radio {
    border-color: var(--vr-text);
  }
  :global(.screen-source-pop-dot) {
    display: block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--vr-text);
  }
  :global(.screen-source-pop-sep) {
    margin: 12px 0 0;
    padding-top: 14px;
    border-top: 1px solid var(--vr-line);
  }
  :global(.screen-source-pop-audio) {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    width: 100%;
    padding: 9px 8px;
    border: none;
    border-radius: 10px;
    background: transparent;
    color: inherit;
    transition: background 140ms var(--ease-out);
  }
  :where(.screen-source-pop-audio):hover {
    background: var(--vr-surface-3);
  }
  :global(.screen-source-pop-audio-label) {
    font-size: 0.84rem;
    font-weight: 600;
    color: var(--vr-text);
  }
  :global(.screen-source-launch) {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 42px;
    padding: 0 20px;
    border: none;
    border-radius: 12px;
    background: var(--vr-accent);
    color: var(--vr-accent-ink);
    font-size: 0.91rem;
    font-weight: 700;
    letter-spacing: -0.01em;
    transition:
      transform 120ms var(--ease-out),
      opacity 120ms var(--ease-out);
  }
  :where(.screen-source-launch):not(:disabled):hover {
    transform: translateY(-1px);
  }
  :where(.screen-source-launch):disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
</style>
