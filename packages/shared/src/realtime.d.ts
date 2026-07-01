export const MAX_VISIBLE_ROOM_PEERS: 5;
export const SUMMARY_COALESCE_MS: 75;

export type ClientEnvelope = {
  id?: string;
  type: string;
  payload?: Record<string, unknown>;
};

export type ServerEnvelope = {
  id?: string;
  type: string;
  payload?: Record<string, unknown>;
  error?: { code: string; message: string };
};

export type RoomPeerSummary = {
  id: string;
  accountUserId?: string;
  avatarColorKey: string;
  muted: boolean;
  name: string;
};

export type RoomRealtimeSummary = {
  roomId: string;
  name: string;
  emoji: string;
  roomColorKey: string;
  roomIconKey: string;
  roomPresetKey: string;
  isStatic: boolean;
  relationship: string;
  peers: number;
  visiblePeers: RoomPeerSummary[];
  hiddenPeerCount: number;
  lastMessageAt?: number | null;
  unreadCount?: number;
};

export function parseClientEnvelope(raw: string): { ok: true; envelope: ClientEnvelope } | { ok: false; code: string };
export function parseServerEnvelope(raw: string): { ok: true; envelope: ServerEnvelope } | { ok: false; code: string };
export function buildServerEnvelope(type: string, payload?: Record<string, unknown>, id?: string): ServerEnvelope;
export function buildServerErrorEnvelope(code: string, message: string, id?: string): ServerEnvelope;
export function toRoomPeerSummary(
  peer: Record<string, unknown>,
  resolveAvatarColorKey?: (peerId: string) => string
): RoomPeerSummary;
export function buildRoomRealtimeSummary(
  room: Record<string, unknown>,
  peers: Array<Record<string, unknown>>,
  resolveAvatarColorKey?: (peerId: string) => string
): RoomRealtimeSummary;
export function validateClientCommand(
  envelope: ClientEnvelope
): { ok: true; envelope: ClientEnvelope } | { ok: false; code: string };