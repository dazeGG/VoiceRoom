/**
 * A random id for keys that only need to be unique: idempotency keys, local
 * row ids, peer ids. Browsers outside a secure context have no randomUUID.
 */
export function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
