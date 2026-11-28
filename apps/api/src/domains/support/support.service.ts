// The admin app's support inbox. People write to the official VoiceRoom
// account like to anyone; their send records the thread (open again on every
// new message). Staff with `support.reply` list the threads, read one (a read
// with no side effects), mark it read once they open it (for staff, never for
// the person), answer as VoiceRoom, leave notes for the team and resolve it
// once they have read everything. Every answer, note and resolve lands in the
// admin action log. Who answered is kept in a side table: the person only ever
// sees VoiceRoom.

import type pg from 'pg';
import { OFFICIAL_ACCOUNT_ID, OFFICIAL_ACCOUNT_NAME } from '@voiceroom/shared/official-account';
import type {
  SupportCounts,
  SupportMessage,
  SupportNote,
  SupportOfficial,
  SupportPerson,
  SupportStatus,
  SupportThreadSummary
} from '@voiceroom/shared/contracts/support';
import { avatarUrl } from '../../lib/avatar-url.ts';
import { kyselyOn, withTransaction } from '../../platform/db/kysely.ts';
import { DomainError } from '../../platform/http/domain-error.ts';
import type { OpenedMedia } from '../media/media-visibility.service.ts';
import type { DbClient } from '../messaging/message-send.ts';
import type { DirectMessage, DirectMessagesService } from '../messaging/direct-messages.service.ts';
import type { StaffCheck } from '../staff/staff-check.ts';
import {
  addNote,
  countThreads,
  listNotes,
  listPairMessages,
  listThreads,
  getThread,
  markThreadRead,
  officialProfile,
  recordPersonMessage,
  recordReply,
  replyAuthors,
  resolveThread,
  threadExists,
  type StoredThread
} from './support.repository.ts';

type Status<T extends string> = T extends string ? { status: T } : never;
type Forbidden = { status: 'forbidden' };

export interface SupportDeps {
  pool(): pg.Pool;
  staff: StaffCheck;
  sendAsOfficial: DirectMessagesService['sendAsOfficial'];
  /**
   * Whether the person still has a message to VoiceRoom: the predicate the
   * answer's authorization uses, so the view and the refusal agree.
   */
  hasLiveConversation(userId: string): Promise<boolean>;
  projectMedia(context: 'dm', message: DirectMessage): Promise<DirectMessage>;
  /** Opens an image of a conversation with the official account, as the official account sees it. */
  visibility(): {
    open(input: { attachmentId: string; variant: string; viewerId: string }): Promise<OpenedMedia>;
  } | null;
}

const officialId = OFFICIAL_ACCOUNT_ID;

/** Where the admin app opens an image, or downloads the diagnostics file, of a support conversation. */
export function supportAttachmentUrl(attachmentId: string, kind: 'image' | 'diagnostics' = 'image'): string {
  const variant = kind === 'diagnostics' ? 'file' : 'preview';
  return `/api/admin/support/attachments/${encodeURIComponent(attachmentId)}/${variant}`;
}

function personOf(person: StoredThread['person']): SupportPerson {
  return {
    id: person.id,
    login: person.login,
    displayName: person.displayName,
    avatarUrl: avatarUrl(person.avatarKey),
    avatarColorKey: person.avatarColorKey,
    avatarAccent: person.avatarAccent
  };
}

function supportMessage(message: DirectMessage, userId: string, staffName: string | null): SupportMessage {
  return {
    id: message.id,
    fromPerson: message.senderId === userId,
    body: message.body,
    createdAt: message.createdAt,
    attachments: (message.attachments ?? []).map((attachment) => {
      const kind = attachment.kind ?? 'image';
      return {
        id: attachment.id,
        mimeType: attachment.mimeType,
        width: attachment.width,
        height: attachment.height,
        url: attachment.url ? supportAttachmentUrl(attachment.id, kind) : null,
        ...(kind === 'diagnostics' && { kind, name: attachment.name ?? null, bytes: attachment.bytes })
      };
    }),
    staffName: message.senderId === userId ? null : staffName
  };
}

async function officialOf(db: ReturnType<typeof kyselyOn>): Promise<SupportOfficial> {
  const stored = await officialProfile(db);
  return {
    displayName: stored?.displayName || OFFICIAL_ACCOUNT_NAME,
    avatarUrl: avatarUrl(stored?.avatarKey ?? null),
    avatarColorKey: stored?.avatarColorKey ?? 'olive',
    avatarAccent: stored?.avatarAccent ?? null
  };
}

/** The hook messaging runs inside a person's send: a message to VoiceRoom opens (or reopens) their thread. */
export async function recordSupportThread(client: DbClient, message: DirectMessage): Promise<void> {
  if (message.recipientId !== officialId || message.senderId === officialId) return;
  await recordPersonMessage(kyselyOn(client), message.senderId, new Date(message.createdAt ?? Date.now()));
}

