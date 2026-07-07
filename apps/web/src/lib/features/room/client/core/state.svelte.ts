import { createInitialRoomState } from '../model/room-state';

/**
 * Single source of truth for the room runtime, made reactive via `$state`.
 *
 * Imperative client code keeps mutating it exactly as before — the `$state` proxy is
 * transparent to plain reads/writes — while Svelte components can now read fields
 * reactively. This replaces the bridge that the migration plan originally proposed.
 *
 * Note: `$state` deep-proxies plain objects/arrays, but NOT Map/Set. `peers` uses
 * `SvelteMap` so participant mutations propagate to Svelte. `screen*PeerIds` (Set)
 * still rely on `screenUi.revision` until migrated to SvelteSet.
 */
export const state = $state(createInitialRoomState());

/**
 * `SvelteMap` (used for `state.peers`) tracks which keys exist, but does not deep-proxy
 * the values stored in it. Wrap participant objects with `$state` before inserting them
 * into `state.peers` so per-field mutations (speaking, level, muted, ...) propagate to
 * Svelte components — otherwise only `state.self` (deep-proxied via the root object) updates.
 */
export function reactiveParticipant<T extends object>(value: T): T {
  return $state(value);
}
