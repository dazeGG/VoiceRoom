// "How was the call?": sending an answer. Staff read them in the admin app.

import type { CallFeedbackBody } from '@voice-room/shared/contracts/feedback';
import type { Done } from '@voice-room/shared/contracts/http';
import { api } from './client';

export type { CallFeedbackCall, CallFeedbackRating, CallFeedbackTag } from '@voice-room/shared/contracts/feedback';

export async function submitCallFeedback(body: CallFeedbackBody): Promise<void> {
  await api.post<Done>('/api/feedback/calls', body, { fallback: 'Не удалось отправить отзыв' });
}
