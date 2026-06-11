<script lang="ts">
  import { onMount } from 'svelte';
  import { createRoom } from '$lib/api/rooms';
  import '$lib/components/topbar.css';
  import '$lib/features/room/client/styles.css';
  import { extractRoomId } from '$lib/utils/room';
  import { cleanDisplayName } from '$lib/utils/text';

  let savedName = $state('');
  let nameInput = $state('');
  let roomCode = $state('');
  let creating = $state(false);
  let toast = $state('');
  let toastTimer = 0;

  const hasSavedName = $derived(Boolean(savedName));

  onMount(() => {
    document.body.dataset.screen = 'start';
    savedName = cleanDisplayName(localStorage.getItem('voice-room:name'));
    nameInput = savedName;
    return () => {
      delete document.body.dataset.screen;
      window.clearTimeout(toastTimer);
    };
  });

  function saveName(event?: Event): void {
    event?.preventDefault();
    const nextName = cleanDisplayName(nameInput);
    if (!nextName) {
      showToast('Введите имя');
      return;
    }
    savedName = nextName;
    nameInput = nextName;
    localStorage.setItem('voice-room:name', nextName);
    showToast('Имя сохранено');
  }

  async function handleCreateRoom(): Promise<void> {
    if (!requireSavedName()) return;
    if (creating) return;

    creating = true;
    try {
      const roomId = await createRoom();
      openRoom(roomId);
    } catch (error) {
      console.error(error);
      showToast(error instanceof Error && error.message ? error.message : 'Не удалось создать комнату');
    } finally {
      creating = false;
    }
  }

  function handleJoinRoom(): void {
    if (!requireSavedName()) return;
    const roomId = extractRoomId(roomCode);
    if (!roomId) {
      showToast('Введите код комнаты');
      return;
    }
    openRoom(roomId);
  }

  function handleRoomCodeKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    handleJoinRoom();
  }

  function requireSavedName(): boolean {
    const nextName = cleanDisplayName(nameInput);
    if (nextName && nextName !== savedName) {
      savedName = nextName;
      nameInput = nextName;
      localStorage.setItem('voice-room:name', nextName);
    }
    if (savedName) return true;
    showToast('Сначала сохраните имя');
    return false;
  }

  function openRoom(roomId: string): void {
    window.location.href = `/r/${encodeURIComponent(roomId)}`;
  }

  function showToast(message: string): void {
    toast = message;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toast = '';
    }, 2600);
  }
</script>

<div class="app-shell">
  <header class="topbar">
    <a class="brand" href="/" aria-label="Новая голосовая комната">
      <img class="brand-mark" src="/icon.svg" width="32" height="32" alt="" aria-hidden="true">
      <span>Voice Room</span>
    </a>
  </header>

  <main class="start-layout" id="startScreen" aria-label="Стартовый экран">
    <section class="start-copy" aria-labelledby="startTitle">
      <p class="eyebrow">voice room</p>
      <h1 id="startTitle">Голосовая комната без лишних дверей</h1>
      <p class="start-lead">Сначала сохраните имя, потом создайте комнату или зайдите к своим по коду.</p>
    </section>

    <section class="start-panel" aria-label="Создать или найти комнату">
      <form class="name-panel" id="startForm" onsubmit={saveName}>
        <label class="field">
          <span>Ваше имя</span>
          <input id="startNameInput" maxlength="40" autocomplete="name" placeholder="Например, Даша" required bind:value={nameInput}>
        </label>

        <button class="secondary-button" type="submit">Сохранить имя</button>
        <p class="name-status" id="startNameStatus">{hasSavedName ? `Сохранено: ${savedName}` : 'Имя не сохранено'}</p>
      </form>

      <div class="start-divider">
        <span>комната</span>
      </div>

      <div class="room-actions">
        <button class="primary-button" id="createRoomButton" type="button" disabled={creating} onclick={handleCreateRoom}>
          {creating ? 'Создаём...' : 'Создать комнату'}
        </button>

        <label class="field">
          <span>Код комнаты</span>
          <input
            id="roomCodeInput"
            maxlength="120"
            autocapitalize="off"
            autocomplete="off"
            spellcheck="false"
            placeholder="x7m2kq9p"
            bind:value={roomCode}
            onkeydown={handleRoomCodeKeydown}
          >
        </label>

        <button class="secondary-button" id="joinByCodeButton" type="button" onclick={handleJoinRoom}>Войти по коду</button>
      </div>
    </section>
  </main>
</div>

{#if toast}
  <div class="toast is-visible" role="status" aria-live="polite">{toast}</div>
{/if}
