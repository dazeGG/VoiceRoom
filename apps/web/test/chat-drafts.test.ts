// @ts-nocheck -- not type-checked yet; remove once the file passes tsconfig.test.json.
import { test, onTestFinished, vi } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const webRoot = resolve(import.meta.dirname, '..');
const read = (path: string) => readFileSync(resolve(webRoot, path), 'utf8');


function memoryStorage() {
  const values = new Map();
  return {
    get length() { return values.size; },
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => { values.set(key, String(value)); },
    removeItem: (key) => { values.delete(key); },
    keys: () => [...values.keys()]
  };
}

// Fresh module state (the sign-out lock) and fresh storage for every test.
async function loadDrafts() {
  const storage = memoryStorage();
  vi.stubGlobal('localStorage', storage);
  onTestFinished(() => { delete globalThis.localStorage; });
  vi.resetModules();
  return { drafts: await import('../src/lib/shared/chat/chat-drafts.ts'), storage };
}

const dm = (id) => ({ type: 'dm', id });
const room = (id) => ({ type: 'room', id });

test('drafts are kept per account and chat, and an empty text removes one', async () => {
  const { drafts, storage } = await loadDrafts();
  drafts.saveChatDraft('ada', dm('grace'), { text: 'привет' }, 1000);
  drafts.saveChatDraft('ada', room('lounge'), { text: 'всем привет\nвторая строка' }, 1000);
  drafts.saveChatDraft('linus', dm('grace'), { text: 'другой аккаунт' }, 1000);

  assert.equal(drafts.loadChatDraft('ada', dm('grace'), 2000).text, 'привет');
  assert.equal(drafts.loadChatDraft('ada', room('lounge'), 2000).text, 'всем привет\nвторая строка');
  assert.equal(drafts.loadChatDraft('linus', dm('grace'), 2000).text, 'другой аккаунт');
  assert.equal(drafts.loadChatDraft('ada', dm('linus'), 2000), null);
  assert.equal(drafts.loadChatDraft('ada', room('grace'), 2000), null, 'a room and a thread never share a draft');

  drafts.saveChatDraft('ada', dm('grace'), { text: '   ' }, 3000);
  assert.equal(drafts.loadChatDraft('ada', dm('grace'), 3000), null);
  assert.ok(drafts.loadChatDraft('ada', room('lounge'), 3000));

  drafts.saveChatDraft('ada', room('lounge'), { text: '' }, 3000);
  assert.deepEqual(storage.keys(), [drafts.chatDraftStorageKey('linus')], 'an account without drafts leaves no key behind');
});

test('a restored draft keeps only the mentions whose @login is still in the text', async () => {
  const { drafts } = await loadDrafts();
  drafts.saveChatDraft('ada', room('lounge'), {
    text: '@grace посмотри',
    mentions: [
      { userId: 'u-grace', login: 'grace', displayName: 'Грейс' },
      { userId: 'u-linus', login: 'linus', displayName: 'Линус' },
      { userId: 'u-grace', login: 'grace', displayName: 'Грейс' }
    ]
  }, 1000);

  assert.deepEqual(drafts.loadChatDraft('ada', room('lounge'), 1000).mentions, [
    { userId: 'u-grace', login: 'grace', displayName: 'Грейс' }
  ]);
});

test('old, excess and malformed drafts are dropped', async () => {
  const { drafts } = await loadDrafts();
  const now = drafts.CHAT_DRAFT_MAX_AGE_MS + 100_000;
  const stored = {
    'dm:stale': { text: 'месяц назад', updatedAt: now - drafts.CHAT_DRAFT_MAX_AGE_MS - 1 },
    'nonsense:x': { text: 'bad key', updatedAt: now },
    'dm:empty': { text: '  ', updatedAt: now },
    'dm:broken': 'not an object'
  };
  for (let index = 0; index < drafts.MAX_CHAT_DRAFTS + 5; index += 1) {
    stored[`room:r${index}`] = { text: `draft ${index}`, updatedAt: now - index };
  }

  const normalized = drafts.normalizeChatDrafts(stored, now);
  assert.equal(Object.keys(normalized).length, drafts.MAX_CHAT_DRAFTS);
  assert.ok(normalized['room:r0'], 'the newest drafts win');
  assert.equal(normalized[`room:r${drafts.MAX_CHAT_DRAFTS}`], undefined);
  for (const key of ['dm:stale', 'nonsense:x', 'dm:empty', 'dm:broken']) assert.equal(normalized[key], undefined);
  assert.deepEqual(drafts.normalizeChatDrafts('garbage', now), {});
});

test('signing out wipes every draft and ignores late saves until the next sign-in', async () => {
  const { drafts, storage } = await loadDrafts();
  storage.setItem('voice-room:name', 'Ada');
  drafts.saveChatDraft('ada', dm('grace'), { text: 'личное' }, 1000);
  drafts.saveChatDraft('linus', room('lounge'), { text: 'чужое' }, 1000);

  drafts.clearChatDrafts();
  assert.deepEqual(storage.keys(), ['voice-room:name'], 'other preferences stay');

  // A composer unmounting after the session ended still tries to store its text.
  drafts.saveChatDraft('ada', dm('grace'), { text: 'личное' }, 2000);
  assert.deepEqual(storage.keys(), ['voice-room:name']);
  assert.equal(drafts.loadChatDraft('ada', dm('grace'), 2000), null);

  drafts.resumeChatDrafts();
  drafts.saveChatDraft('ada', dm('grace'), { text: 'снова' }, 3000);
  assert.equal(drafts.loadChatDraft('ada', dm('grace'), 3000).text, 'снова');
});

test('both chat composers restore and store drafts, and the session clears them', () => {
  const dmView = read('src/lib/features/home/components/lobby/DmView.svelte');
  assert.match(dmView, /loadChatDraft\(selfId, \{ type: 'dm', id: peerId \}\)/);
  assert.match(dmView, /saveChatDraft\(selfId, \{ type: 'dm', id: draftPeerId \}, \{ text: draft \}\)/);
  assert.match(dmView, /addEventListener\('pagehide', persistDraft\)/);

  const roomChat = read('src/lib/features/room/components/RoomChatPanel.svelte');
  assert.match(roomChat, /loadChatDraft\(userId, \{ type: 'room', id: roomId \}\)/);
  assert.match(roomChat, /mentionComposer\.restore\(saved\.mentions\)/);
  assert.match(roomChat, /mentions: mentionComposer\.selected/);

  const sessionModel = read('src/lib/features/auth/session.svelte.ts');
  assert.match(sessionModel, /clearChatDrafts\(\)/);
  assert.match(sessionModel, /resumeChatDrafts\(\)/);
});
