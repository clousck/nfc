import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../src/index.js';
import { cleanupRateLimits } from '../src/rate-limit.js';
import type { Env } from '../src/env.js';
import { seedStaffDevice } from './staff-helpers.js';

const BIZ = 'b_cafe00000001';
const TOKEN = 'test-internal-token-0123456789abcdef';

let ipCounter = 0;
/** Cada test usa IPs propias: los contadores del limitador duran 60 s. */
const freshIp = () => `203.0.113.${++ipCounter}`;

async function call(
  path: string,
  init: { ip?: string; cookie?: string; mode?: 'observe' | 'enforce'; auth?: boolean } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (init.ip) headers['cf-connecting-ip'] = init.ip;
  if (init.cookie) headers['cookie'] = init.cookie;
  if (init.auth) headers['authorization'] = `Bearer ${TOKEN}`;
  const testEnv: Env = { ...env, RATE_LIMIT_MODE: init.mode ?? 'observe' };
  const ctx = createExecutionContext();
  const response = await worker.fetch(
    new Request(`https://go.penginexr.com${path}`, { headers }),
    testEnv,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return response;
}

async function hammer(times: number, path: string, init: Parameters<typeof call>[1]) {
  const statuses: number[] = [];
  for (let i = 0; i < times; i++) statuses.push((await call(path, init)).status);
  return statuses;
}

beforeEach(async () => {
  await env.DB.exec(
    'DELETE FROM rate_limit_incidents; DELETE FROM daily_salts; DELETE FROM staff_devices;',
  );
});

describe('límite de peticiones', () => {
  it('en modo observación nunca bloquea, pero registra el incidente una sola vez por minuto', async () => {
    const ip = freshIp();
    const statuses = await hammer(35, '/v/ABCD2345', { ip, mode: 'observe' });

    expect(statuses.every((s) => s !== 429)).toBe(true);
    const { results } = await env.DB.prepare('SELECT * FROM rate_limit_incidents').all();
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      business_id: '',
      action: 'validate',
      actor: 'anonymous',
      scope: 'network',
      mode: 'observe',
    });
    expect(JSON.stringify(results)).not.toContain(ip); // la IP no se guarda
  });

  it('en modo bloqueo responde 429 a partir del intento 31 sin credencial', async () => {
    const statuses = await hammer(31, '/v/ABCD2345', { ip: freshIp(), mode: 'enforce' });
    expect(statuses.slice(0, 30).every((s) => s !== 429)).toBe(true);
    expect(statuses[30]).toBe(429);
  });

  it('el personal tiene 3 veces el límite público', async () => {
    const cookie = await seedStaffDevice(BIZ);
    const statuses = await hammer(91, '/v/ABCD2345', { ip: freshIp(), cookie, mode: 'enforce' });
    expect(statuses.slice(0, 90).every((s) => s !== 429)).toBe(true);
    expect(statuses[90]).toBe(429);

    const row = await env.DB.prepare(
      'SELECT business_id, actor, scope FROM rate_limit_incidents',
    ).first();
    expect(row).toEqual({ business_id: BIZ, actor: 'staff', scope: 'staff' });
  });

  it('el resumen cuenta orígenes distintos y lo expone /internal/incidents', async () => {
    await hammer(31, '/v/ABCD2345', { ip: freshIp() });
    await hammer(31, '/v/ABCD2345', { ip: freshIp() });

    const res = await call('/internal/incidents?days=7', { auth: true });
    const body = (await res.json()) as {
      mode: string;
      incidents: Array<{ action: string; minutes: number; sources: number }>;
    };
    expect(body.mode).toBe('observe');
    expect(body.incidents).toEqual([
      expect.objectContaining({ action: 'validate', minutes: 1, sources: 2 }),
    ]);
  });

  it('la limpieza diaria borra incidentes de más de 90 días y sales de días pasados', async () => {
    const now = Date.UTC(2026, 9, 24, 12);
    await env.DB.exec(`
      INSERT INTO rate_limit_incidents VALUES ('', 'validate', 'anonymous', 'network', 'observe', ${now - 91 * 86_400_000}, 'viejo');
      INSERT INTO rate_limit_incidents VALUES ('', 'validate', 'anonymous', 'network', 'observe', ${now - 86_400_000}, 'reciente');
      INSERT INTO daily_salts VALUES ('2026-10-23', 'ayer'), ('2026-10-24', 'hoy');
    `);

    await cleanupRateLimits(env.DB, now);

    const incidents = await env.DB.prepare('SELECT source_hash FROM rate_limit_incidents').all();
    expect(incidents.results).toEqual([{ source_hash: 'reciente' }]);
    const salts = await env.DB.prepare('SELECT day FROM daily_salts').all();
    expect(salts.results).toEqual([{ day: '2026-10-24' }]);
  });
});
