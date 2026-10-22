// Reports to the service operator: filing one, and the platform
// administrator's review that either removes the message for everyone or
// dismisses the reports. Both tell the administrators online that the open
// reports changed.

import type { AdminReportsEvent } from '@voice-room/shared/contracts/admin';
import { REPORT_COMMENT_MAX_LENGTH, type AdminReport, type ReportBody } from '@voice-room/shared/contracts/reports';
import { isUuid } from '@voice-room/shared/validation';
import type { StaffCheck } from '../staff/staff-check.ts';
import { canReportDirectMessage } from './report.policy.ts';
import type { ReportRepository } from './report.repository.ts';

export interface ReportServiceDeps {
  repository: () => Pick<
    ReportRepository,
    'findRoomMessage' | 'findDirectMessage' | 'fileReport' | 'findOpenReport' | 'resolveTarget' | 'listOpen'
  >;
  staff: StaffCheck;
  canReadRoom(roomId: string, userId: string): Promise<boolean>;
  removeRoomMessage(input: { roomId: string; messageId: string }): Promise<unknown>;
  removeDirectMessage(input: { senderId: string; recipientId: string; messageId: string }): Promise<unknown>;
  /** Fire and forget: the administrators online learn of it; a failure there never fails the report. */
  reportsChanged?(filed: AdminReportsEvent['filed']): void;
  now?: () => number;
}

export type FileReportOutcome = { status: 'filed' | 'already_filed' | 'target_not_found' | 'own_message' };

export type ResolveOutcome =
  { status: 'resolved'; resolved: number } | { status: 'forbidden' } | { status: 'not_found' };

export function createReportService(deps: ReportServiceDeps) {
  const now = deps.now ?? Date.now;

  async function fileReport(reporterUserId: string, body: ReportBody): Promise<FileReportOutcome> {
    const repository = deps.repository();
    const { target } = body;
    let roomId: string | null = null;
    let roomName: string | null = null;
    if (target.kind === 'room_message') {
      const message = await repository.findRoomMessage(target.roomId, target.messageId);
      // A persistent room shows its chat to members only; a temporary room to
      // anyone with its link, so there the message existing is enough.
      const visible =
        message &&
        !message.deleted &&
        (!message.roomIsStatic || (await deps.canReadRoom(target.roomId, reporterUserId)));
      if (!message || !visible) return { status: 'target_not_found' };
      if (message.authorUserId === reporterUserId) return { status: 'own_message' };
      roomId = target.roomId;
      roomName = message.roomName || null;
    } else {
      const message = await repository.findDirectMessage(target.messageId);
      const access = canReportDirectMessage(message && !message.deleted ? message : null, reporterUserId);
      if (access === 'not_visible') return { status: 'target_not_found' };
      if (access === 'own_message') return { status: 'own_message' };
    }
    const filed = await repository.fileReport({
      reporterUserId,
      targetKind: target.kind,
      roomId,
      messageId: target.messageId,
      reason: body.reason,
      comment: (body.comment ?? '').trim().slice(0, REPORT_COMMENT_MAX_LENGTH)
    });
    if (!filed) return { status: 'already_filed' };
    deps.reportsChanged?.({ reason: body.reason, targetKind: target.kind, roomName });
    return { status: 'filed' };
  }

  async function listOpen(actorUserId: string): Promise<AdminReport[] | null> {
    if (!(await deps.staff.can(actorUserId, 'reports.review'))) return null;
    return deps.repository().listOpen();
  }

  async function resolve(
    actorUserId: string,
    reportId: string,
    action: 'remove_message' | 'dismiss'
  ): Promise<ResolveOutcome> {
    if (!(await deps.staff.can(actorUserId, 'reports.review'))) return { status: 'forbidden' };
    if (!isUuid(reportId)) return { status: 'not_found' };
    const repository = deps.repository();
    const report = await repository.findOpenReport(reportId);
    if (!report) return { status: 'not_found' };

    if (action === 'remove_message') {
      if (report.targetKind === 'room_message' && report.roomId) {
        await deps.removeRoomMessage({ roomId: report.roomId, messageId: report.messageId });
      } else if (report.targetKind === 'direct_message') {
        const message = await repository.findDirectMessage(report.messageId);
        if (message && !message.deleted) {
          await deps.removeDirectMessage({
            senderId: message.senderId,
            recipientId: message.recipientId,
            messageId: report.messageId
          });
        }
      }
    }
    const resolved = await repository.resolveTarget({
      targetKind: report.targetKind,
      messageId: report.messageId,
      status: action === 'remove_message' ? 'actioned' : 'dismissed',
      resolvedByUserId: actorUserId,
      at: new Date(now())
    });
    deps.reportsChanged?.(null);
    return { status: 'resolved', resolved };
  }

  return Object.freeze({ fileReport, listOpen, resolve });
}

export type ReportService = ReturnType<typeof createReportService>;
