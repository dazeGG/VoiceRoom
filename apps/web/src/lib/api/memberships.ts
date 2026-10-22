import { MemberPage, MembershipLeft } from '@voice-room/shared/contracts/membership';
import { api } from './client';

export type {
  MemberPage,
  MemberPresenceStatus,
  MembershipMember,
  MembershipRole
} from '@voice-room/shared/contracts/membership';

export interface FetchMembershipsOptions {
  cursor?: string | undefined;
  limit?: number | undefined;
  query?: string | undefined;
}

export async function fetchRoomMemberships(
  roomId: string,
  { cursor, limit = 50, query }: FetchMembershipsOptions = {}
): Promise<MemberPage> {
  const params = new URLSearchParams({ limit: String(Math.min(100, Math.max(1, limit))) });
  if (cursor) params.set('cursor', cursor);
  if (query?.trim()) params.set('q', query.trim());
  return api.get(`/api/rooms/${encodeURIComponent(roomId)}/members?${params.toString()}`, MemberPage);
}

export async function leaveRoomMembership(roomId: string): Promise<{ left: boolean }> {
  const { left } = await api.delete(`/api/rooms/${encodeURIComponent(roomId)}/memberships/me`, MembershipLeft);
  return { left };
}
