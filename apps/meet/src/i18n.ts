import { ref } from 'vue';
import { resolveLocale, type AppLocale } from '@voice-room/shared/localization';
import { setLocaleReader, setMessageReader } from '@voice-room/ui/i18n';
import { callMessages } from '@/call-messages';

const messages = {
  language: ['Язык', 'Language', 'Langue'],
  created: ['Встреча создана', 'Meeting created', 'Réunion créée'],
  shareDescription: [
    'Отправьте ссылку участникам встречи.',
    'Send the link to your guests.',
    'Envoyez le lien à vos invités.'
  ],
  meetingLink: ['Ссылка на встречу', 'Meeting link', 'Lien de la réunion'],
  copyLink: ['Копировать ссылку', 'Copy link', 'Copier le lien'],
  copied: ['Ссылка скопирована', 'Link copied', 'Lien copié'],
  copyManually: [
    'Ссылка выделена. Скопируйте её вручную.',
    'The link is selected. Copy it manually.',
    'Le lien est sélectionné. Copiez-le manuellement.'
  ],
  openMeeting: ['Открыть встречу', 'Open meeting', 'Ouvrir la réunion'],
  createTitle: ['Создайте встречу', 'Create a meeting', 'Créez une réunion'],
  createDescription: [
    'Создайте комнату и пригласите участников по ссылке.',
    'Create a room and invite guests with a link.',
    'Créez une salle et invitez vos participants avec un lien.'
  ],
  create: ['Создать встречу', 'Create meeting', 'Créer une réunion'],
  creating: ['Создаём встречу…', 'Creating meeting…', 'Création de la réunion…'],
  checkingOwner: ['Проверяем ссылку владельца…', 'Verifying owner link…', 'Vérification du lien propriétaire…'],
  invitation: [
    'Чтобы присоединиться, откройте ссылку на встречу.',
    'Open a meeting link to join.',
    'Ouvrez un lien de réunion pour rejoindre la salle.'
  ],
  left: ['Вы покинули встречу', 'You left the meeting', 'Vous avez quitté la réunion'],
  leftDescription: [
    'Пока встреча открыта, к ней можно вернуться.',
    'You can rejoin while the meeting is open.',
    'Vous pouvez revenir tant que la réunion est ouverte.'
  ],
  rejoin: ['Вернуться на встречу', 'Rejoin meeting', 'Revenir à la réunion'],
  home: ['На главную', 'Back to home', 'Retour à l’accueil'],
  missing: ['Встреча недоступна', 'Meeting unavailable', 'Réunion indisponible'],
  missingDescription: [
    'Проверьте ссылку или попросите организатора отправить новую.',
    'Check your link or ask the organizer for a new one.',
    'Vérifiez le lien ou demandez-en un nouveau à l’organisateur.'
  ],
  join: ['Присоединиться к встрече', 'Join meeting', 'Rejoindre la réunion'],
  checking: ['Проверяем встречу…', 'Checking meeting…', 'Vérification de la réunion…'],
  joinDescription: [
    'Укажите имя, которое увидят участники.',
    'Enter the name your guests will see.',
    'Saisissez le nom que les participants verront.'
  ],
  name: ['Имя для встречи', 'Display name', 'Nom affiché'],
  nameRequired: ['Введите имя.', 'Enter a name.', 'Saisissez un nom.'],
  joining: ['Подключаемся…', 'Joining…', 'Connexion…'],
  retry: ['Повторить', 'Try again', 'Réessayer'],
  call: ['Встреча', 'Meeting', 'Réunion'],
  reconnecting: ['Переподключаемся…', 'Reconnecting…', 'Reconnexion…'],
  connected: ['Подключено', 'Connected', 'Connecté'],
  'error.join': [
    'Не удалось присоединиться. Попробуйте ещё раз.',
    'Could not join. Please try again.',
    'Impossible de rejoindre la réunion. Réessayez.'
  ],
  'error.screen': [
    'Не удалось открыть демонстрацию.',
    'Could not open screen share.',
    'Impossible d’ouvrir le partage d’écran.'
  ],
  'error.unavailable': [
    'Сервер недоступен. Попробуйте ещё раз.',
    'The server is unavailable. Please try again.',
    'Le serveur est indisponible. Réessayez.'
  ],
  'error.invalidResponse': [
    'Не удалось прочитать ответ сервера.',
    'Could not read the server response.',
    'Impossible de lire la réponse du serveur.'
  ],
  'error.ownerLink': [
    'Ссылка владельца недействительна. Откройте актуальную ссылку.',
    'This owner link is invalid. Open the current owner link.',
    'Ce lien propriétaire est invalide. Ouvrez le lien actuel.'
  ],
  'error.ownerAuthorization': [
    'Срок доступа истёк. Снова откройте ссылку владельца.',
    'Your access expired. Open the owner link again.',
    'Votre accès a expiré. Rouvrez le lien propriétaire.'
  ],
  'error.roomNotFound': ['Встреча не найдена.', 'Meeting not found.', 'Réunion introuvable.'],
  'error.roomFull': ['Во встрече нет свободных мест.', 'This meeting is full.', 'Cette réunion est complète.'],
  'error.createLimit': [
    'Создано слишком много встреч. Попробуйте позже.',
    'Too many meetings were created. Try again later.',
    'Trop de réunions ont été créées. Réessayez plus tard.'
  ],
  'error.session': [
    'Не удалось восстановить сеанс. Войдите снова.',
    'Could not restore your session. Join again.',
    'Impossible de rétablir votre session. Rejoignez la réunion à nouveau.'
  ],
  'error.generic': [
    'Не удалось выполнить запрос. Попробуйте ещё раз.',
    'The request failed. Please try again.',
    'La demande a échoué. Réessayez.'
  ]
} satisfies Record<string, readonly [string, string, string]>;

const index = { ru: 0, en: 1, fr: 2 } as const;
const meetMessages: Readonly<Record<string, readonly string[] | undefined>> = messages;
export const locale = ref<AppLocale>('ru');

export function setMeetLocale(value: AppLocale): void {
  locale.value = value;
  document.documentElement.lang = value;
}

export function installMeetI18n(): void {
  setMeetLocale(resolveLocale(navigator.languages));
  setLocaleReader(() => locale.value);
  setMessageReader((language, key) => {
    if (key.startsWith('meet.')) return meetMessages[key.slice(5)]?.[index[language]];
    if (language === 'ru') return undefined;
    return callMessages.get(key)?.[language];
  });
}
