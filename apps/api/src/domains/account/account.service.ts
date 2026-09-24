// Accounts: registration, sign-in and recovery (each opens a session), the
// signed-in devices list, sign-in alerts, recovery codes, notices and account
// deletion. Returns what happened; the routes own cookies, rate limits and
// how each outcome is spelled over HTTP.

import type { Logger } from 'pino';
import { ACCOUNT_DELETION_GRACE_MS, WHATS_NEW_VERSION, formatRecoveryCode, isDeletedAccountLogin } from '@voice-room/shared/account-security';
import { isValidPassword } from '@voice-room/shared/validation';
import { LOG_EVENTS } from '../../lib/log-events.ts';
import { hashSessionToken, selfUser } from '../../lib/user-store.ts';

export interface AccountUser {
  id: string;
  deletionRequestedAt?: number | null;
  [key: string]: unknown;
}

export interface Device {
  userAgent: string;
  locationLabel: unknown;
}

interface LoginAlert {
  id: string;
  client?: string;
  os?: string;
  location?: string;
}

// Distributes over a union so each status narrows on its own.
type Status<T extends string> = T extends string ? { status: T } : never;
type NotFound = Status<'not_found'>;

export interface AccountUserStore {
  createUser(input: { login: string; displayName: string; password: string }): Promise<{ status: string; user?: AccountUser }>;
  createSession(input: { userId: string } & Device): Promise<{ token: string; publicId: string }>;
  getUserById(userId: string): Promise<AccountUser | null>;
  verifyCredentials(login: string, password: string): Promise<AccountUser | null>;
  deleteSession(token: string): Promise<unknown>;
  updateDisplayName(input: { userId: string; displayName: string }): Promise<AccountUser | null>;
  changePassword(input: { userId: string; currentPassword: string; newPassword: string }): Promise<{ status: string }>;
  getRecoveryCodesStatus(userId: string): Promise<unknown>;
  getAccountNotices(userId: string): Promise<{ recoveryCodesReminderSnoozedUntil?: unknown; whatsNewSeen?: unknown }>;
  snoozeRecoveryCodesReminder(input: { userId: string }): Promise<{ status: string; snoozedUntil?: unknown }>;
  markWhatsNewSeen(input: { userId: string }): Promise<{ status: string; whatsNewSeen?: unknown }>;
  markAppPromptSeen(input: { userId: string }): Promise<{ status: string }>;
  listPendingLoginAlerts(input: { userId: string; excludeSessionPublicId: string }): Promise<unknown[]>;
  resolveLoginAlert(input: { userId: string; alertId: string; resolution: 'confirmed' | 'denied'; currentSessionPublicId: string }): Promise<{ status: string; revokedTokenHash?: string | null }>;
  listSessions(input: { userId: string; currentTokenHash: string }): Promise<unknown[]>;
  revokeSession(input: { userId: string; publicId: string }): Promise<{ status: string; tokenHash?: string }>;
  revokeOtherSessions(input: { userId: string; keepTokenHash: string }): Promise<{ tokenHashes: string[] }>;
  generateRecoveryCodes(input: { userId: string; currentPassword: string }): Promise<{ status: string; codes?: string[]; generatedAt?: unknown }>;
  recoverWithCode(input: { login: string; code: unknown; newPassword: string }): Promise<{ status: string; user?: AccountUser; remaining?: number }>;
  recordLogin(input: { userId: string; sessionPublicId: string; kind: LoginKind; userAgent: string; locationLabel: unknown }): Promise<{ alert?: LoginAlert | null }>;
}

export interface AccountDeletionRepository {
  isLoginReserved(login: string): Promise<boolean>;
  previewDeletion(input: { userId: string }): Promise<Record<string, unknown>>;
  requestDeletion(input: { userId: string; currentPassword: string }): Promise<{ status: string; scheduledFor?: number }>;
  restoreAccount(input: { login: string; password: string }): Promise<{ status: string; userId: string | null }>;
}

export type LoginKind = 'register' | 'login' | 'recovery';

export interface AccountDeps {
  users(): AccountUserStore;
  deletions(): AccountDeletionRepository | null;
  loginFailures: {
    reserve(key: string): { allowed: boolean; retryAfterSeconds?: number };
    reset(key: string): void;
  };
  /** Ends what the given sessions still hold open: sockets and voice seats. */
  endSessionConnections(input: { userId?: string | null; tokenHashes?: string[] | null }): Promise<void>;
  notifyUser(userId: string, event: Record<string, unknown>): void;
  queuePush(userId: string, payload: Record<string, unknown>, options: { ignorePreferences: boolean }): Promise<unknown>;
  /** Refreshes the user's live room peers after a profile change. */
  refreshActiveProfile(user: AccountUser): void;
  broadcastProfileToFriends(user: AccountUser, log: Pick<Logger, 'error'> | undefined): Promise<void>;
  logger(): Pick<Logger, 'error'>;
}

