import type { CallFeedbackTag } from '@voice-room/shared/contracts/feedback';
import { t } from './index';

export const CALL_FEEDBACK_TAG_LABELS: Record<CallFeedbackTag, string> = {
  get sound() {
    return t('Чистый звук');
  },
  get connection() {
    return t('Связь без обрывов');
  },
  get video() {
    return t('Видео и демонстрация');
  },
  get easy() {
    return t('Всё просто и понятно');
  },
  get features() {
    return t('Удобный чат и функции');
  },
  get poor_sound() {
    return t('Плохой звук');
  },
  get echo_noise() {
    return t('Эхо или шум');
  },
  get not_heard() {
    return t('Меня не слышали / я не слышал');
  },
  get delay() {
    return t('Задержка');
  },
  get drops() {
    return t('Обрывы и переподключения');
  },
  get poor_video() {
    return t('Проблемы с видео или демонстрацией');
  },
  get hard_to_use() {
    return t('Неудобно или непонятно');
  }
};
