// PostgreSQL LISTEN on a connection taken out of the pool. The connection stays
// out of the pool while it listens; losing it is the caller's cue to reconnect.

type Notification = { channel: string; payload?: string | undefined };

export interface ListenClient {
  on(event: 'notification', listener: (notification: Notification) => void): unknown;
  on(event: 'error', listener: (error: unknown) => void): unknown;
  on(event: 'end', listener: () => void): unknown;
  off(event: 'notification', listener: (notification: Notification) => void): unknown;
  query(sql: string): Promise<unknown>;
  /** An error destroys the connection instead of returning it to the pool. */
  release(error?: Error): void;
}

export type Listener = {
  channel: string;
  client: ListenClient;
  onNotification: (notification: Notification) => void;
};

/** Connects, wires the handlers and subscribes; the connection is released if any step fails. */
export async function startListening(
  pool: { connect(): Promise<ListenClient> },
  channel: string,
  handlers: { onPayload(payload: string | undefined): void; onLost(listener: Listener, error?: unknown): void }
): Promise<Listener> {
  const client = await pool.connect();
  try {
    const listener: Listener = {
      channel,
      client,
      onNotification: (notification) => {
        if (notification.channel === channel) handlers.onPayload(notification.payload);
      }
    };
    client.on('notification', listener.onNotification);
    client.on('error', (error) => handlers.onLost(listener, error));
    client.on('end', () => handlers.onLost(listener));
    await client.query(`LISTEN ${channel}`);
    return listener;
  } catch (error) {
    client.release(error instanceof Error ? error : new Error('LISTEN failed'));
    throw error;
  }
}

/** Drops a connection that is already broken, destroying it. */
export function dropListener(listener: Listener, error?: unknown): void {
  listener.client.off('notification', listener.onNotification);
  listener.client.release(error instanceof Error ? error : new Error('listener lost'));
}

/** Ends a healthy subscription and gives the connection back to the pool. */
export async function stopListener(listener: Listener): Promise<void> {
  listener.client.off('notification', listener.onNotification);
  await listener.client.query(`UNLISTEN ${listener.channel}`).catch(() => {});
  listener.client.release();
}
