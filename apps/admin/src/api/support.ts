// The support inbox's endpoints, each with the schema its answer is checked
// against (see client.ts).

import {
  SupportNoted,
  SupportRead,
  SupportReplied,
  SupportResolved,
  SupportThread,
  SupportThreadList,
  SupportUnread,
  type SupportStatus
} from '@voiceroom/shared/contracts/support';
import { api } from './client.ts';

const thread = (userId: string) => `/api/admin/support/threads/${encodeURIComponent(userId)}`;

export const fetchSupportThreads = (status: SupportStatus) =>
  api.get(`/api/admin/support/threads?status=${status}`, SupportThreadList, 'Не удалось загрузить обращения');

export const fetchSupportUnread = async () =>
  (await api.get('/api/admin/support/unread', SupportUnread, 'Не удалось загрузить обращения')).openUnread;

/** The conversation as it is; reading it marks nothing. */
export const fetchSupportThread = (userId: string) =>
  api.get(thread(userId), SupportThread, 'Не удалось загрузить переписку');

/** Staff have seen the conversation up to the person's newest message; answers the menu badge. */
export const markSupportRead = async (userId: string) =>
  (await api.post(`${thread(userId)}/read`, SupportRead, {}, 'Не удалось отметить прочитанным')).openUnread;

/** A retry of the same answer sends the same key, so the person gets it once. */
export const replySupport = async (userId: string, text: string, idempotencyKey: string) =>
  (
    await api.post(`${thread(userId)}/reply`, SupportReplied, { text }, 'Не удалось отправить ответ', {
      'Idempotency-Key': idempotencyKey
    })
  ).message;

export const noteSupport = async (userId: string, text: string) =>
  (await api.post(`${thread(userId)}/notes`, SupportNoted, { text }, 'Не удалось сохранить заметку')).note;

export const resolveSupport = (userId: string) =>
  api.post(`${thread(userId)}/resolve`, SupportResolved, {}, 'Не удалось отметить решённым');
