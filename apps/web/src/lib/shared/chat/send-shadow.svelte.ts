export type SendShadowState = 'pending' | 'confirmed' | 'failed';

export type SendShadow<T> = {
  draftKey: string;
  fingerprint: string;
  canonicalId: string | null;
  value: T;
  state: SendShadowState;
  updatedAt: number;
};

function randomKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function fingerprint(value: unknown): string {
  const input = stableJson(value);
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function createSendShadowStore<T extends { id?: string }>() {
  let items = $state<SendShadow<T>[]>([]);

  function begin(value: T): SendShadow<T> {
    const nextFingerprint = fingerprint(value);
    const existing = items.find((item) => item.fingerprint === nextFingerprint && item.state === 'pending');
    if (existing) return existing;
    const shadow: SendShadow<T> = {
      draftKey: randomKey(),
      fingerprint: nextFingerprint,
      canonicalId: null,
      value,
      state: 'pending',
      updatedAt: Date.now()
    };
    items = [...items, shadow];
    return shadow;
  }

  function confirm(draftKey: string, value: T): void {
    const canonicalId = value.id || null;
    items = items.map((item) => item.draftKey === draftKey
      ? { ...item, canonicalId, value, state: 'confirmed', updatedAt: Date.now() }
      : item
    );
    if (canonicalId) {
      let kept = false;
      items = items.filter((item) => {
        if (item.canonicalId !== canonicalId) return true;
        if (!kept) { kept = true; return true; }
        return false;
      });
    }
  }

  function reconcileRealtime(value: T, draftKey?: string): void {
    const canonicalId = value.id || null;
    const match = items.find((item) =>
      (draftKey && item.draftKey === draftKey) || (canonicalId && item.canonicalId === canonicalId)
    );
    if (match) {
      confirm(match.draftKey, value);
      return;
    }
    if (canonicalId && items.some((item) => item.value.id === canonicalId)) return;
    items = [...items, {
      draftKey: draftKey || `remote:${canonicalId || randomKey()}`,
      fingerprint: fingerprint(value),
      canonicalId,
      value,
      state: 'confirmed',
      updatedAt: Date.now()
    }];
  }

  function fail(draftKey: string): void {
    items = items.map((item) => item.draftKey === draftKey
      ? { ...item, state: 'failed', updatedAt: Date.now() }
      : item
    );
  }

  function remove(draftKey: string): void {
    items = items.filter((item) => item.draftKey !== draftKey);
  }

  return {
    get items() { return items; },
    begin,
    confirm,
    fail,
    reconcileRealtime,
    remove
  };
}
