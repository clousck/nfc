import { env } from 'cloudflare:workers';
import { generateId, randomBase62 } from '@nfc/shared';
import { hashToken } from '../src/loyalty/security.js';
import { STAFF_COOKIE } from '../src/staff/store.js';

/**
 * Móvil del personal ya vinculado (atajo para tests que no prueban la vinculación).
 * Devuelve la cookie `__Host-nfc_staff=<token>` lista para enviar.
 */
export async function seedStaffDevice(businessId: string, name = 'Café'): Promise<string> {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO business_profile (id, name, status, revision) VALUES (?, ?, 'active', 1)`,
  )
    .bind(businessId, name)
    .run();
  const token = randomBase62(43);
  await env.DB.prepare(
    `INSERT INTO staff_devices (id, business_id, label, token_hash, created_at) VALUES (?, ?, 'Caja', ?, ?)`,
  )
    .bind(generateId('d'), businessId, await hashToken(token), Date.now())
    .run();
  return `${STAFF_COOKIE}=${token}`;
}
