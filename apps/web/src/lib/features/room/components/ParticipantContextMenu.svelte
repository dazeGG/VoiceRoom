<script lang="ts">
  import { onMount } from 'svelte';
  import { session } from '$lib/features/auth/session.svelte';
  import {
    acceptRequestByUserId,
    addFriendByUserId,
    getFriendRelationship,
    getKnownLogin,
    openDm,
    setMode
  } from '$lib/features/home/model/friends.svelte';
  import { VolumeSlider } from '$lib/shared/ui';
  import {
    getParticipantAudioPreference,
    getParticipantAudioPreferenceKey,
    storeParticipantAudioPreference
  } from '../client/core/settings';
  import { applyRemoteParticipantAudioPreferences } from '../client/services/media-playback-service';
  import { getParticipantById } from '../client/room/participants';
  import { getAvatarPresentation } from '../client/ui/avatar-presentation';
  import { showToast } from '../client/ui/toast';
  import {
    closeParticipantContextMenu,
    participantContextMenu
  } from '../participant-context-ui.svelte';

  const MENU_WIDTH = 272;
  const MENU_EDGE_GAP = 10;

  let panel = $state<HTMLElement>();
  let volumePercent = $state(100);
  let localMuted = $state(false);

  const peer = $derived(participantContextMenu.open ? getParticipantById(participantContextMenu.peerId) : null);
  const preferenceKey = $derived(peer ? getParticipantAudioPreferenceKey(peer.accountUserId, peer.id) : '');
  const avatar = $derived(peer ? getAvatarPresentation(peer) : null);
  const canUseSocialActions = $derived(
    Boolean(peer && session.user && peer.accountUserId && peer.accountUserId !== session.user?.id)
  );
  const relationship = $derived(
    canUseSocialActions && peer?.accountUserId ? getFriendRelationship(peer.accountUserId) : 'none'
  );
  const handle = $derived(peer?.accountUserId ? getKnownLogin(peer.accountUserId) : '');
  const subtitle = $derived(
    handle ? `@${handle}` : peer?.accountUserId ? 'Участник комнаты' : 'Гость комнаты'
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

  function setVolume(percent: number): void {
    if (!peer || !preferenceKey) return;
    const safePercent = Math.min(200, Math.max(0, Number.isFinite(percent) ? percent : 100));
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

{#if participantContextMenu.open && peer && !peer.isLocal && avatar}
  <div
    bind:this={panel}
    class="participant-context-menu"
    data-peer-id={peer.id}
    role="dialog"
    aria-label={`Действия для ${peer.name}`}
    tabindex="-1"
  >
    <div class="participant-context-menu-head">
      <span
        class="pcm-avatar"
        aria-hidden="true"
        style={`background:${avatar.background};color:${avatar.foreground};box-shadow:${avatar.shadow}`}
      >
        {avatar.initials}
        <span class="pcm-avatar-status"></span>
      </span>
      <span class="pcm-identity">
        <strong>{peer.name}</strong>
        <span class="pcm-handle">{subtitle}</span>
      </span>
    </div>

    {#if canUseSocialActions && relationship === 'friend'}
      <span class="participant-context-menu-divider" aria-hidden="true"></span>
      <button class="pcm-item" type="button" onclick={openDirectMessage}>
        <svg class="pcm-item-icon" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
        <span>Написать сообщение</span>
      </button>
    {:else if canUseSocialActions && relationship === 'incoming'}
      <span class="participant-context-menu-divider" aria-hidden="true"></span>
      <button class="pcm-item pcm-item--accent" type="button" onclick={acceptFriendRequest}>
        <svg class="pcm-item-icon" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>
        <span>Принять заявку</span>
      </button>
    {:else if canUseSocialActions && relationship === 'outgoing'}
      <span class="participant-context-menu-divider" aria-hidden="true"></span>
      <p class="participant-context-menu-note">Заявка в друзья уже отправлена.</p>
    {:else if canUseSocialActions}
      <span class="participant-context-menu-divider" aria-hidden="true"></span>
      <button class="pcm-item pcm-item--accent" type="button" onclick={sendFriendRequest}>
        <svg class="pcm-item-icon" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><line x1="19" y1="8" x2="19" y2="14"></line><line x1="22" y1="11" x2="16" y2="11"></line></svg>
        <span>Добавить в друзья</span>
      </button>
    {:else if !peer.accountUserId}
      <span class="participant-context-menu-divider" aria-hidden="true"></span>
      <p class="participant-context-menu-note">Гость: доступны только локальные настройки звука.</p>
    {/if}

    <span class="participant-context-menu-divider" aria-hidden="true"></span>

    <div class="pcm-volume">
      <VolumeSlider
        bind:value={volumePercent}
        min={0}
        max={200}
        label="Громкость"
        ariaLabel={`Громкость ${peer.name}`}
        onValueChange={setVolume}
      />
    </div>

    <span class="participant-context-menu-divider" aria-hidden="true"></span>

    <button
      class="pcm-item pcm-item--mute"
      type="button"
      aria-pressed={localMuted}
      onclick={toggleLocalMute}
    >
      <svg class="pcm-item-icon" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="1" y1="1" x2="23" y2="23"></line><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>
      <span>{localMuted ? 'Включить локально' : 'Заглушить'}</span>
    </button>
  </div>
{/if}
