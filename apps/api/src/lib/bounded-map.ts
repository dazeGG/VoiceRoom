// A Map for keys a client chooses, which must not grow without end. set() moves
// a key to the end, so the first key is always the one set longest ago, and
// past `maxKeys` that one is dropped (and handed to `onEvict`, if given).

export class BoundedMap<K, V> extends Map<K, V> {
  readonly #maxKeys: number;
  readonly #onEvict: ((value: V) => void) | undefined;

  constructor(maxKeys: number, onEvict?: (value: V) => void) {
    super();
    this.#maxKeys = maxKeys;
    this.#onEvict = onEvict;
  }

  override set(key: K, value: V): this {
    super.delete(key);
    super.set(key, value);
    while (this.size > this.#maxKeys) {
      const oldest = this.entries().next();
      if (oldest.done) break;
      super.delete(oldest.value[0]);
      this.#onEvict?.(oldest.value[1]);
    }
    return this;
  }
}
