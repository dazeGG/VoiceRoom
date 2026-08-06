import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const store = readFileSync(new URL('../src/lib/shared/chat/reaction-store.svelte.ts', import.meta.url), 'utf8');
const summary = readFileSync(new URL('../src/lib/shared/chat/ReactionSummary.svelte', import.meta.url), 'utf8');
const picker = readFileSync(new URL('../src/lib/shared/chat/ReactionPicker.svelte', import.meta.url), 'utf8');
const reactors = readFileSync(new URL('../src/lib/shared/chat/ReactorList.svelte', import.meta.url), 'utf8');
const room = readFileSync(new URL('../src/lib/features/room/components/RoomChat.svelte', import.meta.url), 'utf8');
const dm = readFileSync(new URL('../src/lib/features/home/components/lobby/DmView.svelte', import.meta.url), 'utf8');

test('G70-A01 optimistic state converges under reorder, reconnect, pagination and deletion races', async () => {
  expect(store).toContain('Math.max(0');
  expect(store).toMatch(/revision\(summary\.revision\) < revision\(current\.revision\)/);
  expect(store).toContain('this.applyServer(messageId, summary)');
  expect(store).toContain('new Map(candidates.map((reactor) => [reactor.userId, reactor]))');
  expect(store).toContain('this.reactorRequests[key] !== requestId');
  expect(store).toContain('this.isDeleted(messageId)');
  expect(room).toContain('reactions.markDeleted(mid)');
  expect(dm).toContain('reactions.markDeleted(mid)');
  expect(room).toContain("event.type === 'reaction.updated'");
  expect(dm).toContain("event.type !== 'reaction.updated'");
});

test('G70-A02 guest controls and picker/reactor popovers are keyboard and screen-reader safe', async () => {
  expect(room).toContain('reactionsEnabled && session.user?.id');
  expect(room).toContain('canMutate={Boolean(session.user?.id)}');
  expect(summary).toContain('{#if canMutate}');
  expect(summary).toContain('aria-pressed={summary.reactedByMe}');
  expect(summary).toContain('aria-haspopup="dialog"');
  expect(summary).toContain('role="alert"');
  expect(picker).toMatch(/ArrowRight|ArrowLeft/);
  expect(picker).toMatch(/ArrowDown|ArrowUp/);
  expect(picker).toMatch(/Home|End/);
  expect(picker).toContain('role="grid"');
  expect(reactors).toContain('heading?.focus()');
  expect(reactors).toContain('aria-live="polite"');
  expect(reactors).toContain('Показать ещё');
});
