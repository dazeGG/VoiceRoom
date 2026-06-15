<script lang="ts">
  import { onMount } from 'svelte';
  import type { AuthUser, OwnedRoom } from '$lib/api/auth';
  import { addRoomByCode, fetchOwnedRooms } from '$lib/api/auth';
  import { createRoom } from '$lib/api/rooms';
  import { extractRoomId } from '$lib/shared/utils/room';
  import Topbar from '$lib/shared/components/Topbar.svelte';
  import UserMenu from './components/UserMenu.svelte';
  import RoomCard from './components/RoomCard.svelte';
  import CreateRoomDialog from './components/CreateRoomDialog.svelte';
  import { pluralizeRooms } from './model/rooms';
  import './styles/lobby.css';

  let { user, loggingOut, onLogout, onToast } = $props<{
    user: AuthUser | null;
    loggingOut: boolean;
    onLogout: () => void;
    onToast: (message: string) => void;
  }>();

  let rooms = $state<OwnedRoom[]>([]);
  let loading = $state(true);
  let roomCode = $state('');
  let joining = $state(false);
  let createDialogOpen = $state(false);
  let addDialogOpen = $state(false);
  let creating = $state(false);
  let adding = $state(false);
  let addRoomCode = $state('');
  let addError = $state('');

  const liveCount = $derived(rooms.filter((room) => room.peers > 0).length);

  onMount(() => {
    void refresh();
  });

  async function refresh(): Promise<void> {
    loading = true;
    try {
      rooms = await fetchOwnedRooms();
    } catch (error) {
      rooms = [];
      onToast(error instanceof Error && error.message ? error.message : 'Не удалось загрузить комнаты');
    } finally {
      loading = false;
    }
  }

  function openRoom(roomId: string): void {
    window.location.href = `/r/${encodeURIComponent(roomId)}`;
  }

  function handleJoin(event: Event): void {
    event.preventDefault();
    if (joining) return;
    const roomId = extractRoomId(roomCode);
    if (!roomId) {
      onToast('Введите код комнаты');
      return;
    }
    joining = true;
    openRoom(roomId);
  }

  async function handleCreate(payload: { name: string; roomPresetKey: string; isStatic: boolean }): Promise<void> {
    if (creating) return;
    creating = true;
    try {
      const roomId = await createRoom(payload);
      if (payload.isStatic) {
        // Persistent room: keep the user in the lobby and surface the new room.
        createDialogOpen = false;
        await refresh();
        onToast('Комната создана');
      } else {
        openRoom(roomId);
      }
    } catch (error) {
      onToast(error instanceof Error && error.message ? error.message : 'Не удалось создать комнату');
    } finally {
      creating = false;
    }
  }

  async function handleAddRoom(event: Event): Promise<void> {
    event.preventDefault();
    if (adding) return;
    const roomId = extractRoomId(addRoomCode);
    if (!roomId) {
      addError = 'Введите код постоянной комнаты';
      return;
    }

    adding = true;
    addError = '';
    try {
      await addRoomByCode(roomId);
      addDialogOpen = false;
      addRoomCode = '';
      await refresh();
      onToast('Комната добавлена');
    } catch (error) {
      addError = error instanceof Error && error.message ? error.message : 'Не удалось добавить комнату';
    } finally {
      adding = false;
    }
  }

  function closeAddDialog(): void {
    if (adding) return;
    addDialogOpen = false;
    addError = '';
  }

  function onDialogOverlayClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) closeAddDialog();
  }

  function onDialogKeydown(event: KeyboardEvent): void {
    if (addDialogOpen && event.key === 'Escape') closeAddDialog();
  }
</script>

<svelte:window onkeydown={onDialogKeydown} />

<div class="app-shell">
  <Topbar label="Мои комнаты Voice Room">
    {#if user}
      <UserMenu {user} {loggingOut} {onLogout} />
    {/if}
  </Topbar>

  <main class="lobby" aria-label="Мои комнаты">
    <div class="lobby-actions">
      <button class="lobby-create" type="button" onclick={() => (createDialogOpen = true)}>
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
        Создать комнату
      </button>

      <form class="lobby-search" onsubmit={handleJoin}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><line x1="21" y1="21" x2="16.5" y2="16.5"></line></svg>
        <input
          class="lobby-search-input"
          placeholder="Войти по коду — x7m2kq9p"
          maxlength="120"
          autocapitalize="off"
          autocomplete="off"
          spellcheck="false"
          bind:value={roomCode}
        />
        <button class="lobby-search-btn" type="submit" disabled={joining}>Войти</button>
      </form>
    </div>

    <div class="lobby-section-head">
      <span class="lobby-section-title">Мои комнаты</span>
      <span class="lobby-section-meta">
        {#if loading && rooms.length === 0}
          Загружаем…
        {:else}
          {rooms.length} {pluralizeRooms(rooms.length)}{#if liveCount > 0} · {liveCount} в эфире{/if}
        {/if}
      </span>
    </div>

    <div class="lobby-grid">
      {#each rooms as room (room.roomId)}
        <RoomCard {room} onOpen={openRoom} />
      {/each}

      <button class="lobby-add" type="button" onclick={() => (addDialogOpen = true)}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
        <span>Добавить комнату</span>
      </button>
    </div>

    {#if !loading && rooms.length === 0}
      <p class="lobby-empty">
        Пока нет комнат в списке. Создайте постоянную комнату или добавьте существующую по коду.
      </p>
    {/if}
  </main>
</div>

<CreateRoomDialog open={createDialogOpen} {creating} onClose={() => (createDialogOpen = false)} onCreate={handleCreate} />

{#if addDialogOpen}
  <div class="dialog-overlay" role="presentation" onclick={onDialogOverlayClick}>
    <div class="dialog-card" role="dialog" aria-modal="true" aria-labelledby="addRoomTitle">
      <div class="dialog-head">
        <span class="dialog-title" id="addRoomTitle">Добавить комнату</span>
        <button class="dialog-close" type="button" aria-label="Закрыть" onclick={closeAddDialog}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18"></line><line x1="18" y1="6" x2="6" y2="18"></line></svg>
        </button>
      </div>

      <form class="dialog-body" onsubmit={handleAddRoom}>
        <p class="dialog-note">Введите код уже созданной постоянной комнаты. Временные комнаты в список не добавляются.</p>
        {#if addError}
          <p class="dialog-error" role="alert">{addError}</p>
        {/if}
        <div class="dialog-field">
          <div class="dialog-label">Код комнаты</div>
          <input
            class="dialog-input dialog-input--mono"
            maxlength="120"
            placeholder="x7m2kq9p"
            autocapitalize="off"
            autocomplete="off"
            spellcheck="false"
            bind:value={addRoomCode}
          />
        </div>

        <div class="dialog-actions">
          <button class="dialog-cancel" type="button" onclick={closeAddDialog}>Отмена</button>
          <button class="dialog-submit" type="submit" disabled={adding}>
            {#if adding}
              <span class="home-spinner" aria-hidden="true"></span>
            {/if}
            Добавить
          </button>
        </div>
      </form>
    </div>
  </div>
{/if}
