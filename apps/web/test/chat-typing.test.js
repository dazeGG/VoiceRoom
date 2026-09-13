import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { createServer } from 'vite';

const webRoot = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(webRoot, path), 'utf8');
const require = createRequire(resolve(webRoot, 'package.json'));

// One Vite server for the whole file, without a file watcher (see
// desktop-os-integration.test.js).
let serverPromise = null;

function getServer() {
  serverPromise ??= createServer({
    appType: 'custom',
    logLevel: 'silent',
    root: webRoot,
    server: { hmr: false, middlewareMode: true, watch: null }
  });
  return serverPromise;
}

after(async () => {
  if (serverPromise) await (await serverPromise).close();
});

async function loadTyping() {
  const server = await getServer();
  server.moduleGraph.invalidateAll();
  return server.ssrLoadModule('/src/lib/shared/chat/typing.svelte.ts');
}

test('the browser keeps the same typing timings as the shared realtime contract', async () => {
  const typing = await loadTyping();
  const shared = require('@voice-room/shared/realtime');
  assert.equal(typing.TYPING_NOTICE_INTERVAL_MS, shared.TYPING_NOTICE_INTERVAL_MS);
  assert.equal(typing.TYPING_NOTICE_TTL_MS, shared.TYPING_NOTICE_TTL_MS);
});

test('the typing line names up to three people and then stops counting', async () => {
  const { formatTypingLabel } = await loadTyping();
  assert.equal(formatTypingLabel([]), '');
  assert.equal(formatTypingLabel([' ', '']), '');
  assert.equal(formatTypingLabel(['Аня']), 'Аня печатает…');
  assert.equal(formatTypingLabel(['Аня', 'Боря']), 'Аня и Боря печатают…');
  assert.equal(formatTypingLabel(['Аня', 'Боря', 'Вика']), 'Аня, Боря и Вика печатают…');
  assert.equal(formatTypingLabel(['Аня', 'Боря', 'Вика', 'Гоша']), 'Несколько человек печатают…');
});

test('a notice goes out at most once per interval and right away after a reset', async () => {
  const { createTypingNotifier } = await loadTyping();
  let clock = 0;
  let sent = 0;
  const notifier = createTypingNotifier(() => { sent += 1; }, { intervalMs: 2500, now: () => clock });

  notifier.notify();
  clock = 1000;
  notifier.notify();
  assert.equal(sent, 1);
  clock = 2500;
  notifier.notify();
  assert.equal(sent, 2);
  clock = 2600;
  notifier.reset();
  notifier.notify();
  assert.equal(sent, 3);
});

test('a typist stays listed until their message or the notice expires', async (t) => {
  const { createTypingTracker } = await loadTyping();
  let clock = 0;
  const tracker = createTypingTracker({ ttlMs: 6000, now: () => clock });
  t.after(() => tracker.reset());

  tracker.note('user-a', 'Аня');
  tracker.note('peer-b', 'Гость');
  tracker.note('user-a', 'Аня');
  assert.deepEqual(tracker.names, ['Гость', 'Аня'], 'a repeated notice does not duplicate the person');
  assert.equal(tracker.has('peer-b'), true);

  tracker.clear('peer-b');
  assert.deepEqual(tracker.names, ['Аня']);

  clock = 5999;
  tracker.prune();
  assert.deepEqual(tracker.names, ['Аня']);
  clock = 6000;
  tracker.prune();
  assert.deepEqual(tracker.names, []);
  tracker.note('', 'nobody');
  assert.deepEqual(tracker.names, []);
});

test('direct threads and room chats send, show and clear typing notices', () => {
  const dmView = read('src/lib/features/home/components/lobby/DmView.svelte');
  assert.match(dmView, /send\('dm\.typing', \{ userId: draftPeerId \}\)/);
  assert.match(dmView, /peerTyping \? 'печатает…' : presenceLabel/);
  assert.match(dmView, /oninput=\{onComposeInput\}/);

  const friends = read('src/lib/features/home/model/friends.svelte.ts');
  assert.match(friends, /case 'dm\.typing'/);
  assert.match(friends, /dmTyping\.clear\(message\.senderId\)/);

  const roomChat = read('src/lib/features/room/components/RoomChatPanel.svelte');
  assert.match(roomChat, /send\('room\.chat\.typing', \{ roomId \}\)/);
  assert.match(roomChat, /event\.type === 'room\.chat\.typing'/);
  assert.match(roomChat, /roomTyping\.clear\(typingKey\(message\)\)/);
  assert.match(roomChat, /class="chat-rail-typing"/);
});
