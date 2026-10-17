// What the "how was the call?" tags say, in the question and in the admin panel.

import type { CallFeedbackTag } from '$lib/api/feedback';

export const CALL_FEEDBACK_TAG_LABELS: Record<CallFeedbackTag, string> = {
  sound: 'Чистый звук',
  connection: 'Связь без обрывов',
  video: 'Видео и демонстрация',
  easy: 'Всё просто и понятно',
  features: 'Удобный чат и функции',
  poor_sound: 'Плохой звук',
  echo_noise: 'Эхо или шум',
  not_heard: 'Меня не слышали / я не слышал',
  delay: 'Задержка',
  drops: 'Обрывы и переподключения',
  poor_video: 'Проблемы с видео или демонстрацией',
  hard_to_use: 'Неудобно или непонятно'
};
