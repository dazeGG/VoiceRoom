// Feature blurbs for the start screen hero.
import { t } from '@/shared/i18n';
export const START_FEATURES = [
  {
    get title() {
      return t('Смотрите вместе');
    },
    get desc() {
      return t('Кино, сериалы и видео со звуком в 1080p 30 FPS.');
    }
  },
  {
    get title() {
      return t('Играйте вместе');
    },
    get desc() {
      return t('Оверлей поверх игры показывает, кто говорит.');
    }
  },
  {
    get title() {
      return t('Зовите по ссылке');
    },
    get desc() {
      return t('Друзьям не нужен аккаунт, чтобы зайти.');
    }
  }
];
