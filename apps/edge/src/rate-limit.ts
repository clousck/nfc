import { randomBase62, type RateLimitIncidentsResponse } from '@nfc/shared';
import type { Env } from './env.js';

// Límites de peticiones (docs/SECURITY.md §4). Se limita lo que escribe datos o se puede
// adivinar; nunca la redirección de un chip. La IP solo se usa en memoria para contar.

export type RateAction = 'signup' | 'redeem' | 'validate';
/** Qué límite se aplica: por móvil, por red (IP + negocio) o por credencial del personal. */
export type RateScope = 'device' | 'network' | 'staff';
export type RateActor = 'customer' | 'staff' | 'anonymous';

export interface RateCheck {
  action: RateAction;
  scope: RateScope;
  actor: RateActor;
  /** Identificador del origen (hash de cookie, o IP + negocio). Nunca se guarda tal cual. */
  key: string;
  /** null si no se sabe a qué negocio iba. */
  businessId: string | null;
}

const LIMITERS: Record<RateScope, 'RL_DEVICE' | 'RL_NETWORK' | 'RL_STAFF'> = {
  device: 'RL_DEVICE',
  network: 'RL_NETWORK',
  staff: 'RL_STAFF',
};

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
export const INCIDENT_RETENTION_DAYS = 90;

export function rateLimitMode(env: Env): 'observe' | 'enforce' {
  return env.RATE_LIMIT_MODE === 'enforce' ? 'enforce' : 'observe';
}

/** IP del cliente según Cloudflare (solo para contar; no se guarda). */
export function clientIp(request: Request): string {
  return request.headers.get('cf-connecting-ip') ?? 'unknown';
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function dailySalt(db: D1Database, day: string): Promise<string> {
  await db
    .prepare('INSERT OR IGNORE INTO daily_salts (day, salt) VALUES (?, ?)')
    .bind(day, randomBase62(32))
    .run();
  const row = await db
    .prepare('SELECT salt FROM daily_salts WHERE day = ?')
    .bind(day)
    .first<{ salt: string }>();
  return row?.salt ?? '';
}

/**
 * Registra el incidente como mucho una vez por minuto y origen: registrar cada petición
 * bloqueada convertiría un ataque en miles de escrituras (y en otro ataque contra la cuota).
 */
async function logIncident(env: Env, check: RateCheck, now: number): Promise<void> {
  const gate = await env.RL_INCIDENT_LOG.limit({
    key: `${check.action}:${check.scope}:${check.key}`,
  });
  if (!gate.success) return;
  const salt = await dailySalt(env.DB, new Date(now).toISOString().slice(0, 10));
  const sourceHash = (await sha256Hex(`${salt}:${check.key}`)).slice(0, 16);
  await env.DB.prepare(
    `INSERT OR IGNORE INTO rate_limit_incidents
       (business_id, action, actor, scope, mode, minute, source_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      check.businessId ?? '',
      check.action,
      check.actor,
      check.scope,
      rateLimitMode(env),
      Math.floor(now / MINUTE_MS) * MINUTE_MS,
      sourceHash,
    )
    .run();
}

/**
 * Aplica los límites indicados. Devuelve `true` si la petición sigue: siempre en modo
 * observación (solo se registra) y en modo bloqueo si ningún límite se superó.
 */
export async function allowRequest(
  env: Env,
  ctx: { waitUntil(promise: Promise<unknown>): void },
  checks: readonly RateCheck[],
  now = Date.now(),
): Promise<boolean> {
  let exceeded = false;
  for (const check of checks) {
    const { success } = await env[LIMITERS[check.scope]].limit({
      key: `${check.action}:${check.key}`,
    });
    if (success) continue;
    exceeded = true;
    // El registro no retrasa la respuesta.
    ctx.waitUntil(
      logIncident(env, check, now).catch((err: unknown) => {
        console.error('No se pudo registrar el incidente', String(err));
      }),
    );
  }
  return !exceeded || rateLimitMode(env) === 'observe';
}

/** Tarea diaria: borra incidentes viejos y las sales de días pasados. */
export async function cleanupRateLimits(db: D1Database, now: number): Promise<void> {
  await db.batch([
    db
      .prepare('DELETE FROM rate_limit_incidents WHERE minute < ?')
      .bind(now - INCIDENT_RETENTION_DAYS * DAY_MS),
    db
      .prepare('DELETE FROM daily_salts WHERE day < ?')
      .bind(new Date(now).toISOString().slice(0, 10)),
  ]);
}

/** Resumen por día local, acción, actor, límite y modo: minutos con bloqueo y orígenes. */
export async function incidentSummary(
  env: Env,
  businessId: string | null,
  days: number,
  now: number,
): Promise<RateLimitIncidentsResponse> {
  const offsetSeconds = Number(env.REPORT_TZ_OFFSET_MINUTES ?? '-300') * 60;
  const filter = businessId === null ? '' : 'AND business_id = ?';
  const { results } = await env.DB.prepare(
    `SELECT business_id AS businessId,
            date(minute / 1000 + ?, 'unixepoch') AS day,
            action, actor, scope, mode,
            COUNT(DISTINCT minute) AS minutes,
            COUNT(DISTINCT source_hash) AS sources,
            MAX(minute) AS lastAt
     FROM rate_limit_incidents
     WHERE minute >= ? ${filter}
     GROUP BY business_id, day, action, actor, scope, mode
     ORDER BY day DESC, minutes DESC
     LIMIT 500`,
  )
    .bind(offsetSeconds, now - days * DAY_MS, ...(businessId === null ? [] : [businessId]))
    .all<RateLimitIncidentsResponse['incidents'][number]>();
  return { mode: rateLimitMode(env), incidents: results };
}
