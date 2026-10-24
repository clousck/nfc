import {
  generateId,
  MAX_STAFF_DEVICES,
  PAIRING_PATH,
  PAIRING_TTL_MS,
  randomBase62,
  type PairingResponse,
  type StaffDeviceSummary,
} from '@nfc/shared';
import { auditStatement, type Actor } from '../audit.js';
import type { Env } from '../env.js';
import { hashToken, readCookie } from '../loyalty/security.js';

// Móviles del personal que validan canjes. Sin cuenta: cada móvil recibe una credencial
// propia (cookie en go.penginexr.com), con nombre y revocable por separado.

export const STAFF_COOKIE = '__Host-nfc_staff';
// 400 días: el máximo que Chrome permite; se renueva al validar.
const STAFF_COOKIE_MAX_AGE = 400 * 86_400;
const TOUCH_EVERY_MS = 3_600_000;
const TOKEN_PATTERN = /^[0-9A-Za-z]{43}$/;

export const DEFAULT_PUBLIC_ORIGIN = 'https://go.penginexr.com';

export function publicOrigin(env: Env): string {
  return (env.PUBLIC_ORIGIN ?? DEFAULT_PUBLIC_ORIGIN).replace(/\/+$/, '');
}

export function staffCookie(token: string): string {
  return `${STAFF_COOKIE}=${token}; Max-Age=${STAFF_COOKIE_MAX_AGE}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

export interface StaffDevice {
  id: string;
  businessId: string;
  businessName: string;
  label: string;
}

const actorId = (actor: Actor) => (actor.type === 'admin' ? null : actor.id);

/** Crea un enlace de vinculación (un solo uso, 15 min). */
export async function createPairing(
  env: Env,
  businessId: string,
  label: string,
  actor: Actor,
  now = Date.now(),
): Promise<PairingResponse> {
  const token = randomBase62(43);
  const expiresAt = now + PAIRING_TTL_MS;
  await env.DB.prepare(
    `INSERT INTO pairing_tokens (token_hash, business_id, label, created_by, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(await hashToken(token), businessId, label, actorId(actor), now, expiresAt)
    .run();
  return { url: `${publicOrigin(env)}${PAIRING_PATH}/${token}`, expiresAt };
}

export interface PendingPairing {
  businessName: string;
  label: string;
}

/** Datos del enlace si sigue sirviendo (página de confirmación; no lo gasta). */
export async function pendingPairing(
  env: Env,
  token: string,
  now = Date.now(),
): Promise<PendingPairing | null> {
  if (!TOKEN_PATTERN.test(token)) return null;
  return env.DB.prepare(
    `SELECT b.name AS businessName, p.label FROM pairing_tokens p
     JOIN business_profile b ON b.id = p.business_id AND b.deleted = 0
     WHERE p.token_hash = ? AND p.used_at IS NULL AND p.expires_at > ?`,
  )
    .bind(await hashToken(token), now)
    .first<PendingPairing>();
}

export type PairResult =
  | { ok: true; cookieToken: string; device: StaffDevice }
  | { ok: false; error: 'invalid' | 'too_many' };

/** Gasta el enlace (atómico) y vincula este móvil. */
export async function completePairing(
  env: Env,
  token: string,
  now = Date.now(),
): Promise<PairResult> {
  if (!TOKEN_PATTERN.test(token)) return { ok: false, error: 'invalid' };
  const used = await env.DB.prepare(
    `UPDATE pairing_tokens SET used_at = ?
     WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?
     RETURNING business_id, label, created_by`,
  )
    .bind(now, await hashToken(token), now)
    .first<{ business_id: string; label: string; created_by: string | null }>();
  if (!used) return { ok: false, error: 'invalid' };

  const business = await env.DB.prepare(
    `SELECT b.name,
       (SELECT COUNT(*) FROM staff_devices d WHERE d.business_id = b.id AND d.revoked_at IS NULL) AS active
     FROM business_profile b WHERE b.id = ? AND b.deleted = 0`,
  )
    .bind(used.business_id)
    .first<{ name: string; active: number }>();
  if (!business) return { ok: false, error: 'invalid' };
  if (business.active >= MAX_STAFF_DEVICES) return { ok: false, error: 'too_many' };

  const cookieToken = randomBase62(43);
  const id = generateId('d');
  const actor: Actor = used.created_by ? { type: 'owner', id: used.created_by } : { type: 'admin' };
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO staff_devices (id, business_id, label, token_hash, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(id, used.business_id, used.label, await hashToken(cookieToken), used.created_by, now),
    auditStatement(env.DB, {
      businessId: used.business_id,
      actor,
      action: 'staff.paired',
      target: id,
      before: null,
      after: { label: used.label },
      ts: now,
    }),
  ]);
  return {
    ok: true,
    cookieToken,
    device: { id, businessId: used.business_id, businessName: business.name, label: used.label },
  };
}

