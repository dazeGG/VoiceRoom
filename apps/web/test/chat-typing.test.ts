// @ts-nocheck -- not type-checked yet; remove once the file passes tsconfig.test.json.
import { test, onTestFinished, vi } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const webRoot = resolve(import.meta.dirname, '..');
const read = (path: string) => readFileSync(resolve(webRoot, path), 'utf8');
const require = createRequire(resolve(webRoot, 'package.json'));


async function loadTyping() {
  vi.resetModules();
  return import('../src/lib/shared/chat/typing.svelte.ts');
}

const typing = (name) => ({ name, activity: 'typing' });
const emoji = (name) => ({ name, activity: 'emoji' });

test('the browser keeps the same typing timings and activities as the shared realtime contract', async () => {
  const typingModule = await loadTyping();
  const shared = require('@voice-room/shared/realtime');
  assert.equal(typingModule.TYPING_NOTICE_INTERVAL_MS, shared.TYPING_NOTICE_INTERVAL_MS);
  assert.equal(typingModule.TYPING_NOTICE_TTL_MS, shared.TYPING_NOTICE_TTL_MS);
  assert.deepEqual([...typingModule.TYPING_ACTIVITIES], [...shared.TYPING_ACTIVITIES]);
});

test('the typing line names up to three people and then stops counting', async () => {
  const { formatTypingLabel } = await loadTyping();
  assert.equal(formatTypingLabel([]), '');
  assert.equal(formatTypingLabel([typing(' '), typing('')]), '');
  assert.equal(formatTypingLabel([typing('Аня')]), 'Аня печатает…');
  assert.equal(formatTypingLabel([typing('Аня'), typing('Боря')]), 'Аня и Боря печатают…');
  assert.equal(formatTypingLabel([typing('Аня'), typing('Боря'), typing('Вика')]), 'Аня, Боря и Вика печатают…');
  assert.equal(formatTypingLabel([typing('Аня'), typing('Боря'), typing('Вика'), typing('Гоша')]), 'Несколько человек печатают…');
});

test('someone with the emoji picker open is shown as choosing an emoji, next to those who type', async () => {
  const { formatTypingLabel, typingActivityOf } = await loadTyping();
  assert.equal(formatTypingLabel([emoji('Аня')]), 'Аня выбирает эмодзи…');
  assert.equal(formatTypingLabel([emoji('Аня'), emoji('Боря')]), 'Аня и Боря выбирают эмодзи…');
  assert.equal(formatTypingLabel([emoji('Аня'), typing('Боря')]), 'Боря печатает, Аня выбирает эмодзи…');
  assert.equal(formatTypingLabel([typing('Аня'), emoji('Боря'), typing('Вика')]), 'Аня и Вика печатают, Боря выбирает эмодзи…');
  assert.equal(formatTypingLabel([emoji('Аня'), emoji('Боря'), typing('Вика'), typing('Гоша')]), 'Несколько человек печатают…');

  // A notice from an older client has no activity and still means typing.
  assert.equal(typingActivityOf(undefined), 'typing');
  assert.equal(typingActivityOf('recording'), 'typing');
  assert.equal(typingActivityOf('emoji'), 'emoji');
});

test('a notice goes out at most once per interval, right away after a reset or a switch of activity', async () => {
  const { createTypingNotifier } = await loadTyping();
  let clock = 0;
  const sent = [];
  const notifier = createTypingNotifier((activity) => { sent.push(activity); }, { intervalMs: 2500, now: () => clock });

  notifier.notify();
  clock = 1000;
  notifier.notify();
  assert.deepEqual(sent, ['typing']);
  clock = 2500;
  notifier.notify();
  assert.deepEqual(sent, ['typing', 'typing']);
  clock = 2600;
  notifier.reset();
  notifier.notify();
  assert.equal(sent.length, 3);

  clock = 2700;
  notifier.notify('emoji');
  notifier.notify('emoji');
  clock = 2800;
  notifier.notify('typing');
  assert.deepEqual(sent.slice(3), ['emoji', 'typing'], 'opening the picker and typing again are both announced at once');
});

test('a typist stays listed with what they do until their message or the notice expires', async () => {
  const { createTypingTracker } = await loadTyping();
  let clock = 0;
  const tracker = createTypingTracker({ ttlMs: 6000, now: () => clock });
  onTestFinished(() => tracker.reset());

  tracker.note('user-a', 'Аня');
  tracker.note('peer-b', 'Гость', 'emoji');
  tracker.note('user-a', 'Аня');
  assert.deepEqual(tracker.people, [emoji('Гость'), typing('Аня')], 'a repeated notice does not duplicate the person');
  assert.equal(tracker.has('peer-b'), true);
  assert.equal(tracker.activityOf('peer-b'), 'emoji');
  assert.equal(tracker.activityOf('nobody'), null);

  tracker.note('peer-b', 'Гость', 'typing');
  assert.equal(tracker.activityOf('peer-b'), 'typing');
  tracker.clear('peer-b');
  assert.deepEqual(tracker.people, [typing('Аня')]);

  clock = 5999;
  tracker.prune();
  assert.deepEqual(tracker.people, [typing('Аня')]);
  clock = 6000;
  tracker.prune();
  assert.deepEqual(tracker.people, []);
  tracker.note('', 'nobody');
  assert.deepEqual(tracker.people, []);
});

test('direct threads and room chats send, show and clear typing notices under the message field', () => {
  const dmView = read('src/lib/features/home/components/lobby/DmView.svelte');
  assert.match(dmView, /send\('dm\.typing', \{ userId: draftPeerId, activity \}\)/);
  assert.match(dmView, /oninput=\{onComposeInput\}/);
  assert.match(dmView, /class="lobby-dm-head-status" data-presence=\{presence\}>\{presenceLabel\}</, 'the header shows presence only');
  assert.match(dmView, /class="lobby-dm-compose"[\s\S]*<TypingIndicator label=\{typingLabel\} \/>/);

  const friends = read('src/lib/features/home/model/friends.svelte.ts');
  assert.match(friends, /case 'dm\.typing'/);
  assert.match(friends, /dmTyping\.note\(event\.payload\.userId, '', typingActivityOf\(event\.payload\.activity\)\)/);
  assert.match(friends, /dmTyping\.clear\(message\.senderId\)/);

  const roomChat = read('src/lib/features/room/components/RoomChatPanel.svelte');
  assert.match(roomChat, /send\('room\.chat\.typing', \{ roomId, activity \}\)/);
  assert.match(roomChat, /event\.type === 'room\.chat\.typing'/);
  assert.match(roomChat, /typingActivityOf\(event\.payload\.activity\)/);
  assert.match(roomChat, /roomTyping\.clear\(typingKey\(message\)\)/);
  assert.match(roomChat, /<form class="chat-rail-compose"[\s\S]*<TypingIndicator label=\{typingLabel\} \/>[\s\S]*<\/form>/);
  assert.doesNotMatch(roomChat, /chat-rail-typing/);

  const indicator = read('src/lib/shared/chat/TypingIndicator.svelte');
  assert.match(indicator, /class="chat-typing" aria-live="polite"/);
  assert.match(indicator, /position: absolute;/);
  assert.match(indicator, /color: var\(--warm-muted/);
  for (const [source, selector] of [[read('src/lib/features/room/styles/chat-rail.css'), 'chat-rail-compose'], [read('src/lib/features/home/styles/friends.css'), 'lobby-dm-compose']]) {
    assert.match(source, new RegExp(`\\.${selector} \\{[^}]*--chat-typing-inset:`));
  }
});
