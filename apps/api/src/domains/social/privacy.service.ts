import type { ContactKind, PrivacySettings } from '@voiceroom/shared/contracts/privacy';
import { type Database, withTransaction } from '../../platform/db/kysely.ts';
import type { AccountMessage } from '../../realtime/account-events.ts';
import { changeAllowList, lockPrivacyOwner, readPrivacy, savePrivacy } from './privacy.repository.ts';

export function createPrivacyService(db: () => Database, notify: (userId: string, event: AccountMessage) => void) {
  function get(userId: string) {
    return db()
      .transaction()
      .setIsolationLevel('repeatable read')
      .execute((tx) => readPrivacy(tx, userId));
  }

  async function update(userId: string, change: (tx: Database) => Promise<void>) {
    const privacy = await withTransaction(db(), async (tx) => {
      await lockPrivacyOwner(tx, userId);
      await change(tx);
      return readPrivacy(tx, userId);
    });
    notify(userId, { type: 'account.privacy.updated', privacy });
    return privacy;
  }

  return {
    get,
    save: (userId: string, settings: PrivacySettings) => update(userId, (tx) => savePrivacy(tx, userId, settings)),
    allow: (ownerId: string, kind: ContactKind, userId: string, add: boolean) =>
      update(ownerId, (tx) => changeAllowList(tx, ownerId, kind, userId, add))
  };
}
