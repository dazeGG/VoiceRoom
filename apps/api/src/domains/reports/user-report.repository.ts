import type pg from 'pg';
import { REPORT_REASONS, type AdminUserReport, type ReportReason } from '@voice-room/shared/contracts/reports';
import { isOneOf } from '@voice-room/shared/guards';
import { kyselyOn } from '../../platform/db/kysely.ts';
import { epochMillis } from '../../platform/epoch-millis.ts';

export function createUserReportRepository({ pool }: { pool: pg.Pool }) {
  const db = kyselyOn(pool);

  const findReportedUser = (userId: string) =>
    db.selectFrom('users').select('id').where('id', '=', userId).where('deleted_at', 'is', null).executeTakeFirst();

  async function fileUserReport(input: {
    reporterUserId: string;
    targetUserId: string;
    reason: ReportReason;
    comment: string;
  }): Promise<boolean> {
    const row = await db
      .insertInto('user_reports')
      .values({
        reporter_user_id: input.reporterUserId,
        target_user_id: input.targetUserId,
        reason: input.reason,
        comment: input.comment
      })
      .onConflict((conflict) =>
        conflict.columns(['reporter_user_id', 'target_user_id']).where('status', '=', 'open').doNothing()
      )
      .returning('id')
      .executeTakeFirst();
    return Boolean(row);
  }

  const findOpenUserReport = (reportId: string) =>
    db
      .selectFrom('user_reports')
      .select(['id', 'target_user_id'])
      .where('id', '=', reportId)
      .where('status', '=', 'open')
      .executeTakeFirst();

  async function resolveUserTarget(input: {
    targetUserId: string;
    status: 'actioned' | 'dismissed';
    resolvedByUserId: string;
    at: Date;
  }): Promise<number> {
    const result = await db
      .updateTable('user_reports')
      .set({
        status: input.status,
        resolved_at: input.at,
        resolved_by_user_id: input.resolvedByUserId
      })
      .where('target_user_id', '=', input.targetUserId)
      .where('status', '=', 'open')
      .executeTakeFirst();
    return Number(result.numUpdatedRows);
  }

  async function listOpenUsers(): Promise<AdminUserReport[]> {
    const rows = await db
      .selectFrom('user_reports as r')
      .innerJoin('users as reporter', 'reporter.id', 'r.reporter_user_id')
      .leftJoin('users as target', 'target.id', 'r.target_user_id')
      .select([
        'r.id',
        'r.reason',
        'r.comment',
        'r.created_at',
        'r.target_user_id',
        'reporter.login as reporter_login',
        'reporter.id as reporter_id',
        'reporter.display_name as reporter_name',
        'target.id as target_id',
        'target.login as target_login',
        'target.display_name as target_name',
        'target.deleted_at as target_deleted_at'
      ])
      .where('r.status', '=', 'open')
      .orderBy('r.created_at', 'asc')
      .orderBy('r.id', 'asc')
      .limit(200)
      .execute();
    return rows.map((row) => ({
      id: row.id,
      reason: isOneOf(REPORT_REASONS, row.reason) ? row.reason : 'other',
      comment: row.comment,
      createdAt: epochMillis(row.created_at) ?? 0,
      reporter: {
        userId: row.reporter_id,
        login: row.reporter_login,
        displayName: row.reporter_name || row.reporter_login
      },
      target: {
        userId: row.target_user_id,
        login: row.target_id === null || row.target_deleted_at ? '' : (row.target_login ?? ''),
        displayName: row.target_id === null || row.target_deleted_at ? '' : row.target_name || row.target_login || '',
        deleted: row.target_id === null || Boolean(row.target_deleted_at)
      }
    }));
  }

  async function countOpenUserReports(): Promise<number> {
    const row = await db
      .selectFrom('user_reports')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('status', '=', 'open')
      .executeTakeFirst();
    return Number(row?.count ?? 0);
  }

  return Object.freeze({
    findReportedUser,
    fileUserReport,
    findOpenUserReport,
    resolveUserTarget,
    listOpenUsers,
    countOpenUserReports
  });
}
