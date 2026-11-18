// Scope comes from server transport wiring, never a request body or header.
export type RoomSurface = 'main' | 'widget';
export type RoomKind = RoomSurface;
export interface RoomBoundary {
  kind?: RoomKind;
  widgetChatEnabled?: boolean;
}

export function roomAllowsSurface(room: RoomBoundary | null | undefined, surface: RoomSurface): boolean {
  return Boolean(room && (room.kind ?? 'main') === surface);
}

export function roomAllowsChat(room: RoomBoundary | null | undefined, surface: RoomSurface): boolean {
  return surface === 'main' && roomAllowsSurface(room, surface);
}

export function roomAllowsAttachments(room: RoomBoundary | null | undefined, surface: RoomSurface): boolean {
  return surface === 'main' && roomAllowsSurface(room, surface);
}
