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
