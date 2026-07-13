<script lang="ts">
  import { HeadphoneOff, MicOff, MonitorPlay } from '@lucide/svelte';
  import { iconSm } from '$lib/shared/ui/icons';
  import { getAvatarPresentation } from '../client/ui/avatar-presentation';
  import { state as roomState } from '../client/core/state.svelte';
  import { enterScreenView } from '../client/ui/screen-view';
  import { openParticipantContextMenu } from '../participant-context-ui.svelte';
  import { toggleParticipantFocus } from '../participants-ui.svelte';
  import type { Participant } from '../client/core/types';

  let { participant, variant = 'grid' }: { participant: Participant; variant?: 'grid' | 'focus' | 'strip' } = $props();

  let tile = $state<HTMLElement>();
  let imageFailed = $state(false);

  const avatar = $derived(getAvatarPresentation(participant));
  $effect(() => {
    participant.avatarUrl;
    imageFailed = false;
  });
  const displayName = $derived(participant.isLocal ? `${participant.name} · вы` : participant.name);
  const viewing = $derived(roomState.viewedScreenPeerId === participant.id);
  const canWatch = $derived(!participant.isLocal && participant.screen && !viewing);
  const screenActionLabel = $derived(roomState.screenRequesting ? 'Подключение' : 'Смотреть экран');

  function activateParticipant(): void {
    if (participant.screen && !participant.isLocal && roomState.viewedScreenPeerId !== participant.id) {
      void enterScreenView(participant.id).catch((error) => console.error(error));
      return;
    }
    toggleParticipantFocus(participant.id);
  }

  function handleTileClick(event: MouseEvent): void {
    if ((event.target as HTMLElement | null)?.closest('button, select, input, a')) return;
    activateParticipant();
  }

  function handleScreenAction(event: MouseEvent): void {
    event.stopPropagation();
    void enterScreenView(participant.id).catch((error) => console.error(error));
  }

  function handleContextMenu(event: MouseEvent): void {
    if (participant.isLocal) return;
    event.preventDefault();
    event.stopPropagation();
    openParticipantContextMenu(participant.id, event.clientX, event.clientY);
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      activateParticipant();
      return;
    }
    if (participant.isLocal) return;
    const isContextKey = event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey);
    if (!isContextKey || !tile) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = tile.getBoundingClientRect();
    openParticipantContextMenu(participant.id, rect.left + rect.width / 2, rect.top + rect.height / 2);
  }
</script>

<div
  bind:this={tile}
  role="button"
  class="participant"
  data-variant={variant}
  data-peer-id={participant.id}
  data-local={participant.isLocal ? 'true' : undefined}
  data-account-user-id={participant.accountUserId || undefined}
  data-deafened={String(participant.deafened)}
  data-muted={String(participant.muted)}
  data-screen={String(participant.screen)}
  data-speaking={String(participant.speaking)}
  tabindex="0"
  aria-haspopup={participant.isLocal ? undefined : 'dialog'}
  aria-label={participant.isLocal
    ? undefined
    : `${participant.name}. Откройте контекстное меню Shift+F10 или клавишей меню.`}
  style:--level={participant.level.toFixed(3)}
  style:--participant-pastel={avatar.background}
  style:--participant-avatar-fg={avatar.foreground}
  style:--participant-avatar-shadow={avatar.shadow}
  onclick={handleTileClick}
  oncontextmenu={handleContextMenu}
  onkeydown={handleKeydown}
>
  <div class="voice-ring" aria-hidden="true">
    <span class="avatar">
      {#if avatar.src && !imageFailed}<img src={avatar.src} alt="" onerror={() => (imageFailed = true)} />{:else}{avatar.initials}{/if}
    </span>
  </div>
  <div class="participant-copy">
    <h2>
      <span class="participant-name">{displayName}</span>
      <span class="participant-muted-icon" aria-label="Микрофон выключен" title="Микрофон выключен"><MicOff {...iconSm} /></span>
      <span class="participant-deafened-icon" aria-label="Звук выключен" title="Звук выключен"><HeadphoneOff {...iconSm} /></span>
    </h2>
    {#if participant.statusLabel}
      <p>{participant.statusLabel}</p>
    {:else}
      <p hidden></p>
    {/if}
    <button
      class="participant-screen-action"
      type="button"
      hidden={!canWatch}
      disabled={roomState.screenRequesting}
      onclick={handleScreenAction}
    >
      <MonitorPlay {...iconSm} aria-hidden="true" />
      <span>{screenActionLabel}</span>
    </button>
  </div>
</div>
