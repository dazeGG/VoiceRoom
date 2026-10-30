import { shallowRef } from 'vue';
import { newId } from '../new-id';

// Messages on their way out of one conversation. The field empties the moment
// a message is sent, the message shows in the chat until the server has it,
// and the next one can be written meanwhile. They go out one at a time, in the
// order they were written. A failed one stays in the chat with its error, to
// be sent again or dropped, while the ones after it carry on.

export type OutgoingState = 'queued' | 'sending' | 'failed';

export interface Outgoing<Payload> {
  /** Stable for the message's life here; also keys its row in the chat. */
  localId: string;
  payload: Payload;
  state: OutgoingState;
  error: string;
}

export interface OutboxOptions<Payload, Message> {
  /** Posts one message; the key makes a repeat of the same message store it once. */
  deliver: (payload: Payload, idempotencyKey: string) => Promise<Message>;
  /** The server has the message: it joins the chat for real. */
  onSent: (message: Message) => void;
}

export class Outbox<Payload, Message> {
  readonly #items = shallowRef<Outgoing<Payload>[]>([]);
  #options: OutboxOptions<Payload, Message>;
  #draining = false;

  constructor(options: OutboxOptions<Payload, Message>) {
    this.#options = options;
  }

  get items(): Outgoing<Payload>[] {
    return this.#items.value;
  }

  set items(value: Outgoing<Payload>[]) {
    this.#items.value = value;
  }

  enqueue(payload: Payload): void {
    this.items = [...this.items, { localId: newId(), payload, state: 'queued', error: '' }];
    void this.#drain();
  }

  /** Sends a failed message again, after the ones already waiting; the server still stores it once. */
  retry(localId: string): void {
    const item = this.items.find((entry) => entry.localId === localId);
    if (!item || item.state !== 'failed') return;
    this.items = [...this.items.filter((entry) => entry.localId !== localId), { ...item, state: 'queued', error: '' }];
    void this.#drain();
  }

  /** Drops a failed message. One on its way cannot be called back. */
  discard(localId: string): void {
    this.items = this.items.filter((entry) => entry.localId !== localId || entry.state !== 'failed');
  }

  async #drain(): Promise<void> {
    if (this.#draining) return;
    this.#draining = true;
    try {
      for (;;) {
        const next = this.items.find((entry) => entry.state === 'queued');
        if (!next) return;
        this.#set(next.localId, { state: 'sending' });
        try {
          // The local id is the idempotency key: a retry is the same message.
          const message = await this.#options.deliver(next.payload, next.localId);
          this.items = this.items.filter((entry) => entry.localId !== next.localId);
          this.#options.onSent(message);
        } catch (error) {
          this.#set(next.localId, {
            state: 'failed',
            error: error instanceof Error && error.message ? error.message : 'Не удалось отправить'
          });
        }
      }
    } finally {
      this.#draining = false;
    }
  }

  #set(localId: string, change: Partial<Outgoing<Payload>>): void {
    this.items = this.items.map((entry) => (entry.localId === localId ? { ...entry, ...change } : entry));
  }
}
