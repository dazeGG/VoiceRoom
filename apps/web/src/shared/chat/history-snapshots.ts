import { keysOf, mergeById } from '@/shared/utils/collections';

// Retain only live changes made while a snapshot is in flight. Hanging HTTP
// requests must not retain an unlimited journal: an overrun discards that
// snapshot, never the messages already shown.
const MAX_PENDING_SNAPSHOTS = 4;
const MAX_SNAPSHOT_CHANGES = 1000;
type SnapshotLane = 'open' | 'older' | 'latest' | 'cursor' | 'recent';

export function createHistorySnapshots<T extends { id: string }>() {
  type Change = { item: T; append: boolean } | null;
  type Pending = { id: number; lane: SnapshotLane; valid: boolean; changes: Map<string, Change> };
  const pending = new Set<Pending>();
  let nextId = 0;
  let epoch = 0;
  const appliedIds = new Map<SnapshotLane, number>();

  function dispose(snapshot: Pending): void {
    snapshot.valid = false;
    snapshot.changes.clear();
    pending.delete(snapshot);
  }

  function record(id: string, change: Change, beforeId = Infinity): void {
    if (!id) return;
    for (const snapshot of pending) {
      if (snapshot.id >= beforeId) continue;
      if (!snapshot.changes.has(id) && snapshot.changes.size >= MAX_SNAPSHOT_CHANGES) dispose(snapshot);
      else {
        const previous = snapshot.changes.get(id);
        // A delayed edit must neither erase a preceding live addition nor
        // resurrect a deletion. Only an explicit upsert may add it again.
        if (change && !change.append && previous === null) continue;
        const current =
          change && previous
            ? {
                item: mergeById([previous.item], [change.item])[0] ?? change.item,
                append: change.append || previous.append
              }
            : change;
        snapshot.changes.set(id, current);
      }
    }
  }

  function begin(lane: SnapshotLane = 'latest') {
    for (const snapshot of pending) if (snapshot.lane === lane) dispose(snapshot);
    const oldest = pending.values().next().value;
    if (pending.size >= MAX_PENDING_SNAPSHOTS && oldest) dispose(oldest);
    const snapshot: Pending = { id: ++nextId, lane, valid: true, changes: new Map() };
    const requestEpoch = epoch;
    let accepted = false;
    pending.add(snapshot);
    return {
      apply(items: T[]): T[] | null {
        if (!snapshot.valid || snapshot.id < (appliedIds.get(lane) ?? 0)) {
          dispose(snapshot);
          return null;
        }
        const ids = keysOf(items, (item) => item.id);
        const updates: T[] = [];
        const removed = new Set<string>();
        for (const [id, change] of snapshot.changes) {
          if (change === null) removed.add(id);
          else if (change.append || ids.has(id)) updates.push(change.item);
        }
        const result = mergeById(items, updates).filter((item) => !removed.has(item.id));
        appliedIds.set(lane, snapshot.id);
        accepted = true;
        dispose(snapshot);
        return result;
      },
      dispose: () => dispose(snapshot),
      upsert: (item: T) => {
        if (accepted && requestEpoch === epoch) record(item.id, { item, append: true }, snapshot.id);
      },
      remove: (id: string) => {
        if (accepted && requestEpoch === epoch) record(id, null, snapshot.id);
      }
    };
  }

  function reset(): void {
    epoch++;
    for (const snapshot of pending) dispose(snapshot);
    appliedIds.clear();
  }

  return {
    begin,
    upsert: (item: T) => record(item.id, { item, append: true }),
    edit: (item: T, append = false) => {
      if ([...pending].some((snapshot) => snapshot.changes.get(item.id) === null)) return false;
      record(item.id, { item, append });
      return true;
    },
    remove: (id: string) => record(id, null),
    reset
  };
}
