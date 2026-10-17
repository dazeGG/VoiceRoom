// "How was the call?": sending an answer, and the platform administrator's read.

import type {
  AdminCallFeedbackPage,
  AdminCallFeedbackQuery,
  CallFeedbackBody
} from '@voice-room/shared/contracts/feedback';
import type { Done } from '@voice-room/shared/contracts/http';
import { api } from './client';

export type {
  AdminCallFeedbackEntry,
  AdminCallFeedbackPage,
  CallFeedbackCall,
  CallFeedbackRating,
  CallFeedbackTag
} from '@voice-room/shared/contracts/feedback';

export async function submitCallFeedback(body: CallFeedbackBody): Promise<void> {
  await api.post<Done>('/api/feedback/calls', body, { fallback: 'Не удалось отправить отзыв' });
}

export async function fetchCallFeedback(query: AdminCallFeedbackQuery): Promise<AdminCallFeedbackPage> {
  const params = new URLSearchParams();
  if (query.days) params.set('days', query.days);
  if (query.rating) params.set('rating', query.rating);
  const search = params.size ? `?${params}` : '';
  return api.get<AdminCallFeedbackPage>(`/api/admin/feedback${search}`, { fallback: 'Не удалось загрузить отзывы' });
}