/** Dispositivo del personal de esta petición (cookie válida, no revocada, negocio vigente). */
export async function readStaffDevice(
  env: Env,
  request: Request,
  ctx: { waitUntil(promise: Promise<unknown>): void },
  now = Date.now(),
): Promise<StaffDevice | null> {
  const token = readCookie(request, STAFF_COOKIE);
  if (!token || !TOKEN_PATTERN.test(token)) return null;
  const row = await env.DB.prepare(
    `SELECT d.id, d.business_id, d.label, d.last_used_at, b.name
     FROM staff_devices d JOIN business_profile b ON b.id = d.business_id
     WHERE d.token_hash = ? AND d.revoked_at IS NULL AND b.deleted = 0 AND b.status = 'active'`,
  )
    .bind(await hashToken(token))
    .first<{
      id: string;
      business_id: string;
      label: string;
      last_used_at: number | null;
      name: string;
    }>();
  if (!row) return null;
  if (!row.last_used_at || now - row.last_used_at > TOUCH_EVERY_MS) {
    ctx.waitUntil(
      env.DB.prepare('UPDATE staff_devices SET last_used_at = ? WHERE id = ?')
        .bind(now, row.id)
        .run(),
    );
  }
  return { id: row.id, businessId: row.business_id, businessName: row.name, label: row.label };
}

export async function listStaffDevices(
  db: D1Database,
  businessId: string,
): Promise<StaffDeviceSummary[]> {
  const { results } = await db
    .prepare(
      `SELECT d.id, d.label, d.created_at, d.last_used_at, a.email AS created_by
       FROM staff_devices d LEFT JOIN accounts a ON a.id = d.created_by
       WHERE d.business_id = ? AND d.revoked_at IS NULL
       ORDER BY d.created_at`,
    )
    .bind(businessId)
    .all<{
      id: string;
      label: string;
      created_at: number;
      last_used_at: number | null;
      created_by: string | null;
    }>();
  return results.map((r) => ({
    id: r.id,
    label: r.label,
    createdAt: r.created_at,
    createdBy: r.created_by,
    lastUsedAt: r.last_used_at,
  }));
}

/** Revoca un móvil: deja de validar al instante. */
export async function revokeStaffDevice(
  env: Env,
  businessId: string,
  deviceId: string,
  actor: Actor,
  now = Date.now(),
): Promise<boolean> {
  const device = await env.DB.prepare(
    'SELECT label FROM staff_devices WHERE id = ? AND business_id = ? AND revoked_at IS NULL',
  )
    .bind(deviceId, businessId)
    .first<{ label: string }>();
  if (!device) return false;
  await env.DB.batch([
    env.DB.prepare('UPDATE staff_devices SET revoked_at = ? WHERE id = ?').bind(now, deviceId),
    auditStatement(env.DB, {
      businessId,
      actor,
      action: 'staff.revoked',
      target: deviceId,
      before: { label: device.label },
      after: null,
      ts: now,
    }),
  ]);
  return true;
}

export async function cleanupPairingTokens(db: D1Database, now: number): Promise<void> {
  await db
    .prepare('DELETE FROM pairing_tokens WHERE expires_at < ?')
    .bind(now - 86_400_000)
    .run();
}
