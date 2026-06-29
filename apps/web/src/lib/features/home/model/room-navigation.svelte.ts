import { voiceSession } from '$lib/features/room/voice-session.svelte';

export type RoomShellMode = 'friends' | 'rooms';

// Room-navigation state machine for the logged-in app shell.
// Invariants:
// - viewedRoomId mirrors the URL-level room preview (/r/:roomId) in the app shell.
// - embeddedRoomId is the mounted room client that owns voice/dock side effects; browsing
//   never creates it. It is created by explicit Enter or by opening the active voice room.
// - joinIntentRoomId is set only by an explicit Enter action and is consumed by RoomPage autoJoin.
// - Route/history and document.body mutations are outside this model; transition helpers return
//   small side-effect instructions so LobbyPage can apply browser/UI effects consistently.
export const roomNavigation = $state<{
  viewedRoomId: string | null;
  embeddedRoomId: string | null;
  joinIntentRoomId: string | null;
}>({
  viewedRoomId: null,
  embeddedRoomId: null,
  joinIntentRoomId: null
});

export function getActiveVoiceRoomId(): string | null {
  return voiceSession.roomId;
}

export function connectedRoomIsViewed(mode: RoomShellMode): boolean {
  const activeRoomId = getActiveVoiceRoomId();
  return Boolean(activeRoomId && roomNavigation.viewedRoomId === activeRoomId && mode === 'rooms');
}

export function embeddedRoomIsVisible(mode: RoomShellMode): boolean {
  return Boolean(
    roomNavigation.embeddedRoomId &&
      mode === 'rooms' &&
      (!getActiveVoiceRoomId() || connectedRoomIsViewed(mode))
  );
}

export function setViewedRoomFromRoute(roomId: string): void {
  routeToRoom(roomId);
}

export function routeToRoom(roomId: string): void {
  roomNavigation.viewedRoomId = roomId;
  roomNavigation.joinIntentRoomId = null;
}

export function selectRoomPreview(roomId: string): void {
  routeToRoom(roomId);
}

export function selectRoomForVoiceEntry(roomId: string): void {
  roomNavigation.viewedRoomId = roomId;
  roomNavigation.embeddedRoomId = roomId;
  roomNavigation.joinIntentRoomId = roomId;
}

export function openActiveVoiceRoom(): string | null {
  const activeRoomId = getActiveVoiceRoomId();
  if (!activeRoomId) return null;
  roomNavigation.viewedRoomId = activeRoomId;
  roomNavigation.embeddedRoomId = activeRoomId;
  roomNavigation.joinIntentRoomId = null;
  return activeRoomId;
}

export function clearViewedRoom(): void {
  roomNavigation.viewedRoomId = null;
}

export function routeToHome(): { closeEmbeddedRoom: boolean } {
  clearViewedRoom();
  return { closeEmbeddedRoom: !getActiveVoiceRoomId() };
}

export function clearEmbeddedRoom(): void {
  roomNavigation.embeddedRoomId = null;
  roomNavigation.joinIntentRoomId = null;
}

export function clearDisconnectedHiddenEmbed(): void {
  if (!getActiveVoiceRoomId() && roomNavigation.embeddedRoomId && roomNavigation.viewedRoomId !== roomNavigation.embeddedRoomId) {
    roomNavigation.embeddedRoomId = null;
  }
}

export function leaveViewedConnectedRoom(leavingRoomId: string | null): { closeEmbeddedRoom: boolean } {
  if (!leavingRoomId || roomNavigation.viewedRoomId !== leavingRoomId) {
    return { closeEmbeddedRoom: false };
  }
  return { closeEmbeddedRoom: true };
}