export function createSupportService(deps: SupportDeps) {
  const db = () => kyselyOn(deps.pool());
  const allowed = (staffId: string) => deps.staff.can(staffId, 'support.reply');

  async function list(
    staffId: string,
    status: SupportStatus
  ): Promise<
    { status: 'listed'; threads: SupportThreadSummary[]; counts: SupportCounts; openUnread: number } | Forbidden
  > {
    if (!(await allowed(staffId))) return { status: 'forbidden' };
    const [threads, counts] = await Promise.all([listThreads(db(), status), countThreads(db())]);
    return {
      status: 'listed',
      threads: threads.map(({ resolvedAt: _resolvedAt, person, ...thread }) => ({
        ...thread,
        person: personOf(person)
      })),
      counts: { open: counts.open, resolved: counts.resolved },
      openUnread: counts.openUnread
    };
  }

  async function unread(staffId: string): Promise<{ status: 'counted'; openUnread: number } | Forbidden> {
    if (!(await allowed(staffId))) return { status: 'forbidden' };
    return { status: 'counted', openUnread: (await countThreads(db())).openUnread };
  }

  async function read(staffId: string, userId: string) {
    if (!(await allowed(staffId))) return { status: 'forbidden' as const };
    const thread = await getThread(db(), userId);
    if (!thread) return { status: 'not_found' as const };
    const [stored, live, official] = await Promise.all([
      listPairMessages(db(), userId),
      deps.hasLiveConversation(userId),
      officialOf(db())
    ]);
    const authors = await replyAuthors(
      db(),
      stored.filter((message) => message.senderId === officialId).map((message) => message.id)
    );
    const messages = await Promise.all(
      stored.map(async (message) =>
        supportMessage(await deps.projectMedia('dm', message), userId, authors.get(message.id) ?? null)
      )
    );
    const notes: SupportNote[] = await listNotes(db(), userId);
    return {
      status: 'read' as const,
      person: personOf(thread.person),
      personState: thread.personState,
      official,
      threadStatus: thread.status,
      resolvedAt: thread.resolvedAt,
      // The person deleted the conversation (or every message of theirs in it).
      conversationDeleted: !live,
      messages,
      notes
    };
  }

  async function markRead(
    staffId: string,
    userId: string
  ): Promise<{ status: 'read'; openUnread: number } | Status<'forbidden' | 'not_found'>> {
    if (!(await allowed(staffId))) return { status: 'forbidden' };
    if (!(await markThreadRead(db(), userId))) return { status: 'not_found' };
    return { status: 'read', openUnread: (await countThreads(db())).openUnread };
  }

  async function reply(
    staffId: string,
    userId: string,
    text: string,
    idempotencyKey = ''
  ): Promise<
    | { status: 'sent'; message: SupportMessage }
    | { status: 'rate_limited'; retryAfterSeconds: number }
    | Status<'forbidden' | 'not_found' | 'empty' | 'official_missing'>
  > {
    if (!(await allowed(staffId))) return { status: 'forbidden' };
    if (!(await threadExists(db(), userId))) return { status: 'not_found' };
    // A conversation the person deleted is refused under the pair lock with
    // support_conversation_deleted (see authorizeOfficialReply).
    const result = await deps.sendAsOfficial({
      staffId,
      recipientId: userId,
      body: text,
      idempotencyKey,
      afterInsert: (client, inserted) => recordReply(kyselyOn(client), { messageId: inserted.id, staffId, userId })
    });
    if (result.status !== 'sent') return result;
    const authors = await replyAuthors(db(), [result.message.id]);
    return { status: 'sent', message: supportMessage(result.message, userId, authors.get(result.message.id) ?? null) };
  }

  async function note(
    staffId: string,
    userId: string,
    text: string
  ): Promise<{ status: 'noted'; note: SupportNote } | Status<'forbidden' | 'not_found' | 'empty'>> {
    if (!(await allowed(staffId))) return { status: 'forbidden' };
    const body = text.trim();
    if (!body) return { status: 'empty' };
    const stored = await withTransaction(db(), (tx) => addNote(tx, { userId, staffId, body }));
    return stored ? { status: 'noted', note: stored } : { status: 'not_found' };
  }

  async function resolve(
    staffId: string,
    userId: string
  ): Promise<{ status: 'resolved'; resolvedAt: number } | Status<'forbidden' | 'not_found' | 'changed'>> {
    if (!(await allowed(staffId))) return { status: 'forbidden' };
    const resolved = await withTransaction(db(), (tx) => resolveThread(tx, { userId, staffId }));
    if (resolved === 'changed') return { status: 'changed' };
    return resolved ? { status: 'resolved', resolvedAt: resolved.resolvedAt } : { status: 'not_found' };
  }

  async function attachment(staffId: string, attachmentId: string, variant: string) {
    if (!(await allowed(staffId))) return { status: 'forbidden' as const };
    const visibility = deps.visibility();
    if (!visibility) throw new DomainError('media_uploads_disabled', 503, 'Media is unavailable');
    return {
      status: 'opened' as const,
      opened: await visibility.open({ attachmentId, variant, viewerId: officialId })
    };
  }

  return Object.freeze({ list, unread, read, markRead, reply, note, resolve, attachment });
}

export type SupportService = ReturnType<typeof createSupportService>;
