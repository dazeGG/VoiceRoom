import { t } from '@/shared/i18n';
import { WHATS_NEW_VERSION, hasUnseenWhatsNew } from '@voiceroom/shared/account-security';
import type { WhatsNew } from '@/api/auth';

export interface WhatsNewSlide {
  video: string;
  poster: string;
  alt: string;
  title: string;
  text: string;
  action?: 'appearance';
}

function slideMedia(name: string): Pick<WhatsNewSlide, 'video' | 'poster'> {
  const path = `/whats-new/${WHATS_NEW_VERSION}/${name}`;
  return { video: `${path}.mp4`, poster: `${path}.webp` };
}

// Keep the clips and their first-frame posters in public/whats-new/<version>/.
// Replacing the slides advances the content revision independently of package versions.
export const WHATS_NEW_SLIDES: readonly [WhatsNewSlide, WhatsNewSlide, ...WhatsNewSlide[]] = [
  {
    ...slideMedia('calls'),
    get alt() {
      return t(
        'Звонок другу в личных сообщениях: плитки собеседников, панель управления и открытый код из четырёх эмодзи под замком'
      );
    },
    get title() {
      return t('Звонки друзьям');
    },
    get text() {
      return t(
        'Позвоните другу прямо из личных сообщений. Звонок защищён сквозным шифрованием: сверьте четыре эмодзи под замком.'
      );
    }
  },
  {
    ...slideMedia('dock'),
    get alt() {
      return t('Звонок: курсор уходит со сцены, панель управления скрывается, плитки занимают её место');
    },
    get title() {
      return t('Панель звонка прячется');
    },
    get text() {
      return t(
        'Включите «Скрывать панель звонка» во внешнем виде, и панель появится, только когда вы наведёте курсор на звонок.'
      );
    },
    action: 'appearance'
  },
  {
    ...slideMedia('chat'),
    get alt() {
      return t('Чат: сообщение со словом жирным шрифтом, курсивом, фрагментом кода и списком');
    },
    get title() {
      return t('Форматирование в чате');
    },
    get text() {
      return t('Жирный, курсив, код и списки прямо в сообщениях: пишите, как в Markdown.');
    }
  },
  {
    ...slideMedia('languages'),
    get alt() {
      return t('Настройки, «Внешний вид»: выбор языка, интерфейс переключается на английский');
    },
    get title() {
      return t('English и Français');
    },
    get text() {
      return t('Интерфейс теперь доступен на английском и французском. Язык меняется во внешнем виде.');
    },
    action: 'appearance'
  }
];

// Leave enough playback time for every clip to finish at least one loop.
export const WHATS_NEW_SLIDE_MS = 8000;

export function shouldShowWhatsNew(state: WhatsNew): boolean {
  return state.current === WHATS_NEW_VERSION && hasUnseenWhatsNew(state.lastSeen, state.current);
}
