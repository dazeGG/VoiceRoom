<script lang="ts">
  import { onMount } from 'svelte';
  import { mountIcons } from '../client/ui/icons';
  import {
    cancelScreenSourcePicker,
    closeScreenSourceOnBackdrop,
    resolveScreenSourcePicker
  } from '../client/ui/screen-source-picker';
  import { guestNameUi } from '../guest-name-ui.svelte';
  import { screenSourceUi } from '../screen-source-ui.svelte';
  import { toastUi } from '../toast-ui.svelte';
  import { startUi } from '../start-ui.svelte';
  import { unlockAudio } from '../client/services/media-playback-service';
  import {
    clearGuestNameError,
    handleGuestNameSubmit
  } from '../client/ui/names';

  let closeButton: HTMLButtonElement | undefined;

  onMount(() => {
    if (closeButton) mountIcons(closeButton);
  });
</script>

<div class="toast" id="toast" role="status" aria-live="polite" data-variant={toastUi.variant} data-visible={String(toastUi.visible)}>
  {toastUi.message}
</div>

<div
  class="guest-name-dialog"
  id="guestNameDialog"
  role="dialog"
  aria-modal="true"
  aria-labelledby="guestNameTitle"
  hidden={!guestNameUi.open}
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
    <div class="screen-source-heading">
      <div>
        <p class="eyebrow">источник</p>
        <h2 id="screenSourceTitle">Что показать</h2>
      </div>
      <button
        bind:this={closeButton}
        class="screen-source-close"
        id="screenSourceCloseButton"
        type="button"
        aria-label="Отменить выбор"
        data-icon="close"
        onclick={cancelScreenSourcePicker}
      ></button>
    </div>
    <div class="screen-source-options" id="screenSourceOptions">
      {#each screenSourceUi.sources as source (source.id)}
        <button
          class="screen-source-option"
          type="button"
          aria-label={source.name}
          onclick={() => resolveScreenSourcePicker(source)}
        >
          <span class="screen-source-preview">
            {#if source.thumbnail}
              <img alt="" src={source.thumbnail} />
            {:else}
              <span class="screen-source-fallback">{source.type === 'screen' ? 'Экран' : 'Окно'}</span>
            {/if}
          </span>
          <span class="screen-source-label">
            {#if source.appIcon}
              <img alt="" src={source.appIcon} />
            {/if}
            <span>{source.name}</span>
          </span>
        </button>
      {/each}
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