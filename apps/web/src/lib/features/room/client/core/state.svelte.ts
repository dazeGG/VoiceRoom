import { createInitialRoomState } from '../model/room-state';

/**
 * Single source of truth for the room runtime, made reactive via `$state`.
 *
 * Imperative client code keeps mutating it exactly as before — the `$state` proxy is
 * transparent to plain reads/writes — while Svelte components can now read fields
 * reactively. This replaces the bridge that the migration plan originally proposed.
 *
 * Note: `$state` deep-proxies plain objects/arrays, but NOT Map/Set. Fields like
 * `peers`/`participantViews` (Map) and `screen*PeerIds` (Set) stay non-reactive at the
 * entry level for now — swap them to SvelteMap/SvelteSet in the participants phase when
 * a component needs to react to their contents.
 */
export const state = $state(createInitialRoomState());