export type SelfUser = ReturnType<typeof selfUser>;
export type OpenedSession = { status: 'signed_in'; token: string; user: SelfUser };

function describeLoginDevice(alert: LoginAlert): string {
  const device = [alert.client || 'Неизвестный браузер', alert.os].filter(Boolean).join(' · ');
  return alert.location ? `${device}, ${alert.location}` : device;
}

export function createAccountService(deps: AccountDeps) {
  // Creating a session can stamp per-account markers (the desktop app
  // marker), so the self view re-reads the row instead of reusing the user
  // loaded before.
  async function reloadSelf(user: AccountUser): Promise<SelfUser> {
    return selfUser((await deps.users().getUserById(user.id)) || user);
  }

  // Records a sign-in and, when it comes from an unfamiliar device or city,
  // asks the account's other devices right away and by push. A failure here
  // must not fail the sign-in itself.
  async function recordAndAnnounceLogin(userId: string, session: { publicId: string }, device: Device, kind: LoginKind): Promise<void> {
    try {
      const { alert } = await deps.users().recordLogin({ userId, sessionPublicId: session.publicId, kind, userAgent: device.userAgent, locationLabel: device.locationLabel });
      if (!alert) return;
      deps.notifyUser(userId, { type: 'account.login.new', alert });
      void deps.queuePush(userId, {
        type: 'account.login',
        title: kind === 'recovery' ? 'Вход по коду восстановления' : 'Новый вход в аккаунт',
        body: `${describeLoginDevice(alert)}. Если это были не вы, откройте Voice Room.`,
        tag: `login-alert:${alert.id}`,
        dedupeKey: `login-alert:${alert.id}`,
        url: '/'
      }, { ignorePreferences: true });
    } catch (error) {
      deps.logger().error({ evt: LOG_EVENTS.AUTH_SIGN_IN_RECORD_FAILED, userId, kind, err: error }, 'failed to record a sign-in');
    }
  }

  async function openSession(user: AccountUser, device: () => Promise<Device>, kind: LoginKind): Promise<OpenedSession> {
    const where = await device();
    const session = await deps.users().createSession({ userId: user.id, ...where });
    await recordAndAnnounceLogin(user.id, session, where, kind);
    return { status: 'signed_in', token: session.token, user: await reloadSelf(user) };
  }

  async function register(input: { login: string; displayName: string; password: string; passwordConfirm: string; device: () => Promise<Device> }): Promise<OpenedSession | Status<'invalid_login' | 'invalid_password' | 'password_mismatch' | 'login_taken'>> {
    if (!input.login) return { status: 'invalid_login' };
    if (!isValidPassword(input.password)) return { status: 'invalid_password' };
    if (input.password !== input.passwordConfirm) return { status: 'password_mismatch' };
    // A deleted account's login stays taken, so nobody can pose as that person.
    if (isDeletedAccountLogin(input.login) || await deps.deletions()?.isLoginReserved(input.login)) return { status: 'login_taken' };
    const created = await deps.users().createUser({ login: input.login, displayName: input.displayName, password: input.password });
    if (created.status === 'login_taken') return { status: 'login_taken' };
    return openSession(created.user as AccountUser, input.device, 'register');
  }

  async function login(input: { login: string; password: string; device: () => Promise<Device> }): Promise<
    OpenedSession | Status<'invalid_credentials'> | { status: 'throttled'; retryAfterSeconds: number } | { status: 'deletion_pending'; deletionScheduledFor: number }
  > {
    if (!input.login || !input.password) return { status: 'invalid_credentials' };
    // The per-IP limit does nothing against credential stuffing from many
    // addresses; this caps failed guesses per login regardless of source. It
    // is keyed by the submitted login, existing or not, so it reveals nothing.
    const accountRate = deps.loginFailures.reserve(input.login);
    if (!accountRate.allowed) return { status: 'throttled', retryAfterSeconds: accountRate.retryAfterSeconds ?? 0 };
    const user = await deps.users().verifyCredentials(input.login, input.password);
    if (!user) return { status: 'invalid_credentials' };
    deps.loginFailures.reset(input.login);
    // The right password on an account waiting to be deleted offers a restore.
    if (user.deletionRequestedAt) return { status: 'deletion_pending', deletionScheduledFor: user.deletionRequestedAt + ACCOUNT_DELETION_GRACE_MS };
    return openSession(user, input.device, 'login');
  }

  async function logout(token: string): Promise<void> {
    if (!token) return;
    await deps.users().deleteSession(token);
    await deps.endSessionConnections({ tokenHashes: [hashSessionToken(token) as string] });
  }

  async function updateProfile(userId: string, displayName: string, log?: Pick<Logger, 'error'>): Promise<{ status: 'updated'; user: SelfUser } | NotFound> {
    const user = await deps.users().updateDisplayName({ userId, displayName });
    if (!user) return { status: 'not_found' };
    deps.refreshActiveProfile(user);
    await deps.broadcastProfileToFriends(user, log);
    return { status: 'updated', user: selfUser(user) };
  }

  // Every session of the account ends, this one included: the new password
  // is the new proof of who is signed in.
  async function changePassword(userId: string, currentPassword: string, newPassword: string): Promise<Status<'changed' | 'invalid_password' | 'invalid_new_password'> | NotFound> {
    if (!isValidPassword(newPassword)) return { status: 'invalid_new_password' };
    const result = await deps.users().changePassword({ userId, currentPassword, newPassword });
    if (result.status === 'not_found') return { status: 'not_found' };
    if (result.status === 'invalid_password') return { status: 'invalid_password' };
    await deps.endSessionConnections({ userId });
    return { status: 'changed' };
  }

  async function security(userId: string) {
    const [recoveryCodes, notices] = await Promise.all([deps.users().getRecoveryCodesStatus(userId), deps.users().getAccountNotices(userId)]);
    return { recoveryCodes, recoveryCodesReminder: { snoozedUntil: notices.recoveryCodesReminderSnoozedUntil } };
  }

  async function snoozeRecoveryCodesReminder(userId: string): Promise<{ status: 'snoozed'; snoozedUntil: unknown } | NotFound> {
    const result = await deps.users().snoozeRecoveryCodesReminder({ userId });
    return result.status === 'snoozed' ? { status: 'snoozed', snoozedUntil: result.snoozedUntil } : { status: 'not_found' };
  }

  async function whatsNew(userId: string) {
    const notices = await deps.users().getAccountNotices(userId);
    return { current: WHATS_NEW_VERSION as string, lastSeen: notices.whatsNewSeen };
  }

  async function markWhatsNewSeen(userId: string): Promise<{ status: 'seen'; whatsNew: { current: string; lastSeen: unknown } } | NotFound> {
    const result = await deps.users().markWhatsNewSeen({ userId });
    if (result.status !== 'seen') return { status: 'not_found' };
    return { status: 'seen', whatsNew: { current: WHATS_NEW_VERSION as string, lastSeen: result.whatsNewSeen } };
  }

  async function markAppPromptSeen(userId: string): Promise<Status<'seen'> | NotFound> {
    const result = await deps.users().markAppPromptSeen({ userId });
    return result.status === 'seen' ? { status: 'seen' } : { status: 'not_found' };
  }

  async function loginAlerts(userId: string, currentSessionPublicId: string): Promise<unknown[]> {
    return deps.users().listPendingLoginAlerts({ userId, excludeSessionPublicId: currentSessionPublicId });
  }

  // Denying a sign-in ends that session; either answer closes the same
  // question on every other device of the account.
  async function resolveLoginAlert(userId: string, currentSessionPublicId: string, alertId: string, resolution: 'confirmed' | 'denied'): Promise<
    { status: 'resolved'; resolution: 'confirmed' } | { status: 'resolved'; resolution: 'denied'; sessionEnded: boolean; recoveryCodes: unknown } | NotFound
  > {
    const result = await deps.users().resolveLoginAlert({ userId, alertId, resolution, currentSessionPublicId });
    if (result.status !== 'resolved') return { status: 'not_found' };
    if (result.revokedTokenHash) await deps.endSessionConnections({ userId, tokenHashes: [result.revokedTokenHash] });
    deps.notifyUser(userId, { type: 'account.login.resolved', alertId: String(alertId).toLowerCase(), resolution });
    if (resolution === 'confirmed') return { status: 'resolved', resolution };
    return { status: 'resolved', resolution, sessionEnded: Boolean(result.revokedTokenHash), recoveryCodes: await deps.users().getRecoveryCodesStatus(userId) };
  }

  async function listSessions(userId: string, currentTokenHash: string): Promise<unknown[]> {
    return deps.users().listSessions({ userId, currentTokenHash });
  }

  async function revokeSession(userId: string, currentSessionPublicId: string, sessionId: unknown): Promise<Status<'revoked' | 'current_session'> | NotFound> {
    const publicId = typeof sessionId === 'string' ? sessionId.toLowerCase() : '';
    if (publicId && publicId === String(currentSessionPublicId).toLowerCase()) return { status: 'current_session' };
    const result = await deps.users().revokeSession({ userId, publicId });
    if (result.status !== 'revoked') return { status: 'not_found' };
    await deps.endSessionConnections({ userId, tokenHashes: [result.tokenHash as string] });
    return { status: 'revoked' };
  }

  async function revokeOtherSessions(userId: string, keepTokenHash: string): Promise<number> {
    const result = await deps.users().revokeOtherSessions({ userId, keepTokenHash });
    await deps.endSessionConnections({ userId, tokenHashes: result.tokenHashes });
    return result.tokenHashes.length;
  }

  async function generateRecoveryCodes(userId: string, currentPassword: string): Promise<
    { status: 'generated'; codes: string[]; recoveryCodes: { remaining: number; generatedAt: unknown } } | Status<'invalid_password'> | NotFound
  > {
    const result = await deps.users().generateRecoveryCodes({ userId, currentPassword });
    if (result.status === 'not_found') return { status: 'not_found' };
    if (result.status === 'invalid_password') return { status: 'invalid_password' };
    const codes = result.codes ?? [];
    return {
      status: 'generated',
      codes: codes.map((code) => formatRecoveryCode(code) as string),
      recoveryCodes: { remaining: codes.length, generatedAt: result.generatedAt }
    };
  }

  // A recovery code replaces the password and ends every other session.
  async function recover(input: { login: string; code: unknown; newPassword: string; device: () => Promise<Device> }): Promise<
    (OpenedSession & { remaining: number }) | Status<'invalid_new_password' | 'invalid_code'>
  > {
    if (!isValidPassword(input.newPassword)) return { status: 'invalid_new_password' };
    const result = await deps.users().recoverWithCode({ login: input.login, code: input.code, newPassword: input.newPassword });
    if (result.status !== 'recovered') return { status: 'invalid_code' };
    const user = result.user as AccountUser;
    await deps.endSessionConnections({ userId: user.id });
    const opened = await openSession(user, input.device, 'recovery');
    return { ...opened, remaining: result.remaining ?? 0 };
  }

  async function deletionPreview(userId: string): Promise<{ status: 'preview'; preview: Record<string, unknown> } | Status<'unavailable'>> {
    const repository = deps.deletions();
    if (!repository) return { status: 'unavailable' };
    return { status: 'preview', preview: await repository.previewDeletion({ userId }) };
  }

  // The account is hidden at once and deleted after the grace period; every
  // session ends and friends see the anonymous name from now on.
  async function requestDeletion(userId: string, currentPassword: string, log?: Pick<Logger, 'error'>): Promise<
    { status: 'scheduled'; deletionScheduledFor: number } | { status: 'already_requested'; deletionScheduledFor: number } | Status<'invalid_password' | 'unavailable'> | NotFound
  > {
    const repository = deps.deletions();
    if (!repository) return { status: 'unavailable' };
    const result = await repository.requestDeletion({ userId, currentPassword });
    if (result.status === 'invalid_password') return { status: 'invalid_password' };
    if (result.status === 'not_found') return { status: 'not_found' };
    if (result.status === 'already_requested') return { status: 'already_requested', deletionScheduledFor: result.scheduledFor as number };
    await deps.endSessionConnections({ userId });
    const hidden = await deps.users().getUserById(userId);
    if (hidden) await deps.broadcastProfileToFriends(hidden, log);
    return { status: 'scheduled', deletionScheduledFor: result.scheduledFor as number };
  }

  async function restore(input: { login: string; password: string; device: () => Promise<Device> }, log?: Pick<Logger, 'error'>): Promise<OpenedSession | Status<'expired' | 'invalid_credentials'>> {
    const repository = deps.deletions() as AccountDeletionRepository;
    const result = input.login && input.password
      ? await repository.restoreAccount({ login: input.login, password: input.password })
      : { status: 'invalid', userId: null };
    if (result.status === 'expired') return { status: 'expired' };
    if (result.status !== 'restored') return { status: 'invalid_credentials' };
    const user = await deps.users().getUserById(result.userId as string) as AccountUser;
    const opened = await openSession(user, input.device, 'login');
    await deps.broadcastProfileToFriends(user, log);
    return opened;
  }

  return {
    register,
    login,
    logout,
    updateProfile,
    changePassword,
    security,
    snoozeRecoveryCodesReminder,
    whatsNew,
    markWhatsNewSeen,
    markAppPromptSeen,
    loginAlerts,
    resolveLoginAlert,
    listSessions,
    revokeSession,
    revokeOtherSessions,
    generateRecoveryCodes,
    recover,
    deletionPreview,
    requestDeletion,
    restore,
    deletionAvailable: () => Boolean(deps.deletions())
  };
}

export type AccountService = ReturnType<typeof createAccountService>;
