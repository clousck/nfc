import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../src/index.js';

const TOKEN = 'test-internal-token-0123456789abcdef';
const BIZ = 'b_cafe00000001';
const OTHER = 'b_otro00000001';

async function call(method: string, path: string, body?: unknown) {
  const request = new Request(`https://go.penginexr.com/internal${path}`, {
    method,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const ctx = createExecutionContext();
  const response = await worker.fetch(request, env, ctx);
  await waitOnExecutionContext(ctx);
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

const putBusiness = (id: string, revision: number) =>
  call('PUT', `/businesses/${id}`, {
    id,
    name: 'Café',
    status: 'active',
    reportToken: null,
    loyaltyVisits: null,
    revision,
  });

beforeEach(async () => {
  await env.DB.exec(
    'DELETE FROM login_tokens; DELETE FROM memberships; DELETE FROM accounts; DELETE FROM audit_log; DELETE FROM business_profile; DELETE FROM business_settings;',
  );
});

describe('cuentas de los dueños', () => {
  it('solo para negocios que el Worker conoce', async () => {
    const res = await call('POST', `/businesses/${BIZ}/accounts`, { email: 'a@b.ec' });
    expect(res.status).toBe(404);
  });

  it('crea, normaliza el correo, lista y no duplica', async () => {
    await putBusiness(BIZ, 1);
    const created = await call('POST', `/businesses/${BIZ}/accounts`, {
      email: '  Dueno@Cafe.EC ',
      name: 'Ana',
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ email: 'dueno@cafe.ec', name: 'Ana', lastLoginAt: null });

    const again = await call('POST', `/businesses/${BIZ}/accounts`, { email: 'dueno@cafe.ec' });
    expect(again.status).toBe(409);

    const list = await call('GET', `/businesses/${BIZ}/accounts`);
    expect(list.body['accounts']).toHaveLength(1);
  });

  it('el mismo correo en otro negocio reutiliza la cuenta', async () => {
    await putBusiness(BIZ, 1);
    await putBusiness(OTHER, 2);
    const a = await call('POST', `/businesses/${BIZ}/accounts`, { email: 'x@y.ec' });
    const b = await call('POST', `/businesses/${OTHER}/accounts`, { email: 'x@y.ec' });
    expect(b.body['id']).toBe(a.body['id']);
  });

  it('rechaza correos inválidos', async () => {
    await putBusiness(BIZ, 1);
    expect((await call('POST', `/businesses/${BIZ}/accounts`, { email: 'no' })).status).toBe(400);
  });

  it('enlace de acceso: URL del portal, de 24 h, y en la base solo el hash', async () => {
    await putBusiness(BIZ, 1);
    const account = await call('POST', `/businesses/${BIZ}/accounts`, { email: 'x@y.ec' });
    const before = Date.now();
    const link = await call('POST', `/businesses/${BIZ}/accounts/${account.body['id']}/login-link`);

    expect(link.status).toBe(200);
    const url = String(link.body['url']);
    expect(url).toMatch(/^https:\/\/negocios\.penginexr\.com\/entrar\/[0-9A-Za-z]{43}$/);
    expect(Number(link.body['expiresAt']) - before).toBeGreaterThanOrEqual(24 * 3_600_000 - 1000);

    const token = url.split('/').pop() ?? '';
    const rows = await env.DB.prepare('SELECT token_hash, purpose FROM login_tokens').all<{
      token_hash: string;
      purpose: string;
    }>();
    expect(rows.results).toHaveLength(1);
    expect(rows.results[0]?.purpose).toBe('invite');
    expect(rows.results[0]?.token_hash).not.toContain(token);
  });

  it('quitar el acceso invalida sus enlaces y queda en la auditoría', async () => {
    await putBusiness(BIZ, 1);
    const account = await call('POST', `/businesses/${BIZ}/accounts`, { email: 'x@y.ec' });
    const id = String(account.body['id']);
    await call('POST', `/businesses/${BIZ}/accounts/${id}/login-link`);

    expect((await call('DELETE', `/businesses/${BIZ}/accounts/${id}`)).status).toBe(200);
    expect((await call('GET', `/businesses/${BIZ}/accounts`)).body['accounts']).toHaveLength(0);
    expect((await call('POST', `/businesses/${BIZ}/accounts/${id}/login-link`)).status).toBe(404);
    expect((await call('DELETE', `/businesses/${BIZ}/accounts/${id}`)).status).toBe(404);

    const pending = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM login_tokens WHERE used_at IS NULL',
    ).first<{ n: number }>();
    expect(pending?.n).toBe(0);

    const audit = await env.DB.prepare('SELECT action FROM audit_log ORDER BY id').all<{
      action: string;
    }>();
    expect(audit.results.map((r) => r.action)).toEqual(['account.added', 'account.removed']);
  });
});
