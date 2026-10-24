// Auditoría de los cambios de configuración de un negocio (docs/BUSINESS-ACCOUNTS.md §5):
// quién, qué, antes, después y cuándo. Se escribe en el mismo batch que el cambio.

export type Actor =
  { type: 'admin' } | { type: 'owner'; id: string } | { type: 'staff'; id: string };

export interface AuditEntry {
  businessId: string;
  actor: Actor;
  action: string;
  target: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  ts: number;
}

export const AUDIT_RETENTION_DAYS = 365;

export function auditStatement(db: D1Database, entry: AuditEntry): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO audit_log (business_id, actor_type, actor_id, action, target, before_json, after_json, ts)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      entry.businessId,
      entry.actor.type,
      entry.actor.type === 'admin' ? null : entry.actor.id,
      entry.action,
      entry.target,
      entry.before ? JSON.stringify(entry.before) : null,
      entry.after ? JSON.stringify(entry.after) : null,
      entry.ts,
    );
}

/** Solo los campos que cambian, para que la auditoría se lea de un vistazo. */
export function diff<T extends Record<string, unknown>>(
  before: T,
  after: T,
): { before: Partial<T>; after: Partial<T> } | null {
  const b: Partial<T> = {};
  const a: Partial<T> = {};
  for (const key of Object.keys(after) as (keyof T)[]) {
    if (before[key] !== after[key]) {
      b[key] = before[key];
      a[key] = after[key];
    }
  }
  return Object.keys(a).length > 0 ? { before: b, after: a } : null;
}

export async function cleanupAudit(db: D1Database, now: number): Promise<void> {
  await db
    .prepare('DELETE FROM audit_log WHERE ts < ?')
    .bind(now - AUDIT_RETENTION_DAYS * 86_400_000)
    .run();
}
