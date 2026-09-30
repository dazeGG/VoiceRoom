// One idempotency key per send attempt: a retry of the same message reuses it,
// so the server stores the message once however many times it was sent. A
// changed message gets a new key.

export class SendAttempt {
  #key = '';
  #fingerprint = '';

  keyFor(value: unknown): string {
    const fingerprint = JSON.stringify(value);
    if (!this.#key || this.#fingerprint !== fingerprint) {
      this.#key = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      this.#fingerprint = fingerprint;
    }
    return this.#key;
  }

  /** The message went through; the next one is a new attempt. */
  reset(): void {
    this.#key = '';
    this.#fingerprint = '';
  }
}
