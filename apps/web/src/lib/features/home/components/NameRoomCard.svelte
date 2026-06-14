<script lang="ts">
  let {
    savedName,
    nameInput = $bindable(),
    roomCode = $bindable(),
    staticRoomEnabled = $bindable(),
    nameMatchesSaved,
    creating,
    addingRoom,
    onSaveName,
    onCreateRoom,
    onJoinRoom,
    onAddRoom,
    onRoomCodeKeydown
  } = $props<{
    savedName: string;
    nameInput: string;
    roomCode: string;
    staticRoomEnabled: boolean;
    nameMatchesSaved: boolean;
    creating: boolean;
    addingRoom: boolean;
    onSaveName: (event?: Event) => void;
    onCreateRoom: () => void;
    onJoinRoom: () => void;
    onAddRoom: () => void;
    onRoomCodeKeydown: (event: KeyboardEvent) => void;
  }>();
</script>

<section class="home-card" aria-label="Создать или найти комнату">
  <div class="home-step">
    <span class="home-badge" data-done={nameMatchesSaved}>
      {#if nameMatchesSaved}
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="5 12 10 17 19 7"></polyline></svg>
      {:else}
        1
      {/if}
    </span>
    <span class="home-step-label">Ваше имя</span>
  </div>

  <form class="home-field-row" onsubmit={onSaveName}>
    <input
      class="home-input"
      maxlength="40"
      autocomplete="name"
      placeholder="Как вас звать"
      required
      bind:value={nameInput}
    >
    <button class="home-ghost-button" type="submit">{nameMatchesSaved ? 'Сохранено' : 'Сохранить'}</button>
  </form>
  <p class="home-hint" class:home-hint--saved={nameMatchesSaved}>
    {#if nameMatchesSaved}
      Сохранено как&nbsp;<b>{savedName}</b>&nbsp;· только на этом устройстве
    {:else}
      Хранится только на вашем устройстве — без регистрации.
    {/if}
  </p>

  <div class="home-rule"></div>

  <div class="home-step">
    <span class="home-badge" data-dim={!nameMatchesSaved}>2</span>
    <span class="home-step-label" data-dim={!nameMatchesSaved}>Комната</span>
    {#if !nameMatchesSaved}
      <span class="home-lock">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"></rect><path d="M8 11 V8 a4 4 0 0 1 8 0 v3"></path></svg>
        сначала имя
      </span>
    {/if}
  </div>

  <div class="home-room" data-locked={!nameMatchesSaved} inert={!nameMatchesSaved}>
    <button class="home-create" type="button" disabled={creating} onclick={onCreateRoom}>
      {#if creating}
        <span class="home-spinner" aria-hidden="true"></span>
      {:else}
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
      {/if}
      {creating ? 'Создаём…' : 'Создать комнату'}
    </button>

    <label class="home-static-toggle">
      <input type="checkbox" bind:checked={staticRoomEnabled} disabled={!nameMatchesSaved}>
      <span>
        <strong>Статичная комната</strong>
        <small>Появится в локальном списке и переживёт перезагрузку сервера.</small>
      </span>
    </label>

    <div class="home-or"><span>или войдите по коду</span></div>

    <div class="home-field-row">
      <input
        class="home-input home-input--code"
        maxlength="120"
        autocapitalize="off"
        autocomplete="off"
        spellcheck="false"
        placeholder="x7m2kq9p"
        bind:value={roomCode}
        onkeydown={onRoomCodeKeydown}
      >
      <button class="home-icon-button" type="button" disabled={addingRoom} onclick={onAddRoom} aria-label="Добавить комнату в локальный список">
        {#if addingRoom}
          <span class="home-spinner home-spinner--small" aria-hidden="true"></span>
        {:else}
          +
        {/if}
      </button>
      <button class="home-ghost-button" type="button" onclick={onJoinRoom}>Войти</button>
    </div>
  </div>
</section>
