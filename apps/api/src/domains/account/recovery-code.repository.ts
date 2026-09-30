// Recovery codes: one-time codes that reset a forgotten password.

import { sql } from 'kysely';
import type pg from 'pg';
import { kyselyOn } from '../../platform/db/kysely.ts';
import { verifyPassword } from '../../lib/password.ts';
import { RECOVERY_CODE_COUNT, normalizeRecoveryCode } from '@voice-room/shared/account-security';
import { createRecoveryCode, hashRecoveryCode, mapUser, toDate, toMillis } from './user-records.ts';
import { lockUser, replacePassword } from './user.repository.ts';

export function createRecoveryCodeRepository({ pool }: { pool: pg.Pool }) {
  const db = kyselyOn(pool);

  // Generating a set proves the password again, like a password change, so a
  // stolen session cannot mint itself a permanent way back into the account.
  async function generateRecoveryCodes({
    userId,
    currentPassword,
    now = Date.now()
  }: {
    userId: string;
    currentPassword: string;
    now?: number;
  }) {
    return db.transaction().execute(async (trx) => {
      const user = mapUser(await lockUser(trx, 'id', userId));
      if (!user) return { status: 'not_found', codes: [] };
      if (!(await verifyPassword(currentPassword, user.passwordHash))) return { status: 'invalid_password', codes: [] };

      const codes = Array.from({ length: RECOVERY_CODE_COUNT }, createRecoveryCode);
      await trx.deleteFrom('account_recovery_codes').where('user_id', '=', userId).execute();
      await trx
        .insertInto('account_recovery_codes')
        .values(
          codes.map((code) => ({ user_id: userId, code_hash: hashRecoveryCode(userId, code), created_at: toDate(now) }))
        )
        .execute();
      return { status: 'generated', codes, generatedAt: now };
    });
  }

  async function getRecoveryCodesStatus(userId: string) {
    const row = await db
      .selectFrom('account_recovery_codes')
      .select([
        sql<number>`count(*) FILTER (WHERE used_at IS NULL)::int`.as('remaining'),
        (eb) => eb.fn.max('created_at').as('generated_at')
      ])
      .where('user_id', '=', userId)
      .executeTakeFirst();
    return {
      remaining: Number(row?.remaining) || 0,
      generatedAt: row?.generated_at ? toMillis(row.generated_at) : null
    };
  }

  // Both failure paths (unknown login, wrong or spent code) return before the
  // password hash is computed, so neither is observably slower than the other.
  async function recoverWithCode({
    login,
    code,
    newPassword,
    now = Date.now()
  }: {
    login: string;
    code: unknown;
    newPassword: string;
    now?: number;
  }) {
    const normalizedCode = normalizeRecoveryCode(code);
    if (!login || !normalizedCode) return { status: 'invalid', user: null, remaining: 0 };
    return db.transaction().execute(async (trx) => {
      const user = mapUser(await lockUser(trx, 'login', login));
      // An account waiting to be deleted comes back through a restore, not a code.
      if (!user || user.deletionRequestedAt || user.deletedAt) return { status: 'invalid', user: null, remaining: 0 };

      const spent = await trx
        .updateTable('account_recovery_codes')
        .set({ used_at: toDate(now) })
        .where('user_id', '=', user.id)
        .where('code_hash', '=', hashRecoveryCode(user.id, normalizedCode))
        .where('used_at', 'is', null)
        .returning('id')
        .execute();
      if (spent.length !== 1) return { status: 'invalid', user: null, remaining: 0 };

      await replacePassword(trx, { userId: user.id, newPassword, now });
      const remaining = await trx
        .selectFrom('account_recovery_codes')
        .select(sql<number>`count(*)::int`.as('remaining'))
        .where('user_id', '=', user.id)
        .where('used_at', 'is', null)
        .executeTakeFirst();
      return { status: 'recovered', user, remaining: Number(remaining?.remaining) || 0 };
    });
  }

  return {
    generateRecoveryCodes,
    getRecoveryCodesStatus,
    recoverWithCode
  };
}
