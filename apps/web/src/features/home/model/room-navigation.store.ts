import { defineStore } from 'pinia';
import { reactive, toRefs } from 'vue';
import { useVoiceSessionStore } from '@/features/room/voice-session.store';

export type RoomShellMode = 'friends' | 'rooms';

// Room-navigation state machine for the logged-in app shell.
// Invariants:
// - viewedRoomId is the room rendered by the app shell and may be a URL-free preview.
// - embeddedRoomId is the mounted room client that owns voice/dock side effects; browsing
//   never creates it. It is created by explicit Enter or by opening the active voice room.
// - joinIntentRoomId is set only by an explicit Enter action and is consumed by RoomPage autoJoin.
// - The browser /r/:roomId route mirrors active voice membership, not preview selection.
//   Route/history and document.body mutations stay in LobbyPage.
export const useRoomNavigationStore = defineStore('room-navigation', () => {
  const roomNavigation = reactive<{
    viewedRoomId: string | null;
    embeddedRoomId: string | null;
    joinIntentRoomId: string | null;
  }>({
    viewedRoomId: null,
    embeddedRoomId: null,
    joinIntentRoomId: null
  });

  function getActiveVoiceRoomId(): string | null {
    return useVoiceSessionStore().roomId;
  }

  function connectedRoomIsViewed(mode: RoomShellMode): boolean {
    const activeRoomId = getActiveVoiceRoomId();
    return Boolean(activeRoomId && roomNavigation.viewedRoomId === activeRoomId && mode === 'rooms');
  }

  // The room client to keep mounted. One off screen stays only for its call: when
  // that call ends (left, kicked, dropped) the client goes with it, so it never
  // shows over the room on screen.
  function mountedRoomId(): string | null {
    const { embeddedRoomId, viewedRoomId } = roomNavigation;
    return embeddedRoomId && (getActiveVoiceRoomId() || viewedRoomId === embeddedRoomId) ? embeddedRoomId : null;
  }

  function embeddedRoomIsVisible(mode: RoomShellMode): boolean {
    return Boolean(mountedRoomId() && mode === 'rooms' && (!getActiveVoiceRoomId() || connectedRoomIsViewed(mode)));
  }

  function setViewedRoomFromRoute(roomId: string): void {
    routeToRoom(roomId);
  }

  function routeToRoom(roomId: string): void {
    // First drop a client whose call ended off screen, so it cannot come back as this room.
    clearDisconnectedHiddenEmbed();
    roomNavigation.viewedRoomId = roomId;
    roomNavigation.joinIntentRoomId = null;
    // Then drop the call-less client the user just browsed away from.
    clearDisconnectedHiddenEmbed();
  }

  function selectRoomPreview(roomId: string): void {
    routeToRoom(roomId);
  }

  function selectRoomForVoiceEntry(roomId: string): void {
    roomNavigation.viewedRoomId = roomId;
    roomNavigation.embeddedRoomId = roomId;
    roomNavigation.joinIntentRoomId = roomId;
  }

  function openActiveVoiceRoom(): string | null {
    const activeRoomId = getActiveVoiceRoomId();
    if (!activeRoomId) return null;
    roomNavigation.viewedRoomId = activeRoomId;
    roomNavigation.embeddedRoomId = activeRoomId;
    roomNavigation.joinIntentRoomId = null;
    return activeRoomId;
  }

  function clearViewedRoom(): void {
    roomNavigation.viewedRoomId = null;
    clearDisconnectedHiddenEmbed();
  }

  function routeToHome(): { closeEmbeddedRoom: boolean } {
    clearViewedRoom();
    return { closeEmbeddedRoom: !getActiveVoiceRoomId() };
  }

  function clearEmbeddedRoom(): void {
    roomNavigation.embeddedRoomId = null;
    roomNavigation.joinIntentRoomId = null;
  }

  function clearDisconnectedHiddenEmbed(): void {
    if (
      !getActiveVoiceRoomId() &&
      roomNavigation.embeddedRoomId &&
      roomNavigation.viewedRoomId !== roomNavigation.embeddedRoomId
    ) {
      roomNavigation.embeddedRoomId = null;
    }
  }

  function leaveViewedConnectedRoom(leavingRoomId: string | null): { closeEmbeddedRoom: boolean } {
    if (!leavingRoomId || roomNavigation.viewedRoomId !== leavingRoomId) {
      return { closeEmbeddedRoom: false };
    }
    return { closeEmbeddedRoom: true };
  }

  return {
    ...toRefs(roomNavigation),
    getActiveVoiceRoomId,
    connectedRoomIsViewed,
    mountedRoomId,
    embeddedRoomIsVisible,
    setViewedRoomFromRoute,
    routeToRoom,
    selectRoomPreview,
    selectRoomForVoiceEntry,
    openActiveVoiceRoom,
    clearViewedRoom,
    routeToHome,
    clearEmbeddedRoom,
    clearDisconnectedHiddenEmbed,
    leaveViewedConnectedRoom
  };
});
