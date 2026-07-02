<script lang="ts">
  import { onMount } from 'svelte';
  import {
    cancelScreenSourcePicker,
    closeScreenSourceOnBackdrop,
    confirmScreenSourcePicker,
    switchScreenTab
  } from '../client/ui/screen-source-picker';
  import { guestNameUi } from '../guest-name-ui.svelte';
  import { screenSourceUi } from '../screen-source-ui.svelte';
  import { toastUi } from '../toast-ui.svelte';
  import { startUi } from '../start-ui.svelte';
  import { unlockAudio } from '../client/services/media-playback-service';
  import {
    clearGuestNameError,
    handleGuestNameDialogClick,
    handleGuestNameDialogKeydown,
    handleGuestNameSubmit,
    syncGuestNameDialogInert
  } from '../client/ui/names';

  let guestNameDialog: HTMLDivElement | undefined;
  let guestNameInput: HTMLInputElement | undefined;

  const hasScreenSources = $derived(screenSourceUi.sources.some((s) => s.type === 'screen'));
  const hasWindowSources = $derived(screenSourceUi.sources.some((s) => s.type !== 'screen'));
  const showTabs = $derived(hasScreenSources && hasWindowSources);
  const filteredSources = $derived(screenSourceUi.sources.filter((s) =>
    screenSourceUi.tab === 'screens' ? s.type === 'screen' : s.type !== 'screen'
  ));
  const selectedSource = $derived(screenSourceUi.sources.find((s) => s.id === screenSourceUi.selectedSourceId));
  const qualityLabel = $derived(screenSourceUi.quality === 'high' ? '1080p' : '720p');
  const fpsLabel = $derived(screenSourceUi.mode === 'text' ? '5 к/с' : '30 к/с');
  const summaryName = $derived(selectedSource?.name ?? 'Не выбрано');
  const summaryDetail = $derived(`${screenSourceUi.quality === 'high' ? 'HD' : 'SD'} · ${qualityLabel} · ${fpsLabel}${screenSourceUi.audio ? ' · звук' : ''}`);

  $effect(() => {
    syncGuestNameDialogInert(guestNameUi.open, guestNameDialog ?? null);
  });

  onMount(() => {
    return () => syncGuestNameDialogInert(false, guestNameDialog ?? null);
  });
</script>

<div class="toast" id="toast" role="status" aria-live="polite" data-variant={toastUi.variant} data-visible={String(toastUi.visible)}>
  {toastUi.message}
</div>

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
      <button
        class="screen-source-close"
        type="button"
        aria-label="Отменить выбор"
        onclick={cancelScreenSourcePicker}
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" />
        </svg>
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
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" />
        </svg>
        Экраны
      </button>
      <button
        class="screen-source-tab"
        aria-pressed={screenSourceUi.tab === 'windows'}
        onclick={() => switchScreenTab('windows')}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="3" y="4" width="18" height="16" rx="2" /><line x1="3" y1="9" x2="21" y2="9" />
        </svg>
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
          onclick={() => { screenSourceUi.selectedSourceId = source.id; }}
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
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#17150f" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M5 13l4 4L19 7" />
                </svg>
              </span>
            {/if}
          </span>
          <span class="screen-source-label">
            {#if source.appIcon}
              <img alt="" src={source.appIcon} />
            {:else if source.type === 'screen'}
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" />
              </svg>
            {:else}
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <rect x="3" y="4" width="18" height="16" rx="2" /><line x1="3" y1="9" x2="21" y2="9" />
              </svg>
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
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" />
          </svg>
        </span>
        <div class="screen-source-summary-text">
          <div class="screen-source-summary-name">{summaryName}</div>
          <div class="screen-source-summary-detail">{summaryDetail}</div>
        </div>
      </div>

      <div class="screen-source-footer-actions">
        <!-- SD / HD toggle -->
        <div class="screen-source-res-toggle" role="group" aria-label="Качество">
          <button
            class="screen-source-res-btn"
            aria-pressed={screenSourceUi.quality === 'balanced'}
            onclick={() => { screenSourceUi.quality = 'balanced'; }}
          >SD</button>
          <button
            class="screen-source-res-btn"
            aria-pressed={screenSourceUi.quality === 'high'}
            onclick={() => { screenSourceUi.quality = 'high'; }}
          >HD</button>
        </div>

        <!-- Settings gear + popover -->
        <div class="screen-source-gear-wrap">
          <button
            class="screen-source-gear"
            aria-pressed={screenSourceUi.popOpen}
            title="Настройки стрима"
            onclick={() => { screenSourceUi.popOpen = !screenSourceUi.popOpen; }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9" />
            </svg>
          </button>

          {#if screenSourceUi.popOpen}
          <div class="screen-source-popover" role="dialog" aria-label="Настройки стрима">
            <div class="screen-source-pop-label">Режим стрима</div>
            <div class="screen-source-pop-presets">
              <button
                class="screen-source-pop-preset"
                aria-pressed={screenSourceUi.mode === 'games'}
                onclick={() => { screenSourceUi.mode = 'games'; }}
              >
                <span class="screen-source-pop-icon">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <polygon points="5 3 19 12 5 21 5 3" />
                  </svg>
                </span>
                <span class="screen-source-pop-info">
                  <span class="screen-source-pop-title">Плавное видео</span>
                  <span class="screen-source-pop-desc">30 к/с · для игр и видео</span>
                </span>
                <span class="screen-source-pop-radio" aria-hidden="true">
                  {#if screenSourceUi.mode === 'games'}<span class="screen-source-pop-dot"></span>{/if}
                </span>
              </button>
              <button
                class="screen-source-pop-preset"
                aria-pressed={screenSourceUi.mode === 'text'}
                onclick={() => { screenSourceUi.mode = 'text'; }}
              >
                <span class="screen-source-pop-icon">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <polyline points="4 7 4 4 20 4 20 7" /><line x1="9" y1="20" x2="15" y2="20" /><line x1="12" y1="4" x2="12" y2="20" />
                  </svg>
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
              onclick={() => { screenSourceUi.audio = !screenSourceUi.audio; }}
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
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M8 5v14l11-7z" />
          </svg>
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
  onclick={() => unlockAudio().catch((error) => console.warn('Audio unlock failed', error))}
>Разрешить звук</button>