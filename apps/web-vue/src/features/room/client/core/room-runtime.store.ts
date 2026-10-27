import { defineStore } from 'pinia';
import { markRaw, reactive } from 'vue';
import { createInitialRoomState } from '../model/room-state';
import type { AppState } from './types';

/**
 * Single source of truth for the room runtime, made reactive with `reactive`.
 *
 * Imperative client code keeps mutating it exactly as before: the reactive proxy is
 * transparent to plain reads and writes, while components read fields reactively.
 * `peers` and the peer id sets are reactive `Map`/`Set`s, so their changes reach
 * components on their own. A MediaStream is not reactive: tracks added to or
 * removed from a screen stream in place are announced with `screenUi.revision`.
 *
 * Vue proxies class instances (LiveKit's `Room`, publications), which breaks identity
 * checks, so a value of that kind is marked raw when it is assigned to `state` (rule 4).
 * A participant put into `state.peers` or `state.self` must be made reactive by whoever
 * creates it.
 *
 * The client imports `state` directly, as it always did; `useRoomRuntimeStore().state` is
 * the same object for components. It lives for the page, like the Svelte `$state` did,
 * so a test resets it with `Object.assign(state, createInitialRoomState())`.
 */
const PLAIN_PROTOTYPES: ReadonlySet<object | null> = new Set([
  null,
  Reflect.getPrototypeOf({}),
  Reflect.getPrototypeOf([])
]);

function isForeignObject(value: unknown): value is object {
  if (typeof value !== 'object' || value === null || value instanceof Map || value instanceof Set) return false;
  return !PLAIN_PROTOTYPES.has(Reflect.getPrototypeOf(value));
}

// `reactive()` types a LiveKit class as its public shape, so `state` keeps the `AppState`
// type through a proxy whose traps hand every access to the reactive view.
const initialState = createInitialRoomState();
const reactiveState = reactive(initialState);

export const state: AppState = new Proxy(initialState, {
  get: (_target, key) => {
    const value: unknown = Reflect.get(reactiveState, key);
    return value;
  },
  set: (_target, key, value: unknown) =>
    Reflect.set(reactiveState, key, isForeignObject(value) ? markRaw(value) : value),
  has: (_target, key) => Reflect.has(reactiveState, key),
  deleteProperty: (_target, key) => Reflect.deleteProperty(reactiveState, key),
  ownKeys: () => Reflect.ownKeys(reactiveState)
});

export const useRoomRuntimeStore = defineStore('room-runtime', () => ({ state }));

/** The name the room client was given for `roomId` when it is the room it holds, else ''. */
export function clientRoomName(roomId: string | null): string {
  return (state.roomId === roomId && state.roomName) || '';
}
