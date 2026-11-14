import { isRecord } from './guards.ts';
import { resolveLocale, type AppLocale } from './localization.ts';

const TEXT_KEYS = [
  'newMessage',
  'privateMessage',
  'newNotification',
  'privateNotification',
  'privateEvent',
  'friendRequestTitle',
  'friendAcceptedTitle',
  'friendRequestBody',
  'friendAcceptedBody',
  'loginTitle',
  'recoveryTitle',
  'loginBody',
  'ringTitle',
  'ringRoom',
  'ringJoin',
  'ringPrivate',
  'roomInvitation',
  'roomInvitationUnnamed'
] as const;
export type NotificationTextKey = (typeof TEXT_KEYS)[number];
export type NotificationText = {
  key: NotificationTextKey;
  args?: { actor?: string; room?: string; device?: string };
};
export type NotificationCopy = { title?: NotificationText; body?: NotificationText; privateBody?: NotificationText };

type Texts = Record<NotificationTextKey, (args: NonNullable<NotificationText['args']>) => string>;
const texts: Record<AppLocale, Texts> = {
  ru: {
    newMessage: () => 'Новое сообщение',
    privateMessage: () => 'Откройте VoiceRoom, чтобы прочитать сообщение.',
    newNotification: () => 'У вас новое уведомление',
    privateNotification: () => 'Откройте VoiceRoom, чтобы посмотреть уведомление.',
    privateEvent: () => 'Откройте VoiceRoom, чтобы посмотреть событие.',
    friendRequestTitle: () => 'Новая заявка в друзья',
    friendAcceptedTitle: () => 'Заявка принята',
    friendRequestBody: ({ actor = '' }) => `${actor} хочет добавить вас в друзья`,
    friendAcceptedBody: ({ actor = '' }) => `${actor} принял(а) вашу заявку в друзья`,
    loginTitle: () => 'Новый вход в аккаунт',
    recoveryTitle: () => 'Вход по коду восстановления',
    loginBody: ({ device = '' }) => `${device}. Если это были не вы, откройте VoiceRoom.`,
    ringTitle: ({ actor }) => `${actor || 'Друг'} зовёт вас`,
    ringRoom: ({ room = '' }) => `Комната «${room}»`,
    ringJoin: () => 'Присоединиться к комнате',
    ringPrivate: () => 'Вас зовут в голосовую комнату.',
    roomInvitation: ({ room = '' }) => `Приглашение в комнату «${room}»`,
    roomInvitationUnnamed: () => 'Приглашение в комнату'
  },
  en: {
    newMessage: () => 'New message',
    privateMessage: () => 'Open VoiceRoom to read the message.',
    newNotification: () => 'You have a new notification',
    privateNotification: () => 'Open VoiceRoom to view the notification.',
    privateEvent: () => 'Open VoiceRoom to view the event.',
    friendRequestTitle: () => 'New friend request',
    friendAcceptedTitle: () => 'Friend request accepted',
    friendRequestBody: ({ actor = '' }) => `${actor} wants to add you as a friend`,
    friendAcceptedBody: ({ actor = '' }) => `${actor} accepted your friend request`,
    loginTitle: () => 'New account sign-in',
    recoveryTitle: () => 'Recovery code sign-in',
    loginBody: ({ device = '' }) => `${device}. If this was not you, open VoiceRoom.`,
    ringTitle: ({ actor }) => `${actor || 'A friend'} is inviting you`,
    ringRoom: ({ room = '' }) => `Room “${room}”`,
    ringJoin: () => 'Join the room',
    ringPrivate: () => 'You are invited to a voice room.',
    roomInvitation: ({ room = '' }) => `Invitation to room “${room}”`,
    roomInvitationUnnamed: () => 'Room invitation'
  },
  fr: {
    newMessage: () => 'Nouveau message',
    privateMessage: () => 'Ouvrez VoiceRoom pour lire le message.',
    newNotification: () => 'Vous avez une nouvelle notification',
    privateNotification: () => 'Ouvrez VoiceRoom pour voir la notification.',
    privateEvent: () => 'Ouvrez VoiceRoom pour voir l’événement.',
    friendRequestTitle: () => 'Nouvelle demande d’ami',
    friendAcceptedTitle: () => 'Demande d’ami acceptée',
    friendRequestBody: ({ actor = '' }) => `${actor} souhaite vous ajouter comme ami`,
    friendAcceptedBody: ({ actor = '' }) => `${actor} a accepté votre demande d’ami`,
    loginTitle: () => 'Nouvelle connexion au compte',
    recoveryTitle: () => 'Connexion avec un code de récupération',
    loginBody: ({ device = '' }) => `${device}. Si ce n’était pas vous, ouvrez VoiceRoom.`,
    ringTitle: ({ actor }) => `${actor || 'Un ami'} vous invite`,
    ringRoom: ({ room = '' }) => `Salon « ${room} »`,
    ringJoin: () => 'Rejoindre le salon',
    ringPrivate: () => 'Vous êtes invité dans un salon vocal.',
    roomInvitation: ({ room = '' }) => `Invitation au salon « ${room} »`,
    roomInvitationUnnamed: () => 'Invitation à un salon'
  }
};

function isTextKey(value: unknown): value is NotificationTextKey {
  return typeof value === 'string' && TEXT_KEYS.some((key) => key === value);
}

export function parseNotificationText(value: unknown): NotificationText | null {
  if (!isRecord(value) || !isTextKey(value.key)) return null;
  const raw = isRecord(value.args) ? value.args : {};
  const args: NonNullable<NotificationText['args']> = {};
  if (typeof raw.actor === 'string') args.actor = raw.actor;
  if (typeof raw.room === 'string') args.room = raw.room;
  if (typeof raw.device === 'string') args.device = raw.device;
  return { key: value.key, args };
}

export function notificationText(text: NotificationText, locale: AppLocale): string {
  return texts[locale][text.key](text.args ?? {});
}

/** Render after recipient selection, then remove internal copy/privacy metadata from the wire. */
export function localizeNotificationPayload(payload: unknown, locale: unknown): unknown {
  if (!isRecord(payload)) return payload;
  const { copy, notificationPrivate, ...wire } = payload;
  if (!isRecord(copy)) return wire;
  const title = parseNotificationText(copy.title);
  const body = parseNotificationText(notificationPrivate === true ? copy.privateBody : copy.body);
  const language = resolveLocale([], locale);
  return {
    ...wire,
    ...(title ? { title: notificationText(title, language) } : {}),
    ...(body ? { body: notificationText(body, language) } : {})
  };
}
