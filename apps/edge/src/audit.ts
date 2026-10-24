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

export interface AuditView {
  ts: number;
  actorType: Actor['type'];
  /** Correo del dueño o nombre del dispositivo; null para el admin. */
  actorLabel: string | null;
  action: string;
  target: string | null;
  /** Número del chip si el objetivo es un chip. */
  tagNumber: number | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

const parse = (json: string | null): Record<string, unknown> | null => {
  if (!json) return null;
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
};

/** Últimos cambios de un negocio, del más reciente al más antiguo. */
export async function listAudit(
  db: D1Database,
  businessId: string,
  limit = 100,
): Promise<AuditView[]> {
  const { results } = await db
    .prepare(
      `SELECT l.ts, l.actor_type, l.action, l.target, l.before_json, l.after_json,
         a.email AS actor_email, t.number AS tag_number
       FROM audit_log l
       LEFT JOIN accounts a ON l.actor_type = 'owner' AND a.id = l.actor_id
       LEFT JOIN tag_inventory t ON t.slug = l.target
       WHERE l.business_id = ?
       ORDER BY l.ts DESC, l.id DESC
       LIMIT ?`,
    )
    .bind(businessId, limit)
    .all<{
      ts: number;
      actor_type: Actor['type'];
      action: string;
      target: string | null;
      before_json: string | null;
      after_json: string | null;
      actor_email: string | null;
      tag_number: number | null;
    }>();
  return results.map((r) => ({
    ts: r.ts,
    actorType: r.actor_type,
    actorLabel: r.actor_email,
    action: r.action,
    target: r.target,
    tagNumber: r.tag_number,
    before: parse(r.before_json),
    after: parse(r.after_json),
  }));
}
