import { Type, type Static } from 'typebox';
import { Ok } from './http.ts';

export const AppLocale = Type.Union([Type.Literal('ru'), Type.Literal('en'), Type.Literal('fr')]);
const Version = Type.String({
  pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
});

export const PushLocaleIntent = Type.Object({
  protocol: Type.Literal(1),
  locale: AppLocale,
  expectedVersion: Type.Union([Version, Type.Null()])
});
export type PushLocaleIntent = Static<typeof PushLocaleIntent>;

export const PushRegistrationState = Type.Object({ protocol: Type.Literal(1), locale: AppLocale, version: Version });
export type PushRegistrationState = Static<typeof PushRegistrationState>;

export const PushRegistrationSuccess = Ok({ registration: PushRegistrationState });
export type PushRegistrationSuccess = Static<typeof PushRegistrationSuccess>;

export const PushRegistrationConflict = Type.Object({
  ok: Type.Literal(false),
  error: Type.String(),
  code: Type.Literal('push_registration_conflict'),
  registration: Type.Union([PushRegistrationState, Type.Null()])
});
export type PushRegistrationConflict = Static<typeof PushRegistrationConflict>;
