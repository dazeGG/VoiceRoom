<script lang="ts">
  import { onMount } from 'svelte';
  import { session } from '$lib/features/auth/session.svelte';
  import {
    acceptRequestByUserId,
    addFriendByUserId,
    getFriendRelationship,
    openDm,
    setMode
  } from '$lib/features/home/model/friends.svelte';
  import {
    getParticipantAudioPreference,
    getParticipantAudioPreferenceKey,
    storeParticipantAudioPreference
  } from '../client/core/settings';
  import { applyRemoteParticipantAudioPreferences } from '../client/services/media-playback-service';
  import { getParticipantById } from '../client/room/participants';
  import { showToast } from '../client/ui/toast';
  import {
    closeParticipantContextMenu,
    participantContextMenu
  } from '../participant-context-ui.svelte';

  const MENU_WIDTH = 292;
  const MENU_EDGE_GAP = 10;

  let panel = $state<HTMLElement>();
  let volumePercent = $state(100);
  let localMuted = $state(false);

  const peer = $derived(participantContextMenu.open ? getParticipantById(participantContextMenu.peerId) : null);
  const preferenceKey = $derived(peer ? getParticipantAudioPreferenceKey(peer.accountUserId, peer.id) : '');
  const canUseSocialActions = $derived(
    Boolean(peer && session.user && peer.accountUserId && peer.accountUserId !== session.user?.id)
  );
  const relationship = $derived(
    canUseSocialActions && peer?.accountUserId ? getFriendRelationship(peer.accountUserId) : 'none'
  );

  $effect(() => {
    if (!peer || !preferenceKey) return;
    const preference = getParticipantAudioPreference(preferenceKey);
    volumePercent = Math.round(preference.volume * 100);
    localMuted = preference.muted;
  });

  function positionPanel(): void {
    if (!panel) return;
    const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
    const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
    const rect = panel.getBoundingClientRect();
    const width = Math.max(rect.width || MENU_WIDTH, MENU_WIDTH);
    const height = rect.height || 260;
    const left = Math.min(
      Math.max(MENU_EDGE_GAP, participantContextMenu.x),
      Math.max(MENU_EDGE_GAP, viewportWidth - width - MENU_EDGE_GAP)
    );
    const top = Math.min(
      Math.max(MENU_EDGE_GAP, participantContextMenu.y),
      Math.max(MENU_EDGE_GAP, viewportHeight - height - MENU_EDGE_GAP)
    );
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  }

  function handleVolumeInput(event: Event): void {
    if (!peer || !preferenceKey) return;
    const percent = Number.parseInt((event.currentTarget as HTMLInputElement).value, 10);
    const safePercent = Number.isFinite(percent) ? percent : 100;
    volumePercent = safePercent;
    storeParticipantAudioPreference(preferenceKey, { volume: safePercent / 100 });
    applyRemoteParticipantAudioPreferences(peer);
  }

  function toggleLocalMute(): void {
    if (!peer || !preferenceKey) return;
    const next = storeParticipantAudioPreference(preferenceKey, {
      muted: !getParticipantAudioPreference(preferenceKey).muted
    });
    localMuted = next.muted;
    applyRemoteParticipantAudioPreferences(peer);
    closeParticipantContextMenu(peer.id);
  }

  async function openDirectMessage(): Promise<void> {
    if (!peer?.accountUserId) return;
    closeParticipantContextMenu(peer.id);
    try {
      setMode('friends');
      await openDm(peer.accountUserId);
    } catch (error) {
      console.error(error);
      showToast('Не удалось открыть личные сообщения', { variant: 'error' });
    }
  }

  async function sendFriendRequest(): Promise<void> {
    if (!peer?.accountUserId) return;
    closeParticipantContextMenu(peer.id);
    try {
      const result = await addFriendByUserId(peer.accountUserId);
      showToast(getFriendRequestToast(result.status));
    } catch (error) {
      console.error(error);
      showToast('Не удалось отправить заявку в друзья', { variant: 'error' });
    }
  }

  async function acceptFriendRequest(): Promise<void> {
    if (!peer?.accountUserId) return;
    closeParticipantContextMenu(peer.id);
    try {
      await acceptRequestByUserId(peer.accountUserId);
      showToast('Заявка принята');
    } catch (error) {
      console.error(error);
      showToast('Не удалось принять заявку в друзья', { variant: 'error' });
    }
  }

  function getFriendRequestToast(status: 'sent' | 'accepted' | 'already_sent' | 'already_friends'): string {
    switch (status) {
      case 'accepted':
        return 'Теперь вы друзья';
      case 'already_friends':
        return 'Уже в друзьях';
      case 'already_sent':
        return 'Заявка уже отправлена';
      case 'sent':
      default:
        return 'Заявка в друзья отправлена';
    }
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (!participantContextMenu.open) return;
    const activeElement = document.activeElement;
    const isRangeInput = activeElement instanceof HTMLInputElement && activeElement.type === 'range';
    if (event.key === 'Escape') {
      event.preventDefault();
      closeParticipantContextMenu();
    } else if (event.key === 'ArrowDown' && !isRangeInput) {
      event.preventDefault();
      focusNext(1);
    } else if (event.key === 'ArrowUp' && !isRangeInput) {
      event.preventDefault();
      focusNext(-1);
    }
  }

  function focusNext(delta: number): void {
    if (!panel) return;
    const items = [...panel.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])')];
    if (items.length === 0) return;
    const currentIndex = Math.max(0, items.indexOf(document.activeElement as HTMLElement));
    const nextIndex = (currentIndex + delta + items.length) % items.length;
    items[nextIndex]?.focus();
  }

  function handlePointerDown(event: PointerEvent): void {
    if (!panel || panel.contains(event.target as Node)) return;
    closeParticipantContextMenu('', false);
  }

  function handleFocusIn(event: FocusEvent): void {
    if (!participantContextMenu.open || !panel) return;
    const target = event.target;
    if (target instanceof Node && panel.contains(target)) return;
    const opener = document.querySelector<HTMLElement>(
      `.participant[data-peer-id="${CSS.escape(participantContextMenu.restoreFocusPeerId)}"]`
    );
    if (opener && target instanceof Node && opener.contains(target)) return;
    closeParticipantContextMenu('', false);
  }

  onMount(() => {
    document.addEventListener('keydown', handleKeydown);
    document.addEventListener('pointerdown', handlePointerDown, { capture: true });
    document.addEventListener('focusin', handleFocusIn);
    return () => {
      document.removeEventListener('keydown', handleKeydown);
      document.removeEventListener('pointerdown', handlePointerDown, { capture: true });
      document.removeEventListener('focusin', handleFocusIn);
    };
  });

  $effect(() => {
    if (participantContextMenu.open && panel) {
      queueMicrotask(() => {
        positionPanel();
        const first = panel?.querySelector<HTMLElement>('button:not(:disabled), input:not(:disabled)');
        (first || panel)?.focus();
      });
    }
  });
