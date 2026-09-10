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
  let sequence = 0;
  const source = crypto.randomUUID();
  const seen = new Set<string>();
  const sourceSequences = new Map<string, number>();
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
        if (candidate) seen.add(candidate);
        if (committed) {
          seen.add(committed);
          channel?.postMessage({ cursor: committed, sequence: ++sequence, source });
        }
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

  channel?.addEventListener('message', (event: MessageEvent<{ cursor?: unknown; sequence?: unknown; source?: unknown }>) => {
    const cursor = typeof event.data?.cursor === 'string' ? event.data.cursor : '';
    const remoteSource = typeof event.data?.source === 'string' ? event.data.source : '';
    const remoteSequence = Number(event.data?.sequence);
    if (!cursor || cursor === committed || seen.has(cursor)) return;
    // Cursor payloads are opaque. Order the transport envelope per sender and
    // let the server's monotonic read cursor reject cross-sender stale values.
    if (remoteSource && Number.isSafeInteger(remoteSequence) && remoteSequence > 0) {
      if (remoteSequence <= (sourceSequences.get(remoteSource) || 0)) return;
      sourceSequences.set(remoteSource, remoteSequence);
    }
    void advanceAfterRender(cursor);
  });

  function dispose(): void {
    disposed = true;
    pending = undefined;
    channel?.close();
  }

  return { advanceAfterRender, dispose };
}
