interface ReadReconciliationOptions {
  scope: string;
  legacy: boolean;
  commit: (cursor?: string) => Promise<string | void>;
}

export function createReadReconciliation(options: ReadReconciliationOptions) {
  let disposed = false;
  let pending: string | undefined;
  let active: Promise<void> | null = null;
  let committed = '';
  const channelName = `voice-room:read:${options.scope}`;
  const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(channelName);

  async function drain(): Promise<void> {
    while (!disposed && pending !== undefined) {
      const candidate = pending;
      pending = undefined;
      if (!options.legacy && (!candidate || candidate === committed)) continue;
      try {
        const accepted = await options.commit(options.legacy ? undefined : candidate);
        committed = typeof accepted === 'string' && accepted ? accepted : candidate || committed;
        if (committed) channel?.postMessage({ cursor: committed });
      } catch {
        if (pending === undefined) pending = candidate;
        break;
      }
    }
  }

  function advanceAfterRender(cursor?: string): Promise<void> {
    if (disposed || (!options.legacy && !cursor)) return Promise.resolve();
    pending = cursor ?? '';
    if (!active) {
      active = drain().finally(() => { active = null; });
    }
    return active;
  }

  channel?.addEventListener('message', (event: MessageEvent<{ cursor?: unknown }>) => {
    const cursor = typeof event.data?.cursor === 'string' ? event.data.cursor : '';
    // Opaque cursors are intentionally not ordered in the browser. Once this
    // tab has an acknowledged cursor, a foreign cursor cannot safely advance
    // it; account realtime/resync remains the authority for cross-tab state.
    if (!cursor || committed) return;
    void advanceAfterRender(cursor);
  });

  function dispose(): void {
    disposed = true;
    pending = undefined;
    channel?.close();
  }

  return { advanceAfterRender, dispose };
}
