import {
  generateId,
  INVITE_LINK_TTL_MS,
  LOGIN_PATH,
  randomBase62,
  type AccountSummary,
  type CreateAccountBody,
  type LoginLinkResponse,
} from '@nfc/shared';
import { auditStatement, type Actor } from '../audit.js';
import type { Env } from '../env.js';
import { hashToken } from '../loyalty/security.js';

// Cuentas de los dueños y sus enlaces de acceso. En la base solo hay hashes de tokens.

export const DEFAULT_PORTAL_ORIGIN = 'https://negocios.penginexr.com';

export function portalOrigin(env: Env): string {
  return (env.PORTAL_ORIGIN ?? DEFAULT_PORTAL_ORIGIN).replace(/\/+$/, '');
}

const LOGIN_TOKEN_PATTERN = /^[0-9A-Za-z]{43}$/;

export function isLoginToken(value: string): boolean {
  return LOGIN_TOKEN_PATTERN.test(value);
}

/** ¿El negocio existe en la copia del plano de control? */
async function businessExists(db: D1Database, id: string): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 AS ok FROM business_profile WHERE id = ? AND deleted = 0')
    .bind(id)
    .first<{ ok: number }>();
  return row !== null;
}

export async function listAccounts(db: D1Database, businessId: string): Promise<AccountSummary[]> {
  const { results } = await db
    .prepare(
      `SELECT a.id, a.email, a.name, a.created_at, a.last_login_at
       FROM memberships m JOIN accounts a ON a.id = m.account_id
       WHERE m.business_id = ? AND a.disabled_at IS NULL
       ORDER BY a.created_at`,
    )
    .bind(businessId)
    .all<{
      id: string;
      email: string;
      name: string | null;
      created_at: number;
      last_login_at: number | null;
    }>();
  return results.map((r) => ({
    id: r.id,
    email: r.email,
    name: r.name,
    createdAt: r.created_at,
    lastLoginAt: r.last_login_at,
  }));
}

export type AddAccountResult =
  | { ok: true; account: AccountSummary }
  | { ok: false; error: 'business_not_found' | 'already_member' };

/** Da acceso a un correo. Si la cuenta ya existe (dueña de otro negocio), se reutiliza. */
export async function addAccount(
  env: Env,
  businessId: string,
  input: CreateAccountBody,
  actor: Actor,
  now = Date.now(),
): Promise<AddAccountResult> {
  if (!(await businessExists(env.DB, businessId))) {
    return { ok: false, error: 'business_not_found' };
  }
  const name = input.name || null;
  await env.DB.prepare(
    `INSERT INTO accounts (id, email, name, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET disabled_at = NULL, name = COALESCE(excluded.name, name)`,
  )
    .bind(generateId('a'), input.email, name, now)
    .run();
  const account = await env.DB.prepare('SELECT id FROM accounts WHERE email = ?')
    .bind(input.email)
    .first<{ id: string }>();
  if (!account) throw new Error('No se pudo crear la cuenta');

  const member = await env.DB.prepare(
    'SELECT 1 AS ok FROM memberships WHERE account_id = ? AND business_id = ?',
  )
    .bind(account.id, businessId)
    .first<{ ok: number }>();
  if (member) return { ok: false, error: 'already_member' };

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO memberships (account_id, business_id, role, created_at)
       VALUES (?, ?, 'owner', ?)`,
    ).bind(account.id, businessId, now),
    auditStatement(env.DB, {
      businessId,
      actor,
      action: 'account.added',
      target: account.id,
      before: null,
      after: { email: input.email },
      ts: now,
    }),
  ]);
  const accounts = await listAccounts(env.DB, businessId);
  const summary = accounts.find((a) => a.id === account.id);
  if (!summary) throw new Error('Cuenta creada pero no encontrada');
  return { ok: true, account: summary };
}

/** Quita el acceso de una cuenta a un negocio (sus enlaces pendientes dejan de servir). */
export async function removeAccount(
  env: Env,
  businessId: string,
  accountId: string,
  actor: Actor,
  now = Date.now(),
): Promise<boolean> {
  const account = await env.DB.prepare(
    `SELECT a.email FROM memberships m JOIN accounts a ON a.id = m.account_id
     WHERE m.account_id = ? AND m.business_id = ?`,
  )
    .bind(accountId, businessId)
    .first<{ email: string }>();
  if (!account) return false;
  await env.DB.batch([
    env.DB.prepare('DELETE FROM memberships WHERE account_id = ? AND business_id = ?').bind(
      accountId,
      businessId,
    ),
    // Sin negocios, sus enlaces sin usar se invalidan.
    env.DB.prepare(
      `UPDATE login_tokens SET used_at = ? WHERE account_id = ? AND used_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM memberships WHERE account_id = ?)`,
    ).bind(now, accountId, accountId),
    auditStatement(env.DB, {
      businessId,
      actor,
      action: 'account.removed',
      target: accountId,
      before: { email: account.email },
      after: null,
      ts: now,
    }),
  ]);
  return true;
}

/** Enlace de acceso de un solo uso (el admin lo copia desde el panel). null si no es miembro. */
export async function createLoginLink(
  env: Env,
  businessId: string,
  accountId: string,
  now = Date.now(),
): Promise<LoginLinkResponse | null> {
  const member = await env.DB.prepare(
    `SELECT 1 AS ok FROM memberships m JOIN accounts a ON a.id = m.account_id
     WHERE m.account_id = ? AND m.business_id = ? AND a.disabled_at IS NULL`,
  )
    .bind(accountId, businessId)
    .first<{ ok: number }>();
  if (!member) return null;
  return issueLoginToken(env, accountId, 'invite', INVITE_LINK_TTL_MS, now);
}

export async function issueLoginToken(
  env: Env,
  accountId: string,
  purpose: 'invite' | 'email',
  ttlMs: number,
  now = Date.now(),
): Promise<LoginLinkResponse> {
  // 43 caracteres base62 ≈ 256 bits: imposible de adivinar.
  const token = randomBase62(43);
  const expiresAt = now + ttlMs;
  await env.DB.prepare(
    `INSERT INTO login_tokens (token_hash, account_id, purpose, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(await hashToken(token), accountId, purpose, now, expiresAt)
    .run();
  return { url: `${portalOrigin(env)}${LOGIN_PATH}/${token}`, expiresAt };
}

/** Enlaces caducados hace más de un día (cron diario). */
export async function cleanupLoginTokens(db: D1Database, now: number): Promise<void> {
  await db
    .prepare('DELETE FROM login_tokens WHERE expires_at < ?')
    .bind(now - 86_400_000)
    .run();
}
