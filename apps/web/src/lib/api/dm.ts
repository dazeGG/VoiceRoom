// Direct (one-to-one) messages. Mirrors the /api/dm/:userId routes.

import { del, getJsonAuth, patchJson, postJsonAuth } from './http';
import type { PublicUser } from './friends';

export interface DirectMessage {
  id: string;
  senderId: string;
  recipientId: string;
  body: string;
  createdAt: number;
  editedAt: number | null;
  readAt: number | null;
}

// Opening a thread also clears its unread badge server-side.
export async function fetchThread(userId: string): Promise<{ peer: PublicUser; messages: DirectMessage[]; muted: boolean }> {
  const payload = await getJsonAuth<{ peer: PublicUser; messages?: DirectMessage[]; muted?: boolean }>(
    `/api/dm/${encodeURIComponent(userId)}`
  );
  return {
    peer: payload.peer,
    messages: Array.isArray(payload.messages) ? payload.messages : [],
    muted: Boolean(payload.muted)
  };
}

export async function sendDirectMessage(userId: string, text: string): Promise<DirectMessage> {
  const payload = await postJsonAuth<{ message: DirectMessage }>(`/api/dm/${encodeURIComponent(userId)}`, {
    text
  });
  return payload.message;
}

export async function markThreadRead(userId: string): Promise<number> {
  const payload = await postJsonAuth<{ count?: number }>(`/api/dm/${encodeURIComponent(userId)}/read`, {});
  return payload.count ?? 0;
}

export async function deleteDirectMessage(userId: string, messageId: string): Promise<{ ok: boolean; deleted?: boolean }> {
  const payload = await del<{ ok: boolean; deleted?: boolean }>(`/api/dm/${encodeURIComponent(userId)}/messages/${encodeURIComponent(messageId)}`);
  return payload;
}

export async function editDirectMessage(userId: string, messageId: string, text: string): Promise<DirectMessage> {
  const payload = await patchJson<{ message: DirectMessage }>(
    `/api/dm/${encodeURIComponent(userId)}/messages/${encodeURIComponent(messageId)}`,
    { text }
  );
  return payload.message;
}
