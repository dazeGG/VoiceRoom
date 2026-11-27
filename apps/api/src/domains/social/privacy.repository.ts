import type { AccountPrivacy, ContactKind, PrivacySettings } from '@voiceroom/shared/contracts/privacy';
import { cleanBadge } from '../account/user-records.ts';
import type { Database } from '../../platform/db/kysely.ts';
import { DomainError } from '../../platform/http/domain-error.ts';
import { contactAudience } from './contact-facts.repository.ts';
import { mapPublicUser } from './social-records.ts';

export async function readPrivacy(db: Database, userId: string): Promise<AccountPrivacy> {
  const settings = await db
    .selectFrom('users')
    .select(['messages_from', 'calls_from'])
    .where('id', '=', userId)
    .executeTakeFirstOrThrow();
  const rows = await db
    .selectFrom('contact_allow_list as entry')
    .innerJoin('users as peer', 'peer.id', 'entry.allowed_id')
    .where('entry.owner_id', '=', userId)
    .where('peer.deleted_at', 'is', null)
    .select([
      'entry.kind',
      'entry.created_at as added_at',
      'peer.id',
      'peer.login',
      'peer.display_name',
      'peer.avatar_accent',
      'peer.avatar_color_key',
      'peer.avatar_key',
      'peer.created_at',
      'peer.dnd',
      'peer.presence_status',
      'peer.badge'
    ])
    .orderBy('entry.created_at')
    .orderBy('peer.id')
    .execute();
  return {
    messagesFrom: contactAudience(settings.messages_from, 'everyone'),
    callsFrom: contactAudience(settings.calls_from, 'friends'),
    allowList: rows.flatMap((row) =>
      row.kind === 'messages' || row.kind === 'calls'
        ? [
            {
              kind: row.kind,
              user: { ...mapPublicUser(row), badge: cleanBadge(row.badge) },
              createdAt: row.added_at.getTime()
            }
          ]
        : []
    )
  };
}

export async function lockPrivacyOwner(db: Database, userId: string) {
  await db.selectFrom('users').select('id').where('id', '=', userId).forNoKeyUpdate().executeTakeFirstOrThrow();
}

export async function savePrivacy(db: Database, userId: string, settings: PrivacySettings) {
  await db
    .updateTable('users')
    .set({ messages_from: settings.messagesFrom, calls_from: settings.callsFrom })
    .where('id', '=', userId)
    .execute();
}

export async function changeAllowList(db: Database, ownerId: string, kind: ContactKind, userId: string, add: boolean) {
  if (add) {
    const user = await db
      .selectFrom('users')
      .select('id')
      .where('id', '=', userId)
      .where('deleted_at', 'is', null)
      .where('deletion_requested_at', 'is', null)
      .executeTakeFirst();
    if (!user || ownerId === userId) throw new DomainError('user_not_found', 404, 'User not found');
    await db
      .insertInto('contact_allow_list')
      .values({ owner_id: ownerId, kind, allowed_id: userId })
      .onConflict((oc) => oc.columns(['owner_id', 'kind', 'allowed_id']).doNothing())
      .execute();
    return;
  }
  await db
    .deleteFrom('contact_allow_list')
    .where('owner_id', '=', ownerId)
    .where('kind', '=', kind)
    .where('allowed_id', '=', userId)
    .execute();
}
