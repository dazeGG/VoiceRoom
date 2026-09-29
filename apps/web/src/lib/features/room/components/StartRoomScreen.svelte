<script lang="ts">
  import FeatureList from '$lib/shared/components/FeatureList.svelte';
  import { START_FEATURES } from '$lib/features/shared-content/start-features';
  import { state } from '../client/core/state.svelte';
  import { createRoomFromStart, joinRoomByCode, handleRoomCodeKeydown } from '../client/room/room-start';
  import { saveStartName, updateNameStatuses } from '../client/ui/names';
  import { startUi } from '../start-ui.svelte';
</script>

<main class="start-layout" id="startScreen" aria-label="Стартовый экран" hidden={state.screen !== 'start'}>
  <section class="start-copy" aria-labelledby="startTitle">
    <p class="eyebrow">voice room</p>
    <h1 class="hero-title" id="startTitle">Голосовая комната без лишних дверей</h1>
    <p class="hero-lead">Сначала сохраните имя, потом создайте комнату или зайдите к своим по коду.</p>

    <FeatureList items={START_FEATURES} />
  </section>

  <section class="start-panel" aria-label="Создать или найти комнату">
    <form class="name-panel" id="startForm" onsubmit={saveStartName}>
      <label class="field">
        <span>Ваше имя</span>
        <input
          id="startNameInput"
          bind:value={startUi.nameInput}
          maxlength="40"
          autocomplete="name"
          placeholder="Ваше имя"
          required
          oninput={() => updateNameStatuses(startUi.nameInput)}
        />
      </label>

      <button class="secondary-button" type="submit">Сохранить имя</button>
      <p class="name-status" id="startNameStatus" data-state={startUi.savedNameState}>{startUi.savedNameStatus}</p>
    </form>

    <div class="start-divider">
      <span>комната</span>
    </div>

    <div class="room-actions">
      <button
        class="primary-button"
        id="createRoomButton"
        type="button"
        disabled={startUi.createRoomLoading}
        onclick={() => void createRoomFromStart()}
      >
        {startUi.createRoomLoading ? 'Создаём...' : 'Создать комнату'}
      </button>

      <label class="field">
        <span>Код комнаты</span>
        <input
          id="roomCodeInput"
          bind:value={startUi.roomCode}
          maxlength="120"
          autocapitalize="off"
          autocomplete="off"
          spellcheck="false"
          placeholder="x7m2kq9p"
          onkeydown={handleRoomCodeKeydown}
        />
      </label>

      <button class="secondary-button" id="joinByCodeButton" type="button" onclick={joinRoomByCode}
        >Войти по коду</button
      >
    </div>
  </section>
</main>

<style>
  :global(.start-divider) {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    color: var(--muted);
    font-size: 0.78rem;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  :where(.start-divider)::before,
  :where(.start-divider)::after {
    height: 1px;
    flex: 1;
    background: var(--line);
    content: '';
  }
  :global(.hero-title) {
    margin: 18px 0 0;
    font-family: var(--font-display);
    font-weight: 700;
    line-height: 1.03;
    letter-spacing: 0;
    text-wrap: balance;
  }
  :global(.hero-lead) {
    margin: 22px 0 0;
    max-width: 460px;
    font-size: 17px;
    font-weight: 400;
    line-height: 1.55;
    color: var(--hero-lead-ink, #b3ac9b);
  }
</style>
