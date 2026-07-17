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
  import { invokeToastAction, toastUi } from '../toast-ui.svelte';
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
  const qualityLabel = $derived(screenSourceUi.mode === 'text' ? 'Источник' : screenSourceUi.quality === 'high' ? '1080p' : '720p');
  const fpsLabel = $derived(screenSourceUi.mode === 'text' ? '5 к/с' : '30 к/с');
  const summaryName = $derived(selectedSource?.name ?? 'Не выбрано');
  const summaryDetail = $derived(`${screenSourceUi.mode === 'text' ? 'Текст' : screenSourceUi.quality === 'high' ? 'HD' : 'SD'} · ${qualityLabel} · ${fpsLabel}${screenSourceUi.audio ? ' · звук' : ''}`);

  $effect(() => {
    syncGuestNameDialogInert(guestNameUi.open, guestNameDialog ?? null);
  });

  onMount(() => {
    return () => syncGuestNameDialogInert(false, guestNameDialog ?? null);
  });
</script>

<div class="toast" id="toast" role="status" aria-live="polite" data-variant={toastUi.variant} data-visible={String(toastUi.visible)}>
  <span>{toastUi.message}</span>
  {#if toastUi.action && toastUi.actionLabel}
    <button type="button" onclick={() => void invokeToastAction()}>{toastUi.actionLabel}</button>
  {/if}
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
                <Check {...iconXs} color="#17150f" aria-hidden="true" />
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
            onclick={() => { screenSourceUi.quality = 'balanced'; }}
          >SD</button>
          <button
            class="screen-source-res-btn"
            aria-pressed={screenSourceUi.quality === 'high'}
            onclick={() => { screenSourceUi.quality = 'high'; }}
          >HD</button>
        </div>
        {/if}

        <!-- Settings gear + popover -->
        <div class="screen-source-gear-wrap">
          <button
            class="screen-source-gear"
            aria-pressed={screenSourceUi.popOpen}
            title="Настройки стрима"
            onclick={() => { screenSourceUi.popOpen = !screenSourceUi.popOpen; }}
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
                onclick={() => { screenSourceUi.mode = 'games'; }}
              >
                <span class="screen-source-pop-icon">
                  <Play {...iconSm} aria-hidden="true" />
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
  onclick={() => unlockAudio().catch((error) => console.warn('Audio unlock failed', error))}
>Разрешить звук</button>
