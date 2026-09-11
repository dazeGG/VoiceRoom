<script lang="ts">
  // The in-room rail: it owns the room-shell wiring (peer session, panel state,
  // participant menu) and renders the shared room chat panel for everything the
  // lobby preview also shows.
  import { onMount } from 'svelte';
  import { cleanDisplayName } from '$lib/shared/utils/text';
  import { showToast } from '../client/ui/toast';
  import { getRoomIdFromPath, getStoredPeerSession } from '../client/core/session';
  import { openParticipantContextMenu } from '../participant-context-ui.svelte';
  import { roomUi, closeChat, incrementUnreadChat, markChatRead, selectRoomPanel } from '../room-ui.svelte';
  import { roomSettingsUi } from '../room-settings.svelte';
  import RoomChatPanel from './RoomChatPanel.svelte';
  import RoomMemberList from '$lib/features/home/components/lobby/RoomMemberList.svelte';

  let roomId = $state('');
  let peerId = $state('');
  let sessionToken = $state('');
  let ready = $state(false);

  onMount(() => {
    roomId = getRoomIdFromPath();
    const peerSession = getStoredPeerSession(roomId);
    peerId = peerSession.peerId;
    sessionToken = peerSession.sessionToken;
    ready = true;
  });

  // Reflect chat state onto <body> so the room layout + dock can react in CSS.
  $effect(() => {
    document.body.dataset.chatOpen = roomUi.chatOpen ? 'true' : 'false';
    return () => {
      delete document.body.dataset.chatOpen;
    };
  });

  // Read at send time: the guest name dialog can persist a name long after this
  // component mounted.
  function resolveDisplayName(): string {
    return cleanDisplayName(localStorage.getItem('voice-room:name')) || 'Гость';
  }

  function openAuthorMenu(authorPeerId: string, event: MouseEvent): void {
    const anchor = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    const rect = anchor?.getBoundingClientRect();
    queueMicrotask(() =>
      openParticipantContextMenu(
        authorPeerId,
        rect ? rect.left + rect.width / 2 : event.clientX,
        rect ? rect.bottom + 6 : event.clientY,
        'list',
        anchor
      )
    );
  }
</script>

{#if ready}
  <RoomChatPanel
    {roomId}
    {peerId}
    {sessionToken}
    {resolveDisplayName}
    rootClass="room-chat-rail"
    ariaLabel="Панель комнаты"
    hidden={!roomUi.chatOpen}
    activeTab={roomUi.activePanel === 'participants' ? 'participants' : 'chat'}
    visible={roomUi.chatOpen}
    unread={roomUi.unreadChat}
    chatTabId="room-panel-chat-tab"
    participantsTabId="room-panel-participants-tab"
    chatPanelId="room-panel-chat"
    participantsPanelId="room-panel-participants"
    onSelectChat={() => selectRoomPanel('chat')}
    onSelectParticipants={() => selectRoomPanel('participants')}
    onCollapse={closeChat}
    onRead={markChatRead}
    onUnreadMessage={incrementUnreadChat}
    onToast={(message, options) => showToast(message, options)}
    onAuthorContextMenu={openAuthorMenu}
    canModerate={roomSettingsUi.isOwner}
  >
    {#snippet participants()}
      <RoomMemberList {roomId} />
    {/snippet}
  </RoomChatPanel>
{/if}
