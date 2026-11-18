// One widget owner per process role. Main traffic never depends on this authority.
import crypto from 'node:crypto';
import type pg from 'pg';
export const WIDGET_OWNER_NAMESPACE = 870113;
export type WidgetOwnerRole = 'api' | 'gate';
export const widgetOwnerLockId = (role: WidgetOwnerRole): number => (role === 'api' ? 1 : 2);
interface OwnerState {
  enabled: boolean;
  generation: string;
  owner_id: string | null;
}
export function createWidgetRuntimeOwner({
  pool,
  role,
  quiesce,
  lost
}: {
  pool: pg.Pool;
  role: WidgetOwnerRole;
  quiesce: () => Promise<boolean>;
  lost: () => void;
}) {
  let client: pg.PoolClient | null = null;
  let valid = false;
  let enabled = false;
  let stopping = false;
  const id = crypto.randomUUID();
  function invalidate() {
    if (!valid) return;
    valid = false;
    enabled = false;
    lost();
  }
  async function state(): Promise<OwnerState | null> {
    if (!valid || !client) return null;
    try {
      const result = await client.query<OwnerState>(
        `SELECT a.widget_admission_enabled AS enabled,a.recovery_generation::text AS generation,o.owner_id FROM widget_boundary_activation a JOIN widget_runtime_owners o ON o.role=$1 WHERE a.singleton`,
        [role]
      );
      const row = result.rows[0];
      if (!row || row.owner_id !== id) {
        invalidate();
        return null;
      }
      enabled = row.enabled;
      return row;
    } catch (error) {
      invalidate();
      throw error;
    }
  }
  async function tick(): Promise<void> {
    const current = await state();
    if (!current || current.enabled) return;
    if (!(await quiesce()) || !valid || !client) return;
    await client.query(
      `UPDATE widget_runtime_owners SET acknowledged_generation=$1 WHERE role=$2 AND owner_id=$3 AND EXISTS(SELECT 1 FROM widget_boundary_activation WHERE singleton AND NOT widget_admission_enabled AND recovery_generation=$1)`,
      [current.generation, role, id]
    );
  }
  async function start(): Promise<boolean> {
    if (client) return valid;
    const opened = await pool.connect();
    client = opened;
    opened.on('error', invalidate);
    opened.on('end', invalidate);
    try {
      const lock = await opened.query<{ locked: boolean }>('SELECT pg_try_advisory_lock($1,$2) AS locked', [
        WIDGET_OWNER_NAMESPACE,
        widgetOwnerLockId(role)
      ]);
      if (!lock.rows[0]?.locked) {
        client = null;
        opened.release();
        return false;
      }
      // A released DB lock does not prove an old process/tunnel ended. Never silently take over its row.
      const claimed = await opened.query<{ role: WidgetOwnerRole }>(
        `UPDATE widget_runtime_owners SET owner_id=$1,backend_pid=pg_backend_pid(),acknowledged_generation=NULL WHERE role=$2 AND owner_id IS NULL RETURNING role`,
        [id, role]
      );
      if (claimed.rowCount !== 1) {
        await opened.query('SELECT pg_advisory_unlock($1,$2)', [WIDGET_OWNER_NAMESPACE, widgetOwnerLockId(role)]);
        client = null;
        opened.release();
        return false;
      }
      valid = true;
      await tick();
      return true;
    } catch (error) {
      invalidate();
      client = null;
      opened.release(true);
      throw error;
    }
  }
  async function capture(): Promise<string | null> {
    const current = await state();
    return current?.enabled ? current.generation : null;
  }
  async function allows(generation: string): Promise<boolean> {
    const current = await state();
    return Boolean(current?.enabled && current.generation === generation);
  }
  async function stop(): Promise<void> {
    if (stopping) return;
    stopping = true;
    const opened = client;
    try {
      if (valid && opened && (await quiesce()))
        await opened.query(
          'UPDATE widget_runtime_owners SET owner_id=NULL,backend_pid=NULL,acknowledged_generation=NULL WHERE role=$1 AND owner_id=$2',
          [role, id]
        );
    } finally {
      const canUnlock = valid;
      invalidate();
      client = null;
      if (opened) {
        try {
          if (canUnlock)
            await opened.query('SELECT pg_advisory_unlock($1,$2)', [WIDGET_OWNER_NAMESPACE, widgetOwnerLockId(role)]);
        } finally {
          opened.release(true);
        }
      }
    }
  }
  return { start, tick, capture, allows, stop, valid: () => valid, localEnabled: () => valid && enabled, id, role };
}
export type WidgetRuntimeOwner = ReturnType<typeof createWidgetRuntimeOwner>;
