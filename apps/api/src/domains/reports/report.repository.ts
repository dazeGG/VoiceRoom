// Reports to the service operator and the messages they point at. The only
// writer of content_reports.

import type pg from 'pg';
import { kyselyOn } from '../../platform/db/kysely.ts';
import type { AdminReport, ReportReason } from '@voice-room/shared/contracts/reports';

export type ReportTargetKind = 'room_message' | 'direct_message';

export type ReportedRoomMessage = {
  roomId: string;
  authorUserId: string | null;
  deleted: boolean;
  /** A persistent room; a temporary one is open to anyone with its link. */
  roomIsStatic: boolean;
};
export type ReportedDirectMessage = { senderId: string; recipientId: string; deleted: boolean };
export type OpenReport = { id: string; targetKind: ReportTargetKind; roomId: string | null; messageId: string };

const OPEN_REPORTS_LIMIT = 200;

function toMillis(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  const time = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

export function createReportRepository({ pool }: { pool: pg.Pool }) {
  const db = kyselyOn(pool);

  async function findRoomMessage(roomId: string, messageId: string): Promise<ReportedRoomMessage | null> {
    const row = await db
      .selectFrom('room_messages as m')
      .innerJoin('rooms as r', 'r.id', 'm.room_id')
      .select(['m.room_id', 'm.author_user_id', 'm.deleted_at', 'r.is_static', 'r.deleted_at as room_deleted_at'])
      .where('m.room_id', '=', roomId)
      .where('m.id', '=', messageId)
      .executeTakeFirst();
    return row
      ? {
          roomId: row.room_id,
          authorUserId: row.author_user_id,
          deleted: Boolean(row.deleted_at || row.room_deleted_at),
          roomIsStatic: row.is_static
        }
      : null;
  }

  async function findDirectMessage(messageId: string): Promise<ReportedDirectMessage | null> {
    const row = await db
      .selectFrom('direct_messages')
      .select(['sender_id', 'recipient_id', 'deleted_at'])
      .where('id', '=', messageId)
      .executeTakeFirst();
    return row ? { senderId: row.sender_id, recipientId: row.recipient_id, deleted: Boolean(row.deleted_at) } : null;
  }

  /** Stores an open report; false when this account already has one open for the message. */
  async function fileReport(input: {
    reporterUserId: string;
    targetKind: ReportTargetKind;
    roomId: string | null;
    messageId: string;
    reason: ReportReason;
    comment: string;
  }): Promise<boolean> {
    const inserted = await db
      .insertInto('content_reports')
      .values({
        reporter_user_id: input.reporterUserId,
        target_kind: input.targetKind,
        room_id: input.roomId,
        message_id: input.messageId,
        reason: input.reason,
        comment: input.comment
      })
      .onConflict((conflict) =>
        conflict.columns(['reporter_user_id', 'target_kind', 'message_id']).where('status', '=', 'open').doNothing()
      )
      .returning('id')
      .executeTakeFirst();
    return Boolean(inserted);
  }

  async function findOpenReport(reportId: string): Promise<OpenReport | null> {
    const row = await db
      .selectFrom('content_reports')
      .select(['id', 'target_kind', 'room_id', 'message_id'])
      .where('id', '=', reportId)
      .where('status', '=', 'open')
      .executeTakeFirst();
    return row
      ? { id: row.id, targetKind: row.target_kind as ReportTargetKind, roomId: row.room_id, messageId: row.message_id }
      : null;
  }

  /** Closes every open report of the message with one decision; returns how many it closed. */
  async function resolveTarget(input: {
    targetKind: ReportTargetKind;
    messageId: string;
    status: 'actioned' | 'dismissed';
    resolvedByUserId: string;
    at: Date;
  }): Promise<number> {
    const result = await db
      .updateTable('content_reports')
      .set({ status: input.status, resolved_at: input.at, resolved_by_user_id: input.resolvedByUserId })
      .where('target_kind', '=', input.targetKind)
      .where('message_id', '=', input.messageId)
      .where('status', '=', 'open')
      .executeTakeFirst();
    return Number(result.numUpdatedRows);
  }

  /** The open reports, oldest first, each with the message as it stands now. */
  async function listOpen(): Promise<AdminReport[]> {
    const rows = await db
      .selectFrom('content_reports as r')
      .innerJoin('users as reporter', 'reporter.id', 'r.reporter_user_id')
      .leftJoin('room_messages as rm', (join) =>
        join
          .onRef('rm.id', '=', 'r.message_id')
          .onRef('rm.room_id', '=', 'r.room_id')
          .on('r.target_kind', '=', 'room_message')
      )
      .leftJoin('rooms as room', 'room.id', 'r.room_id')
      .leftJoin('direct_messages as dm', (join) =>
        join.onRef('dm.id', '=', 'r.message_id').on('r.target_kind', '=', 'direct_message')
      )
      .leftJoin('users as author', (join) =>
        join.on((eb) =>
          eb.or([
            eb.and([eb('r.target_kind', '=', 'room_message'), eb('author.id', '=', eb.ref('rm.author_user_id'))]),
            eb.and([eb('r.target_kind', '=', 'direct_message'), eb('author.id', '=', eb.ref('dm.sender_id'))])
          ])
        )
      )
      .select([
        'r.id',
        'r.target_kind',
        'r.room_id',
        'r.message_id',
        'r.reason',
        'r.comment',
        'r.created_at',
        'reporter.id as reporter_id',
        'reporter.login as reporter_login',
        'reporter.display_name as reporter_display_name',
        'room.name as room_name',
        'rm.name as room_author_name',
        'rm.text as room_text',
        'rm.created_at as room_sent_at',
        'rm.deleted_at as room_deleted_at',
        'rm.id as room_message_id',
        'dm.id as dm_id',
        'dm.body as dm_body',
        'dm.created_at as dm_sent_at',
        'dm.deleted_at as dm_deleted_at',
        'author.id as author_id',
        'author.login as author_login',
        'author.display_name as author_display_name'
      ])
      .where('r.status', '=', 'open')
      .orderBy('r.created_at', 'asc')
      .orderBy('r.id', 'asc')
      .limit(OPEN_REPORTS_LIMIT)
      .execute();

    return rows.map((row) => {
      const isRoom = row.target_kind === 'room_message';
      const found = Boolean(isRoom ? row.room_message_id : row.dm_id);
      const accountName = row.author_display_name || row.author_login || '';
      return {
        id: row.id,
        reason: row.reason as ReportReason,
        comment: row.comment,
        createdAt: toMillis(row.created_at) ?? 0,
        reporter: {
          userId: row.reporter_id,
          login: row.reporter_login,
          displayName: row.reporter_display_name || row.reporter_login
        },
        target: {
          kind: isRoom ? 'room_message' : 'direct_message',
          messageId: row.message_id,
          roomId: row.room_id,
          roomName: isRoom ? row.room_name || null : null,
          authorUserId: row.author_id || null,
          authorName: (isRoom ? row.room_author_name || accountName : accountName) || '',
          text: (isRoom ? row.room_text : row.dm_body) || '',
          sentAt: toMillis(isRoom ? row.room_sent_at : row.dm_sent_at),
          deleted: !found || Boolean(isRoom ? row.room_deleted_at : row.dm_deleted_at)
        }
      };
    });
  }

  return Object.freeze({ findRoomMessage, findDirectMessage, fileReport, findOpenReport, resolveTarget, listOpen });
}

export type ReportRepository = ReturnType<typeof createReportRepository>;
