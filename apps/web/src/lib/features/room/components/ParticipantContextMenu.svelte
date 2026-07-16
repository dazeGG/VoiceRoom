<script lang="ts">
  import { Ban, Check, MessageSquare, MicOff, UserMinus, UserPlus, Volume2 } from '@lucide/svelte';
  import { banRoomPeer, kickRoomPeer, undoRoomBan } from '$lib/api/rooms';
  import { iconMd, iconSm } from '$lib/shared/ui/icons';
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
  import { Avatar, Slider } from '$lib/shared/ui';
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
  import { roomSettingsUi } from '../room-settings.svelte';
  import { state as roomState } from '../client/core/state.svelte';

  const MENU_WIDTH = 272;
  const MENU_EDGE_GAP = 10;

  let panel = $state<HTMLElement>();
  let volumePercent = $state(100);
  let localMuted = $state(false);

  const volumeLabel = $derived(`${Math.round(volumePercent)}%`);
  const peer = $derived(participantContextMenu.open ? getParticipantById(participantContextMenu.peerId) : null);
  const preferenceKey = $derived(peer ? getParticipantAudioPreferenceKey(peer.accountUserId, peer.id) : '');
  const avatar = $derived(peer ? getAvatarPresentation(peer) : null);
  const canUseSocialActions = $derived(
    Boolean(peer && session.user && peer.accountUserId && peer.accountUserId !== session.user?.id)
  );
  const canModerate = $derived(Boolean(peer && roomSettingsUi.isOwner && !peer.isLocal));
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

  function errorToastMessage(error: unknown, fallback: string): string {
    return error instanceof Error && error.message ? error.message : fallback;
  }

  async function openDirectMessage(): Promise<void> {
    if (!peer?.accountUserId) return;
    const peerId = peer.id;
    const accountUserId = peer.accountUserId;
    closeParticipantContextMenu(peerId);
    try {
      setMode('friends');
      await openDm(accountUserId);
    } catch (error) {
      console.error(error);
      showToast(errorToastMessage(error, 'Не удалось открыть личные сообщения'), { variant: 'error' });
    }
  }

  async function sendFriendRequest(): Promise<void> {
    if (!peer?.accountUserId) return;
    const peerId = peer.id;
    const accountUserId = peer.accountUserId;
    closeParticipantContextMenu(peerId);
    try {
      const result = await addFriendByUserId(accountUserId);
      showToast(getFriendRequestToast(result.status));
    } catch (error) {
      console.error(error);
      showToast(errorToastMessage(error, 'Не удалось отправить заявку в друзья'), { variant: 'error' });
    }
  }

  async function acceptFriendRequest(): Promise<void> {
    if (!peer?.accountUserId) return;
    const peerId = peer.id;
    const accountUserId = peer.accountUserId;
    closeParticipantContextMenu(peerId);
    try {
      await acceptRequestByUserId(accountUserId);
      showToast('Заявка принята');
    } catch (error) {
      console.error(error);
      showToast(errorToastMessage(error, 'Не удалось принять заявку в друзья'), { variant: 'error' });
    }
  }

  async function kickParticipant(): Promise<void> {
    if (!peer) return;
    const peerId = peer.id;
    closeParticipantContextMenu(peerId);
    try {
      await kickRoomPeer(roomState.roomId, peerId);
      showToast(`${peer.name} исключён из комнаты`);
    } catch (error) {
      showToast(errorToastMessage(error, 'Не удалось исключить участника'), { variant: 'error' });
    }
  }

  async function banParticipant(): Promise<void> {
    if (!peer) return;
    const peerId = peer.id;
    const peerName = peer.name;
    closeParticipantContextMenu(peerId);
    try {
      const banId = await banRoomPeer(roomState.roomId, peerId);
      showToast(`${peerName} заблокирован`, {
        actionLabel: 'Отменить',
        duration: 10000,
        action: async () => {
          try {
            await undoRoomBan(roomState.roomId, banId);
            showToast('Блокировка отменена');
          } catch (error) {
            showToast(errorToastMessage(error, 'Не удалось отменить блокировку'), { variant: 'error' });
          }
        }
      });
    } catch (error) {
      showToast(errorToastMessage(error, 'Не удалось заблокировать участника'), { variant: 'error' });
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
      <span class="pcm-avatar" aria-hidden="true">
        <Avatar name={peer.name} src={avatar.src} background={avatar.background} size={42} />
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
        <MessageSquare class="pcm-item-icon" {...iconMd} aria-hidden="true" />
        <span>Написать сообщение</span>
      </button>
    {:else if canUseSocialActions && relationship === 'incoming'}
      <span class="participant-context-menu-divider" aria-hidden="true"></span>
      <button class="pcm-item pcm-item--accent" type="button" onclick={acceptFriendRequest}>
        <Check class="pcm-item-icon" {...iconMd} aria-hidden="true" />
        <span>Принять заявку</span>
      </button>
    {:else if canUseSocialActions && relationship === 'outgoing'}
      <span class="participant-context-menu-divider" aria-hidden="true"></span>
      <p class="participant-context-menu-note">Заявка в друзья уже отправлена.</p>
    {:else if canUseSocialActions}
      <span class="participant-context-menu-divider" aria-hidden="true"></span>
      <button class="pcm-item pcm-item--accent" type="button" onclick={sendFriendRequest}>
        <UserPlus class="pcm-item-icon" {...iconMd} aria-hidden="true" />
        <span>Добавить в друзья</span>
      </button>
    {:else if !peer.accountUserId}
      <span class="participant-context-menu-divider" aria-hidden="true"></span>
      <p class="participant-context-menu-note">Гость: доступны только локальные настройки звука.</p>
    {/if}

    <span class="participant-context-menu-divider" aria-hidden="true"></span>

    <div class="pcm-volume">
      <div class="pcm-volume-head">
        <span class="pcm-volume-label">
          <Volume2 {...iconSm} aria-hidden="true" />
          <span>Громкость</span>
        </span>
        <output class="pcm-volume-value">{volumeLabel}</output>
      </div>
      <Slider
        bind:value={volumePercent}
        min={0}
        max={200}
        step={1}
        defaultValue={100}
        snap
        snapThreshold={6}
        ariaLabel={`Громкость ${peer.name}`}
        ariaValueText={volumeLabel}
        onValueChange={setVolume}
      />
      <div class="pcm-volume-scale" aria-hidden="true">
        <span>0%</span>
        <span>100%</span>
        <span>200%</span>
      </div>
    </div>

    <span class="participant-context-menu-divider" aria-hidden="true"></span>

    <button
      class="pcm-item pcm-item--mute"
      type="button"
      aria-pressed={localMuted}
      onclick={toggleLocalMute}
    >
      <MicOff class="pcm-item-icon" {...iconMd} aria-hidden="true" />
      <span>{localMuted ? 'Включить локально' : 'Заглушить'}</span>
    </button>

    {#if canModerate}
      <span class="participant-context-menu-divider" aria-hidden="true"></span>
      <button class="pcm-item" type="button" onclick={kickParticipant}>
        <UserMinus class="pcm-item-icon" {...iconMd} aria-hidden="true" />
        <span>Исключить</span>
      </button>
      <button class="pcm-item pcm-item--danger" type="button" onclick={banParticipant}>
        <Ban class="pcm-item-icon" {...iconMd} aria-hidden="true" />
        <span>Заблокировать</span>
      </button>
    {/if}
  </div>
{/if}
