import { getAppRealtime, type RealtimeEvent, type RoomSnapshot } from '$lib/api/realtime';
import { applyRoomSummary } from './room-presence.svelte';

type RoomDetailHandler = (event: RealtimeEvent) => void;

const previewSubscriptions = new Map<string, number>();
const detailHandlers = new Map<string, Set<RoomDetailHandler>>();

function roomDetailEventTargetsRoom(event: RealtimeEvent, roomId: string): boolean {
  if (event.type === 'room.snapshot') return event.payload.roomId === roomId;
  if ('payload' in event && event.payload && typeof event.payload === 'object') {
    const payload = event.payload as { roomId?: string; room?: { roomId?: string } };
    return payload.roomId === roomId || payload.room?.roomId === roomId;
  }
  return false;
}

function dispatchRoomDetail(roomId: string, event: RealtimeEvent): void {
  const handlers = detailHandlers.get(roomId);
  if (!handlers) return;
  for (const handler of handlers) handler(event);
}

let lobbyHooked = false;
let activeVoiceJoin: {
  roomId: string;
  peerId: string;
  sessionToken: string;
  name: string;
} | null = null;
let restoreHooked = false;

function ensureReconnectRestore(): void {
  if (restoreHooked) return;
  restoreHooked = true;
  getAppRealtime().onRestore(() => {
    for (const roomId of previewSubscriptions.keys()) {
      getAppRealtime().send('room.preview.subscribe', { roomId });
    }
    if (activeVoiceJoin) {
      getAppRealtime().send('room.join', activeVoiceJoin);
    }
  });
}

export function initLobbyRoomRealtime(
  onRoomsUpdate: (updater: (rooms: import('$lib/api/auth').OwnedRoom[]) => import('$lib/api/auth').OwnedRoom[]) => void
): () => void {
  const conn = getAppRealtime();
  const unsubscribe = conn.subscribe((event) => {
    if (event.type === 'room.summary') {
      applyRoomSummary(event.payload.room);
      const summary = event.payload.room;
      onRoomsUpdate((rooms) =>
        rooms.map((room) =>
          room.roomId === summary.roomId
            ? {
                ...room,
                peers: summary.peers,
                name: summary.name || room.name,
                emoji: summary.emoji || room.emoji,
                roomColorKey: summary.roomColorKey || room.roomColorKey,
                roomIconKey: summary.roomIconKey || room.roomIconKey,
                roomPresetKey: summary.roomPresetKey || room.roomPresetKey
              }
            : room
        )
      );
      return;
    }

    if (event.type === 'room.deleted') {
      onRoomsUpdate((rooms) => rooms.filter((room) => room.roomId !== event.payload.roomId));
      return;
    }

    if (event.type === 'room.updated') {
      const updated = event.payload.room;
      onRoomsUpdate((rooms) =>
        rooms.map((room) =>
          room.roomId === updated.roomId
            ? { ...room, ...updated, relationship: room.relationship }
            : room
        )
      );
    }
  });

  lobbyHooked = true;
  return () => {
    lobbyHooked = false;
    unsubscribe();
  };
}

export function subscribeRoomPreview(roomId: string, handler: RoomDetailHandler): () => void {
  ensureReconnectRestore();
  const conn = getAppRealtime();
  let handlers = detailHandlers.get(roomId);
  if (!handlers) {
    handlers = new Set();
    detailHandlers.set(roomId, handlers);
  }
  handlers.add(handler);

  const count = (previewSubscriptions.get(roomId) ?? 0) + 1;
  previewSubscriptions.set(roomId, count);
  if (count === 1) {
    conn.send('room.preview.subscribe', { roomId });
  }

  const unsubscribe = conn.subscribe((event) => {
    if (!roomDetailEventTargetsRoom(event, roomId)) return;
    dispatchRoomDetail(roomId, event);
  });

  return () => {
    handlers?.delete(handler);
    if (handlers && handlers.size === 0) detailHandlers.delete(roomId);
    unsubscribe();

    const next = (previewSubscriptions.get(roomId) ?? 1) - 1;
    if (next <= 0) {
      previewSubscriptions.delete(roomId);
      conn.send('room.preview.unsubscribe', { roomId });
    } else {
      previewSubscriptions.set(roomId, next);
    }
  };
}

export function subscribeRoomVoice(roomId: string, handler: RoomDetailHandler): () => void {
  const conn = getAppRealtime();
  let handlers = detailHandlers.get(roomId);
  if (!handlers) {
    handlers = new Set();
    detailHandlers.set(roomId, handlers);
  }
  handlers.add(handler);

  const unsubscribe = conn.subscribe((event) => {
    if (!roomDetailEventTargetsRoom(event, roomId)) return;
    dispatchRoomDetail(roomId, event);
  });

  return () => {
    handlers?.delete(handler);
    if (handlers && handlers.size === 0) detailHandlers.delete(roomId);
    unsubscribe();
  };
}

export function joinVoiceRoom(payload: {
  roomId: string;
  peerId: string;
  sessionToken: string;
  name: string;
}): void {
  ensureReconnectRestore();
  activeVoiceJoin = payload;
  getAppRealtime().send('room.join', payload);
}

export function leaveVoiceRoom(payload: { roomId: string; peerId: string; sessionToken: string }): void {
  if (
    activeVoiceJoin?.roomId === payload.roomId &&
    activeVoiceJoin.peerId === payload.peerId
  ) {
    activeVoiceJoin = null;
  }
  getAppRealtime().send('room.leave', payload);
}

export function updateVoicePeer(payload: {
  roomId: string;
  peerId: string;
  sessionToken: string;
  patch: Record<string, unknown>;
}): void {
  getAppRealtime().send('room.peer.update', payload);
}

export function ensureAppRealtimeConnected(): void {
  getAppRealtime().ensureConnected();
}

export function isLobbyRoomRealtimeHooked(): boolean {
  return lobbyHooked;
}

export type { RoomSnapshot };