</script>

{#if participantContextMenu.open && peer && !peer.isLocal}
  <div
    bind:this={panel}
    class="participant-context-menu"
    data-peer-id={peer.id}
    role="dialog"
    aria-label={`Действия для ${peer.name}`}
    tabindex="-1"
  >
    <div class="participant-context-menu-head">
      <strong>{peer.name}</strong>
      <span>{peer.accountUserId ? 'Участник комнаты' : 'Гость комнаты'}</span>
    </div>

    {#if canUseSocialActions && relationship === 'friend'}
      <button class="participant-context-menu-action" type="button" onclick={openDirectMessage}>Написать сообщение</button>
    {:else if canUseSocialActions && relationship === 'incoming'}
      <button class="participant-context-menu-action" type="button" onclick={acceptFriendRequest}>Принять заявку</button>
    {:else if canUseSocialActions && relationship === 'outgoing'}
      <p class="participant-context-menu-note">Заявка в друзья уже отправлена.</p>
    {:else if canUseSocialActions}
      <button class="participant-context-menu-action" type="button" onclick={sendFriendRequest}>Добавить в друзья</button>
    {:else if !peer.accountUserId}
      <p class="participant-context-menu-note">Гость: доступны только локальные настройки звука.</p>
    {/if}

    {#if canUseSocialActions || !peer.accountUserId}
      <span class="participant-context-menu-divider" aria-hidden="true"></span>
    {/if}

    <label class="participant-context-menu-volume">
      <span class="participant-context-menu-label-row">
        <span>Громкость</span>
        <output>{volumePercent}%</output>
      </span>
      <span class="gate-control participant-volume-control">
        <span class="gate-meter-wrap">
          <span
            class="mic-level-track participant-volume-track"
            data-boosted={String(volumePercent > 100)}
          >
            <span
              class="mic-level-fill participant-volume-fill"
              style:width="{Math.max(0, Math.min(100, volumePercent / 2))}%"
            ></span>
          </span>
          <input
            type="range"
            min="0"
            max="200"
            step="1"
            value={volumePercent}
            aria-label={`Громкость ${peer.name}`}
            oninput={handleVolumeInput}
          />
        </span>
      </span>
    </label>

    <button
      class="participant-context-menu-action participant-context-menu-mute"
      type="button"
      aria-pressed={localMuted}
      onclick={toggleLocalMute}
    >
      {localMuted ? 'Включить локально' : 'Заглушить локально'}
    </button>
  </div>
{/if}