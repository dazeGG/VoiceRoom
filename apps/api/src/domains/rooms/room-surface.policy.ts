import type { RoomCapabilities } from '@voice-room/shared/contracts/rooms';

// Scope comes from server transport wiring, never a request body or header.
export type RoomSurface = 'main' | 'widget' | 'meet';
export type RoomKind = RoomSurface;
export interface RoomBoundary {
  kind?: RoomKind;
  widgetChatEnabled?: boolean;
}

type SurfaceCeiling = Omit<RoomCapabilities, 'maxPeers'> & { guestOnly: boolean; requiresWidgetOwner: boolean };

export const ROOM_SURFACE_CEILINGS: Readonly<Record<RoomSurface, Readonly<SurfaceCeiling>>> = {
  main: { screenShare: true, camera: true, chat: 'persistent', guestOnly: false, requiresWidgetOwner: false },
  widget: { screenShare: false, camera: true, chat: 'none', guestOnly: true, requiresWidgetOwner: true },
  meet: { screenShare: true, camera: true, chat: 'ephemeral', guestOnly: true, requiresWidgetOwner: false }
};

export function roomCapabilities(surface: RoomSurface, maxPeers: number): RoomCapabilities {
  const { screenShare, camera, chat } = ROOM_SURFACE_CEILINGS[surface];
  // The ephemeral WebSocket handler has not shipped yet.
  return { screenShare, camera, chat: chat === 'ephemeral' ? 'none' : chat, maxPeers };
}

export function roomAllowsSurface(room: RoomBoundary | null | undefined, surface: RoomSurface): boolean {
  return Boolean(room && (room.kind ?? 'main') === surface);
}

export async function roomAllowsAdmission(
  room: RoomBoundary | null,
  surface: RoomSurface,
  widgetCanAdmit: () => Promise<boolean>
): Promise<boolean> {
  return (
    roomAllowsSurface(room, surface) &&
    (!ROOM_SURFACE_CEILINGS[surface].requiresWidgetOwner || (await widgetCanAdmit()))
  );
}

export function roomAllowsChat(room: RoomBoundary | null | undefined, surface: RoomSurface): boolean {
  return ROOM_SURFACE_CEILINGS[surface].chat === 'persistent' && roomAllowsSurface(room, surface);
}

export function roomAllowsAttachments(room: RoomBoundary | null | undefined, surface: RoomSurface): boolean {
  return roomAllowsChat(room, surface);
}
