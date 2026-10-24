import type { Env } from './env.js';

// Ajustes globales que el admin cambia desde el panel. Si no hay valor en D1 se usa el de
// wrangler.toml (ADMIN_NOTIFY_EMAIL), que es el valor por defecto.

const ADMIN_NOTIFY_EMAIL = 'admin_notify_email';

export async function adminNotifyEmail(env: Env): Promise<string | null> {
  const row = await env.DB.prepare('SELECT value FROM app_settings WHERE key = ?')
    .bind(ADMIN_NOTIFY_EMAIL)
    .first<{ value: string }>();
  return row?.value ?? env.ADMIN_NOTIFY_EMAIL ?? null;
}

export async function setAdminNotifyEmail(env: Env, email: string, now = Date.now()) {
  await env.DB.prepare(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  )
    .bind(ADMIN_NOTIFY_EMAIL, email, now)
    .run();
}
