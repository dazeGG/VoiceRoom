// Promise.allSettled types a rejection reason as `any`; this keeps it unknown.

export type Settled<Value> = { ok: true; value: Value } | { ok: false; error: unknown };

export function settleAll<Value>(promises: readonly Promise<Value>[]): Promise<Array<Settled<Value>>> {
  return Promise.all(
    promises.map((promise) =>
      promise.then(
        (value): Settled<Value> => ({ ok: true, value }),
        (error: unknown): Settled<Value> => ({ ok: false, error })
      )
    )
  );
}
