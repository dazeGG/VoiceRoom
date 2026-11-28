// The service's own account, @voiceroom. A migration creates it with a fixed
// id, the `official` badge and a password hash no password matches. People
// write to it like to anyone; staff answer from the admin app. It cannot sign
// in, befriend, block, call or be called, and people search skips it.
//
// The account is known by its id, not by the badge: staff may give the
// `official` badge to a person too (who may then carry the service's name),
// and that person keeps an ordinary account.

export const OFFICIAL_ACCOUNT_ID = '00000000-0000-4000-8000-00000000f00d';
export const OFFICIAL_ACCOUNT_LOGIN = 'voiceroom';
export const OFFICIAL_ACCOUNT_NAME = 'VoiceRoom';

/** Whether an account is the service's own. */
export function isOfficialAccount(user: { id: string } | null | undefined): boolean {
  return user?.id === OFFICIAL_ACCOUNT_ID;
}
