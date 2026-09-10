import type { MembershipEnvelope } from '@voice-room/shared/membership';
import { normalizeMembershipEnvelope } from '@voice-room/shared/membership';
import { getJsonAuth } from './http';
import { del } from './http';

export type { MemberPresenceStatus, MembershipEnvelope, MembershipMember, MembershipRole } from '@voice-room/shared/membership';

export interface FetchMembershipsOptions {
  cursor?: string;
  limit?: number;
  query?: string;
}

export async function fetchRoomMemberships(
  roomId: string,
  { cursor, limit = 50, query }: FetchMembershipsOptions = {}
): Promise<MembershipEnvelope> {
  const params = new URLSearchParams({ limit: String(Math.min(100, Math.max(1, limit))) });
  if (cursor) params.set('cursor', cursor);
  if (query?.trim()) params.set('q', query.trim());
  const payload = await getJsonAuth<unknown>(
    `/api/rooms/${encodeURIComponent(roomId)}/members?${params.toString()}`
  );
  const normalized = normalizeMembershipEnvelope(payload);
  if (!normalized.ok || normalized.envelope.roomId !== roomId) {
    throw new Error('Сервер вернул некорректный список участников');
  }
  return normalized.envelope;
}

export async function leaveRoomMembership(roomId: string): Promise<{ left: boolean }> {
  return del<{ left: boolean }>(`/api/rooms/${encodeURIComponent(roomId)}/memberships/me`);
}
