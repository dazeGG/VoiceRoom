<script lang="ts">
  import {
    Ban,
    Check,
    LogOut,
    MessageSquare,
    MicOff,
    User,
    UserMinus,
    UserPlus,
    Volume2,
    VolumeX
  } from '@lucide/svelte';
  import {
    banRoomPeer,
    kickRoomPeer,
    setRoomPeerServerMute,
    undoRoomBan
  } from '$lib/api/rooms';
  import { iconMd, iconSm } from '$lib/shared/ui/icons';
  import { session } from '$lib/features/auth/session.svelte';
  import {
    acceptRequestByUserId,
    addFriendByUserId,
    getFriendRelationship,
    openDm,
    removeFriend,
    setMode
  } from '$lib/features/home/model/friends.svelte';
  import { openProfileCardFor } from '$lib/features/home/profile-card-ui.svelte';
  import {
    ContextMenu,
    PopoverDivider,
    PopoverMenuItem,
    PopoverMenuLabel,
    Slider
  } from '$lib/shared/ui';
  import {
    getParticipantAudioPreference,
    getParticipantAudioPreferenceKey,
    storeParticipantAudioPreference
  } from '../client/core/settings';
  import { applyRemoteParticipantAudioPreferences } from '../client/services/media-playback-service';
  import { getParticipantById } from '../client/room/participants';
  import { showToast } from '../client/ui/toast';
  import { participantProfilePerson } from '../profile-card-adapter';
  import {
    closeParticipantContextMenu,
    participantContextMenu
  } from '../participant-context-ui.svelte';
  import { roomSettingsUi } from '../room-settings.svelte';
  import { state as roomState } from '../client/core/state.svelte';

  let volumePercent = $state(100);
  let localMuted = $state(false);
  let moderating = $state(false);

  const volumeLabel = $derived(`${Math.round(volumePercent)}%`);
  const peer = $derived(participantContextMenu.open ? getParticipantById(participantContextMenu.peerId) : null);
  const preferenceKey = $derived(peer ? getParticipantAudioPreferenceKey(peer.accountUserId, peer.id) : '');
  // Volume, local mute and forced mute only make sense from a grid tile, where
  // you are actually listening to this person.
  const showAudioControls = $derived(participantContextMenu.variant === 'tile');
  const canUseSocialActions = $derived(
    Boolean(peer && session.user && peer.accountUserId && peer.accountUserId !== session.user?.id)
  );
  const canModerate = $derived(Boolean(peer && roomSettingsUi.isOwner && !peer.isLocal));
  const relationship = $derived(
    canUseSocialActions && peer?.accountUserId ? getFriendRelationship(peer.accountUserId) : 'none'
  );

  $effect(() => {
    if (!peer || !preferenceKey) return;
    const preference = getParticipantAudioPreference(preferenceKey);
    volumePercent = Math.round(preference.volume * 100);
    localMuted = preference.muted;
  });

  function setVolume(percent: number): void {
    if (!peer || !preferenceKey) return;
    const safePercent = Math.min(200, Math.max(0, Number.isFinite(percent) ? percent : 100));
    volumePercent = safePercent;
    storeParticipantAudioPreference(preferenceKey, { volume: safePercent / 100 });
    applyRemoteParticipantAudioPreferences(peer);
  }

  function errorToastMessage(error: unknown, fallback: string): string {
    return error instanceof Error && error.message ? error.message : fallback;
  }

  // Every action closes the menu first so the result is visible immediately;
  // failures surface as a toast rather than by leaving the menu hanging open.
  function act(action: () => Promise<void>, fallback: string): void {
    if (!peer || moderating) return;
    moderating = true;
    closeParticipantContextMenu(peer.id, false);
    void action()
      .catch((error) => showToast(errorToastMessage(error, fallback), { variant: 'error' }))
      .finally(() => { moderating = false; });
  }

  function showProfile(event: MouseEvent): void {
    if (!peer?.accountUserId) return;
    const person = participantProfilePerson(peer);
    const anchor = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    const anchorRect = anchor?.getBoundingClientRect() ?? null;
    const restoreFocus = participantContextMenu.restoreFocus;
    closeParticipantContextMenu(peer.id, false);
    // Deferred so the closing menu does not swallow the card's own outside-click
    // listener during the same pointer event.
    queueMicrotask(() => openProfileCardFor(person, { rect: anchorRect, restoreFocus }));
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

  function openDirectMessage(): void {
    const accountUserId = peer?.accountUserId;
    if (!accountUserId) return;
    act(async () => {
      setMode('friends');
      await openDm(accountUserId);
    }, 'Не удалось открыть личные сообщения');
  }

  function sendFriendRequest(): void {
    const accountUserId = peer?.accountUserId;
    if (!accountUserId) return;
    act(async () => {
      const result = await addFriendByUserId(accountUserId);
      showToast(friendRequestToast(result.status));
    }, 'Не удалось отправить заявку в друзья');
  }

  function acceptFriendRequest(): void {
    const accountUserId = peer?.accountUserId;
    if (!accountUserId) return;
    act(async () => {
      await acceptRequestByUserId(accountUserId);
      showToast('Заявка принята');
    }, 'Не удалось принять заявку в друзья');
  }

  function dropFriend(): void {
    const accountUserId = peer?.accountUserId;
    const name = peer?.name ?? 'Пользователь';
    if (!accountUserId) return;
    act(async () => {
      await removeFriend(accountUserId);
      showToast(`${name} удалён из друзей`);
    }, 'Не удалось удалить из друзей');
  }

  function toggleServerMute(): void {
    if (!peer) return;
    const peerId = peer.id;
    const name = peer.name;
    const next = !peer.serverMuted;
    act(async () => {
      await setRoomPeerServerMute(roomState.roomId, peerId, next);
      showToast(next ? `Микрофон ${name} выключен` : `Микрофон ${name} включён`);
    }, 'Не удалось изменить микрофон участника');
  }

  function kickParticipant(): void {
    if (!peer) return;
    const peerId = peer.id;
    const name = peer.name;
    act(async () => {
      await kickRoomPeer(roomState.roomId, peerId);
      showToast(`${name} исключён из комнаты`);
    }, 'Не удалось исключить участника');
  }

  function banParticipant(): void {
    if (!peer) return;
    const peerId = peer.id;
    const peerName = peer.name;
    act(async () => {
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
    }, 'Не удалось заблокировать участника');
  }

  function friendRequestToast(status: 'sent' | 'accepted' | 'already_sent' | 'already_friends'): string {
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
</script>

{#if participantContextMenu.open && peer && !peer.isLocal}
  <ContextMenu
    open={participantContextMenu.open}
    x={participantContextMenu.x}
    y={participantContextMenu.y}
    ariaLabel={`Действия для ${peer.name}`}
    restoreFocus={participantContextMenu.restoreFocus}
    role="dialog"
    onClose={() => closeParticipantContextMenu('', false)}
  >
    {#snippet content()}
      <div class="participant-menu" data-peer-id={peer.id}>
        <PopoverMenuLabel text={showAudioControls ? 'Плитка в сетке' : 'Участник'} />

        {#if peer.accountUserId}
          <PopoverMenuItem role="button" label="Профиль" onclick={showProfile}>
            {#snippet icon()}<User {...iconMd} aria-hidden="true" />{/snippet}
          </PopoverMenuItem>
        {/if}

        {#if canUseSocialActions}
          <PopoverMenuItem role="button" label="Написать" onclick={openDirectMessage}>
            {#snippet icon()}<MessageSquare {...iconMd} aria-hidden="true" />{/snippet}
          </PopoverMenuItem>

          {#if relationship === 'friend'}
            <PopoverMenuItem role="button" label="Удалить из друзей" variant="danger" onclick={dropFriend}>
              {#snippet icon()}<UserMinus {...iconMd} aria-hidden="true" />{/snippet}
            </PopoverMenuItem>
          {:else if relationship === 'incoming'}
            <PopoverMenuItem role="button" label="Принять заявку" variant="friendly" onclick={acceptFriendRequest}>
              {#snippet icon()}<Check {...iconMd} aria-hidden="true" />{/snippet}
            </PopoverMenuItem>
          {:else if relationship === 'outgoing'}
            <PopoverMenuItem role="button" label="Заявка отправлена" variant="friendly" disabled onclick={() => {}}>
              {#snippet icon()}<UserPlus {...iconMd} aria-hidden="true" />{/snippet}
            </PopoverMenuItem>
          {:else}
            <PopoverMenuItem role="button" label="Добавить в друзья" variant="friendly" onclick={sendFriendRequest}>
              {#snippet icon()}<UserPlus {...iconMd} aria-hidden="true" />{/snippet}
            </PopoverMenuItem>
          {/if}
        {:else if !peer.accountUserId}
          <p class="participant-menu-note">Гость: доступны только локальные настройки звука.</p>
        {/if}

        {#if showAudioControls}
          <PopoverDivider />

          <div class="participant-menu-volume">
            <div class="participant-menu-volume-head">
              <span class="participant-menu-volume-label">
                <Volume2 {...iconSm} aria-hidden="true" />
                <span>Громкость</span>
              </span>
              <output class="participant-menu-volume-value">{volumeLabel}</output>
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
          </div>

          <PopoverMenuItem
            role="button"
            label={localMuted ? 'Включить для меня' : 'Заглушить для меня'}
            variant={localMuted ? 'accent' : 'default'}
            onclick={toggleLocalMute}
          >
            {#snippet icon()}<VolumeX {...iconMd} aria-hidden="true" />{/snippet}
          </PopoverMenuItem>
        {/if}

        {#if canModerate}
          <PopoverDivider />
          <PopoverMenuLabel text="Модерация" />

          {#if showAudioControls}
            <PopoverMenuItem
              role="button"
              label={peer.serverMuted ? 'Включить микрофон' : 'Выключить микрофон'}
              disabled={moderating}
              onclick={toggleServerMute}
            >
              {#snippet icon()}<MicOff {...iconMd} aria-hidden="true" />{/snippet}
            </PopoverMenuItem>
          {/if}

          <PopoverMenuItem role="button" label="Исключить из комнаты" variant="danger" disabled={moderating} onclick={kickParticipant}>
            {#snippet icon()}<LogOut {...iconMd} aria-hidden="true" />{/snippet}
          </PopoverMenuItem>
          <PopoverMenuItem role="button" label="Заблокировать в комнате" variant="danger" disabled={moderating} onclick={banParticipant}>
            {#snippet icon()}<Ban {...iconMd} aria-hidden="true" />{/snippet}
          </PopoverMenuItem>
        {/if}
      </div>
    {/snippet}
  </ContextMenu>
{/if}

<style>
  .participant-menu {
    display: flex;
    width: min(288px, calc(100vw - 28px));
    flex-direction: column;
    gap: 2px;
  }

  .participant-menu-note {
    margin: 0;
    padding: 4px 12px 10px;
    color: var(--warm-faint);
    font-size: 13px;
    line-height: 1.45;
  }

  .participant-menu-volume {
    display: flex;
    flex-direction: column;
    gap: 9px;
    padding: 10px 12px 12px;
  }

  .participant-menu-volume-head {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .participant-menu-volume-label {
    display: inline-flex;
    flex: 1;
    align-items: center;
    gap: 10px;
    color: var(--warm-ink-dim);
    font-size: 14px;
    font-weight: 600;
  }

  .participant-menu-volume-value {
    color: var(--warm-faint);
    font-family: var(--font-mono);
    font-size: 11.5px;
  }
</style>
