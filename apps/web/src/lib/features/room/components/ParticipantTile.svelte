<script lang="ts">
  import { onMount } from 'svelte';
  import { getAvatarColor } from '$lib/visual/tokens';
  import { getInitials } from '../client/core/utils';
  import { state as roomState } from '../client/core/state.svelte';
  import { enterScreenView } from '../client/ui/screen-view';
  import { mountIcons } from '../client/ui/icons';
  import { openParticipantContextMenu } from '../participant-context-ui.svelte';
  import type { Participant } from '../client/core/types';

  let { participant }: { participant: Participant } = $props();

  let tile: HTMLElement | undefined;

  const palette = $derived(
    getAvatarColor(participant.avatarColorKey)
  );
  const displayName = $derived(participant.isLocal ? `${participant.name} · вы` : participant.name);
  const viewing = $derived(roomState.viewedScreenPeerId === participant.id);
  const canWatch = $derived(!participant.isLocal && participant.screen && !viewing);
  const screenActionLabel = $derived(roomState.screenRequesting ? 'Подключение' : 'Смотреть экран');

  onMount(() => {
    if (tile) mountIcons(tile);
  });

  function handleTileClick(event: MouseEvent): void {
    if (!participant.screen || participant.isLocal || roomState.viewedScreenPeerId === participant.id) return;
    if ((event.target as HTMLElement | null)?.closest('button, select, input, a')) return;
    void enterScreenView(participant.id).catch((error) => console.error(error));
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
    if (participant.isLocal) return;
    const isContextKey = event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey);
    if (!isContextKey || !tile) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = tile.getBoundingClientRect();
    openParticipantContextMenu(participant.id, rect.left + rect.width / 2, rect.top + rect.height / 2);
  }
</script>

<article
  bind:this={tile}
  class="participant"
  data-peer-id={participant.id}
  data-local={participant.isLocal ? 'true' : undefined}
  data-account-user-id={participant.accountUserId || undefined}
  data-deafened={String(participant.deafened)}
  data-muted={String(participant.muted)}
  data-screen={String(participant.screen)}
  data-speaking={String(participant.speaking)}
  tabindex={participant.isLocal ? undefined : 0}
  aria-haspopup={participant.isLocal ? undefined : 'dialog'}
  aria-label={participant.isLocal
    ? undefined
    : `${participant.name}. Откройте контекстное меню Shift+F10 или клавишей меню.`}
  style:--level={participant.level.toFixed(3)}
  style:--participant-pastel={palette.background}
  style:--participant-avatar-fg={palette.foreground}
  style:--participant-avatar-shadow={palette.shadow}
  onclick={handleTileClick}
  oncontextmenu={handleContextMenu}
  onkeydown={handleKeydown}
>
  <div class="voice-ring" aria-hidden="true">
    <span class="avatar">{getInitials(participant.name)}</span>
  </div>
  <div class="participant-copy">
    <h2>
      <span class="participant-name">{displayName}</span>
      <span class="participant-muted-icon" data-icon="mic-muted" aria-label="Микрофон выключен" title="Микрофон выключен"></span>
      <span class="participant-deafened-icon" data-icon="headphones-muted" aria-label="Звук выключен" title="Звук выключен"></span>
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
      <span data-icon="watch-screen" aria-hidden="true"></span>
      <span>{screenActionLabel}</span>
    </button>
  </div>
</article>