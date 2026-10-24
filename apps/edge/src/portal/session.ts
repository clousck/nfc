import { EMAIL_LINK_TTL_MS, randomBase62, type BusinessState } from '@nfc/shared';
import { issueLoginToken } from '../accounts/store.js';
import type { Env } from '../env.js';
import { hashToken, readCookie } from '../loyalty/security.js';
import { mailSender } from './mail.js';
import { loginEmail } from './pages.js';

// Sesiones del portal. Cookie `__Host-`: el navegador la ata a negocios.penginexr.com (sin
// Domain, Path=/ y Secure obligatorios), así nunca se mezcla con las cookies de go.

export const SESSION_COOKIE = '__Host-nfc_session';
export const SESSION_TTL_MS = 30 * 86_400_000;
/** last_seen_at se actualiza como mucho una vez por hora (una escritura, no una por clic). */
const TOUCH_EVERY_MS = 3_600_000;
/** Enlaces por correo sin usar que se permiten a la vez por cuenta (cuida la cuota de Resend). */
const MAX_PENDING_EMAIL_LINKS = 3;

const TOKEN_PATTERN = /^[0-9A-Za-z]{43}$/;

export interface PortalBusiness {
  id: string;
  name: string;
  status: BusinessState['status'];
}

export interface PortalSession {
  idHash: string;
  accountId: string;
  email: string;
  name: string | null;
  /** Negocios a los que tiene acceso (sin los cancelados ni borrados). */
  businesses: PortalBusiness[];
}

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; Max-Age=${SESSION_TTL_MS / 1000}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

export const CLEAR_SESSION_COOKIE = `${SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`;

export async function readSession(
  env: Env,
  request: Request,
  ctx: { waitUntil(promise: Promise<unknown>): void },
  now = Date.now(),
): Promise<PortalSession | null> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token || !TOKEN_PATTERN.test(token)) return null;
  const idHash = await hashToken(token);
  const row = await env.DB.prepare(
    `SELECT s.account_id, s.last_seen_at, a.email, a.name
     FROM sessions s JOIN accounts a ON a.id = s.account_id
     WHERE s.id_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ? AND a.disabled_at IS NULL`,
  )
    .bind(idHash, now)
    .first<{ account_id: string; last_seen_at: number; email: string; name: string | null }>();
  if (!row) return null;

  const { results } = await env.DB.prepare(
    `SELECT b.id, b.name, b.status FROM memberships m
     JOIN business_profile b ON b.id = m.business_id
     WHERE m.account_id = ? AND b.deleted = 0 AND b.status != 'cancelled'
     ORDER BY b.name`,
  )
    .bind(row.account_id)
    .all<PortalBusiness>();
  if (results.length === 0) return null;

  if (now - row.last_seen_at > TOUCH_EVERY_MS) {
    ctx.waitUntil(
      env.DB.prepare('UPDATE sessions SET last_seen_at = ? WHERE id_hash = ?')
        .bind(now, idHash)
        .run(),
    );
  }
  return {
    idHash,
    accountId: row.account_id,
    email: row.email,
    name: row.name,
    businesses: results,
  };
}

/**
 * Gasta el enlace (una sola vez, de forma atómica) y abre una sesión. Devuelve el token de
 * la cookie, o null si el enlace no existe, caducó, ya se usó o la cuenta perdió el acceso.
 */
export async function consumeLoginToken(
  env: Env,
  token: string,
  now = Date.now(),
): Promise<string | null> {
  if (!TOKEN_PATTERN.test(token)) return null;
  const used = await env.DB.prepare(
    `UPDATE login_tokens SET used_at = ?
     WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?
     RETURNING account_id`,
  )
    .bind(now, await hashToken(token), now)
    .first<{ account_id: string }>();
  if (!used) return null;

  const allowed = await env.DB.prepare(
    `SELECT 1 AS ok FROM accounts a WHERE a.id = ? AND a.disabled_at IS NULL
     AND EXISTS (SELECT 1 FROM memberships m JOIN business_profile b ON b.id = m.business_id
                 WHERE m.account_id = a.id AND b.deleted = 0 AND b.status != 'cancelled')`,
  )
    .bind(used.account_id)
    .first<{ ok: number }>();
  if (!allowed) return null;

  const session = randomBase62(43);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO sessions (id_hash, account_id, created_at, expires_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(await hashToken(session), used.account_id, now, now + SESSION_TTL_MS, now),
    env.DB.prepare('UPDATE accounts SET last_login_at = ? WHERE id = ?').bind(now, used.account_id),
  ]);
  return session;
}

/** ¿El enlace sigue sirviendo? (para la página de confirmación; no lo gasta). */
export async function isLoginTokenUsable(env: Env, token: string, now = Date.now()) {
  if (!TOKEN_PATTERN.test(token)) return false;
  const row = await env.DB.prepare(
    'SELECT 1 AS ok FROM login_tokens WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?',
  )
    .bind(await hashToken(token), now)
    .first<{ ok: number }>();
  return row !== null;
}

export async function revokeSession(env: Env, idHash: string, now = Date.now()): Promise<void> {
  await env.DB.prepare('UPDATE sessions SET revoked_at = ? WHERE id_hash = ?')
    .bind(now, idHash)
    .run();
}

/**
 * Envía un enlace por correo si el correo tiene acceso. No dice nada al que lo pidió: la
 * respuesta es la misma exista o no la cuenta (se llama dentro de waitUntil).
 */
export async function sendLoginEmail(env: Env, email: string, now = Date.now()): Promise<void> {
  const account = await env.DB.prepare(
    `SELECT a.id,
       (SELECT COUNT(*) FROM login_tokens l WHERE l.account_id = a.id AND l.purpose = 'email'
          AND l.used_at IS NULL AND l.expires_at > ?) AS pending
     FROM accounts a
     WHERE a.email = ? AND a.disabled_at IS NULL
       AND EXISTS (SELECT 1 FROM memberships m JOIN business_profile b ON b.id = m.business_id
                   WHERE m.account_id = a.id AND b.deleted = 0 AND b.status != 'cancelled')`,
  )
    .bind(now, email)
    .first<{ id: string; pending: number }>();
  if (!account || account.pending >= MAX_PENDING_EMAIL_LINKS) return;

  const link = await issueLoginToken(env, account.id, 'email', EMAIL_LINK_TTL_MS, now);
  await mailSender(env).send({ to: email, ...loginEmail(link.url) });
}

export async function cleanupSessions(db: D1Database, now: number): Promise<void> {
  await db.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now).run();
}
