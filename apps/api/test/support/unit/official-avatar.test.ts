// The official account's avatar on fakes: rendered once into a
// content-addressed file, saved on every start, and the account pointed at
// it only when its key changed.

import assert from 'node:assert/strict';
import test from 'node:test';
import { OFFICIAL_ACCOUNT_ID } from '@voiceroom/shared/official-account';
import { runStartupTasks } from '../../../src/app/startup-tasks.ts';
import { ensureOfficialAvatar } from '../../../src/domains/support/official-avatar.service.ts';
import { fake, storedUser } from '../../fakes/index.ts';

function fakes(account: { avatarKey: string | null } | null) {
  const saved = new Array<[string, number]>();
  const swapped = new Array<{ userId: string; avatarKey: string; avatarAccent: string }>();
  return {
    saved,
    swapped,
    deps: {
      storage: {
        async save(key: string, buffer: Buffer) {
          saved.push([key, buffer.length]);
        }
      },
      users: {
        async getUserById(userId: string) {
          assert.equal(userId, OFFICIAL_ACCOUNT_ID);
          return account;
        },
        async swapAvatar(input: { userId: string; avatarKey: string; avatarAccent: string }) {
          swapped.push(input);
        }
      }
    }
  };
}

test('without the account nothing is rendered or saved', async () => {
  const { deps, saved } = fakes(null);
  assert.equal(await ensureOfficialAvatar(deps), 'missing');
  assert.deepEqual(saved, []);
});

test('a new key is saved and set; the same key is saved again but not set', async () => {
  const first = fakes({ avatarKey: null });
  assert.equal(await ensureOfficialAvatar(first.deps), 'updated');
  const [entry] = first.saved;
  assert.ok(entry);
  const [key, bytes] = entry;
  assert.match(key, new RegExp(`^av_${OFFICIAL_ACCOUNT_ID}_[0-9a-f]{8}\\.webp$`));
  assert.ok(bytes > 0);
  assert.equal(first.swapped[0]?.avatarKey, key);
  assert.ok(first.swapped[0]?.avatarAccent);

  const again = fakes({ avatarKey: key });
  assert.equal(await ensureOfficialAvatar(again.deps), 'kept');
  assert.deepEqual(
    again.saved.map(([saved]) => saved),
    [key]
  );
  assert.deepEqual(again.swapped, []);
});

function startupServices(save: (key: string) => Promise<void>, removed: string[]) {
  let avatarKey: string | null = null;
  return fake<Parameters<typeof runStartupTasks>[0]>({
    getRoomStore: () =>
      fake<ReturnType<Parameters<typeof runStartupTasks>[0]['getRoomStore']>>({
        markActiveTemporaryRoomsEmpty: async () => 0,
        pruneRooms: async () => true,
        listAvatarKeys: async () => []
      }),
    getAvatarStorage: () =>
      fake<ReturnType<Parameters<typeof runStartupTasks>[0]['getAvatarStorage']>>({
        save,
        listKeys: async () => ['av_stale_00000000.webp', ...(avatarKey ? [avatarKey] : [])],
        remove: async (key: string) => {
          removed.push(key);
        }
      }),
    getUserStore: () =>
      fake<ReturnType<Parameters<typeof runStartupTasks>[0]['getUserStore']>>({
        getUserById: async () => storedUser({ id: OFFICIAL_ACCOUNT_ID, login: 'voiceroom' }),
        swapAvatar: async (input: { avatarKey?: string | null }) => {
          avatarKey = input.avatarKey ?? null;
          return { previousAvatarKey: null, user: null };
        },
        listAvatarKeys: async () => (avatarKey ? [avatarKey] : [])
      }),
    getLinkPreviewRepository: () => null
  });
}

test('startup stores the brand avatar before reconciling, and a failure only warns', async () => {
  const infos = new Array<unknown>();
  const warnings = new Array<unknown>();
  const logger = { info: (entry: unknown) => infos.push(entry), warn: (entry: unknown) => warnings.push(entry) };
  const removed = new Array<string>();
  await runStartupTasks(
    startupServices(async () => {}, removed),
    logger
  );
  // The new avatar counts as referenced: only the stale file goes.
  assert.deepEqual(removed, ['av_stale_00000000.webp']);
  assert.equal(JSON.stringify(infos).includes('official-avatar'), true);
  assert.deepEqual(warnings, []);

  const failing = new Array<string>();
  await runStartupTasks(
    startupServices(async () => {
      throw new Error('disk full');
    }, failing),
    logger
  );
  assert.equal(JSON.stringify(warnings).includes('official-avatar'), true);
  assert.deepEqual(failing, ['av_stale_00000000.webp']);
});
