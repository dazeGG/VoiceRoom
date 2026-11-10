import { expect, test } from 'vitest';
import { createHistorySnapshots } from '@/shared/chat/history-snapshots';

type Item = { id: string; text?: string; extra?: string };

test('coalesces live additions and partial edits without losing append intent', () => {
  const changes = createHistorySnapshots<Item>();
  const snapshot = changes.begin();
  changes.upsert({ id: 'new', text: 'original', extra: 'kept' });
  changes.edit({ id: 'new', text: 'edited' });
  expect(snapshot.apply([])).toEqual([{ id: 'new', text: 'edited', extra: 'kept' }]);
});

test('a deletion survives edits but an explicit new addition restores it', () => {
  const changes = createHistorySnapshots<Item>();
  const snapshot = changes.begin();
  changes.remove('gone');
  changes.edit({ id: 'gone', text: 'late edit' });
  expect(snapshot.apply([{ id: 'gone' }])).toEqual([]);
  const next = changes.begin();
  changes.remove('back');
  changes.upsert({ id: 'back' });
  expect(next.apply([])).toEqual([{ id: 'back' }]);
});

test('reset and dispose invalidate old handles', () => {
  const changes = createHistorySnapshots<Item>();
  const closed = changes.begin();
  closed.dispose();
  expect(closed.apply([])).toBeNull();
  const old = changes.begin();
  changes.reset();
  expect(old.apply([])).toBeNull();
  expect(changes.begin().apply([])).toEqual([]);
});

test('cursor bursts supersede cursors without crowding out initial history', () => {
  const changes = createHistorySnapshots<Item>();
  const opening = changes.begin('open');
  const oldCursor = changes.begin('cursor');
  for (let i = 0; i < 10; i++) changes.begin('cursor');
  expect(oldCursor.apply([])).toBeNull();
  expect(opening.apply([{ id: 'full' }])).toEqual([{ id: 'full' }]);
});

test('limits distinct changed ids and active operation lanes', () => {
  const changes = createHistorySnapshots<Item>();
  const opening = changes.begin('open');
  for (let i = 0; i < 1001; i++) changes.upsert({ id: String(i) });
  expect(opening.apply([])).toBeNull();
  const oldest = changes.begin('open');
  changes.begin('older');
  changes.begin('latest');
  changes.begin('cursor');
  const newest = changes.begin('recent');
  expect(oldest.apply([])).toBeNull();
  expect(newest.apply([])).toEqual([]);
});

test('accepted HTTP results only propagate to older pending operations', () => {
  const changes = createHistorySnapshots<Item>();
  const older = changes.begin('open');
  const newer = changes.begin('cursor');
  expect(older.apply([{ id: 'a', text: 'old' }])).not.toBeNull();
  older.upsert({ id: 'a', text: 'old' });
  expect(newer.apply([{ id: 'a', text: 'fresh' }])).toEqual([{ id: 'a', text: 'fresh' }]);
});

test('newer accepted responses protect older pending operations and cannot cross reset', () => {
  const changes = createHistorySnapshots<Item>();
  const older = changes.begin('open');
  const newer = changes.begin('cursor');
  newer.apply([{ id: 'a', text: 'fresh' }]);
  newer.upsert({ id: 'a', text: 'fresh' });
  expect(older.apply([{ id: 'a', text: 'old' }])).toEqual([{ id: 'a', text: 'fresh' }]);
  changes.reset();
  const current = changes.begin('open');
  newer.upsert({ id: 'wrong-scope' });
  expect(current.apply([])).toEqual([]);
});
